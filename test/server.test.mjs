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
  fs.writeFileSync(path.join(HOME, "config.json"), JSON.stringify({ openBrowser: "never", remindMinutes: 1 }));
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
