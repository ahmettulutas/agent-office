// What people do: the live snapshot becomes people who walk in, sit at a desk
// (or stand in the corridor when the desks are full), type, take breaks, hand
// their work to their lead and walk out. Positions are in tiles.

import { T, OUTSIDE, seats, spots, overflow, findPath, walkable, zoneFor } from "./map.js";
import { iso } from "./iso.js";
import { lookFor, pick } from "./look.js";
import { ui, emit, now, rand, SEC } from "./ui.js";

export const walkers = new Map();
const seatOwner = new Map();
export const spotOwner = new Map();
export const office = { snapshot: { sessions: [] } };
let booted = false;

// ---------- seats ----------
function claimSeat(w, zones) {
  for (const zone of zones) {
    for (const s of seats) {
      if (s.zone === zone && !seatOwner.has(s.id)) {
        seatOwner.set(s.id, w.key);
        return s;
      }
    }
  }
  for (const s of [...seats, ...overflow]) {
    if (!seatOwner.has(s.id)) {
      seatOwner.set(s.id, w.key);
      return s;
    }
  }
  return null;
}

// someone standing in the corridor takes a real desk as soon as one is free
function upgradeSeat(w, zones) {
  if (!w.seat?.stand || w.path.length) return;
  const free = zones.flatMap((z) => seats.filter((s) => s.zone === z)).find((s) => !seatOwner.has(s.id)) || seats.find((s) => !seatOwner.has(s.id));
  if (!free) return;
  seatOwner.delete(w.seat.id);
  seatOwner.set(free.id, w.key);
  w.seat = free;
}
const seatPose = (seat) => (seat.stand ? "stand" : "sit");

function release(w) {
  if (w.seat && seatOwner.get(w.seat.id) === w.key) seatOwner.delete(w.seat.id);
  w.seat = null;
  releaseSpot(w);
}
function releaseSpot(w) {
  if (w.spot && spotOwner.get(w.spot.id) === w.key) spotOwner.delete(w.spot.id);
  w.spot = null;
}

function makeWalker(key, kind, sessionId, data, zone) {
  const w = {
    key,
    kind,
    sessionId,
    agentId: kind === "sub" ? data.id : null,
    data,
    zone,
    look: lookFor(key, kind, zone),
    fx: OUTSIDE.x,
    fy: OUTSIDE.y,
    ox: 0,
    oy: 0,
    path: [],
    goal: null,
    pose: "stand",
    facing: "right",
    phase: Math.random() * 10,
    seat: null,
    spot: null,
    mode: "work",
    breakUntil: 0,
    nextBreakAt: now() + rand(15, 35) * SEC,
    holding: null,
    typing: false,
    waving: false,
    lastTool: null,
    toolUntil: 0,
    checkUntil: 0,
    delivered: false,
    noteUntil: 0,
    note: "",
  };
  w.seat = claimSeat(w, kind === "main" ? ["lead", "dev"] : [zone, "dev"]);
  walkers.set(key, w);
  return w;
}

function place(w, tile, pose, facing) {
  w.fx = tile.x;
  w.fy = tile.y;
  w.path = [];
  w.goal = { x: tile.x, y: tile.y, pose, facing };
  w.pose = pose;
  w.facing = facing;
}

function setGoal(w, g) {
  const same = w.goal && w.goal.x === g.x && w.goal.y === g.y;
  w.goal = g;
  if (same && (w.path.length || atGoal(w))) return;
  const from = { x: Math.round(w.fx), y: Math.round(w.fy) };
  w.path = findPath(from, g) || [];
}

export function atGoal(w) {
  return w.goal && w.path.length === 0 && Math.abs(w.fx - w.goal.x) < 0.01 && Math.abs(w.fy - w.goal.y) < 0.01;
}

// ---------- applying a snapshot ----------
export function sync(snap) {
  office.snapshot = snap;
  const seen = new Set();
  for (const s of snap.sessions) {
    const key = `s:${s.id}`;
    let w = walkers.get(key);
    if (!w && s.state !== "ended") {
      w = makeWalker(key, "main", s.id, s, "lead");
      if (!booted && w.seat) place(w, w.seat, seatPose(w.seat), w.seat.facing);
    }
    if (w) {
      w.data = s;
      seen.add(key);
    }
    for (const a of s.subagents || []) {
      const akey = `a:${s.id}:${a.id}`;
      let aw = walkers.get(akey);
      if (!aw && a.state === "running") {
        aw = makeWalker(akey, "sub", s.id, a, zoneFor(a.type));
        if (!booted && aw.seat) place(aw, aw.seat, seatPose(aw.seat), aw.seat.facing);
      }
      if (aw) {
        aw.data = a;
        seen.add(akey);
      }
    }
  }
  for (const [key, w] of walkers) {
    if (!seen.has(key)) w.data = { ...w.data, state: w.kind === "main" ? "ended" : "done" };
  }
  booted = true;
  emit("side");
}

// ---------- behaviour ----------
function adjacentTo(tile) {
  const opts = [[1, 0], [-1, 0], [0, -1], [0, 1]];
  for (const [dx, dy] of opts) {
    const x = tile.x + dx;
    const y = tile.y + dy;
    if (walkable(x, y) && !seats.some((s) => s.x === x && s.y === y)) return { x, y, dx, dy };
  }
  for (const [dx, dy] of opts) if (walkable(tile.x + dx, tile.y + dy)) return { x: tile.x + dx, y: tile.y + dy, dx, dy };
  return null;
}

function faceToward(dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

function leave(w) {
  if (w.mode !== "leave") {
    w.mode = "leave";
    release(w);
  }
  setGoal(w, { x: OUTSIDE.x, y: OUTSIDE.y, pose: "stand", facing: "left" });
}

function think(w) {
  const d = w.data;
  w.typing = false;
  w.waving = false;

  if (w.kind === "main") {
    if (d.state === "ended") return leave(w);
    if (!w.seat) w.seat = claimSeat(w, ["lead", "dev"]);
    upgradeSeat(w, ["lead", "dev"]);
    if (d.state === "busy" || d.state === "needs-you") {
      if (w.mode === "break") {
        releaseSpot(w);
        w.holding = null;
      }
      w.mode = "work";
      w.nextBreakAt = now() + rand(20, 40) * SEC;
      if (!w.seat) return;
      const needs = d.state === "needs-you";
      setGoal(w, { x: w.seat.x, y: w.seat.y, pose: needs ? "stand" : seatPose(w.seat), facing: w.seat.facing });
      w.holding = w.seat.stand && !needs ? "laptop" : null;
      if (atGoal(w)) {
        w.typing = !needs;
        w.waving = needs;
      }
      return;
    }
    // idle: sit at the desk, now and then take a break
    if (w.mode === "break") {
      if (atGoal(w) && !w.breakUntil) w.breakUntil = now() + rand(20, 45) * SEC;
      if (w.breakUntil && now() > w.breakUntil) {
        releaseSpot(w);
        w.mode = "work";
        w.breakUntil = 0;
        w.nextBreakAt = now() + rand(30, 70) * SEC;
      } else {
        const s = w.spot;
        setGoal(w, { x: s.x, y: s.y, pose: s.pose, facing: s.facing });
        if (atGoal(w)) {
          w.holding = s.act === "coffee" || s.act === "chat" ? "coffee" : s.act === "pingpong" ? "paddle" : null;
          w.typing = s.act === "arcade";
        }
        return;
      }
    }
    w.holding = w.seat?.stand ? "laptop" : null;
    if (w.seat) setGoal(w, { x: w.seat.x, y: w.seat.y, pose: seatPose(w.seat), facing: w.seat.facing });
    if (atGoal(w) && now() > w.nextBreakAt && now() - d.since > 12 * SEC) {
      const free = spots.filter((s) => !spotOwner.has(s.id));
      if (free.length) {
        // ping-pong only with a partner already waiting, or a small chance to start
        const pp = free.filter((s) => s.pair && spots.some((o) => o.pair === s.pair && o.id !== s.id && spotOwner.has(o.id)));
        const s = pp.length ? pp[0] : pick(free, Math.floor(Math.random() * 1e6));
        spotOwner.set(s.id, w.key);
        w.spot = s;
        w.mode = "break";
        w.breakUntil = 0;
      } else {
        w.nextBreakAt = now() + 20 * SEC;
      }
    }
    return;
  }

  // subagent
  if (d.state === "running") {
    if (!w.seat) w.seat = claimSeat(w, [w.zone, "dev"]);
    upgradeSeat(w, [w.zone, "dev"]);
    if (!w.seat) return;
    setGoal(w, { x: w.seat.x, y: w.seat.y, pose: seatPose(w.seat), facing: w.seat.facing });
    w.holding = w.seat.stand ? "laptop" : null;
    if (atGoal(w)) w.typing = true;
    return;
  }
  // done: hand the paper to the main agent, then go home
  if (w.mode === "leave") return leave(w);
  const parent = walkers.get(`s:${w.sessionId}`);
  if (w.delivered || !parent || parent.mode === "leave") {
    if (w.checkUntil && now() < w.checkUntil) return;
    return leave(w);
  }
  if (w.mode !== "deliver") {
    w.mode = "deliver";
    w.holding = "paper";
    if (w.seat && seatOwner.get(w.seat.id) === w.key) seatOwner.delete(w.seat.id);
    w.seat = null;
  }
  const ptile = { x: Math.round(parent.fx), y: Math.round(parent.fy) };
  const adj = adjacentTo(ptile);
  if (!adj) return leave(w);
  setGoal(w, { x: adj.x, y: adj.y, pose: "stand", facing: faceToward(-adj.dx, -adj.dy) });
  if (atGoal(w)) {
    w.delivered = true;
    w.holding = null;
    w.checkUntil = now() + 1600;
    parent.note = `${w.data.type} done`;
    parent.noteUntil = now() + 3500;
  }
}

function move(w, dt) {
  const speed = w.mode === "leave" ? 5 : 4; // tiles per second
  let budget = speed * dt;
  while (budget > 0 && w.path.length) {
    const n = w.path[0];
    const dx = n.x - w.fx;
    const dy = n.y - w.fy;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.001) w.facing = faceToward(dx, dy);
    if (dist <= budget) {
      w.fx = n.x;
      w.fy = n.y;
      w.path.shift();
      budget -= dist;
    } else {
      w.fx += (dx / dist) * budget;
      w.fy += (dy / dist) * budget;
      budget = 0;
    }
  }
  if (w.path.length) {
    w.pose = "walk";
  } else if (w.goal) {
    w.pose = w.goal.pose;
    w.facing = w.goal.facing;
  }
}

// People who pass each other step a little to the side (only where they are
// drawn, not where they walk), so nobody walks through anybody.
function sidestep(dt) {
  const list = [...walkers.values()];
  for (const w of list) {
    let tx = 0;
    let ty = 0;
    const next = w.path[0];
    if (w.pose === "walk" && next) {
      const mx = next.x - w.fx;
      const my = next.y - w.fy;
      const ml = Math.hypot(mx, my) || 1;
      const px = -my / ml;
      const py = mx / ml;
      for (const o of list) {
        if (o === w) continue;
        const dx = w.fx - o.fx;
        const dy = w.fy - o.fy;
        const d = Math.hypot(dx, dy);
        if (d > 0.9) continue;
        const k = (0.9 - d) / 0.9;
        const side = Math.sign(px * dx + py * dy) || (w.key < o.key ? 1 : -1);
        tx += px * side * k * 0.42;
        ty += py * side * k * 0.42;
      }
      if (!walkable(Math.round(w.fx + tx), Math.round(w.fy + ty))) tx = ty = 0;
    }
    const e = Math.min(1, dt * 8);
    w.ox += (tx - w.ox) * e;
    w.oy += (ty - w.oy) * e;
  }
}

// one tick: decide, move, and work out where everyone is drawn
export function step(dt) {
  for (const w of [...walkers.values()]) {
    think(w);
    move(w, dt);
    if (w.mode === "leave" && atGoal(w) && w.fx === OUTSIDE.x && w.fy === OUTSIDE.y) {
      release(w);
      walkers.delete(w.key);
      if (ui.selectedKey === w.key) ui.selectedKey = null;
      emit("side");
    }
  }
  sidestep(dt);
  for (const w of walkers.values()) {
    w.px = (w.fx + 0.5 + w.ox) * T;
    w.py = (w.fy + 0.5 + w.oy) * T;
    [w.sx, w.sy] = iso(w.px, w.py, 0);
    w.selected = w.key === ui.selectedKey;
  }
}

// waiting outside the door, not yet walking in
export const offstage = (w) => w.fx < 0 && w.fy === OUTSIDE.y && w.path.length === 0 && w.mode !== "leave";

// both ping-pong players in place
export function pingpongPlayers() {
  const players = spots.filter((s) => s.pair === "pp").map((s) => walkers.get(spotOwner.get(s.id)));
  return players.length === 2 && players.every((p) => p && atGoal(p));
}
