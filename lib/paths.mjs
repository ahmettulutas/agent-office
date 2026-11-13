import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const HOME_DIR = process.env.AGENT_OFFICE_HOME || path.join(os.homedir(), ".agent-office");
export const STATE_FILE = path.join(HOME_DIR, "state.json");
export const RUN_FILE = path.join(HOME_DIR, "run.json");
export const LOG_FILE = path.join(HOME_DIR, "server.log");
export const SPAWN_LOCK = path.join(HOME_DIR, "spawn.lock");
export const CONFIG_FILE = path.join(HOME_DIR, "config.json");
export const OPENED_FILE = path.join(HOME_DIR, "last-open");

export const DEFAULT_CONFIG = {
  port: 47800,
  // "when-closed": open the page when a claude session starts and no page is open (10 min cooldown)
  // "on-start":    open the page once, when the server itself starts
  // "never":       never open it automatically
  openBrowser: "when-closed",
  // agents that report nothing for this long are removed from the office
  forgetAfterHours: 6,
  // ring a bell when a session or a subagent starts waiting for you
  bell: true,
  // which sound: bell, alarm, ship, chime, beeps or gong
  sound: "bell",
  // also show a desktop notification saying which session needs you
  notify: true,
  // let the page export a session's transcript as a TraceExport JSON (off: nothing can be exported)
  exportEnabled: false,
  // show observed token, cache and cost counters for the selected session (reads its transcript, counters only)
  metrics: false,
  // play it again every this many minutes while a session still waits (0: never)
  remindMinutes: 3,
};
export const REMIND_CHOICES = [0, 1, 3, 5, 10];

export function ensureHome() {
  fs.mkdirSync(HOME_DIR, { recursive: true, mode: 0o700 });
}

export function loadConfig() {
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    /* missing or invalid: defaults */
  }
  const cfg = { ...DEFAULT_CONFIG, ...user };
  if (process.env.AGENT_OFFICE_PORT) cfg.port = Number(process.env.AGENT_OFFICE_PORT);
  if (!Number.isInteger(cfg.port) || cfg.port < 1024 || cfg.port > 65535) cfg.port = DEFAULT_CONFIG.port;
  return cfg;
}

export function officeUrl(cfg = loadConfig()) {
  return `http://127.0.0.1:${cfg.port}/`;
}

// change some settings and keep the rest of the user's file as it is
export function saveConfig(patch) {
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    /* missing or invalid: start fresh */
  }
  ensureHome();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...user, ...patch }, null, 2) + "\n");
}
