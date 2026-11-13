// Session metrics: counters only, observed, deduped by message id.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { newState, advance, summarize, createMetricsService } from "../lib/metrics.mjs";
import { readTranscript } from "../lib/transcript-reader.mjs";

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ao-metrics-")));
const done = (d) => fs.rmSync(d, { recursive: true, force: true });
const line = (r) => (typeof r === "string" ? r : JSON.stringify(r)) + "\n";
const usage = (i, o, cr, cw) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: cr, cache_creation_input_tokens: cw });
const asst = (id, model, u, extra = {}) => ({ type: "assistant", uuid: `u-${id}-${Math.random()}`, isSidechain: false, message: { id, model, role: "assistant", content: [{ type: "text", text: "SECRET-CONTENT" }], usage: u }, ...extra });
const cost = (total, models, d = {}) => ({ type: "cost-state", sessionId: "s", totalCostUSD: total, totalAPIDuration: d.api ?? 100, totalToolDuration: d.tools ?? 50, totalDuration: d.wall ?? 1000, modelUsage: models });
async function sum(file) {
  const st = newState();
  await advance(file, st);
  return summarize(st, "sid");
}

test("a message split into records counts once; the largest output wins", async () => {
  const d = tmp();
  try {
    const f = path.join(d, "s.jsonl");
    fs.writeFileSync(f, [asst("m1", "claude-a", usage(10, 5, 100, 20)), asst("m1", "claude-a", usage(10, 40, 100, 20)), asst("m1", "claude-a", usage(10, 40, 100, 20)), asst("m2", "claude-a", usage(1, 2, 3, 4))].map(line).join(""));
    const s = await sum(f);
    assert.deepEqual(s.totals, { input: 11, output: 42, cacheRead: 103, cacheWrite: 24, cacheHitRatio: 103 / (103 + 24 + 11), costUsd: null });
  } finally {
    done(d);
  }
});

test("several models are kept apart; sidechains, synthetic and unknown records are ignored", async () => {
  const d = tmp();
  try {
    const f = path.join(d, "s.jsonl");
    fs.writeFileSync(
      f,
      [
        asst("a", "claude-a", usage(1, 1, 0, 0)),
        asst("b", "claude-b", usage(2, 2, 0, 0)),
        asst("c", "claude-b", usage(100, 100, 0, 0), { isSidechain: true }),
        asst("d", "<synthetic>", usage(9, 9, 9, 9)),
        { type: "weird", future: { a: 1 } },
        { type: "assistant", message: { id: "e", model: "claude-a", usage: "nonsense" } },
        { type: "user", message: { role: "user", content: "x", usage: usage(50, 50, 50, 50) } },
        "{broken json",
      ].map(line).join(""),
    );
    const s = await sum(f);
    assert.deepEqual(Object.keys(s.models).sort(), ["claude-a", "claude-b"]);
    assert.equal(s.models["claude-b"].input, 2);
    assert.equal(s.totals.input, 3);
    assert.equal(s.totals.output, 3);
  } finally {
    done(d);
  }
});

test("cost and durations come from the last cost-state; without one they are null", async () => {
  const d = tmp();
  try {
    const none = path.join(d, "n.jsonl");
    fs.writeFileSync(none, line(asst("m", "claude-a", usage(1, 1, 1, 1))));
    const n = await sum(none);
    assert.equal(n.totals.costUsd, null);
    assert.deepEqual(n.durationsMs, { api: null, tools: null, wall: null });
    assert.equal(n.models["claude-a"].costUsd, null);

    const two = path.join(d, "t.jsonl");
    fs.writeFileSync(two, [asst("m", "claude-a", usage(1, 1, 1, 1)), cost(1.5, { "claude-a": { costUSD: 1.5 } }, { api: 1 }), cost(2.25, { "claude-a": { costUSD: 2.25 } }, { api: 7, tools: 8, wall: 9 })].map(line).join(""));
    const t = await sum(two);
    assert.equal(t.totals.costUsd, 2.25);
    assert.equal(t.models["claude-a"].costUsd, 2.25);
    assert.deepEqual(t.durationsMs, { api: 7, tools: 8, wall: 9 });
  } finally {
    done(d);
  }
});

test("the summary has the SessionMetrics v1 shape and carries no content, path or repo", async () => {
  const d = tmp();
  try {
    const f = path.join(d, "s.jsonl");
    fs.writeFileSync(f, [asst("m", "claude-a", usage(1, 2, 3, 4)), cost(0.5, { "claude-a": { costUSD: 0.5 } })].map(line).join(""));
    const s = await sum(f);
    assert.deepEqual(s, {
      version: 1,
      sessionId: "sid",
      scope: "main-session",
      models: { "claude-a": { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, costUsd: 0.5 } },
      totals: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cacheHitRatio: 3 / 8, costUsd: 0.5 },
      durationsMs: { api: 100, tools: 50, wall: 1000 },
      source: "transcript",
      confidence: "observed",
      privacy: "metadata",
      partial: false,
    });
    const json = JSON.stringify(s);
    assert.equal(json.includes("SECRET-CONTENT"), false);
    assert.equal(json.includes(d), false);
  } finally {
    done(d);
  }
});

test("an empty hit ratio is null, not NaN", async () => {
  const d = tmp();
  try {
    const f = path.join(d, "s.jsonl");
    fs.writeFileSync(f, "");
    assert.equal((await sum(f)).totals.cacheHitRatio, null);
  } finally {
    done(d);
  }
});

test("reading by appends gives the result of one full read; a smaller file starts over", async () => {
  const d = tmp();
  try {
    const f = path.join(d, "s.jsonl");
    const recs = [asst("m1", "claude-a", usage(1, 1, 1, 1)), asst("m1", "claude-a", usage(1, 9, 1, 1)), asst("m2", "claude-b", usage(2, 2, 2, 2)), cost(1, { "claude-a": { costUSD: 1 } }), asst("m3", "claude-a", usage(3, 3, 3, 3)), cost(2, { "claude-a": { costUSD: 2 } })];
    const svc = createMetricsService();
    fs.writeFileSync(f, "");
    for (const r of recs) {
      fs.appendFileSync(f, line(r));
      await svc.get(f, "sid");
    }
    const inc = await svc.get(f, "sid");
    assert.deepEqual(inc, await sum(f));

    // half a line at the end is picked up once it is finished
    const last = line(asst("m4", "claude-a", usage(4, 4, 4, 4)));
    fs.appendFileSync(f, last.slice(0, 30));
    await svc.get(f, "sid");
    fs.appendFileSync(f, last.slice(30));
    assert.equal((await svc.get(f, "sid")).totals.input, 1 + 2 + 3 + 4);

    // compaction: the file is rewritten smaller
    fs.writeFileSync(f, line(asst("z", "claude-z", usage(7, 7, 7, 7))));
    const small = await svc.get(f, "sid");
    assert.deepEqual(Object.keys(small.models), ["claude-z"]);
    assert.equal(small.totals.input, 7);
  } finally {
    done(d);
  }
});

test("an unchanged file is not read again", async () => {
  const d = tmp();
  try {
    const f = path.join(d, "s.jsonl");
    fs.writeFileSync(f, line(asst("m", "claude-a", usage(1, 1, 1, 1))));
    const svc = createMetricsService();
    await svc.get(f, "sid");
    await svc.get(f, "sid");
    await svc.get(f, "sid");
    assert.equal(svc.reads, 1);
    fs.appendFileSync(f, line(asst("n", "claude-a", usage(1, 1, 1, 1))));
    await svc.get(f, "sid");
    assert.equal(svc.reads, 2);
  } finally {
    done(d);
  }
});

test("a transcript over the cap is read from its tail and marked partial", async () => {
  const d = tmp();
  try {
    const f = path.join(d, "s.jsonl");
    fs.writeFileSync(f, Array.from({ length: 300 }, (_, i) => asst(`m${i}`, "claude-a", usage(1, 1, 0, 0), { pad: "p".repeat(200) })).map(line).join(""));
    const st = newState();
    await advance(f, st, { maxBytes: 20000 });
    const s = summarize(st, "sid");
    assert.equal(s.partial, true);
    assert.ok(s.totals.input > 10 && s.totals.input < 300);
  } finally {
    done(d);
  }
});

test("reader: `from` starts at a byte offset and reports where it stopped", async () => {
  const d = tmp();
  try {
    const f = path.join(d, "s.jsonl");
    const a = line({ type: "user", n: 1 });
    fs.writeFileSync(f, a + line({ type: "user", n: 2 }) + '{"type":"user","n":3');
    const stats = {};
    const got = [];
    for await (const r of readTranscript(f, { from: Buffer.byteLength(a), stats })) got.push(r.n);
    assert.deepEqual(got, [2]);
    assert.equal(stats.offset, Buffer.byteLength(a + line({ type: "user", n: 2 })));
  } finally {
    done(d);
  }
});

test("a 50 MB transcript streams without holding it", async () => {
  const d = tmp();
  try {
    const f = path.join(d, "big.jsonl");
    const fd = fs.openSync(f, "w");
    const pad = "y".repeat(20000);
    for (let i = 0; i < 2500; i++) fs.writeSync(fd, line(asst(`m${i}`, "claude-a", usage(1, 1, 1, 1), { pad })));
    fs.closeSync(fd);
    const before = process.memoryUsage().heapUsed;
    let peak = before;
    const t = setInterval(() => (peak = Math.max(peak, process.memoryUsage().heapUsed)), 10);
    const s = await sum(f);
    clearInterval(t);
    assert.equal(s.totals.input, 2500);
    assert.ok(peak - before < 150 * 1024 * 1024, `heap grew ${Math.round((peak - before) / 1e6)} MB`);
  } finally {
    done(d);
  }
});
