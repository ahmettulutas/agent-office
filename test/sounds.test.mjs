import { test } from "node:test";
import assert from "node:assert/strict";
import { Office } from "../lib/state.mjs";
import { SOUNDS, DEFAULT_SOUND, soundById, wav } from "../lib/sounds.mjs";

const S = { session: "s1", cwd: "/work/web-shop" };

test("each switch into needs-you counts one alert, from the session or a subagent", () => {
  const o = new Office();
  let t = Date.now();
  o.apply({ ...S, event: "UserPromptSubmit" }, t++);
  o.apply({ ...S, event: "PreToolUse", tool: "Bash", toolUseId: "u1" }, t++);
  o.apply({ ...S, event: "Notification", notification: "permission_prompt" }, t++);
  assert.equal(o.alerts, 1);
  // still waiting: a repeated notice does not ring again
  o.apply({ ...S, event: "Notification", notification: "permission_prompt" }, t++);
  assert.equal(o.alerts, 1);
  o.apply({ ...S, event: "PostToolUse", tool: "Bash", toolUseId: "u1" }, t++);
  // a subagent asking for permission holds up its session and rings too
  o.apply({ ...S, event: "PreToolUse", tool: "Write", toolUseId: "u2", agentId: "a1", agentType: "Explore" }, t++);
  o.apply({ ...S, event: "Notification", notification: "permission_prompt", agentId: "a1", agentType: "Explore" }, t++);
  assert.equal(o.snapshot().sessions[0].state, "needs-you");
  assert.equal(o.alerts, 2);
  // notices that are not about the user, or late ones, do not
  o.apply({ ...S, event: "PostToolUse", tool: "Write", toolUseId: "u2", agentId: "a1" }, t++);
  o.apply({ ...S, event: "Notification", notification: "idle_prompt" }, t++);
  o.apply({ ...S, event: "Notification", notification: "permission_prompt" }, t++);
  assert.equal(o.alerts, 2);
});

test("every sound is a valid, loud 16-bit wav with its own id", () => {
  assert.equal(new Set(SOUNDS.map((x) => x.id)).size, SOUNDS.length);
  for (const sd of SOUNDS) {
    const samples = sd.make();
    let peak = 0;
    for (const v of samples) peak = Math.max(peak, Math.abs(v));
    assert.ok(peak > 0.9 && peak <= 1, `${sd.id} peak ${peak}`);
    assert.ok(samples.length > 44100 && samples.length < 44100 * 5, `${sd.id} length`);
    const buf = wav(samples);
    assert.equal(buf.toString("ascii", 0, 4), "RIFF");
    assert.equal(buf.toString("ascii", 8, 12), "WAVE");
    assert.equal(buf.readUInt16LE(34), 16);
    assert.equal(buf.length, 44 + samples.length * 2);
  }
});

test("an unknown sound falls back to the default", () => {
  assert.equal(soundById("nope").id, DEFAULT_SOUND);
  assert.equal(soundById("gong").id, "gong");
});
