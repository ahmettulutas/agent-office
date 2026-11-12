// Drawing a frame: the static office layer, animated screens, people back to
// front (with whatever stands in front of them drawn again over them), the
// light of the hour, status marks and labels.

import { T } from "./map.js";
import { daylight } from "./floors.js";
import { iso, onGround } from "./iso.js";
import { ITEMS, renderStatic, itemBounds, occludes, overlaps, CEILING_LIGHTS } from "./scene.js";
import { drawPerson, drawStatus, drawBall } from "./people.js";
import { W, H, canvas, cam, view, onView, toScreen } from "./camera.js";
import { walkers, atGoal, offstage, pingpongPlayers } from "./office.js";
import { ui, now, SEC, reasonText } from "./ui.js";

const ctx = canvas.getContext("2d");
export const boxes = new Map(); // where each person was drawn, for clicks

// ---------- light: auto follows the clock ----------
const LIGHT_MODES = ["auto", "day", "night"];
export let lightMode = "auto";
try {
  const saved = localStorage.getItem("agent-office:light");
  if (LIGHT_MODES.includes(saved)) lightMode = saved;
} catch {
  /* storage blocked: use auto */
}
let env = daylight(new Date(), lightMode);
export function cycleLight() {
  lightMode = LIGHT_MODES[(LIGHT_MODES.indexOf(lightMode) + 1) % LIGHT_MODES.length];
  try {
    localStorage.setItem("agent-office:light", lightMode);
  } catch {
    /* storage blocked: keep it for this page only */
  }
  env = daylight(new Date(), lightMode);
  rebuildStatic();
  return lightMode;
}

// ---------- layers ----------
// Floors, walls and furniture are drawn once into a layer at the resolution
// the screen needs (res), and again when that or the time of day changes.
// Each item can also be drawn on its own (a sprite) to cover a person behind it.
const staticLayer = document.createElement("canvas");
let staticKey = "";
let res = 1;
const sprites = new Map();
const wantedRes = () => Math.min(2.5, Math.max(1, Math.ceil(view.scale * view.dpr * 1.2 * 4) / 4));
function rebuildStatic() {
  staticLayer.width = Math.round(W * res);
  staticLayer.height = Math.round(H * res);
  const sctx = staticLayer.getContext("2d");
  sctx.setTransform(res, 0, 0, res, 0, 0);
  renderStatic(sctx, env, res);
  sprites.clear();
  staticKey = `${res}|${env.key}`;
}
let resTimer = null;
function scheduleRes() {
  const r = wantedRes();
  if (r === res && staticKey) return;
  clearTimeout(resTimer);
  resTimer = setTimeout(
    () => {
      res = wantedRes();
      rebuildStatic();
    },
    staticKey ? 180 : 0,
  );
}
onView(scheduleRes);
scheduleRes();

function sprite(it) {
  let c = sprites.get(it.id);
  const b = itemBounds(it);
  if (!c) {
    c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(b.w * res));
    c.height = Math.max(1, Math.ceil(b.h * res));
    const sc = c.getContext("2d");
    sc.setTransform(res, 0, 0, res, -b.x * res, -b.y * res);
    it.draw(sc, env);
    sprites.set(it.id, c);
  }
  ctx.drawImage(c, b.x, b.y, c.width / res, c.height / res);
}

const lightLayer = document.createElement("canvas");
const LIGHT_RES = 0.5;
lightLayer.width = Math.round(W * LIGHT_RES);
lightLayer.height = Math.round(H * LIGHT_RES);
const lctx = lightLayer.getContext("2d");
const ANIMATED = ITEMS.filter((it) => it.anim);
const LIT = ITEMS.filter((it) => it.lights);

function rgbaHex(c, a) {
  const n = parseInt(c.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Night: darken everything, then cut holes where lights fall on the floor and
// around each light itself. Lamps and screens add coloured glow on top.
function drawLighting(lights) {
  const dark = env.dark;
  if (dark > 0.01) {
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.globalCompositeOperation = "source-over";
    lctx.clearRect(0, 0, lightLayer.width, lightLayer.height);
    lctx.fillStyle = `rgba(12,16,40,${dark * 1.15})`;
    lctx.fillRect(0, 0, lightLayer.width, lightLayer.height);
    lctx.setTransform(LIGHT_RES, 0, 0, LIGHT_RES, 0, 0);
    lctx.globalCompositeOperation = "destination-out";
    const pool = (l, k) => {
      onGround(lctx, 0, (g) => {
        const gr = g.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
        gr.addColorStop(0, `rgba(0,0,0,${Math.min(1, l.strength * k)})`);
        gr.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = gr;
        g.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
      });
    };
    for (const l of CEILING_LIGHTS) pool(l, 0.6);
    for (const l of lights) {
      pool(l, 1);
      const [sx, sy] = iso(l.x, l.y, l.z || 0);
      const r = l.r * 0.45;
      const gr = lctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      gr.addColorStop(0, `rgba(0,0,0,${0.8 * l.strength})`);
      gr.addColorStop(1, "rgba(0,0,0,0)");
      lctx.fillStyle = gr;
      lctx.fillRect(sx - r, sy - r, r * 2, r * 2);
    }
    ctx.drawImage(lightLayer, 0, 0, W, H);
  }
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const l of lights) {
    if (!l.color) continue;
    const k = (l.day ?? 0.1) + dark * 0.55;
    if (k < 0.01) continue;
    onGround(ctx, 0, (g) => {
      const gr = g.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r * 0.8);
      gr.addColorStop(0, rgbaHex(l.color, k * l.strength * 0.8));
      gr.addColorStop(1, rgbaHex(l.color, 0));
      g.fillStyle = gr;
      g.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
    });
    const [sx, sy] = iso(l.x, l.y, l.z || 0);
    const r = l.r * 0.35;
    const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
    gr.addColorStop(0, rgbaHex(l.color, k * l.strength * 0.5));
    gr.addColorStop(1, rgbaHex(l.color, 0));
    ctx.fillStyle = gr;
    ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
  }
  ctx.restore();
}

// ---------- far away: a coloured pin per person ----------
const PIN = { busy: "#43e08b", running: "#ffb84d", "needs-you": "#ff5d5d", idle: "#9aa0b8", done: "#9aa0b8", ended: "#9aa0b8" };
const isFar = () => 32 * view.scale < 20; // a person shorter than about 20 screen pixels
function drawPin(w, b, t) {
  const r = 4.2 / view.scale;
  const x = w.sx;
  const lift = w.data.state === "needs-you" ? Math.abs(Math.sin(t * 4)) * 3 / view.scale : 0;
  const y = b.head - r * 1.6 - lift;
  ctx.beginPath();
  ctx.moveTo(x, y + r * 1.6);
  ctx.lineTo(x - r * 0.6, y + r * 0.4);
  ctx.lineTo(x + r * 0.6, y + r * 0.4);
  ctx.closePath();
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.72, 0, Math.PI * 2);
  ctx.fillStyle = PIN[w.data.state] || PIN.idle;
  ctx.fill();
}

// ---------- the frame ----------
let lastEnvCheck = 0;
export function draw(ts) {
  const t = ts / 1000;
  // the time of day: the light moves every few seconds, the office layer
  // (windows, sun patches) is redrawn every ten minutes
  if (ts - lastEnvCheck > 5_000) {
    lastEnvCheck = ts;
    const next = daylight(new Date(), lightMode);
    const rebuild = next.key !== env.key;
    env = next;
    if (rebuild) rebuildStatic();
  }

  // which screens are on: a desk whose seat holder is typing
  const typingSeat = new Set();
  let meetingOn = false;
  for (const w of walkers.values()) {
    if (w.typing && w.seat && atGoal(w)) {
      typingSeat.add(`${w.seat.x},${w.seat.y}`);
      if (w.seat.zone === "meeting") meetingOn = true;
    }
  }
  const stateOf = (it) => (it.seatKey ? { screen: typingSeat.has(it.seatKey) } : it.kind === "table" ? { screen: meetingOn } : null);

  const { scale, ox, oy, dpr } = view;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // the background gets the same night tint as the office, so the dark has no edge
  const k = env.dark > 0.01 ? Math.min(1, env.dark * 1.15) : 0;
  const mixC = (b, o) => Math.round(b * (1 - k) + o * k);
  ctx.fillStyle = `rgb(${mixC(14, 12)},${mixC(16, 16)},${mixC(23, 40)})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!staticKey) return;
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(staticLayer, 0, 0, W, H);
  for (const it of ANIMATED) it.anim(ctx, t, stateOf(it));

  // people back to front; whatever stands in front of someone is drawn again over them
  const people = [...walkers.values()].filter((w) => !offstage(w));
  people.sort((a, b) => a.px + a.py - (b.px + b.py));
  for (const w of people) {
    const b = drawPerson(ctx, w, t, w.sx, w.sy);
    boxes.set(w.key, b);
    for (const it of ITEMS) {
      if (!overlaps(itemBounds(it), b) || !occludes(it, w.px, w.py)) continue;
      sprite(it);
      if (it.anim) it.anim(ctx, t, stateOf(it));
    }
  }
  for (const key of boxes.keys()) if (!walkers.has(key)) boxes.delete(key);

  // ping-pong ball when both players are in place
  if (pingpongPlayers()) {
    const k = (Math.sin(t * 3) + 1) / 2;
    const bx = (46 + k * 4) * T;
    const by = (29.6 + k * 0.8) * T;
    const [gx, gy] = iso(bx, by, 12);
    const [, ay] = iso(bx, by, 12 + 2 + Math.abs(Math.sin(t * 6)) * 6);
    drawBall(ctx, gx, ay, gy);
  }

  const lights = [];
  for (const it of LIT) for (const l of it.lights(stateOf(it))) lights.push(l);
  drawLighting(lights);

  // team lines from the selected main agent to its subagents
  if (ui.selectedKey) {
    const sel = walkers.get(ui.selectedKey);
    const main = sel && (sel.kind === "main" ? sel : walkers.get(`s:${sel.sessionId}`));
    if (main) {
      ctx.save();
      ctx.setLineDash([2, 2]);
      ctx.strokeStyle = "rgba(255,209,102,0.75)";
      ctx.lineWidth = 0.7;
      for (const w of walkers.values()) {
        if (w.kind !== "sub" || w.sessionId !== main.sessionId) continue;
        ctx.beginPath();
        ctx.moveTo(main.sx, main.sy - 14);
        ctx.lineTo(w.sx, w.sy - 14);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // status marks over heads (or pins when far away), after the light so they stay bright
  const far = isFar();
  for (const w of people) {
    const b = boxes.get(w.key);
    if (!b || w.fx < 0) continue;
    if (far) {
      drawPin(w, b, t);
      continue;
    }
    const hx = w.sx;
    const hy = b.head - 5;
    if (w.waving) drawStatus(ctx, "alert", hx, hy - 1, t);
    else if (w.checkUntil > now()) drawStatus(ctx, "check", hx, hy, t);
    else if (w.typing && w.mode === "work") drawStatus(ctx, "busy", hx, hy, t);
    else if (w.kind === "main" && w.data.state === "idle" && w.mode === "work" && atGoal(w) && now() - w.data.since > 120 * SEC)
      drawStatus(ctx, "zzz", hx + 3, hy + 2, t);
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawLabels(far);
}

// ---------- labels ----------
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function drawLabels(far) {
  const fs = Math.max(9, Math.min(12, Math.round(view.scale * 7)));
  ctx.font = `600 ${fs}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  for (const w of walkers.values()) {
    if (w.fx < 0 || w.sx == null) continue;
    const focus = w.key === ui.selectedKey || w.key === ui.hoverKey;
    const [sx, sy] = toScreen(w.sx, w.sy);

    // name tag under the feet
    if (ui.showAllLabels || focus) {
      const name = w.kind === "main" ? w.data.project || "session" : w.data.type || "agent";
      const text = cut(name, focus ? 40 : 16);
      const tw = ctx.measureText(text).width + 8;
      const ty = sy + 6 * view.scale + fs * 0.6;
      ctx.globalAlpha = focus ? 1 : 0.85;
      ctx.fillStyle = w.kind === "main" ? "#1b1f2e" : "#262a3b";
      roundRect(sx - tw / 2, ty - fs * 0.7, tw, fs * 1.4, 4);
      ctx.fill();
      ctx.fillStyle = w.kind === "main" ? "#ffd166" : "#c9d1ff";
      ctx.fillText(text, sx - tw / 2 + 4, ty + 0.5);
      ctx.globalAlpha = 1;
    }

    // speech bubble with the current tool, or a note
    let bubble = null;
    if (w.noteUntil > now()) bubble = { text: w.note, color: "#2ecc71" };
    else {
      const tool = w.data.tool;
      if (tool) {
        w.lastTool = tool;
        w.lastDetail = w.data.detail || "";
        w.toolUntil = now() + 1500;
      }
      if (w.lastTool && w.toolUntil > now() && w.mode === "work") {
        // neighbours sit close: only the tool name, the detail when zoomed in or in focus
        const roomy = focus || cam.zoom >= 2;
        bubble = { text: roomy && w.lastDetail ? `${w.lastTool}: ${w.lastDetail}` : w.lastTool, color: "#ffffff" };
      }
      if (w.waving) bubble = { text: reasonText(w.data.reason), color: "#ff6b6b" };
    }
    // far away the pins carry the state; only the ones in focus or waiting keep a bubble
    if (bubble && (!far || focus || w.waving)) {
      const text = cut(bubble.text, focus ? 60 : cam.zoom >= 2 ? 30 : 12);
      const tw = ctx.measureText(text).width + 10;
      const headY = boxes.get(w.key)?.head ?? w.sy - 32;
      const by = toScreen(w.sx, headY - (far ? 16 / view.scale : 10))[1] - fs * 0.4;
      ctx.fillStyle = "#ffffffee";
      roundRect(sx - tw / 2, by - fs * 0.75, tw, fs * 1.5, 5);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(sx - 3, by + fs * 0.75 - 0.5);
      ctx.lineTo(sx + 3, by + fs * 0.75 - 0.5);
      ctx.lineTo(sx, by + fs * 0.75 + 4);
      ctx.fill();
      ctx.fillStyle = bubble.color === "#ffffff" ? "#1b1f2e" : bubble.color;
      ctx.fillText(text, sx - tw / 2 + 5, by + 0.5);
    }
  }
}
