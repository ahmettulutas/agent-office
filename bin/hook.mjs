#!/usr/bin/env node
// Claude Code runs this for every hook event (installed by `agent-office install`).
// It reads the payload, keeps only the small event, and sends it to the local
// office server, starting the server first if it is not running.
// It never prints (SessionStart output would go into Claude's context) and
// always exits 0.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { extract } from "../lib/extract.mjs";
import { ROOT, SPAWN_LOCK, LOG_FILE, ensureHome, loadConfig } from "../lib/paths.mjs";

const cfg = loadConfig();

function post(body) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: cfg.port,
        path: "/api/event",
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
        timeout: 1500,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 204 || res.statusCode === 200 ? "ok" : "bad");
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", (err) => resolve(err.code === "ECONNREFUSED" ? "down" : "bad"));
    req.end(body);
  });
}

function ping() {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: cfg.port, path: "/api/ping", timeout: 300 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureServer() {
  ensureHome();
  let fd;
  try {
    fd = fs.openSync(SPAWN_LOCK, "wx");
  } catch {
    // another hook is starting it; a lock older than 15 s is stale
    try {
      if (Date.now() - fs.statSync(SPAWN_LOCK).mtimeMs > 15_000) fs.unlinkSync(SPAWN_LOCK);
    } catch {
      /* ignore */
    }
  }
  if (fd !== undefined) {
    fs.closeSync(fd);
    const log = fs.openSync(LOG_FILE, "a");
    const child = spawn(process.execPath, [path.join(ROOT, "bin", "server.mjs"), "--background"], {
      detached: true,
      stdio: ["ignore", log, log],
      env: { ...process.env, AGENT_OFFICE_STARTED_BY: "hook" },
    });
    child.unref();
    fs.closeSync(log);
  }
  for (let i = 0; i < 40; i++) {
    if (await ping()) break;
    await sleep(100);
  }
  if (fd !== undefined) {
    try {
      fs.unlinkSync(SPAWN_LOCK);
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  if (process.stdin.isTTY) return;
  let raw;
  try {
    raw = fs.readFileSync(0, "utf8");
  } catch {
    return;
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }
  const event = extract(payload);
  if (!event) return;
  const body = JSON.stringify(event);
  if ((await post(body)) === "down") {
    await ensureServer();
    await post(body);
  }
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
