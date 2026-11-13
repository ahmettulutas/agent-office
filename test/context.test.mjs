// Startup-context scan: pure over a directory tree, so every test builds a small
// synthetic tree in a temporary folder. Nothing here reads the real home.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { scanContext, createContextService, estimateTokens } from "../lib/context.mjs";
import { findRoot } from "../lib/repo-root.mjs";

// a fresh sandbox: { home, proj } where proj is a git project below home
function sandbox() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ao-ctx-")));
  const home = path.join(base, "home");
  const proj = path.join(home, "work", "proj");
  fs.mkdirSync(path.join(proj, ".git"), { recursive: true });
  return { base, home, proj, done: () => fs.rmSync(base, { recursive: true, force: true }) };
}
function put(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
const chars = (n) => "x".repeat(n);
const row = (r, kind, scope = "project") => r.rows.find((x) => x.kind === kind && x.scope === scope);

test("estimateTokens is ceil(chars / 3.7)", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("x".repeat(37)), 10);
  assert.equal(estimateTokens("x".repeat(38)), 11);
});

test("CLAUDE.md, rules, skills, agents and commands are summed", async () => {
  const s = sandbox();
  try {
    put(path.join(s.proj, "CLAUDE.md"), chars(370)); // 100
    put(path.join(s.proj, ".claude", "rules", "a.md"), chars(37)); // 10
    put(path.join(s.proj, ".claude", "rules", "sub", "b.md"), chars(37)); // 10
    put(path.join(s.proj, ".claude", "skills", "s1", "SKILL.md"), `---\nname: s1\ndescription: does a thing\n---\n${chars(3700)}`);
    put(path.join(s.proj, ".claude", "agents", "ag.md"), `---\nname: ag\ndescription: an agent\n---\n${chars(370)}`);
    put(path.join(s.proj, ".claude", "commands", "c.md"), `---\ndescription: a command\n---\n${chars(370)}`);
    const r = await scanContext(s.proj, { home: s.home });
    assert.equal(r.version, 1);
    assert.equal(r.source, "estimated");
    assert.equal(row(r, "memory").startupTokens, 100);
    assert.equal(row(r, "rules").startupTokens, 20);
    assert.equal(row(r, "rules").count, 2);
    assert.equal(row(r, "skills").count, 1);
    assert.ok(row(r, "skills").startupTokens > 0 && row(r, "skills").startupTokens < 20, "only name + description at startup");
    assert.ok(row(r, "skills").onDemandTokens >= 1000, "the body is on demand");
    assert.ok(row(r, "agents").onDemandTokens >= 100);
    assert.ok(row(r, "commands").onDemandTokens >= 100);
    assert.equal(r.startupTokens, r.rows.reduce((n, x) => n + x.startupTokens, 0));
    assert.equal(r.onDemandTokens, r.rows.reduce((n, x) => n + x.onDemandTokens, 0));
  } finally {
    s.done();
  }
});

test("CLAUDE.md files in every parent of cwd count, subfolders do not", async () => {
  const s = sandbox();
  try {
    const sub = path.join(s.proj, "packages", "web");
    put(path.join(s.home, "work", "CLAUDE.md"), chars(37)); // parent above the git root
    put(path.join(s.proj, "CLAUDE.md"), chars(37));
    put(path.join(sub, "CLAUDE.md"), chars(37));
    put(path.join(s.proj, "packages", "api", "CLAUDE.md"), chars(370)); // sibling: lazy
    const r = await scanContext(sub, { home: s.home });
    assert.equal(row(r, "memory").count, 3);
    assert.equal(row(r, "memory").startupTokens, 30);
  } finally {
    s.done();
  }
});

test("CLAUDE.local.md and .claude/CLAUDE.md count", async () => {
  const s = sandbox();
  try {
    put(path.join(s.proj, "CLAUDE.local.md"), chars(37));
    put(path.join(s.proj, ".claude", "CLAUDE.md"), chars(37));
    const r = await scanContext(s.proj, { home: s.home });
    assert.equal(row(r, "memory").count, 2);
  } finally {
    s.done();
  }
});

test("user scope is a separate row and joins the startup total", async () => {
  const s = sandbox();
  try {
    put(path.join(s.proj, "CLAUDE.md"), chars(37));
    put(path.join(s.home, ".claude", "CLAUDE.md"), chars(74));
    put(path.join(s.home, ".claude", "rules", "u.md"), chars(37));
    const r = await scanContext(s.proj, { home: s.home });
    assert.equal(row(r, "memory", "user").startupTokens, 20);
    assert.equal(row(r, "rules", "user").startupTokens, 10);
    assert.equal(r.startupTokens, 10 + 20 + 10);
    // ~/.claude/CLAUDE.md is not also counted as a project file when cwd is home
    const h = await scanContext(s.home, { home: s.home });
    assert.equal(row(h, "memory", "user").count, 1);
    assert.equal(row(h, "memory", "project"), undefined);
  } finally {
    s.done();
  }
});

test("@AGENTS.md import counts once; an orphan AGENTS.md counts only without any CLAUDE.md", async () => {
  const s = sandbox();
  try {
    put(path.join(s.proj, "AGENTS.md"), chars(370)); // 100
    put(path.join(s.proj, "CLAUDE.md"), "@AGENTS.md\n"); // imports it
    let r = await scanContext(s.proj, { home: s.home });
    assert.equal(row(r, "memory").startupTokens, 100 + estimateTokens("@AGENTS.md\n"));
    assert.equal(row(r, "memory").count, 2);

    fs.rmSync(path.join(s.proj, "CLAUDE.md"));
    r = await scanContext(s.proj, { home: s.home });
    assert.equal(row(r, "memory").startupTokens, 100, "no CLAUDE.md: AGENTS.md is read directly");

    put(path.join(s.proj, "CLAUDE.md"), chars(37)); // CLAUDE.md without the import
    r = await scanContext(s.proj, { home: s.home });
    assert.equal(row(r, "memory").startupTokens, 10, "orphan AGENTS.md is not counted");
  } finally {
    s.done();
  }
});

test("a rule with paths: frontmatter is on demand; broken yaml falls back to startup", async () => {
  const s = sandbox();
  try {
    put(path.join(s.proj, ".claude", "rules", "scoped.md"), `---\npaths:\n  - "src/**/*.ts"\n---\n${chars(370)}`);
    put(path.join(s.proj, ".claude", "rules", "csv.md"), `---\npaths: "a/**, b/**"\n---\n${chars(370)}`);
    put(path.join(s.proj, ".claude", "rules", "always.md"), chars(37));
    put(path.join(s.proj, ".claude", "rules", "broken.md"), `---\npaths: [unclosed\n  - : :\n---\n${chars(37)}`);
    const r = await scanContext(s.proj, { home: s.home });
    const rules = row(r, "rules");
    const broken = `---\npaths: [unclosed\n  - : :\n---\n${chars(37)}`;
    assert.equal(rules.startupTokens, 10 + estimateTokens(broken), "always + broken (whole file counts)");
    assert.ok(rules.onDemandTokens >= 200, "two scoped rules");
  } finally {
    s.done();
  }
});

test("imports: relative to the file, code is skipped, loops and outside paths are not followed", async () => {
  const s = sandbox();
  try {
    put(path.join(s.proj, "CLAUDE.md"), ["see @docs/a.md", "```", "@docs/never.md", "```", "and `@docs/never.md` inline", "outside @../../../secret.md and @/etc/hosts"].join("\n"));
    put(path.join(s.proj, "docs", "a.md"), `@b.md\n${chars(37)}`); // b.md is relative to docs/
    put(path.join(s.proj, "docs", "b.md"), `@a.md\n${chars(37)}`); // loop back to a
    put(path.join(s.proj, "docs", "never.md"), chars(3700));
    put(path.join(s.home, "secret.md"), chars(3700));
    const r = await scanContext(s.proj, { home: s.home });
    const m = row(r, "memory");
    assert.equal(m.count, 3, "CLAUDE.md, a.md and b.md");
    assert.ok(m.startupTokens < 100, `never.md and secret.md stay out (got ${m.startupTokens})`);
  } finally {
    s.done();
  }
});

test("import chains stop after 4 hops", async () => {
  const s = sandbox();
  try {
    put(path.join(s.proj, "CLAUDE.md"), "@i1.md");
    for (let i = 1; i <= 6; i++) put(path.join(s.proj, `i${i}.md`), `@i${i + 1}.md`);
    put(path.join(s.proj, "i7.md"), "end");
    const r = await scanContext(s.proj, { home: s.home });
    assert.equal(row(r, "memory").count, 1 + 4, "CLAUDE.md plus hops 1 to 4");
    assert.ok(r.notes.some((n) => /import/i.test(n)));
  } finally {
    s.done();
  }
});

test("symlinks: directories are never followed, files only inside the project", async () => {
  const s = sandbox();
  try {
    const outside = path.join(s.base, "outside");
    put(path.join(outside, "big.md"), chars(37000));
    put(path.join(s.proj, "AGENTS.md"), chars(37));
    fs.symlinkSync("AGENTS.md", path.join(s.proj, "CLAUDE.md")); // the common CLAUDE.md -> AGENTS.md
    fs.mkdirSync(path.join(s.proj, ".claude"), { recursive: true });
    fs.symlinkSync(outside, path.join(s.proj, ".claude", "rules")); // a directory link outside
    fs.symlinkSync(path.join(outside, "big.md"), path.join(s.proj, "CLAUDE.local.md")); // a file link outside
    // a loop inside skills
    fs.mkdirSync(path.join(s.proj, ".claude", "skills", "x"), { recursive: true });
    fs.symlinkSync(path.join(s.proj, ".claude", "skills"), path.join(s.proj, ".claude", "skills", "x", "loop"));
    const r = await scanContext(s.proj, { home: s.home });
    assert.equal(row(r, "memory").startupTokens, 10, "the in-project link counts once, the outside file does not");
    assert.equal(row(r, "rules"), undefined, "a linked rules folder is not followed");
  } finally {
    s.done();
  }
});

test("caps: too many files marks the result truncated", async () => {
  const s = sandbox();
  try {
    for (let i = 0; i < 30; i++) put(path.join(s.proj, ".claude", "rules", `r${i}.md`), chars(37));
    const r = await scanContext(s.proj, { home: s.home, limits: { files: 10 } });
    assert.equal(r.truncated, true);
    assert.ok(row(r, "rules").count <= 10);
    put(path.join(s.proj, "CLAUDE.md"), "hi");
    const big = await scanContext(s.proj, { home: s.home, limits: { fileBytes: 10 } });
    assert.equal(row(big, "rules"), undefined, "files over the size cap are skipped");
    assert.equal(big.truncated, true);
  } finally {
    s.done();
  }
});

test("errors: a missing cwd is gone, nothing at all is no-context", async () => {
  const s = sandbox();
  try {
    assert.deepEqual(await scanContext(path.join(s.base, "nope"), { home: s.home }), { version: 1, error: "gone" });
    assert.deepEqual(await scanContext(s.proj, { home: s.home }), { version: 1, error: "no-context" });
  } finally {
    s.done();
  }
});

test("the result carries no paths or file names", async () => {
  const s = sandbox();
  try {
    put(path.join(s.proj, "CLAUDE.md"), "@secret-notes.md");
    put(path.join(s.proj, "secret-notes.md"), chars(37));
    put(path.join(s.proj, ".claude", "skills", "hidden-skill-name", "SKILL.md"), "---\nname: hidden-skill-name\ndescription: d\n---\nbody");
    const text = JSON.stringify(await scanContext(s.proj, { home: s.home }));
    for (const bad of ["secret-notes", "hidden-skill-name", s.base, path.join("work", "proj"), "CLAUDE"]) assert.ok(!text.includes(bad), `leaked ${bad}`);
  } finally {
    s.done();
  }
});

test("findRoot: git folder, worktree file, .claude folder, never home", async () => {
  const s = sandbox();
  try {
    const sub = path.join(s.proj, "a", "b");
    fs.mkdirSync(sub, { recursive: true });
    assert.equal(await findRoot(sub, s.home), s.proj);
    // a worktree has a .git file
    const wt = path.join(s.base, "wt");
    put(path.join(wt, ".git"), "gitdir: /elsewhere");
    fs.mkdirSync(path.join(wt, "x"));
    assert.equal(await findRoot(path.join(wt, "x"), s.home), wt);
    // a .claude folder marks a root without git
    const nogit = path.join(s.base, "nogit");
    fs.mkdirSync(path.join(nogit, ".claude"), { recursive: true });
    fs.mkdirSync(path.join(nogit, "deep"));
    assert.equal(await findRoot(path.join(nogit, "deep"), s.home), nogit);
    // ~/.claude does not make home a project
    fs.mkdirSync(path.join(s.home, ".claude"), { recursive: true });
    const loose = path.join(s.home, "loose");
    fs.mkdirSync(loose);
    assert.equal(await findRoot(loose, s.home), null);
    assert.equal(await findRoot(s.home, s.home), null);
  } finally {
    s.done();
  }
});

test("service cache: second call reads no file, a change refreshes", async () => {
  const s = sandbox();
  try {
    put(path.join(s.proj, "CLAUDE.md"), chars(37));
    let reads = 0;
    const counting = { ...fsp, readFile: (...a) => (reads++, fsp.readFile(...a)) };
    const svc = createContextService({ home: s.home, fs: counting, max: 2 });
    const a = await svc.get(s.proj);
    const first = reads;
    assert.ok(first > 0);
    const b = await svc.get(s.proj);
    assert.equal(reads, first, "cache hit: no more reads");
    assert.deepEqual(b, a);

    put(path.join(s.proj, "CLAUDE.md"), chars(370));
    const c = await svc.get(s.proj);
    assert.equal(row(c, "memory").startupTokens, 100);

    put(path.join(s.proj, ".claude", "rules", "new.md"), chars(37));
    const d = await svc.get(s.proj);
    assert.equal(row(d, "rules").count, 1, "a new file is noticed");
  } finally {
    s.done();
  }
});

test("service cache keeps at most `max` roots", async () => {
  const s = sandbox();
  try {
    const dirs = [1, 2, 3].map((i) => {
      const d = path.join(s.base, `p${i}`);
      put(path.join(d, "CLAUDE.md"), chars(37));
      return d;
    });
    let reads = 0;
    const svc = createContextService({ home: s.home, fs: { ...fsp, readFile: (...a) => (reads++, fsp.readFile(...a)) }, max: 2 });
    for (const d of dirs) await svc.get(d);
    const before = reads;
    await svc.get(dirs[0]); // evicted: scanned again
    assert.ok(reads > before);
  } finally {
    s.done();
  }
});
