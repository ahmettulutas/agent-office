// The 3D draw order: what stands in front of whom.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ITEMS, occludes, order, itemBounds, overlaps } from "../web/scene.js";
import { seats, T } from "../web/map.js";

const at = (x, y) => [(x + 0.5) * T, (y + 0.5) * T];
const find = (kind, fn) => ITEMS.find((it) => it.kind === kind && fn(it));

test("items are drawn back to front", () => {
  const index = new Map(ITEMS.map((it, i) => [it, i]));
  let checked = 0;
  for (let i = 0; i < ITEMS.length; i++) {
    for (let j = i + 1; j < ITEMS.length; j++) {
      const a = ITEMS[i];
      const b = ITEMS[j];
      if (!overlaps(itemBounds(a), itemBounds(b))) continue;
      checked++;
      // nothing later in the list may be behind something earlier
      assert.notEqual(order(a, b), 1, `${a.kind} #${index.get(a)} is drawn before ${b.kind} #${index.get(b)} but is in front of it`);
    }
  }
  assert.ok(checked > 500, `only ${checked} overlapping pairs`);
});

test("a desk covers the person sitting behind it, not the one walking in front", () => {
  const seat = seats.find((s) => s.zone === "lead");
  const desk = find("desk", (it) => it.seatKey === `${seat.x},${seat.y}`);
  assert.ok(desk);
  assert.equal(occludes(desk, ...at(seat.x, seat.y)), true);
  assert.equal(occludes(desk, ...at(seat.x, seat.y + 2)), false);
});

test("a chair back covers its sitter only when it is on the near side", () => {
  const down = seats.find((s) => s.facing === "down");
  const up = seats.find((s) => s.facing === "up");
  const chair = (s) => find("chair", (it) => it.box[0] > s.x * T && it.box[0] < (s.x + 1) * T && it.box[1] > s.y * T - 2 && it.box[1] < (s.y + 1) * T);
  assert.equal(occludes(chair(down), ...at(down.x, down.y)), false);
  assert.equal(occludes(chair(up), ...at(up.x, up.y)), true);
});

test("glass between a room and the corridor covers people in the room, not in the corridor", () => {
  const glass = find("glass", (it) => it.box[0] === 3 * T && it.box[1] > 11 * T);
  assert.ok(glass);
  assert.equal(occludes(glass, ...at(3, 10)), true);
  assert.equal(occludes(glass, ...at(3, 12)), false);
});
