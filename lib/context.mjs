// What a Claude Code session starts with: the memory files, rules, skills,
// agents and commands that count against its context before the first prompt.
//
// Reads only memory-style markdown, never follows a symlinked folder, caps the
// work, and returns counts and categories only (no paths, no file names).
// It never touches the network. The numbers are an estimate and a lower bound.
//
// Rules of thumb it follows (Claude Code memory docs):
//  - CLAUDE.md / CLAUDE.local.md in the working directory and every parent load
//    at start; folders below it load lazily, so they are not counted.
//  - AGENTS.md is read directly only when no CLAUDE.md exists up the chain;
//    otherwise only an `@AGENTS.md` import brings it in.
//  - `@path` imports resolve relative to the file, at most 4 hops deep, and
//    code spans and fenced code are not imports.
//  - A rule with `paths:` frontmatter loads on demand, not at start.

import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findRoot } from "./repo-root.mjs";

export const CHARS_PER_TOKEN = 3.7;
export const estimateTokens = (text) => Math.ceil(text.length / CHARS_PER_TOKEN);

const LIMITS = { depth: 8, files: 2000, bytes: 8 * 1024 * 1024, fileBytes: 4 * 1024 * 1024, hops: 4 };
const SKIP_DIRS = new Set(["node_modules", ".git"]);

const inside = (p, dir) => {
  const rel = path.relative(dir, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

// ---------- small text helpers ----------

// frontmatter: only what we need. `paths` is "set" when the rule is scoped.
function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { data: {}, body: text, scoped: false };
  const data = {};
  const lines = m[1].split(/\r?\n/);
  let scoped = false;
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z][\w-]*):[ \t]*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const value = kv[2].trim();
    if (kv[1] === "paths") {
      if (value) {
        const broken = value.startsWith("[") && !value.endsWith("]");
        scoped = !broken;
      } else {
        scoped = lines.slice(i + 1).some((l, j) => /^\s+-\s*\S/.test(l) && lines.slice(i + 1, i + 1 + j).every((x) => /^\s/.test(x)));
      }
      continue;
    }
    data[kv[1]] = value.replace(/^["']|["']$/g, "");
  }
  return { data, body: text.slice(m[0].length), scoped };
}

function importsOf(text) {
  const plain = text.replace(/^(```|~~~)[\s\S]*?^\1/gm, "").replace(/`[^`\n]*`/g, "");
  const out = [];
  for (const m of plain.matchAll(/(?:^|[\s(])@([^\s)`'"<>]+)/g)) {
    const p = m[1].replace(/[.,;:!?]+$/, "");
    if (p && !/^[a-z]+:\/\//i.test(p)) out.push(p);
  }
  return out;
}

// ---------- the scan ----------

async function scan(cwd, { home = os.homedir(), fs = fsp, limits: lim = {} } = {}) {
  const limits = { ...LIMITS, ...lim };
  const homeDir = path.resolve(home);
  const start = path.resolve(cwd);
  try {
    if (!(await fs.lstat(start)).isDirectory()) return { result: { version: 1, error: "gone" }, sig: [] };
  } catch {
    return { result: { version: 1, error: "gone" }, sig: [] };
  }

  const st = { files: 0, bytes: 0, truncated: false };
  const notes = new Set(["Estimate: characters / 3.7, a lower bound", "Plugin skills are not counted", "Assumes Claude Code 2.1.277+ and default instruction settings"]);
  const sig = new Map(); // path -> { m, s }: what the cache checks later
  const rows = new Map();
  const visited = new Set();

  const track = async (p) => {
    try {
      const s = await fs.stat(p);
      sig.set(p, { m: s.mtimeMs, s: s.size });
    } catch {
      /* missing: its parent folder is tracked */
    }
  };
  const add = (kind, scope, startup, onDemand) => {
    const key = `${kind}:${scope}`;
    const r = rows.get(key) || { kind, scope, count: 0, startupTokens: 0, onDemandTokens: 0 };
    r.count++;
    r.startupTokens += startup;
    r.onDemandTokens += onDemand;
    rows.set(key, r);
  };

  // one file, read only when it is a regular file whose real path stays inside `bound`
  async function readText(p, bound) {
    let s;
    try {
      s = await fs.lstat(p);
    } catch {
      return null;
    }
    let real;
    try {
      real = await fs.realpath(p);
      if (!inside(real, bound)) return null;
      if (s.isSymbolicLink()) s = await fs.stat(real);
    } catch {
      return null;
    }
    if (!s.isFile()) return null;
    if (s.size > limits.fileBytes || st.files >= limits.files || st.bytes + s.size > limits.bytes) {
      st.truncated = true;
      return null;
    }
    try {
      const text = await fs.readFile(real, "utf8");
      st.files++;
      st.bytes += s.size;
      sig.set(p, { m: s.mtimeMs, s: s.size });
      return text;
    } catch {
      return null;
    }
  }

  // a memory file and the files it imports
  async function memory(file, scope, bound, importBound, hop) {
    const real = await fs.realpath(file).catch(() => null);
    if (!real || visited.has(real)) return false;
    const text = await readText(file, bound);
    if (text === null) return false;
    visited.add(real);
    add("memory", scope, estimateTokens(text), 0);
    for (const ref of importsOf(text)) {
      if (hop >= limits.hops) {
        notes.add(`Imports deeper than ${limits.hops} hops are ignored`);
        break;
      }
      const target = ref.startsWith("~/") ? path.join(homeDir, ref.slice(2)) : path.resolve(path.dirname(file), ref);
      if (!inside(target, importBound)) {
        notes.add("Imports outside the project are not counted");
        continue;
      }
      await memory(target, scope, importBound, importBound, hop + 1);
    }
    return true;
  }

  // markdown files below a folder: symlinks are never followed, depth and counts are capped
  async function walk(dir, bound, depth, found) {
    let d;
    try {
      d = await fs.lstat(dir);
    } catch {
      return;
    }
    if (!d.isDirectory()) return;
    await track(dir);
    if (depth > limits.depth) {
      st.truncated = true;
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of entries) {
      if (e.isSymbolicLink() || SKIP_DIRS.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p, bound, depth + 1, found);
      else if (e.isFile() && e.name.endsWith(".md")) {
        if (st.files >= limits.files) {
          st.truncated = true;
          return;
        }
        found.push(p);
      }
    }
  }

  // rules, skills, agents and commands under one `.claude` folder
  async function claudeFolder(base, scope, bound) {
    const rules = [];
    await walk(path.join(base, "rules"), bound, 0, rules);
    for (const p of rules) {
      if (/README\.md$/i.test(p)) continue;
      const text = await readText(p, bound);
      if (text === null) continue;
      const tokens = estimateTokens(text);
      if (parseFrontmatter(text).scoped) add("rules", scope, 0, tokens);
      else add("rules", scope, tokens, 0);
    }
    const skills = [];
    await walk(path.join(base, "skills"), bound, 0, skills);
    for (const p of skills.filter((f) => path.basename(f) === "SKILL.md")) {
      const text = await readText(p, bound);
      if (text === null) continue;
      const { data, body, scoped } = parseFrontmatter(text);
      const head = `${data.name || path.basename(path.dirname(p))}: ${data.description || ""}`;
      if (scoped) add("skills", scope, 0, estimateTokens(head) + estimateTokens(body));
      else add("skills", scope, estimateTokens(head), estimateTokens(body));
    }
    for (const kind of ["agents", "commands"]) {
      const found = [];
      await walk(path.join(base, kind), bound, 0, found);
      for (const p of found) {
        if (/README\.md$/i.test(p)) continue;
        const text = await readText(p, bound);
        if (text === null) continue;
        const { data, body } = parseFrontmatter(text);
        const head = kind === "agents" ? `${data.name || path.basename(p, ".md")}: ${data.description || ""}` : data.description || "";
        add(kind, scope, estimateTokens(head), estimateTokens(body));
      }
    }
  }

  const realOf = (p) => fs.realpath(p).catch(() => p);
  const root = await findRoot(start, homeDir, fs);
  const realRoot = await realOf(root || start);

  // memory chain: the working directory and every parent
  const chain = [];
  for (let d = start; ; d = path.dirname(d)) {
    chain.push(d);
    if (path.dirname(d) === d) break;
  }
  let anyClaudeMd = false;
  for (const dir of chain) {
    await track(dir);
    const realDir = await realOf(dir);
    const bound = inside(realDir, realRoot) ? realRoot : realDir;
    const files = ["CLAUDE.md", "CLAUDE.local.md"];
    if (dir !== homeDir) files.push(path.join(".claude", "CLAUDE.md"));
    for (const f of files) {
      if (await memory(path.join(dir, f), "project", bound, realRoot, 0)) anyClaudeMd = true;
      else if (await fs.lstat(path.join(dir, f)).then(() => true, () => false)) anyClaudeMd = true;
    }
    if (dir !== homeDir) await track(path.join(dir, ".claude"));
  }
  if (!anyClaudeMd) {
    for (const dir of chain) await memory(path.join(dir, "AGENTS.md"), "project", await realOf(dir), realRoot, 0);
  }

  if (root) {
    await track(root);
    await track(path.join(root, ".claude"));
    await claudeFolder(path.join(root, ".claude"), "project", realRoot);
  }

  // the user's own files
  const userBase = path.join(homeDir, ".claude");
  await track(homeDir);
  await track(userBase);
  const userReal = await realOf(userBase);
  await memory(path.join(userBase, "CLAUDE.md"), "user", userReal, userReal, 0);
  await claudeFolder(userBase, "user", userReal);

  if (st.truncated) notes.add("Some files were skipped (size or count limits)");
  const list = [...rows.values()];
  if (!list.length) return { result: { version: 1, error: "no-context" }, sig: [...sig] };
  const order = ["memory", "rules", "skills", "agents", "commands"];
  list.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || (a.scope < b.scope ? 1 : -1));
  return {
    result: {
      version: 1,
      source: "estimated",
      startupTokens: list.reduce((n, r) => n + r.startupTokens, 0),
      onDemandTokens: list.reduce((n, r) => n + r.onDemandTokens, 0),
      rows: list,
      truncated: st.truncated,
      notes: [...notes],
    },
    sig: [...sig],
  };
}

export async function scanContext(cwd, opts) {
  return (await scan(cwd, opts)).result;
}

// A small cache: a scan is reused while every file and folder it looked at still
// has the same modification time and size (one `stat` each, no file is read).
export function createContextService({ home = os.homedir(), fs = fsp, max = 20, limits } = {}) {
  const cache = new Map(); // cwd -> { result, sig }, oldest first

  async function fresh(sig) {
    for (const [p, v] of sig) {
      try {
        const s = await fs.stat(p);
        if (s.mtimeMs !== v.m || s.size !== v.s) return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  return {
    async get(cwd) {
      const key = path.resolve(cwd);
      const hit = cache.get(key);
      if (hit && (await fresh(hit.sig))) {
        cache.delete(key);
        cache.set(key, hit);
        return hit.result;
      }
      const { result, sig } = await scan(key, { home, fs, limits });
      cache.delete(key);
      if (!result.error) {
        cache.set(key, { result, sig });
        while (cache.size > max) cache.delete(cache.keys().next().value);
      }
      return result;
    },
  };
}
