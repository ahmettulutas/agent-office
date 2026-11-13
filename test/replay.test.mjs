import test from "node:test";
import assert from "node:assert/strict";
import { timelineRows } from "../web/replay.js";

const trace = {
  version: 1,
  messages: [
    { role: "user", content: "fix the bug" },
    { role: "assistant", content: [{ type: "text", text: "Looking." }, { type: "tool_use", id: "t1", name: "Read", input: { detail: "a.js" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "boom", is_error: true }] },
  ],
};

test("replay: rows follow the conversation, errors flagged, tool result named", () => {
  const { rows } = timelineRows(trace);
  assert.deepEqual(rows.map((r) => [r.kind, r.label, r.error]), [
    ["user", "You", false],
    ["reply", "Claude", false],
    ["tool", "Read", false],
    ["result", "Read result", true],
  ]);
  assert.equal(rows[2].text, "a.js");
});

test("replay: junk input and long text are tolerated and capped", () => {
  assert.deepEqual(timelineRows(null).rows, []);
  assert.deepEqual(timelineRows({ messages: [null, 3, { role: "user", content: [null, { type: "x" }] }] }).rows, []);
  const big = { messages: Array.from({ length: 450 }, () => ({ role: "user", content: "x".repeat(500) })) };
  const r = timelineRows(big);
  assert.equal(r.rows.length, 400);
  assert.equal(r.omitted, 50);
  assert.ok(r.rows[0].text.length <= 161);
});
