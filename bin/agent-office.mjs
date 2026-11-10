#!/usr/bin/env node
// agent-office: a live 3D office of your Claude Code agents.
//
//   agent-office install      add the hooks to ~/.claude/settings.json (backup first)
//   agent-office uninstall    remove exactly those hooks
//   agent-office start        run the server in this terminal and open the page
//   agent-office on | off     run it in the background, or stop it
//   agent-office open         open the page (starts the server if needed)
//   agent-office status       is it running
//   agent-office sound on|off|list|use <name>|test [name]   the sound when an agent needs you
//   agent-office demo         play a scripted day at the office (fake sessions)

import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import path from "node:path";
import readline from "node:readline/promises";
import { spawn } from "node:child_process";
import { ROOT, HOME_DIR, RUN_FILE, LOG_FILE, ensureHome, loadConfig, saveConfig, officeUrl } from "../lib/paths.mjs";
import { play, soundById, soundFile, SOUNDS } from "../lib/sounds.mjs";

const cfg = loadConfig();
const URL_BASE = officeUrl(cfg);
const MARKER = "# agent-office";
const HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
  "SessionEnd",
];
const SETTINGS = process.env.CLAUDE_CONFIG_DIR
  ? path.join(process.env.CLAUDE_CONFIG_DIR, "settings.json")
  : path.join(os.homedir(), ".claude", "settings.json");

const [cmd = "help", ...rest] = process.argv.slice(2);
const flags = new Set(rest);

function postSettings(body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { host: "127.0.0.1", port: cfg.port, path: "/api/settings", method: "POST", timeout: 1000, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) } },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode === 200));
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => req.destroy());
    req.end(data);
  });
}

function ping() {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: cfg.port, path: "/api/ping", timeout: 500 }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => {
        try {
          const j = JSON.parse(b);
          resolve(j.app === "agent-office" ? j : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function openPage() {
  const [c, a] =
    process.platform === "darwin"
      ? ["open", [URL_BASE]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", URL_BASE]]
        : ["xdg-open", [URL_BASE]];
  spawn(c, a, { detached: true, stdio: "ignore" }).unref();
}

async function startBackground() {
  if (await ping()) return true;
  ensureHome();
  const log = fs.openSync(LOG_FILE, "a");
  spawn(process.execPath, [path.join(ROOT, "bin", "server.mjs"), "--background"], {
    detached: true,
    stdio: ["ignore", log, log],
  }).unref();
  for (let i = 0; i < 40; i++) {
    if (await ping()) return true;
    await sleep(100);
  }
  return false;
}

// ---------- settings.json ----------
function hookCommand() {
  const node = process.execPath;
  const hook = path.join(ROOT, "bin", "hook.mjs");
  // fall back to `node` on PATH if this node goes away (an nvm upgrade); never fail the hook
  return `N=${JSON.stringify(node)}; [ -x "$N" ] || N=node; "$N" ${JSON.stringify(hook)} >/dev/null 2>&1; true ${MARKER}`;
}

function readSettings() {
  if (!fs.existsSync(SETTINGS)) return {};
  const raw = fs.readFileSync(SETTINGS, "utf8");
  const json = JSON.parse(raw);
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error(`${SETTINGS} is not a JSON object`);
  return json;
}

function stripOurs(settings) {
  const hooks = settings.hooks || {};
  let removed = 0;
  for (const ev of Object.keys(hooks)) {
    if (!Array.isArray(hooks[ev])) continue;
    hooks[ev] = hooks[ev]
      .map((group) => {
        if (!group || !Array.isArray(group.hooks)) return group;
        const kept = group.hooks.filter((h) => !(typeof h?.command === "string" && h.command.includes(MARKER)));
        removed += group.hooks.length - kept.length;
        return { ...group, hooks: kept };
      })
      .filter((group) => !group || !Array.isArray(group.hooks) || group.hooks.length > 0);
    if (hooks[ev].length === 0) delete hooks[ev];
  }
  if (settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks;
  return removed;
}

function writeSettings(settings) {
  ensureHome();
  const backups = path.join(HOME_DIR, "backups");
  fs.mkdirSync(backups, { recursive: true, mode: 0o700 });
  if (fs.existsSync(SETTINGS)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = path.join(backups, `settings-${stamp}.json`);
    fs.copyFileSync(SETTINGS, backup);
    console.log(`backup: ${backup}`);
  }
  const target = fs.existsSync(SETTINGS) ? fs.realpathSync(SETTINGS) : SETTINGS;
  const tmp = `${target}.agent-office.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n");
  fs.renameSync(tmp, target);
}

async function confirm(question) {
  if (flags.has("--yes") || flags.has("-y")) return true;
  if (!process.stdin.isTTY) {
    console.log("no terminal to ask in: pass --yes");
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(a.trim());
}

async function install() {
  const settings = readSettings();
  stripOurs(settings);
  console.log(`This adds ${HOOK_EVENTS.length} async hooks to ${SETTINGS}, after your own.`);
  console.log(`Each runs: ${hookCommand()}`);
  if (!(await confirm("Continue?"))) return console.log("nothing changed");
  settings.hooks = settings.hooks || {};
  for (const ev of HOOK_EVENTS) {
    settings.hooks[ev] = Array.isArray(settings.hooks[ev]) ? settings.hooks[ev] : [];
    settings.hooks[ev].push({ hooks: [{ type: "command", command: hookCommand(), async: true, timeout: 10 }] });
  }
  writeSettings(settings);
  console.log("installed. New claude sessions start the office and show up in it.");
  console.log(`page: ${URL_BASE}`);
}

async function uninstall() {
  const settings = readSettings();
  const removed = stripOurs(settings);
  if (removed === 0) return console.log("no agent-office hooks found, nothing changed");
  if (!(await confirm(`Remove ${removed} agent-office hooks from ${SETTINGS}?`))) return console.log("nothing changed");
  writeSettings(settings);
  console.log(`removed ${removed} hooks`);
}

// ---------- demo ----------
async function demo() {
  if (!(await startBackground())) return console.log("could not start the server");
  if (!flags.has("--no-open")) openPage();
  const post = (e) =>
    new Promise((resolve) => {
      const body = JSON.stringify(e);
      const req = http.request(
        { host: "127.0.0.1", port: cfg.port, path: "/api/event", method: "POST", headers: { "content-type": "application/json" } },
        (res) => {
          res.resume();
          resolve();
        },
      );
      req.on("error", resolve);
      req.end(body);
    });
  let n = 0;
  const id = () => `demo-tool-${++n}`;
  const run = Date.now().toString(36); // fresh ids, so two demos never mix
  const A = { session: `demo-${run}-a`, cwd: "/demo/web-shop" };
  const B = { session: `demo-${run}-b`, cwd: "/demo/payments-api" };
  const C = { session: `demo-${run}-c`, cwd: "/demo/design-system" };
  const tool = async (s, name, detail, extra = {}, ms = 1200) => {
    const t = id();
    await post({ ...s, ...extra, event: "PreToolUse", tool: name, detail, toolUseId: t });
    await sleep(ms);
    await post({ ...s, ...extra, event: "PostToolUse", tool: name, toolUseId: t });
  };
  const sub = (s, agentId, agentType) => ({ ...s, agentId, agentType });
  const steps = [
    async () => {
      await post({ ...A, event: "SessionStart", source: "startup", model: "Opus 5.5" });
      await post({ ...B, event: "SessionStart", source: "startup", model: "Sonnet 5.5" });
      await post({ ...C, event: "SessionStart", source: "startup", model: "Opus 5.5" });
    },
    () => sleep(3000),
    async () => {
      await post({ ...A, event: "UserPromptSubmit" });
      await tool(A, "Read", "checkout.tsx");
      await post({ ...A, event: "PreToolUse", tool: "Agent", detail: "Find the cart code", subagentType: "Explore", description: "Find the cart code", toolUseId: "demo-agent-1" });
      await post({ ...sub(A, "demo-ex1", "Explore"), event: "SubagentStart" });
      await post({ ...A, event: "PreToolUse", tool: "Agent", detail: "Plan the refactor", subagentType: "Plan", description: "Plan the refactor", toolUseId: "demo-agent-2" });
      await post({ ...sub(A, "demo-pl1", "Plan"), event: "SubagentStart" });
    },
    async () => {
      await post({ ...B, event: "UserPromptSubmit" });
      await tool(sub(A, "demo-ex1", "Explore"), "Grep", "useCart", {}, 900);
      await tool(B, "Bash", "Run the unit tests", {}, 2500);
    },
    async () => {
      await tool(sub(A, "demo-ex1", "Explore"), "Glob", "src/**/cart*", {}, 900);
      await tool(sub(A, "demo-pl1", "Plan"), "Read", "store.ts", {}, 1500);
      await post({ ...B, event: "PreToolUse", tool: "Bash", detail: "Deploy to staging", toolUseId: "demo-perm" });
      await post({ ...B, event: "Notification", notification: "permission_prompt" });
    },
    () => sleep(4000),
    async () => {
      await post({ ...sub(A, "demo-ex1", "Explore"), event: "SubagentStop" });
      await post({ ...A, event: "PostToolUse", tool: "Agent", toolUseId: "demo-agent-1" });
      await post({ ...B, event: "PostToolUse", tool: "Bash", toolUseId: "demo-perm" });
      await post({ ...C, event: "UserPromptSubmit" });
      await post({ ...C, event: "PreToolUse", tool: "Agent", detail: "Review button styles", subagentType: "code-reviewer", description: "Review button styles", toolUseId: "demo-agent-3" });
      await post({ ...sub(C, "demo-rv1", "code-reviewer"), event: "SubagentStart" });
      await post({ ...C, event: "PreToolUse", tool: "Agent", detail: "Write the new tokens", subagentType: "general-purpose", description: "Write the new tokens", toolUseId: "demo-agent-4" });
      await post({ ...sub(C, "demo-gp1", "general-purpose"), event: "SubagentStart" });
    },
    async () => {
      await tool(sub(C, "demo-rv1", "code-reviewer"), "Read", "Button.tsx", {}, 2000);
      await tool(sub(C, "demo-gp1", "general-purpose"), "Edit", "tokens.css", {}, 2000);
      await tool(B, "Edit", "invoice.go", {}, 1500);
    },
    async () => {
      await post({ ...sub(A, "demo-pl1", "Plan"), event: "SubagentStop" });
      await post({ ...A, event: "PostToolUse", tool: "Agent", toolUseId: "demo-agent-2" });
      await tool(A, "Edit", "cart-store.ts", {}, 2500);
      await post({ ...B, event: "Stop" });
    },
    async () => {
      await tool(sub(C, "demo-gp1", "general-purpose"), "Write", "tokens.json", {}, 2000);
      await post({ ...sub(C, "demo-rv1", "code-reviewer"), event: "SubagentStop" });
    },
    async () => {
      await post({ ...A, event: "Stop" });
      await post({ ...sub(C, "demo-gp1", "general-purpose"), event: "SubagentStop" });
      await post({ ...C, event: "Stop" });
    },
    () => sleep(flags.has("--short") ? 2000 : 40000),
    async () => {
      for (const s of [A, B, C]) await post({ ...s, event: "SessionEnd", reason: "other" });
    },
  ];
  console.log(`demo running on ${URL_BASE} (three fake sessions, about a minute)`);
  for (const step of steps) {
    await step();
    await sleep(2500);
  }
  console.log("demo done");
}

// ---------- commands ----------
async function main() {
  switch (cmd) {
    case "install":
      return install();
    case "uninstall":
      return uninstall();
    case "start": {
      const running = await ping();
      if (running) {
        console.log(`already running on ${URL_BASE} (pid ${running.pid})`);
        if (!flags.has("--no-open")) openPage();
        return;
      }
      const child = spawn(process.execPath, [path.join(ROOT, "bin", "server.mjs"), ...rest], { stdio: "inherit" });
      child.on("exit", (code) => process.exit(code ?? 0));
      return;
    }
    case "on": {
      if (!(await startBackground())) return console.log(`could not start it, see ${LOG_FILE}`);
      console.log(`running on ${URL_BASE}`);
      if (!flags.has("--no-open")) openPage();
      return;
    }
    case "open": {
      if (!(await startBackground())) return console.log(`could not start it, see ${LOG_FILE}`);
      return openPage();
    }
    case "off": {
      const running = await ping();
      if (!running) return console.log("not running");
      let run;
      try {
        run = JSON.parse(fs.readFileSync(RUN_FILE, "utf8"));
      } catch {
        /* ignore */
      }
      // only signal the process that proved itself on the port
      if (!run || run.pid !== running.pid) return console.log(`the server on port ${cfg.port} (pid ${running.pid}) has no matching run file, stop it by hand`);
      process.kill(running.pid, "SIGTERM");
      for (let i = 0; i < 30 && (await ping()); i++) await sleep(100);
      return console.log("stopped");
    }
    case "status": {
      const running = await ping();
      console.log(running ? `running on ${URL_BASE} (pid ${running.pid})` : "not running");
      const s = readSettings();
      const installed = JSON.stringify(s.hooks || {}).includes(MARKER.replace("# ", ""));
      console.log(`hooks: ${installed ? "installed" : "not installed"} in ${SETTINGS}`);
      const c = loadConfig();
      console.log(`sound: ${c.bell ? "on" : "off"}, ${soundById(c.sound).name}`);
      return;
    }
    case "sound":
    case "bell": {
      const [what, name] = rest;
      const current = soundById(loadConfig().sound).id;
      // tell a running server too, so a change takes effect now
      const apply = async (patch) => {
        saveConfig(patch);
        if (await ping()) await postSettings(patch);
      };
      if (what === "list") {
        for (const sd of SOUNDS) console.log(`${sd.id === current ? "*" : " "} ${sd.id.padEnd(6)} ${sd.name}: ${sd.about}`);
        return;
      }
      if (what === "test") {
        const id = name || current;
        if (soundById(id).id !== id) return console.log(`no sound called "${id}", see: agent-office sound list`);
        if (!play(id, (...m) => console.log(...m))) return;
        return console.log(`playing ${soundById(id).name} (${soundFile(id)}); if you hear nothing, turn the system volume up`);
      }
      if (what === "use") {
        if (!name || soundById(name).id !== name) return console.log(`no sound called "${name || ""}", see: agent-office sound list`);
        await apply({ sound: name });
        return console.log(`sound: ${soundById(name).name}`);
      }
      if (what === "on" || what === "off") {
        await apply({ bell: what === "on" });
        return console.log(`sound ${what}`);
      }
      return console.log("usage: agent-office sound on|off|list|use <name>|test [name]");
    }
    case "demo":
      return demo();
    default:
      console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 13).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
