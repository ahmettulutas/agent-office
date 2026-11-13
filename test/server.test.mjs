// Runs a real server in a temporary home, with sound and notifications muted
// (they only log), short minutes for reminders and fast timers.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "agent-office-test-"));
const CLAUDE = path.join(HOME, "claude");
const PORT = 47900 + Math.floor(Math.random() * 90);
let child;
let out = "";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await wait(30);
  }
  return false;
}
const lines = (re) => out.split("\n").filter((l) => re.test(l));

function request(method, p, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        agent: false, // a fresh connection each time: the 413 test closes its socket
        path: p,
        method,
        headers: { host: `127.0.0.1:${PORT}`, ...(data !== undefined ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}), ...headers },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(b);
          } catch {
            /* not json */
          }
          resolve({ status: res.statusCode, json });
        });
      },
    );
    req.on("error", reject);
    if (data !== undefined) req.write(data);
    req.end();
  });
}
const event = (e) => request("POST", "/api/event", { body: e });
const session = async (id) => (await request("GET", "/api/state")).json.sessions.find((s) => s.id === id);

before(async () => {
  fs.mkdirSync(path.join(CLAUDE, "projects", "p"), { recursive: true });
  fs.writeFileSync(path.join(HOME, "config.json"), JSON.stringify({ openBrowser: "never", remindMinutes: 1, exportEnabled: true }));
  child = spawn(process.execPath, [path.join(ROOT, "bin", "server.mjs"), "--no-open"], {
    env: {
      ...process.env,
      AGENT_OFFICE_HOME: HOME,
      AGENT_OFFICE_PORT: String(PORT),
      AGENT_OFFICE_MUTE: "1",
      AGENT_OFFICE_MINUTE_MS: "300",
      AGENT_OFFICE_REMIND_TICK: "50",
      AGENT_OFFICE_INTERRUPT_TICK: "50",
      CLAUDE_CONFIG_DIR: CLAUDE,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (c) => (out += c));
  child.stderr.on("data", (c) => (out += c));
  assert.ok(await until(() => out.includes("agent office on")), `server did not start:\n${out}`);
});

after(async () => {
  if (child && child.exitCode === null) {
    const done = new Promise((r) => child.on("exit", r));
    child.kill("SIGTERM");
    await done;
  }
  fs.rmSync(HOME, { recursive: true, force: true });
});

test("only its own host names and only JSON events from no origin or its own", async () => {
  assert.equal((await request("GET", "/api/ping")).json.app, "agent-office");
  assert.equal((await request("GET", "/api/ping", { headers: { host: "evil.example" } })).status, 421);
  assert.equal((await request("POST", "/api/event", { body: "x", headers: { "content-type": "text/plain" } })).status, 415);
  assert.equal((await request("POST", "/api/event", { body: { event: "Stop", session: "s" }, headers: { origin: "https://evil.example" } })).status, 403);
  assert.equal((await request("POST", "/api/event", { body: "{not json" })).status, 400);
  assert.equal((await request("POST", "/api/event", { body: "x".repeat(70 * 1024) }).catch(() => ({ status: 413 }))).status, 413);
  assert.equal((await request("PUT", "/api/event")).status, 405);
});

test("settings: checked, saved to config.json, refused from other sites", async () => {
  const s = (await request("GET", "/api/settings")).json;
  assert.equal(s.sounds.length >= 6, true);
  assert.equal((await request("POST", "/api/settings", { body: { sound: "nope" } })).status, 400);
  assert.equal((await request("POST", "/api/settings", { body: { remindMinutes: 7 } })).status, 400);
  assert.equal((await request("POST", "/api/settings", { body: { bell: false }, headers: { origin: "https://evil.example" } })).status, 403);
  const r = await request("POST", "/api/settings", { body: { sound: "gong", notify: true } });
  assert.equal(r.json.sound, "gong");
  assert.equal(JSON.parse(fs.readFileSync(path.join(HOME, "config.json"), "utf8")).sound, "gong");
  // the preview plays even when the sound is off
  await request("POST", "/api/settings", { body: { bell: false, preview: "chime" } });
  assert.ok(await until(() => lines(/play \(muted\): chime/).length === 1));
  await request("POST", "/api/settings", { body: { bell: true } });
});

test("a waiting session plays the sound once, notifies each time, and reminds", async () => {
  const before = lines(/play \(muted\): gong/).length;
  for (const id of ["w1", "w2"]) {
    await event({ event: "UserPromptSubmit", session: id, cwd: `/work/proj-${id}` });
    await event({ event: "PreToolUse", session: id, tool: "Bash", toolUseId: `${id}-t` });
    await event({ event: "Notification", session: id, notification: "permission_prompt" });
  }
  assert.ok(await until(() => lines(/notify \(muted\): Agent Office: proj-w2 needs your OK/).length === 1));
  assert.equal(lines(/notify \(muted\): Agent Office: proj-w1 needs your OK/).length, 1);
  // two at once: one sound
  assert.equal(lines(/play \(muted\): gong/).length - before, 1);
  // still waiting after a (test) minute: a reminder
  assert.ok(await until(() => lines(/Still waiting for you: proj-w1 needs your OK/).length >= 1, 2000));
  for (const id of ["w1", "w2"]) await event({ event: "PostToolUse", session: id, tool: "Bash", toolUseId: `${id}-t` });
});

test("Esc in the transcript ends the turn; transcripts elsewhere are ignored", async () => {
  const file = path.join(CLAUDE, "projects", "p", "esc.jsonl");
  const outside = path.join(HOME, "elsewhere.jsonl");
  const rec = () => JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user]" }] }, timestamp: new Date().toISOString() }) + "\n";
  fs.writeFileSync(file, '{"type":"assistant"}\n');
  fs.writeFileSync(outside, '{"type":"assistant"}\n');
  await event({ event: "UserPromptSubmit", session: "esc", cwd: "/work/esc", transcript: file });
  await event({ event: "UserPromptSubmit", session: "esc2", cwd: "/work/esc2", transcript: outside });
  assert.equal((await session("esc")).state, "busy");
  await wait(120);
  fs.appendFileSync(file, rec());
  fs.appendFileSync(outside, rec());
  assert.ok(await until(async () => (await session("esc")).state === "idle"), "the interrupted session should be idle");
  assert.equal((await session("esc2")).state, "busy");
  // the transcript path never reaches the page
  assert.equal("transcript" in (await session("esc")), false);
});

// ---------- export ----------
function rawRequest(p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { host: "127.0.0.1", port: PORT, agent: false, path: p, method: "POST", headers: { host: `127.0.0.1:${PORT}`, "content-type": "application/json", "content-length": Buffer.byteLength(data), ...headers } },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: b }));
      },
    );
    req.on("error", reject);
    req.end(data);
  });
}
const ORIGIN = () => ({ origin: `http://127.0.0.1:${PORT}` });

test("export: only for the page, a known session and a real transcript; nothing stored", async () => {
  const file = path.join(CLAUDE, "projects", "p", "exp.jsonl");
  const SECRET = "sk-ant-api03-FAKEFAKEFAKEFAKE9999";
  fs.writeFileSync(
    file,
    [
      { type: "user", uuid: "u1", parentUuid: null, message: { role: "user", content: `hello ${SECRET}` } },
      { type: "assistant", uuid: "a1", parentUuid: "u1", message: { id: "m1", role: "assistant", content: [{ type: "text", text: "hi" }] } },
    ].map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  await event({ event: "UserPromptSubmit", session: "ex1", cwd: "/work/ex", transcript: file });
  const before = fs.readdirSync(HOME).sort();

  const ok = await rawRequest("/api/export", { session: "ex1" }, ORIGIN());
  assert.equal(ok.status, 200);
  assert.match(ok.headers["content-disposition"], /^attachment; filename="agent-office-trace-ex1\.json"$/);
  assert.equal(ok.headers["cache-control"], "no-store");
  const t = JSON.parse(ok.text);
  assert.equal(t.version, 1);
  assert.equal(t.messages.length, 2);
  assert.equal(ok.text.includes(SECRET), false);
  assert.ok(lines(/export: safe, 2 messages/).length >= 1);
  assert.equal(out.includes(SECRET), false, "the log carries counters only");
  assert.deepEqual(fs.readdirSync(HOME).sort(), before, "nothing written to disk");

  assert.equal((await rawRequest("/api/export", { session: "ex1", mode: "full" }, ORIGIN())).status, 200);
  assert.equal((await rawRequest("/api/export", { session: "ex1", mode: "nope" }, ORIGIN())).status, 400);
  assert.equal((await rawRequest("/api/export", { session: "ghost" }, ORIGIN())).status, 404);
  assert.equal((await rawRequest("/api/export", { session: "ex1" })).status, 403, "no origin");
  assert.equal((await rawRequest("/api/export", { session: "ex1" }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await request("GET", "/api/export")).status, 404, "POST only");
});

test("export: a transcript that left the projects folder through a symlink is refused", async () => {
  const outside = path.join(HOME, "outside.jsonl");
  fs.writeFileSync(outside, JSON.stringify({ type: "user", uuid: "u", parentUuid: null, message: { role: "user", content: "x" } }) + "\n");
  const link = path.join(CLAUDE, "projects", "p", "link.jsonl");
  fs.symlinkSync(outside, link);
  await event({ event: "UserPromptSubmit", session: "ex2", cwd: "/work/ex2", transcript: link });
  assert.equal((await rawRequest("/api/export", { session: "ex2" }, ORIGIN())).status, 404);
});

test("export: reported in settings, off by default, not changeable from the page", async () => {
  const { DEFAULT_CONFIG } = await import("../lib/paths.mjs");
  assert.equal(DEFAULT_CONFIG.exportEnabled, false);
  assert.equal((await request("GET", "/api/settings")).json.exportEnabled, true);
  const r = await request("POST", "/api/settings", { body: { exportEnabled: false } });
  assert.equal(r.json.exportEnabled, true);
});

// ---------- metrics ----------
test("metrics: off by default, switched on from the page, counters only, known sessions only", async () => {
  const { DEFAULT_CONFIG } = await import("../lib/paths.mjs");
  assert.equal(DEFAULT_CONFIG.metrics, false);
  const file = path.join(CLAUDE, "projects", "p", "met.jsonl");
  const TEXT = "PRIVATE-PROMPT-TEXT";
  fs.writeFileSync(
    file,
    [
      { type: "assistant", uuid: "a", message: { id: "m1", model: "claude-x", content: [{ type: "text", text: TEXT }], usage: { input_tokens: 3, output_tokens: 4, cache_read_input_tokens: 5, cache_creation_input_tokens: 6 } } },
      { type: "cost-state", totalCostUSD: 0.5, totalAPIDuration: 10, totalToolDuration: 20, totalDuration: 30, modelUsage: { "claude-x": { costUSD: 0.5 } } },
    ].map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  await event({ event: "UserPromptSubmit", session: "me1", cwd: "/work/me", transcript: file });

  assert.equal((await request("GET", "/api/settings")).json.metrics, false);
  assert.equal((await request("GET", "/api/metrics?session=me1")).status, 404, "off: nothing is read");

  assert.equal((await request("POST", "/api/settings", { body: { metrics: true }, headers: { origin: "https://evil.example" } })).status, 403);
  assert.equal((await request("POST", "/api/settings", { body: { metrics: true } })).json.metrics, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(HOME, "config.json"), "utf8")).metrics, true);

  const r = await request("GET", "/api/metrics?session=me1");
  assert.equal(r.status, 200);
  assert.equal(r.json.sessionId, "me1");
  assert.deepEqual(r.json.totals, { input: 3, output: 4, cacheRead: 5, cacheWrite: 6, cacheHitRatio: 5 / 14, costUsd: 0.5 });
  assert.equal(r.json.confidence, "observed");
  assert.equal(JSON.stringify(r.json).includes(TEXT), false);
  assert.equal(JSON.stringify(r.json).includes(HOME), false);
  assert.equal((await request("GET", "/api/metrics?session=ghost")).status, 404);
  assert.equal((await request("GET", "/api/metrics")).status, 404);

  await request("POST", "/api/settings", { body: { metrics: false } });
  assert.equal((await request("GET", "/api/metrics?session=me1")).status, 404);
});

test("metrics: a transcript that left the projects folder through a symlink is refused", async () => {
  const outside = path.join(HOME, "outside-m.jsonl");
  fs.writeFileSync(outside, JSON.stringify({ type: "assistant", message: { id: "x", model: "m", usage: { input_tokens: 1 } } }) + "\n");
  const link = path.join(CLAUDE, "projects", "p", "linkm.jsonl");
  fs.symlinkSync(outside, link);
  await event({ event: "UserPromptSubmit", session: "me2", cwd: "/work/me2", transcript: link });
  await request("POST", "/api/settings", { body: { metrics: true } });
  assert.equal((await request("GET", "/api/metrics?session=me2")).status, 404);
  await request("POST", "/api/settings", { body: { metrics: false } });
});
