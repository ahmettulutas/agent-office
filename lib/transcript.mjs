// Esc interrupts a turn without firing a hook, but Claude Code writes a
// "[Request interrupted by user]" record into the session's transcript.
// Only Claude Code transcripts are read, only their tail, only for that marker.

import os from "node:os";
import fs from "node:fs";
import path from "node:path";

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const PROJECTS_DIR = path.resolve(CLAUDE_DIR, "projects") + path.sep;
export function isTranscript(p) {
  const r = path.resolve(p);
  return r.startsWith(PROJECTS_DIR) && r.endsWith(".jsonl");
}
const MARKER = "[Request interrupted by user";
export function lastInterrupt(text) {
  const i = text.lastIndexOf(MARKER);
  if (i < 0) return null;
  const start = text.lastIndexOf("\n", i) + 1;
  const end = text.indexOf("\n", i);
  try {
    const rec = JSON.parse(text.slice(start, end < 0 ? undefined : end));
    if (rec.type !== "user") return null;
    // the record Claude Code writes, not a prompt that happens to quote it
    const c = rec.message?.content;
    const said = typeof c === "string" ? c : Array.isArray(c) && c.length === 1 ? c[0]?.text : null;
    if (typeof said !== "string" || !/^\[Request interrupted by user[^\]]{0,30}\]$/.test(said.trim())) return null;
    const at = Date.parse(rec.timestamp);
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

// the real path of a transcript, only when it is a regular .jsonl file that
// still lives under the projects folder after symlinks are resolved
export async function resolveTranscript(p) {
  if (typeof p !== "string" || !isTranscript(p)) return null;
  try {
    const real = await fs.promises.realpath(p);
    const root = (await fs.promises.realpath(PROJECTS_DIR)) + path.sep;
    if (!real.startsWith(root) || !real.endsWith(".jsonl")) return null;
    return (await fs.promises.stat(real)).isFile() ? real : null;
  } catch {
    return null;
  }
}
