import { test } from "node:test";
import assert from "node:assert/strict";
import { Office } from "../lib/state.mjs";
import { extract } from "../lib/extract.mjs";
import { findPath, clearLine, seats, spots, overflow, walkable, ENTRANCE, OUTSIDE, zoneFor } from "../web/map.js";

const S = { session: "s1", cwd: "/work/web-shop" };
const T0 = Date.now();
const get = (o) => o.snapshot().sessions[0];

test("a session goes idle, busy, needs-you, busy, idle, ended", () => {
  const o = new Office();
  let t = Date.now();
  o.apply({ ...S, event: "SessionStart", source: "startup", model: "Opus" }, t++);
  assert.equal(get(o).state, "idle");
  assert.equal(get(o).project, "web-shop");
  o.apply({ ...S, event: "UserPromptSubmit" }, t++);
  assert.equal(get(o).state, "busy");
  o.apply({ ...S, event: "PreToolUse", tool: "Bash", detail: "Deploy", toolUseId: "u1" }, t++);
  o.apply({ ...S, event: "Notification", notification: "permission_prompt" }, t++);
  assert.equal(get(o).state, "needs-you");
  o.apply({ ...S, event: "PostToolUse", tool: "Bash", toolUseId: "u1" }, t++);
  assert.equal(get(o).state, "busy");
  assert.equal(get(o).log[0].ok, true);
  o.apply({ ...S, event: "Stop" }, t++);
  assert.equal(get(o).state, "idle");
  o.apply({ ...S, event: "SessionEnd", reason: "other" }, t++);
  assert.equal(get(o).state, "ended");
  // events after the end are ignored
  assert.equal(o.apply({ ...S, event: "UserPromptSubmit" }, t++), false);
});

test("a late permission notice for a tool that already ran is ignored", () => {
  const o = new Office();
  o.apply({ ...S, event: "UserPromptSubmit" }, T0 + 1);
  o.apply({ ...S, event: "PreToolUse", tool: "Bash", toolUseId: "u1" }, T0 + 2);
  o.apply({ ...S, event: "PostToolUse", tool: "Bash", toolUseId: "u1" }, T0 + 3);
  o.apply({ ...S, event: "Notification", notification: "permission_prompt" }, T0 + 4);
  assert.equal(get(o).state, "busy");
});

test("subagents get the label of their Agent call and finish", () => {
  const o = new Office();
  o.apply({ ...S, event: "PreToolUse", tool: "Agent", subagentType: "Explore", description: "Find the cart", toolUseId: "a" }, T0 + 1);
  o.apply({ ...S, event: "SubagentStart", agentId: "x1", agentType: "Explore" }, T0 + 2);
  o.apply({ ...S, event: "PreToolUse", agentId: "x1", agentType: "Explore", tool: "Grep", detail: "cart" }, T0 + 3);
  let a = get(o).subagents[0];
  assert.equal(a.label, "Find the cart");
  assert.equal(a.state, "running");
  assert.equal(a.tool, "Grep");
  o.apply({ ...S, event: "SubagentStop", agentId: "x1", agentType: "Explore" }, T0 + 4);
  a = get(o).subagents[0];
  assert.equal(a.state, "done");
});

test("ended sessions and stale ones are pruned", () => {
  const o = new Office({ forgetAfterHours: 1 });
  o.apply({ ...S, event: "SessionEnd" }, 0);
  o.apply({ session: "s2", event: "UserPromptSubmit" }, 0);
  assert.equal(o.snapshot(30_000).sessions.length, 2);
  const left = o.snapshot(2 * 3600_000).sessions;
  assert.equal(left.length, 0);
});

test("busy without news for 15 minutes falls back to idle", () => {
  const o = new Office();
  o.apply({ ...S, event: "UserPromptSubmit" }, 0);
  assert.equal(o.snapshot(16 * 60_000).sessions[0].state, "idle");
});

test("extract keeps names only, never prompts or commands", () => {
  const e = extract({
    hook_event_name: "PreToolUse",
    session_id: "abc",
    cwd: "/a/b",
    tool_name: "Bash",
    tool_input: { command: "curl -H 'Authorization: secret' x", description: "Call the API" },
    prompt: "my secret prompt",
  });
  assert.equal(e.detail, "Call the API");
  assert.ok(!JSON.stringify(e).includes("secret"));
  const e2 = extract({ hook_event_name: "PreToolUse", session_id: "abc", tool_name: "Bash", tool_input: { command: "TOKEN=x npm test" } });
  assert.equal(e2.detail, "TOKEN=x");
  const e3 = extract({ hook_event_name: "PreToolUse", session_id: "abc", tool_name: "Edit", tool_input: { file_path: "/x/y/app.tsx", old_string: "a" } });
  assert.equal(e3.detail, "app.tsx");
  const e4 = extract({ hook_event_name: "PreToolUse", session_id: "abc", tool_name: "mcp__ccd_turn__wrap_up" });
  assert.equal(e4.tool, "ccd_turn:wrap_up");
});

test("every seat and break spot can be reached from the entrance", () => {
  for (const s of [...seats, ...spots]) {
    assert.ok(walkable(s.x, s.y), `${s.id} is not walkable`);
    assert.ok(findPath(OUTSIDE, s), `${s.id} cannot be reached`);
    assert.ok(findPath(s, OUTSIDE), `${s.id} has no way out`);
  }
  assert.ok(walkable(ENTRANCE.x, ENTRANCE.y));
});

test("subagent types map to rooms", () => {
  assert.equal(zoneFor("Explore"), "research");
  assert.equal(zoneFor("Plan"), "meeting");
  assert.equal(zoneFor("code-reviewer"), "review");
  assert.equal(zoneFor("unit-tester"), "review");
  assert.equal(zoneFor("general-purpose"), "dev");
});

test("paths cut corners like people do, never through walls", () => {
  for (const goal of [...seats, ...spots, ...overflow]) {
    const p = findPath(OUTSIDE, goal);
    assert.ok(p && p.length, `no path to ${goal.x},${goal.y}`);
    let from = OUTSIDE;
    for (const q of p) {
      assert.ok(clearLine(from, q), `blocked step ${from.x},${from.y} -> ${q.x},${q.y}`);
      from = q;
    }
    assert.deepEqual(p.at(-1), { x: goal.x, y: goal.y });
  }
  // straightened: far fewer points than tiles walked
  assert.ok(findPath(OUTSIDE, { x: 52, y: 30 }).length < 15);
});

test("corridor places for when every desk is taken", () => {
  assert.ok(overflow.length >= 30);
  for (const s of overflow) assert.ok(walkable(s.x, s.y) && s.stand);
});

test("Esc in the transcript ends a busy turn, not a later one", () => {
  const o = new Office();
  const t = Date.now();
  o.apply({ ...S, event: "UserPromptSubmit", transcript: "/x.jsonl" }, t);
  o.apply({ ...S, event: "PreToolUse", tool: "Bash", toolUseId: "u1" }, t + 10);
  assert.deepEqual(o.watchList().map((w) => w.transcript), ["/x.jsonl"]);
  assert.equal(o.interrupt("s1", t - 5000, t + 20), false); // an old interrupt
  assert.equal(o.interrupt("s1", t + 15, t + 20), true);
  assert.equal(get(o).state, "idle");
  assert.equal(get(o).log[0].ok, false);
  assert.equal(o.watchList().length, 0);
  assert.equal("transcript" in get(o), false);
});

test("the last alert says who and why", () => {
  const o = new Office();
  const t = Date.now();
  o.apply({ ...S, event: "UserPromptSubmit" }, t);
  o.apply({ ...S, event: "PreToolUse", tool: "Write", toolUseId: "u1", agentId: "a1", agentType: "Explore" }, t + 1);
  o.apply({ ...S, event: "Notification", notification: "permission_prompt", agentId: "a1", agentType: "Explore" }, t + 2);
  assert.deepEqual(o.lastAlert, { session: "s1", project: "web-shop", reason: "permission_prompt", agentType: "Explore" });
});

test("Claude asking a question or a plan approval waits for you until it is answered", () => {
  for (const [tool, reason] of [["AskUserQuestion", "question"], ["ExitPlanMode", "plan_approval"]]) {
    const o = new Office();
    const t = Date.now();
    o.apply({ ...S, event: "UserPromptSubmit" }, t);
    o.apply({ ...S, event: "PreToolUse", tool, toolUseId: "q1" }, t + 1);
    assert.equal(get(o).state, "needs-you");
    assert.equal(get(o).reason, reason);
    assert.equal(o.alerts, 1);
    assert.equal(o.lastAlert.reason, reason);
    // a permission notice for the same tool does not ring twice
    o.apply({ ...S, event: "Notification", notification: "permission_prompt" }, t + 2);
    assert.equal(o.alerts, 1);
    o.apply({ ...S, event: "PostToolUse", tool, toolUseId: "q1" }, t + 3);
    assert.equal(get(o).state, "busy");
  }
});
