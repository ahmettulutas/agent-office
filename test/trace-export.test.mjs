// Transcript reader and TraceExport v1: synthetic transcripts in a temporary
// folder, nothing from a real session.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readTranscript } from "../lib/transcript-reader.mjs";
import { exportTranscript, buildTrace } from "../lib/trace-export.mjs";

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ao-trace-")));
const write = (dir, records, name = "s.jsonl") => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, records.map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join("\n") + "\n");
  return file;
};
async function collect(file, opts) {
  const stats = {};
  const out = [];
  for await (const r of readTranscript(file, { ...opts, stats })) out.push(r);
  return { out, stats };
}

// the agent-replay contract (src/lib/parse.ts parseTrace), ported to count steps
function replaySteps(trace) {
  const messages = Array.isArray(trace) ? trace : trace?.messages;
  if (!Array.isArray(messages) || !messages.length) return { ok: false, steps: 0 };
  let steps = 0;
  for (const m of messages) {
    if (typeof m.content === "string") {
      if (m.content.trim()) steps++;
      continue;
    }
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "text" && b.text?.trim()) steps++;
      else if (b.type === "thinking" && b.thinking?.trim()) steps++;
      else if (b.type === "tool_use" || b.type === "tool_result") steps++;
    }
  }
  return { ok: steps > 0, steps };
}

const user = (uuid, parentUuid, content, extra = {}) => ({ type: "user", uuid, parentUuid, isSidechain: false, message: { role: "user", content }, ...extra });
const asst = (uuid, parentUuid, id, block, extra = {}) => ({ type: "assistant", uuid, parentUuid, isSidechain: false, message: { id, role: "assistant", content: [block] }, ...extra });
const text = (t) => ({ type: "text", text: t });
const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
const result = (id, content, is_error) => ({ type: "tool_result", tool_use_id: id, content, ...(is_error ? { is_error: true } : {}) });

const FAKE_KEY = "sk-ant-api03-FAKEFAKEFAKEFAKE1234";
const FAKE_PASS = "hunter2hunter2";

function basic() {
  return [
    { type: "queue-operation", operation: "enqueue" },
    user("u1", null, "fix the login"),
    asst("a1", "u1", "m1", { type: "thinking", thinking: "private thoughts" }),
    asst("a2", "a1", "m1", text("looking"), { apiBlockIndex: 1 }),
    asst("a3", "a2", "m1", toolUse("t1", "Read", { file_path: "/home/me/proj/src/app.ts" }), { apiBlockIndex: 2 }),
    user("u2", "a3", [result("t1", "x".repeat(1000) + ` key ${FAKE_KEY}`)]),
    asst("a4", "u2", "m2", toolUse("t2", "Bash", { command: `curl -u me:${FAKE_PASS} https://x`, description: "fetch" })),
    user("u3", "a4", [result("t2", "boom", true)]),
    asst("a5", "u3", "m3", text("done")),
    { type: "last-prompt", leafUuid: "a5", lastPrompt: "fix the login" },
  ];
}

test("reader: streams records and counts bad, long and unknown lines without crashing", async () => {
  const dir = tmp();
  try {
    const file = write(dir, [JSON.stringify({ type: "user", n: 1 }), "{not json", "x".repeat(5000), JSON.stringify({ type: "weird", n: 2 }), ""]);
    const { out, stats } = await collect(file, { maxLine: 1000 });
    assert.deepEqual(out.map((r) => r.n), [1, 2]);
    assert.equal(stats.bad, 1);
    assert.equal(stats.tooLong, 1);
    assert.equal(stats.truncated, false);
    assert.deepEqual((await collect(write(dir, [], "empty.jsonl"))).out, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("reader: a file over the cap is cut to its tail and marked truncated", async () => {
  const dir = tmp();
  try {
    const recs = Array.from({ length: 200 }, (_, i) => ({ type: "user", n: i, pad: "p".repeat(100) }));
    const file = write(dir, recs);
    const { out, stats } = await collect(file, { maxBytes: 5000 });
    assert.equal(stats.truncated, true);
    assert.equal(out.at(-1).n, 199, "the end is kept");
    assert.ok(out.length < 200 && out.length > 10);
    assert.ok(out.every((r) => typeof r.n === "number"), "no half record from the cut");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("export: roles, tool_use / tool_result pairs, errors, merged split messages, safe mode", async () => {
  const dir = tmp();
  try {
    const t = await exportTranscript(write(dir, basic()), { mode: "safe" });
    assert.equal(t.version, 1);
    assert.equal(t.source, "claude-code-transcript");
    assert.equal(t.privacy, "safe");
    assert.equal(t.redaction, "best-effort");
    assert.equal(t.truncated, false);
    assert.deepEqual(t.messages.map((m) => m.role), ["user", "assistant", "user", "assistant", "user", "assistant"]);
    const first = t.messages[1];
    assert.deepEqual(first.content.map((b) => b.type), ["text", "tool_use"], "m1 is one message, thinking dropped");
    assert.equal(t.messages[1].content[1].id, "t1");
    assert.equal(t.messages[2].content[0].tool_use_id, "t1");
    assert.equal(t.messages[4].content[0].is_error, true);
    assert.deepEqual(t.stats, { messages: 6, toolCalls: 2, errors: 1 });
    // safe: results cut short, tool input reduced to a name or first word
    const res = JSON.stringify(t.messages[2].content[0].content);
    assert.ok(res.includes("chars omitted"));
    assert.deepEqual(t.messages[1].content[1].input, { detail: "app.ts" });
    assert.deepEqual(t.messages[3].content[0].input, { detail: "fetch" });
    assert.equal(JSON.stringify(t).includes("private thoughts"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("export: no planted secret reaches the output in either mode", async () => {
  const dir = tmp();
  try {
    const file = write(dir, basic());
    for (const mode of ["safe", "full"]) {
      const s = JSON.stringify(await exportTranscript(file, { mode }));
      assert.equal(s.includes(FAKE_KEY), false, `${mode}: key`);
      assert.equal(s.includes(FAKE_PASS), false, `${mode}: password in a command`);
    }
    const full = await exportTranscript(file, { mode: "full" });
    assert.equal(full.privacy, "full");
    assert.ok(JSON.stringify(full.messages[2].content[0].content).includes("xxxxxxxxxx"), "full keeps the content");
    assert.ok(JSON.stringify(full).includes("private thoughts"), "full keeps thinking");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("export: a rewound transcript follows one line, sidechains are skipped", async () => {
  const dir = tmp();
  try {
    const recs = [
      user("u1", null, "first"),
      asst("a1", "u1", "m1", text("old answer")),
      user("u2", "a1", "old follow-up"),
      // rewind: a new branch from a1
      user("u3", "a1", "new follow-up"),
      asst("a3", "u3", "m3", text("new answer")),
      asst("s1", "u3", "ms", text("side agent"), { isSidechain: true }),
      { type: "attachment", uuid: "x1", parentUuid: "a3" },
      user("u4", "x1", "after an attachment"),
      { type: "last-prompt", leafUuid: "u4" },
    ];
    const t = await exportTranscript(write(dir, recs), { mode: "safe" });
    const flat = JSON.stringify(t.messages);
    assert.ok(flat.includes("new follow-up") && flat.includes("after an attachment"));
    assert.equal(flat.includes("old follow-up"), false);
    assert.equal(flat.includes("side agent"), false);
    assert.equal(t.messages.length, 5);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("export: without last-prompt the last message is the leaf; cycles and missing parents do not hang", async () => {
  const dir = tmp();
  try {
    const t = await exportTranscript(write(dir, [user("u1", "ghost", "a"), asst("a1", "u1", "m", text("b")), user("u2", "u3", "c"), user("u3", "u2", "d")]), { mode: "safe" });
    assert.ok(t.messages.length >= 1 && t.messages.length <= 2);
    const empty = await exportTranscript(write(dir, [], "e.jsonl"), { mode: "safe" });
    assert.deepEqual(empty.messages, []);
    assert.deepEqual(empty.stats, { messages: 0, toolCalls: 0, errors: 0 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("export: agent-replay accepts the output and sees the expected steps", async () => {
  const dir = tmp();
  try {
    const t = await exportTranscript(write(dir, basic()), { mode: "safe" });
    const r = replaySteps(JSON.parse(JSON.stringify(t)));
    assert.equal(r.ok, true);
    // user text, text, tool_use, tool_result, tool_use, tool_result, text
    assert.equal(r.steps, 7);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("export: a 50 MB transcript streams with a bounded heap and a free event loop", async () => {
  const dir = tmp();
  try {
    const file = path.join(dir, "big.jsonl");
    const fd = fs.openSync(file, "w");
    let parent = null;
    const pad = "y".repeat(20000);
    for (let i = 0; i < 2500; i++) {
      const u = `u${i}`;
      fs.writeSync(fd, JSON.stringify(user(u, parent, [result(`t${i}`, pad)])) + "\n");
      parent = u;
    }
    fs.closeSync(fd);
    assert.ok(fs.statSync(file).size > 50e6);
    if (global.gc) global.gc();
    let worst = 0;
    let last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      worst = Math.max(worst, now - last - 20);
      last = now;
    }, 20);
    const before = process.memoryUsage().heapUsed;
    let peak = before;
    const sampler = setInterval(() => (peak = Math.max(peak, process.memoryUsage().heapUsed)), 10);
    const t = await exportTranscript(file, { mode: "safe" });
    clearInterval(timer);
    clearInterval(sampler);
    assert.equal(t.messages.length, 2500);
    assert.ok(peak - before < 250 * 1024 * 1024, `heap grew ${Math.round((peak - before) / 1e6)} MB`);
    assert.ok(worst < 1000, `event loop blocked ${worst} ms`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("buildTrace takes any async iterable of records", async () => {
  async function* gen() {
    yield user("u1", null, "hi");
  }
  const t = await buildTrace(gen(), { mode: "safe" });
  assert.equal(t.messages.length, 1);
});
