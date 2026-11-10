// The office as 3D objects in the isometric view: outer walls with windows,
// glass partitions, and every piece of furniture. Each object is an item with
// a floor footprint (box) for depth order, a visual extent (vis), a draw
// function, the shadows it casts, and optionally lights and an animation.

import { T, COLS, ROWS, W, H, grid, floorType, ROOMS, WALL, furniture } from "./map.js";
import { rng, shade, lin, ellipse, skyStops, noisePattern, FLOOR_DRAW, drawDoorTile, drawDecal } from "./floors.js";
import { iso, onGround, onFaceY, onFaceX, box, shadowPath, M, WALL_H, IW, IH } from "./iso.js";
import { itemsFor, leaves } from "./furniture.js";

const LOW = 10; // cut-away front walls
const BASE_H = 9; // solid base of a glass partition
const GLASS_TOP = 42;
const ALU = "#aab2bb";
const DECALS = new Set(["mat", "runner", "rug"]);

const inGrid = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS;
const isWallT = (x, y) => inGrid(x, y) && grid[y][x] === WALL;
const isDoorT = (x, y) => inGrid(x, y) && floorType[y][x] === "door";

// ---------- items ----------
const items = [];
function add(it) {
  it.z0 ??= 0;
  it.shadows ??= [];
  items.push(it);
  return it;
}

// ---------- outer walls ----------
const mounted = (wall, i) =>
  furniture.some((f) => f.wall === wall && (wall === "north" ? i >= f.x0 && i <= f.x1 : i >= f.y0 && i <= f.y1)) ||
  (wall === "north" && furniture.some((f) => f.kind === "whiteboard" && i >= f.x0 && i <= f.x1));

function skyline(g, x, y, w, h, gx, env) {
  // distant buildings, continuous along the wall (gx is the pane's place on the wall)
  const night = env.sun < 0.15;
  const base = night ? "#141a2e" : env.dusk > 0.3 && env.sun < 0.8 ? "#5d5f7a" : "#9fb3c6";
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  const unit = 5;
  for (let k = Math.floor(gx / unit) - 1; k * unit < gx + w + unit; k++) {
    const r = rng(k * 9973 + 7);
    const bh = 4 + r() * 13;
    const bx = x + k * unit - gx;
    const bw = unit + r() * 2;
    g.fillStyle = shade(base, 0.9 + r() * 0.2);
    g.fillRect(bx, y + h - bh, bw, bh);
    if (night) {
      for (let wy = y + h - bh + 1; wy < y + h - 1; wy += 1.6) {
        for (let wx = bx + 0.7; wx < bx + bw - 0.7; wx += 1.3) {
          if (r() < 0.35) {
            g.fillStyle = r() < 0.8 ? "rgba(255,214,140,0.85)" : "rgba(170,210,255,0.8)";
            g.fillRect(wx, wy, 0.6, 0.7);
          }
        }
      }
    }
  }
  // trees in front of the city
  for (let k = Math.floor(gx / 3) - 1; k * 3 < gx + w + 3; k++) {
    const r = rng(k * 31 + 1);
    if (r() < 0.45) continue;
    ellipse(g, x + k * 3 - gx, y + h - 0.5, 1.6 + r() * 1.4, 2 + r() * 2, night ? "#0d1420" : shade("#5d7f55", 0.85 + r() * 0.3));
  }
  g.restore();
}

function windowPane(g, x, y, w, h, gx, env) {
  g.fillStyle = "#3a3e46";
  g.fillRect(x - 0.9, y - 0.9, w + 1.8, h + 1.8);
  const [top, bottom] = skyStops(env);
  g.fillStyle = lin(g, 0, y, 0, y + h, [top, bottom]);
  g.fillRect(x, y, w, h);
  if (env.sun < 0.15) {
    const r = rng(Math.floor(gx));
    for (let i = 0; i < 5; i++) {
      g.fillStyle = `rgba(255,255,255,${0.4 + r() * 0.5})`;
      g.fillRect(x + r() * w, y + r() * h * 0.5, 0.35, 0.35);
    }
  }
  skyline(g, x, y + h * 0.45, w, h * 0.55, gx, env);
  // reflections on the glass
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = "rgba(255,255,255,0.09)";
  const k = (gx * 0.37) % 9;
  g.beginPath();
  g.moveTo(x + k, y + h);
  g.lineTo(x + k + 3, y + h);
  g.lineTo(x + k + 13, y);
  g.lineTo(x + k + 10, y);
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.05)";
  g.fillRect(x, y, w, h * 0.12);
  g.restore();
  // transom bar and sill
  g.fillStyle = "#3a3e46";
  g.fillRect(x, y + h * 0.3, w, 0.7);
  g.fillStyle = "#e9e5de";
  g.fillRect(x - 1.4, y + h + 0.9, w + 2.8, 1.1);
  g.fillStyle = "rgba(0,0,0,0.18)";
  g.fillRect(x - 1.4, y + h + 2, w + 2.8, 0.5);
}

function wallFace(color, pane, env) {
  return (g, w, h) => {
    g.fillStyle = lin(g, 0, 0, 0, h, [shade(color, 0.86), color, shade(color, 0.97)]);
    g.fillRect(0, 0, w, h);
    // skirting board
    g.fillStyle = shade(color, 0.78);
    g.fillRect(0, h - 2.4, w, 2.4);
    g.fillStyle = "rgba(255,255,255,0.25)";
    g.fillRect(0, h - 2.4, w, 0.3);
    if (pane) windowPane(g, 1.6, WALL_H - 48, w - 3.2, 30, pane.gx + 1.6, env);
  };
}

const WALL_PAINT = "#e7e2d9";
const ACCENT = "#46536b";
const CAP = "#2f3238";

// north wall: x from 8 to the east corner, 8 units thick on the inner half
for (let x = 0; x < COLS; x++) {
  const x0 = Math.max(8, x * T);
  const x1 = Math.min((COLS - 1) * T + 8, x * T + T);
  const color = x >= 19 && x <= 36 ? ACCENT : WALL_PAINT;
  const pane = x > 0 && x < COLS - 1 && !mounted("north", x) ? { gx: x0 } : null;
  add({
    kind: "wall",
    box: [x0, 8, x1, 16],
    vis: [x0, 8, 0, x1, 16, WALL_H],
    draw(g, env) {
      box(g, x0, 8, 0, x1 - x0, 8, WALL_H, color, { top: CAP, left: wallFace(color, pane, env), edge: 0.12 });
    },
  });
}
// west wall, with the glass entrance at y 12..14
for (let y = 1; y < ROWS; y++) {
  if (!isWallT(0, y)) continue;
  const y0 = y * T;
  const y1 = Math.min((ROWS - 1) * T + 8, y * T + T);
  const pane = y < ROWS - 1 && !mounted("west", y) ? { gx: 2000 - y1 } : null;
  add({
    kind: "wall",
    box: [8, y0, 16, y1],
    vis: [8, y0, 0, 16, y1, WALL_H],
    draw(g, env) {
      box(g, 8, y0, 0, 8, y1 - y0, WALL_H, WALL_PAINT, { top: CAP, right: wallFace(WALL_PAINT, pane, env), left: shade("#59606b", 0.9), edge: 0.12 });
    },
  });
}
// entrance: sliding glass doors under a header
add({
  kind: "entrance",
  box: [8, 12 * T, 16, 15 * T],
  vis: [8, 12 * T, 0, 16, 15 * T, WALL_H],
  draw(g) {
    const y0 = 12 * T;
    const y1 = 15 * T;
    // floor track
    onGround(g, 0, (f) => {
      f.fillStyle = "#4a4e57";
      f.fillRect(9, y0, 6, y1 - y0);
    });
    // doors slid open to the sides
    for (const [a, b] of [[y0, y0 + 10], [y1 - 10, y1]]) {
      onFaceX(g, 12.5, b, 36, (f) => {
        f.fillStyle = "rgba(190,220,235,0.28)";
        f.fillRect(0, 0, b - a, 36);
        f.strokeStyle = "#3d424b";
        f.lineWidth = 0.9;
        f.strokeRect(0.45, 0.45, b - a - 0.9, 35.1);
        f.fillStyle = "rgba(255,255,255,0.18)";
        f.beginPath();
        f.moveTo(2, 36);
        f.lineTo(4, 36);
        f.lineTo(9, 0);
        f.lineTo(7, 0);
        f.fill();
      });
    }
    // header with the sign
    box(g, 8, y0, 36, 8, y1 - y0, WALL_H - 36, WALL_PAINT, {
      top: CAP,
      right: (f, w, h) => {
        f.fillStyle = shade(WALL_PAINT, 0.95);
        f.fillRect(0, 0, w, h);
        f.fillStyle = "#30343c";
        f.fillRect(0, h - 1.4, w, 1.4);
        f.font = "700 4.2px ui-sans-serif, system-ui, sans-serif";
        f.textAlign = "center";
        f.fillStyle = "#2f3a4f";
        f.fillText("AGENT OFFICE", w / 2, h / 2 + 1.5);
      },
      edge: 0.12,
    });
  },
});
// south and east: cut away low so the rooms stay in view
for (let x = 1; x < COLS; x++) {
  const x0 = x * T;
  const x1 = Math.min((COLS - 1) * T + 8, x * T + T);
  add({
    kind: "wall",
    box: [x0, (ROWS - 1) * T, x1, (ROWS - 1) * T + 8],
    vis: [x0, (ROWS - 1) * T, 0, x1, (ROWS - 1) * T + 8, LOW],
    draw(g) {
      box(g, x0, (ROWS - 1) * T, 0, x1 - x0, 8, LOW, "#5d636e", { top: "#d9d4cb", edge: 0.2 });
    },
  });
}
for (let y = 1; y < ROWS - 1; y++) {
  add({
    kind: "wall",
    box: [(COLS - 1) * T, y * T, (COLS - 1) * T + 8, y * T + T],
    vis: [(COLS - 1) * T, y * T, 0, (COLS - 1) * T + 8, y * T + T, LOW],
    draw(g) {
      box(g, (COLS - 1) * T, y * T, 0, 8, T, LOW, "#5d636e", { top: "#d9d4cb", edge: 0.2 });
    },
  });
}

// ---------- glass partitions ----------
const SIGNS = [
  { row: 11, x: 2 * T + 6, text: "RESEARCH" },
  { row: 11, x: 20 * T + 6, text: "MEETING ROOM" },
  { row: 11, x: 39 * T + 6, text: "REVIEW & QA" },
  { row: 15, x: 9 * T + 2, text: "LEADS & DEV FLOOR" },
  { row: 15, x: 47 * T, text: "CAFE" },
  { row: 24, x: 45 * T + 8, text: "LOUNGE" },
];

function glassPaint(row, gx) {
  return (g, w, h) => {
    g.fillStyle = "rgba(196,224,238,0.13)";
    g.fillRect(0, 0, w, h);
    // frosted privacy band
    g.fillStyle = "rgba(255,255,255,0.12)";
    g.fillRect(0, GLASS_TOP - 27, w, 6);
    g.fillStyle = "rgba(255,255,255,0.18)";
    g.fillRect(0, GLASS_TOP - 27, w, 0.3);
    g.fillRect(0, GLASS_TOP - 21.3, w, 0.3);
    // reflections, continuous along the partition
    g.save();
    g.beginPath();
    g.rect(0, 0, w, h);
    g.clip();
    g.fillStyle = "rgba(255,255,255,0.07)";
    for (let k = Math.floor((gx - 40) / 37) * 37; k < gx + w + 40; k += 37) {
      const s = k - gx;
      g.beginPath();
      g.moveTo(s, h);
      g.lineTo(s + 5, h);
      g.lineTo(s + 19, 0);
      g.lineTo(s + 14, 0);
      g.fill();
    }
    if (row != null) {
      g.font = "600 3.6px ui-sans-serif, system-ui, sans-serif";
      g.fillStyle = "rgba(255,255,255,0.7)";
      for (const sg of SIGNS) if (sg.row === row) g.fillText(sg.text.split("").join(" "), sg.x - gx, GLASS_TOP - 22.7);
    }
    g.restore();
  };
}

function partH(g, x0, x1, cy, row, mullLeft, jambRight) {
  box(g, x0, cy - 2.5, 0, x1 - x0, 5, BASE_H, "#d6d1c8", { top: "#8d949d", edge: 0.25 });
  onFaceY(g, cy + 1, x0, GLASS_TOP, glassPaint(row, x0));
  if (mullLeft && Math.round(x0 / T) % 2 === 0) box(g, x0 - 0.6, cy - 1.2, BASE_H, 1.2, 2.4, GLASS_TOP - BASE_H, ALU, { edge: 0.3 });
  if (jambRight) box(g, x1 - 1, cy - 1.4, 0, 1.6, 2.8, GLASS_TOP, ALU, { edge: 0.3 });
  box(g, x0, cy - 1.3, GLASS_TOP, x1 - x0, 2.6, 1.4, ALU, { edge: 0.3 });
}
function partV(g, cx, y0, y1, mullTop, jambBottom) {
  box(g, cx - 2.5, y0, 0, 5, y1 - y0, BASE_H, "#d6d1c8", { top: "#8d949d", edge: 0.25 });
  onFaceX(g, cx + 1, y1, GLASS_TOP, glassPaint(null, 3000 - y1));
  if (mullTop && Math.round(y0 / T) % 2 === 0) box(g, cx - 1.2, y0 - 0.6, BASE_H, 2.4, 1.2, GLASS_TOP - BASE_H, ALU, { edge: 0.3 });
  if (jambBottom) box(g, cx - 1.4, y1 - 1, 0, 2.8, 1.6, GLASS_TOP, ALU, { edge: 0.3 });
  box(g, cx - 1.3, y0, GLASS_TOP, 2.6, y1 - y0, 1.4, ALU, { edge: 0.3 });
}

for (let y = 1; y < ROWS - 1; y++) {
  for (let x = 1; x < COLS - 1; x++) {
    if (!isWallT(x, y)) continue;
    const cx = x * T + 8;
    const cy = y * T + 8;
    const con = (dx, dy) => isWallT(x + dx, y + dy) || isDoorT(x + dx, y + dy);
    const E = con(1, 0);
    const Wn = con(-1, 0);
    const N = con(0, -1);
    const S = con(0, 1);
    const hx0 = Wn ? x * T : cx - 2.5;
    const hx1 = E ? x * T + T : cx + 2.5;
    const vy0 = N ? y * T : cy - 2.5;
    const vy1 = S ? y * T + T : cy + 2.5;
    const horiz = E || Wn;
    const vert = N || S;
    const bx0 = horiz ? hx0 : cx - 2.5;
    const bx1 = horiz ? hx1 : cx + 2.5;
    const by0 = vert ? vy0 : cy - 2.5;
    const by1 = vert ? vy1 : cy + 2.5;
    add({
      kind: "glass",
      box: [bx0, by0, bx1, by1],
      vis: [bx0, by0, 0, bx1, by1, GLASS_TOP + 1.5],
      draw(g) {
        if (!horiz && !vert) return box(g, cx - 2.5, cy - 2.5, 0, 5, 5, GLASS_TOP, ALU);
        if (!horiz) return partV(g, cx, vy0, vy1, N, isDoorT(x, y + 1));
        if (N) partV(g, cx, vy0, cy - 2.5, true, false);
        partH(g, hx0, hx1, cy, y, Wn, isDoorT(x + 1, y));
        if (S) partV(g, cx, cy + 2.5, vy1, false, isDoorT(x, y + 1));
      },
    });
  }
}
// door headers
for (let y = 1; y < ROWS - 1; y++) {
  for (let x = 1; x < COLS - 1; x++) {
    if (!isDoorT(x, y)) continue;
    const horiz = isWallT(x - 1, y) || isWallT(x + 1, y) || isDoorT(x - 1, y) || isDoorT(x + 1, y);
    const cx = x * T + 8;
    const cy = y * T + 8;
    const b = horiz ? [x * T, cy - 1.5, x * T + T, cy + 1.5] : [cx - 1.5, y * T, cx + 1.5, y * T + T];
    add({
      kind: "door",
      box: b,
      z0: GLASS_TOP - 5,
      vis: [b[0], b[1], GLASS_TOP - 5, b[2], b[3], GLASS_TOP + 1.5],
      draw(g) {
        box(g, b[0], b[1], GLASS_TOP - 5, b[2] - b[0], b[3] - b[1], 6.4, ALU, { edge: 0.3 });
      },
    });
  }
}

// ---------- furniture (models in furniture.js) ----------
for (const f of furniture) if (!DECALS.has(f.kind)) for (const it of itemsFor(f)) add(it);

// ---------- depth order ----------
// a is behind b when it ends before b starts along x or along y
const EPS = 0.01;
export function order(a, b) {
  const [ax0, ay0, ax1, ay1] = a.box;
  const [bx0, by0, bx1, by1] = b.box;
  const aBehind = ax1 <= bx0 + EPS || ay1 <= by0 + EPS;
  const bBehind = bx1 <= ax0 + EPS || by1 <= ay0 + EPS;
  if (aBehind && !bBehind) return -1;
  if (bBehind && !aBehind) return 1;
  if (aBehind && bBehind) return 0;
  return a.z0 - b.z0;
}

export function itemBounds(it) {
  if (it.bounds) return it.bounds;
  const [x0, y0, z0, x1, y1, z1] = it.vis;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) {
    const [sx, sy] = iso(x, y, z);
    minX = Math.min(minX, sx);
    minY = Math.min(minY, sy);
    maxX = Math.max(maxX, sx);
    maxY = Math.max(maxY, sy);
  }
  const pad = 2;
  it.bounds = { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
  return it.bounds;
}
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function sortItems(list) {
  const n = list.length;
  const bb = list.map(itemBounds);
  const deps = list.map(() => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!overlaps(bb[i], bb[j])) continue;
      const o = order(list[i], list[j]);
      if (o < 0) deps[j].push(i);
      else if (o > 0) deps[i].push(j);
    }
  }
  const depth = (it) => it.box[0] + it.box[1] + it.box[2] + it.box[3] + it.z0;
  const seq = list.map((_, i) => i).sort((a, b) => depth(list[a]) - depth(list[b]));
  const out = [];
  const seen = new Uint8Array(n);
  const visit = (i) => {
    if (seen[i]) return;
    seen[i] = 1;
    for (const k of deps[i]) visit(k);
    out.push(list[i]);
  };
  for (const i of seq) visit(i);
  return out;
}

export const ITEMS = sortItems(items);
ITEMS.forEach((it, i) => (it.id = i));

// is this item in front of a person standing at (px, py) in world units
export function occludes(it, px, py, r = 3) {
  const [x0, y0, x1, y1] = it.box;
  const front = x0 >= px + r - EPS || y0 >= py + r - EPS;
  const behind = x1 <= px - r + EPS || y1 <= py - r + EPS;
  return front && !behind;
}
export { overlaps };

// ---------- the static layer ----------
function outside(g) {
  onGround(g, 0, (f) => {
    f.fillStyle = "#6c7075";
    f.fillRect(-M, -M, W + 2 * M, H + 2 * M);
    f.fillStyle = noisePattern(f);
    f.fillRect(-M, -M, W + 2 * M, H + 2 * M);
    // paving joints
    f.strokeStyle = "rgba(0,0,0,0.12)";
    f.lineWidth = 0.3;
    for (let x = -M; x <= W + M; x += 12) {
      f.beginPath();
      f.moveTo(x, -M);
      f.lineTo(x, H + M);
      f.stroke();
    }
    for (let y = -M; y <= H + M; y += 12) {
      f.beginPath();
      f.moveTo(-M, y);
      f.lineTo(W + M, y);
      f.stroke();
    }
    // lawn beyond the path
    const lawn = "#56794a";
    f.fillStyle = lawn;
    f.fillRect(-M, H + 18, W + 2 * M, M - 18);
    f.fillRect(W + 18, -M, M - 18, H + 2 * M);
    f.fillStyle = noisePattern(f);
    f.fillRect(-M, H + 18, W + 2 * M, M - 18);
    f.fillRect(W + 18, -M, M - 18, H + 2 * M);
    f.fillStyle = "#b9b4aa";
    f.fillRect(-M, H + 17, W + M + 18, 1.2);
    f.fillRect(W + 17, -M, 1.2, H + M + 18);
  });
  // shrubs on the lawn
  const r = rng(77);
  for (let x = 20; x < W + 10; x += 34 + r() * 20) {
    const [sx, sy] = iso(x, H + 28 + r() * 6, 0);
    ellipse(g, sx + 2, sy + 1, 7, 3, "rgba(0,0,0,0.2)");
    leaves(g, sx, sy - 3, 18, Math.round(x), 2.6, 5, 4, ["#3f6b3a", "#4c7d44", "#355c31"]);
  }
  for (let y = 20; y < H + 10; y += 34 + r() * 20) {
    const [sx, sy] = iso(W + 28 + r() * 6, y, 0);
    ellipse(g, sx + 2, sy + 1, 7, 3, "rgba(0,0,0,0.2)");
    leaves(g, sx, sy - 3, 18, Math.round(y) + 5, 2.6, 5, 4, ["#3f6b3a", "#4c7d44", "#355c31"]);
  }
}

function floors(g) {
  for (const r of ROOMS) {
    const R = { x: r.x0 * T - 8, y: r.y0 * T - 8, w: (r.x1 - r.x0 + 1) * T + 16, h: (r.y1 - r.y0 + 1) * T + 16 };
    g.save();
    g.beginPath();
    g.rect(R.x, R.y, R.w, R.h);
    g.clip();
    FLOOR_DRAW[r.floor](g, R, r);
    g.restore();
  }
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (floorType[y][x] === "door") drawDoorTile(g, x, y);
  // a little contact darkness where the floor meets a wall
  for (let y = 1; y < ROWS - 1; y++) {
    for (let x = 1; x < COLS - 1; x++) {
      if (grid[y][x] === WALL) continue;
      const X = x * T;
      const Y = y * T;
      if (isWallT(x, y - 1)) {
        const off = y - 1 === 0 ? 0 : 5.5;
        g.fillStyle = lin(g, 0, Y - off, 0, Y + 6 - off, ["rgba(0,0,0,0.22)", "rgba(0,0,0,0)"]);
        g.fillRect(X, Y - off, T, 6);
      }
      if (isWallT(x - 1, y)) {
        const off = x - 1 === 0 ? 0 : 5.5;
        g.fillStyle = lin(g, X - off, 0, X + 5 - off, 0, ["rgba(0,0,0,0.18)", "rgba(0,0,0,0)"]);
        g.fillRect(X - off, Y, 5, T);
      }
    }
  }
}

// sunlight through the outer windows, landing south east of each pane
function sunPatches(g, env) {
  if (env.sun < 0.05) return;
  const a = 0.2 * env.sun;
  const col = env.dusk > 0.3 ? "255,196,140" : "255,240,205";
  g.fillStyle = `rgba(${col},${a})`;
  for (let x = 1; x < COLS - 1; x++) {
    if (mounted("north", x)) continue;
    const x0 = x * T + 1.6;
    const x1 = x * T + T - 1.6;
    // a pane from z 18 to 48 on the wall face at y = 16
    const n = { x: 18 * 0.32, y: 18 * 0.5 };
    const f = { x: 48 * 0.32, y: 48 * 0.5 };
    g.beginPath();
    g.moveTo(x0 + n.x, 16 + n.y);
    g.lineTo(x1 + n.x, 16 + n.y);
    g.lineTo(x1 + f.x, 16 + f.y);
    g.lineTo(x0 + f.x, 16 + f.y);
    g.fill();
  }
  for (let y = 1; y < ROWS - 1; y++) {
    if (!isWallT(0, y) || mounted("west", y)) continue;
    const y0 = y * T + 1.6;
    const y1 = y * T + T - 1.6;
    const n = { x: 18 * 0.32, y: 18 * 0.5 };
    const f = { x: 48 * 0.32, y: 48 * 0.5 };
    g.beginPath();
    g.moveTo(16 + n.x, y0 + n.y);
    g.lineTo(16 + n.x, y1 + n.y);
    g.lineTo(16 + f.x, y1 + f.y);
    g.lineTo(16 + f.x, y0 + f.y);
    g.fill();
  }
}

function shadows(ctx, env, res) {
  const k = 0.5;
  const c = document.createElement("canvas");
  c.width = Math.ceil(IW * res * k);
  c.height = Math.ceil(IH * res * k);
  const s = c.getContext("2d");
  const pass = (fn, blur, alpha) => {
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.clearRect(0, 0, c.width, c.height);
    s.setTransform(res * k, 0, 0, res * k, 0, 0);
    onGround(s, 0, (g) => {
      g.beginPath();
      fn(g);
      g.fillStyle = "#0b0d14";
      g.fill();
    });
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if ("filter" in ctx) ctx.filter = `blur(${blur * res}px)`;
    ctx.globalAlpha = alpha;
    ctx.drawImage(c, 0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  };
  // soft daylight shadows, then tight contact shadows right under things
  pass((g) => {
    for (const it of ITEMS) for (const [r, z0, z1] of it.shadows) shadowPath(g, r, z0, z1);
  }, 2.6, 0.1 + 0.16 * env.sun);
  pass((g) => {
    for (const it of ITEMS) for (const [r, z0] of it.shadows) if (z0 < 1) shadowPath(g, r, 0, 0);
  }, 0.9, 0.28);
}

export function renderStatic(ctx, env, res) {
  outside(ctx);
  onGround(ctx, 0, (g) => {
    floors(g);
    for (const f of furniture) if (DECALS.has(f.kind)) drawDecal(g, f);
    sunPatches(g, env);
  });
  shadows(ctx, env, res);
  for (const it of ITEMS) it.draw(ctx, env);
}

// ceiling lights: one pool of light every few tiles in each room
export const CEILING_LIGHTS = (() => {
  const out = [];
  for (const r of ROOMS) {
    const step = r.id === "corridor" ? 6 : 5;
    for (let y = r.y0 + 2; y <= r.y1; y += step) {
      for (let x = r.x0 + 2; x <= r.x1; x += step) out.push({ x: x * T + 8, y: y * T + 8, r: 56, strength: 0.75 });
    }
  }
  return out;
})();

