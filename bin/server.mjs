#!/usr/bin/env node
// The office server: keeps the state of every Claude Code session and subagent
// that the hook reports, and serves the office page on 127.0.0.1 only.

import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { Office } from "../lib/state.mjs";
import { clean } from "../lib/extract.mjs";
import { play, soundById, soundList } from "../lib/sounds.mjs";
import { notify, alertText } from "../lib/notify.mjs";
import { createContextService } from "../lib/context.mjs";
import { isTranscript, lastInterrupt } from "../lib/transcript.mjs";
import {
  ROOT,
  STATE_FILE,
  RUN_FILE,
  OPENED_FILE,
  ensureHome,
  loadConfig,
  saveConfig,
  officeUrl,
  REMIND_CHOICES,
} from "../lib/paths.mjs";

const args = new Set(process.argv.slice(2));
const cfg = loadConfig();
cfg.sound = soundById(cfg.sound).id;
if (!REMIND_CHOICES.includes(cfg.remindMinutes)) cfg.remindMinutes = 3;
const URL_BASE = officeUrl(cfg);
const WEB = path.join(ROOT, "web");
const OPEN_COOLDOWN = 10 * 60_000;
const startedByHook = process.env.AGENT_OFFICE_STARTED_BY === "hook";

ensureHome();
const office = new Office({ forgetAfterHours: cfg.forgetAfterHours });
try {
  office.load(JSON.parse(fs.readFileSync(STATE_FILE, "utf8")));
} catch {
  /* first run or unreadable: start empty */
}

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- static files: a fixed list, read once ----------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };
const files = new Map();
for (const name of fs.readdirSync(WEB)) {
  const ext = path.extname(name);
  if (TYPES[ext]) files.set("/" + name, { file: path.join(WEB, name), type: TYPES[ext] });
}
files.set("/", files.get("/index.html"));

// ---------- live clients (server-sent events) ----------
const clients = new Set();
let sentVersion = -1;
function broadcast(force = false) {
  const snap = office.snapshot();
  if (!force && snap.version === sentVersion) return;
  sentVersion = snap.version;
  const msg = `data: ${JSON.stringify(snap)}\n\n`;
  for (const res of clients) res.write(msg);
}
let pending = null;
function scheduleBroadcast() {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    broadcast();
  }, 60);
}

// ---------- persistence ----------
let savedVersion = office.version;
function save() {
  if (office.version === savedVersion) return;
  savedVersion = office.version;
  const tmp = STATE_FILE + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(office.dump()), { mode: 0o600 });
    fs.renameSync(tmp, STATE_FILE);
  } catch (err) {
    log("save failed:", err.message);
  }
}

// ---------- opening the page ----------
function lastOpened() {
  try {
    return Number(fs.readFileSync(OPENED_FILE, "utf8")) || 0;
  } catch {
    return 0;
  }
}
function openBrowser(reason, force = false) {
  const now = Date.now();
  if (!force && now - lastOpened() < OPEN_COOLDOWN) return;
  try {
    fs.writeFileSync(OPENED_FILE, String(now));
  } catch {
    /* ignore */
  }
  const [cmd, cmdArgs] =
    process.platform === "darwin"
      ? ["open", [URL_BASE]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", URL_BASE]]
        : ["xdg-open", [URL_BASE]];
  try {
    spawn(cmd, cmdArgs, { detached: true, stdio: "ignore" }).unref();
    log("opened the page:", reason);
  } catch (err) {
    log("could not open the page:", err.message);
  }
}

// ---------- requests ----------
const ALLOWED_HOSTS = new Set([`127.0.0.1:${cfg.port}`, `localhost:${cfg.port}`]);
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
  "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
};

function send(res, code, body, type = "application/json") {
  res.writeHead(code, { ...SECURITY_HEADERS, "content-type": type });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

// only known keys, only short strings: the hook already cleaned them, this is a second fence
const EVENT_KEYS = ["event", "session", "agentId", "agentType", "tool", "detail", "toolUseId", "notification", "source", "reason", "error", "model", "subagentType", "description"];
function sanitize(e) {
  if (!e || typeof e !== "object") return null;
  const out = {};
  for (const k of EVENT_KEYS) if (typeof e[k] === "string") out[k] = clean(e[k], 120);
  if (typeof e.cwd === "string") out.cwd = e.cwd.slice(0, 1024);
  if (typeof e.transcript === "string" && isTranscript(e.transcript)) out.transcript = path.resolve(e.transcript);
  return out;
}

// a small JSON body from no origin (the hook) or from the office page itself
function readJson(req, res, done) {
  if (!String(req.headers["content-type"] || "").startsWith("application/json")) return send(res, 415, { error: "json only" });
  const origin = req.headers.origin;
  if (origin && origin !== URL_BASE.slice(0, -1) && origin !== `http://localhost:${cfg.port}`) return send(res, 403, { error: "origin" });
  let size = 0;
  const chunks = [];
  req.on("data", (c) => {
    size += c.length;
    if (size > 64 * 1024) {
      send(res, 413, { error: "too large" });
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on("end", () => {
    if (res.writableEnded) return;
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return send(res, 400, { error: "bad json" });
    }
    done(body);
  });
}

// ---------- telling you an agent waits ----------
const SOUND_GAP = 6000; // several agents asking at once play the sound once
let lastSound = 0;
function sound(why) {
  if (!cfg.bell) return;
  const t = Date.now();
  if (t - lastSound < SOUND_GAP) return;
  lastSound = t;
  log(`sound (${cfg.sound}):`, why);
  play(cfg.sound, log);
}
function alert(a, reminder = false) {
  if (!a) return;
  const text = alertText(a, reminder);
  sound(text.body);
  if (cfg.notify) notify(text, log);
}

// while a session keeps waiting, remind every remindMinutes
const reminded = new Map(); // session id -> { since, count }
const MINUTE = Number(process.env.AGENT_OFFICE_MINUTE_MS) || 60_000; // the tests shorten it
function remindLoop() {
  const t = Date.now();
  const waiting = new Set();
  for (const s of office.snapshot().sessions) {
    if (s.state !== "needs-you") continue;
    waiting.add(s.id);
    let r = reminded.get(s.id);
    if (!r || r.since !== s.since) reminded.set(s.id, (r = { since: s.since, count: 0 }));
    if (!cfg.remindMinutes) continue;
    if (t - s.since >= cfg.remindMinutes * MINUTE * (r.count + 1)) {
      r.count++;
      alert({ session: s.id, project: s.project, reason: s.reason, agentType: null }, true);
    }
  }
  for (const id of reminded.keys()) if (!waiting.has(id)) reminded.delete(id);
}
setInterval(remindLoop, Number(process.env.AGENT_OFFICE_REMIND_TICK) || 10_000).unref();

// ---------- Esc: an interrupt fires no hook, but lands in the transcript ----------
// Only Claude Code transcripts are read, only their last 16 KB, only to find
// the interrupt marker. Nothing from them is kept or sent anywhere.
const seenMtime = new Map(); // transcript -> mtime already checked
const TAIL = 16 * 1024;
function interruptLoop() {
  const live = new Set();
  for (const w of office.watchList()) {
    live.add(w.transcript);
    let st;
    try {
      st = fs.statSync(w.transcript);
    } catch {
      continue;
    }
    if (seenMtime.get(w.transcript) === st.mtimeMs) continue;
    seenMtime.set(w.transcript, st.mtimeMs);
    let text = "";
    try {
      const fd = fs.openSync(w.transcript, "r");
      const len = Math.min(TAIL, st.size);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, st.size - len);
      fs.closeSync(fd);
      text = buf.toString("utf8");
    } catch {
      continue;
    }
    const at = lastInterrupt(text);
    if (at && office.interrupt(w.id, at)) {
      log("interrupted (Esc) in a session, now idle");
      scheduleBroadcast();
    }
  }
  for (const k of seenMtime.keys()) if (!live.has(k)) seenMtime.delete(k);
}
setInterval(interruptLoop, Number(process.env.AGENT_OFFICE_INTERRUPT_TICK) || 2000).unref();

function handleEvent(req, res) {
  readJson(req, res, (body) => {
    const e = sanitize(body);
    const alerts = office.alerts;
    const applied = office.apply(e);
    if (applied) scheduleBroadcast();
    if (office.alerts > alerts) alert(office.lastAlert);
    if (
      applied &&
      e.event === "SessionStart" &&
      e.source !== "compact" &&
      e.source !== "clear" &&
      cfg.openBrowser === "when-closed" &&
      clients.size === 0
    ) {
      openBrowser("a session started and no page was open");
    }
    res.writeHead(204, SECURITY_HEADERS);
    res.end();
  });
}

// settings the page can change: the sound on or off, which sound, and a preview
// startup context of a session: the server finds the folder from its own state,
// the page never sends a path
const contextService = createContextService();
async function handleContext(url, res) {
  if (!cfg.contextHealth) return send(res, 404, { error: "off" });
  const s = office.sessions.get(url.searchParams.get("session") || "");
  if (!s || !s.cwd) return send(res, 404, { error: "unknown session" });
  try {
    send(res, 200, await contextService.get(s.cwd));
  } catch (err) {
    log("context scan failed:", err.message);
    send(res, 500, { error: "scan" });
  }
}

const settingsBody = () => ({ bell: cfg.bell, sound: cfg.sound, notify: cfg.notify, remindMinutes: cfg.remindMinutes, contextHealth: cfg.contextHealth, remindChoices: REMIND_CHOICES, sounds: soundList() });
let lastPreview = 0;
function handleSettings(req, res) {
  readJson(req, res, (body) => {
    if (!body || typeof body !== "object") return send(res, 400, { error: "bad settings" });
    const patch = {};
    if (typeof body.bell === "boolean" && body.bell !== cfg.bell) patch.bell = body.bell;
    if (typeof body.notify === "boolean" && body.notify !== cfg.notify) patch.notify = body.notify;
    if (body.remindMinutes !== undefined) {
      if (!REMIND_CHOICES.includes(body.remindMinutes)) return send(res, 400, { error: "bad reminder" });
      if (body.remindMinutes !== cfg.remindMinutes) patch.remindMinutes = body.remindMinutes;
    }
    if (typeof body.sound === "string") {
      if (soundById(body.sound).id !== body.sound) return send(res, 400, { error: "unknown sound" });
      if (body.sound !== cfg.sound) patch.sound = body.sound;
    }
    if (Object.keys(patch).length) {
      Object.assign(cfg, patch);
      try {
        saveConfig(patch);
      } catch (err) {
        log("could not save the settings:", err.message);
      }
      log("settings changed from the page:", JSON.stringify(patch));
    }
    // a preview plays the named sound (or the chosen one) even when the sound is off
    if (body.preview === true || typeof body.preview === "string") {
      const id = typeof body.preview === "string" ? body.preview : cfg.sound;
      if (soundById(id).id !== id) return send(res, 400, { error: "unknown sound" });
      const t = Date.now();
      if (t - lastPreview > 400) {
        lastPreview = t;
        play(id, log);
      }
    }
    send(res, 200, settingsBody());
  });
}

const server = http.createServer((req, res) => {
  if (!ALLOWED_HOSTS.has(String(req.headers.host || "").toLowerCase())) return send(res, 421, { error: "host" });
  const url = new URL(req.url, URL_BASE);

  if (req.method === "POST" && url.pathname === "/api/event") return handleEvent(req, res);
  if (req.method === "POST" && url.pathname === "/api/settings") return handleSettings(req, res);
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "method" });

  if (url.pathname === "/api/ping") return send(res, 200, { app: "agent-office", pid: process.pid, port: cfg.port });
  if (url.pathname === "/api/state") return send(res, 200, office.snapshot());
  if (url.pathname === "/api/settings") return send(res, 200, settingsBody());
  if (url.pathname === "/api/context") return handleContext(url, res);
  if (url.pathname === "/api/stream") {
    res.writeHead(200, { ...SECURITY_HEADERS, "content-type": "text/event-stream", connection: "keep-alive" });
    res.write(`retry: 2000\ndata: ${JSON.stringify(office.snapshot())}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  const f = files.get(url.pathname);
  if (!f) return send(res, 404, { error: "not found" });
  // read on each request so editing the page needs only a reload
  fs.readFile(f.file, (err, buf) => (err ? send(res, 500, { error: "read" }) : send(res, 200, buf, f.type)));
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    log(`port ${cfg.port} is in use, another office is probably running`);
    process.exit(0);
  }
  log("server error:", err.message);
  process.exit(1);
});

server.listen(cfg.port, "127.0.0.1", () => {
  fs.writeFileSync(RUN_FILE, JSON.stringify({ pid: process.pid, port: cfg.port, startedAt: new Date().toISOString() }), { mode: 0o600 });
  log(`agent office on ${URL_BASE} (pid ${process.pid})`);
  if (args.has("--no-open")) return;
  if (!startedByHook && !args.has("--background")) openBrowser("started from the terminal", true);
  else if (startedByHook && cfg.openBrowser === "on-start") openBrowser("started by a claude session");
});

const timers = [
  setInterval(() => broadcast(), 5_000), // prunes stale state and pushes it
  setInterval(save, 5_000),
  setInterval(() => {
    for (const res of clients) res.write(": keep-alive\n\n");
  }, 20_000),
];

function shutdown() {
  timers.forEach(clearInterval);
  save();
  try {
    const run = JSON.parse(fs.readFileSync(RUN_FILE, "utf8"));
    if (run.pid === process.pid) fs.unlinkSync(RUN_FILE);
  } catch {
    /* ignore */
  }
  for (const res of clients) res.end();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
