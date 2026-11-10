// Shared drawing helpers, the time of day, and the floors and rugs, drawn in
// floor units (1 tile = 16 units). The isometric view draws them through a
// ground-plane transform, so they stay sharp at any zoom.

import { T, grid, floorType, WALL } from "./map.js";

// ---------- small helpers ----------
export const TAU = Math.PI * 2;

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hex(c) {
  const n = parseInt(c.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function shade(c, k) {
  const [r, g, b] = hex(c);
  if (k < 1) return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
  const m = k - 1;
  return `rgb(${Math.round(r + (255 - r) * m)},${Math.round(g + (255 - g) * m)},${Math.round(b + (255 - b) * m)})`;
}
export function rgba(c, a) {
  const [r, g, b] = hex(c);
  return `rgba(${r},${g},${b},${a})`;
}
export function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
export function fillRR(ctx, x, y, w, h, r, fill) {
  rr(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}
export function lin(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  return g;
}
export function ellipse(ctx, x, y, rx, ry, fill) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
}
export function softShadow(ctx, x, y, rx, ry, a = 0.3) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(10,12,20,${a})`);
  g.addColorStop(0.6, `rgba(10,12,20,${a * 0.5})`);
  g.addColorStop(1, "rgba(10,12,20,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, TAU);
  ctx.fill();
  ctx.restore();
}
export function line(ctx, x0, y0, x1, y1, color, w = 0.5) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.stroke();
}

// ---------- time of day ----------
// mode: "auto" follows the clock, "day" and "night" force one
export function daylight(date = new Date(), mode = "auto") {
  let h = date.getHours() + date.getMinutes() / 60;
  if (mode === "day") h = 13;
  if (mode === "night") h = 23;
  const ramp = (a, b, x) => Math.min(1, Math.max(0, (x - a) / (b - a)));
  const sun = Math.min(ramp(6, 8.5, h), 1 - ramp(17.5, 20, h)); // 0 at night, 1 by day
  const dusk = Math.max(0, 1 - Math.abs(h - 19) / 1.5) + Math.max(0, 1 - Math.abs(h - 7) / 1.2);
  return {
    sun,
    dark: (1 - sun) * 0.5,
    dusk: Math.min(1, dusk),
    morning: h < 13,
    hour: Math.floor(h),
    key: `${mode}:${Math.floor(h * 6)}`, // the office layer is redrawn every ten minutes
  };
}

export function skyStops(env) {
  if (env.sun > 0.6) return ["#7cc4f5", "#cbe9fb"];
  if (env.sun > 0.05) return env.dusk > 0.3 ? ["#5a6fb0", "#ffb37a"] : ["#8fb8e0", "#e7d7c4"];
  return ["#0b1330", "#1f2d58"];
}

// ---------- floors ----------
let noiseCanvas = null;
export function noisePattern(ctx) {
  if (!noiseCanvas) {
    noiseCanvas = document.createElement("canvas");
    noiseCanvas.width = noiseCanvas.height = 64;
    const n = noiseCanvas.getContext("2d");
    const r = rng(42);
    for (let i = 0; i < 900; i++) {
      n.fillStyle = r() < 0.5 ? `rgba(255,255,255,${r() * 0.07})` : `rgba(0,0,0,${r() * 0.09})`;
      n.fillRect(Math.floor(r() * 64), Math.floor(r() * 64), 1, 1);
    }
  }
  const p = ctx.createPattern(noiseCanvas, "repeat");
  p.setTransform(new DOMMatrix().scale(0.5));
  return p;
}

export function roomRect(r) {
  return { x: r.x0 * T, y: r.y0 * T, w: (r.x1 - r.x0 + 1) * T, h: (r.y1 - r.y0 + 1) * T };
}

export const FLOOR_DRAW = {
  wood(ctx, R, r) {
    ctx.fillStyle = "#a57347";
    ctx.fillRect(R.x, R.y, R.w, R.h);
    const rand = rng(11);
    const rowH = 5.33;
    for (let y = R.y, row = 0; y < R.y + R.h; y += rowH, row++) {
      let x = R.x - rand() * 40;
      while (x < R.x + R.w) {
        const len = 26 + rand() * 34;
        const tone = 0.86 + rand() * 0.24;
        ctx.fillStyle = shade("#a87548", tone);
        ctx.fillRect(x, y, len, rowH);
        // grain
        for (let g = 0; g < 2; g++) {
          const gy = y + 1 + rand() * (rowH - 2);
          ctx.beginPath();
          ctx.moveTo(x + 1, gy);
          ctx.bezierCurveTo(x + len * 0.3, gy + 0.6, x + len * 0.6, gy - 0.6, x + len - 1, gy + 0.2);
          ctx.strokeStyle = "rgba(70,40,20,0.13)";
          ctx.lineWidth = 0.35;
          ctx.stroke();
        }
        ctx.fillStyle = "rgba(60,35,18,0.45)";
        ctx.fillRect(x + len - 0.35, y, 0.35, rowH);
        x += len;
      }
      ctx.fillStyle = "rgba(60,35,18,0.4)";
      ctx.fillRect(R.x, y + rowH - 0.3, R.w, 0.3);
    }
    ctx.fillStyle = lin(ctx, R.x, R.y, R.x + R.w, R.y + R.h, ["rgba(255,235,200,0.10)", "rgba(255,235,200,0)", "rgba(0,0,0,0.08)"]);
    ctx.fillRect(R.x, R.y, R.w, R.h);
  },
  carpetBlue(ctx, R) {
    ctx.fillStyle = "#3d5180";
    ctx.fillRect(R.x, R.y, R.w, R.h);
    ctx.fillStyle = noisePattern(ctx);
    ctx.fillRect(R.x, R.y, R.w, R.h);
    ctx.strokeStyle = "rgba(255,255,255,0.035)";
    ctx.lineWidth = 0.4;
    for (let d = -R.h; d < R.w; d += 6) {
      ctx.beginPath();
      ctx.moveTo(R.x + d, R.y);
      ctx.lineTo(R.x + d + R.h, R.y + R.h);
      ctx.stroke();
    }
  },
  tile(ctx, R) {
    const rand = rng(23);
    for (let y = R.y; y < R.y + R.h; y += 16) {
      for (let x = R.x; x < R.x + R.w; x += 16) {
        ctx.fillStyle = shade("#dfe4e9", 0.96 + rand() * 0.06);
        ctx.fillRect(x, y, 16, 16);
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.fillRect(x + 1, y + 1, 6, 0.6);
      }
    }
    ctx.strokeStyle = "#bfc7cf";
    ctx.lineWidth = 0.5;
    for (let x = R.x; x <= R.x + R.w; x += 16) line(ctx, x, R.y, x, R.y + R.h, "#bfc7cf", 0.5);
    for (let y = R.y; y <= R.y + R.h; y += 16) line(ctx, R.x, y, R.x + R.w, y, "#bfc7cf", 0.5);
  },
  corridor(ctx, R) {
    ctx.fillStyle = "#a3a6ad";
    ctx.fillRect(R.x, R.y, R.w, R.h);
    ctx.fillStyle = noisePattern(ctx);
    ctx.fillRect(R.x, R.y, R.w, R.h);
    for (let x = R.x; x < R.x + R.w; x += 48) line(ctx, x, R.y, x, R.y + R.h, "rgba(0,0,0,0.12)", 0.4);
    line(ctx, R.x, R.y + R.h / 2, R.x + R.w, R.y + R.h / 2, "rgba(0,0,0,0.08)", 0.4);
    // polished reflections
    ctx.fillStyle = lin(ctx, R.x, R.y, R.x, R.y + R.h, ["rgba(255,255,255,0.12)", "rgba(255,255,255,0)", "rgba(255,255,255,0.06)"]);
    ctx.fillRect(R.x, R.y, R.w, R.h);
  },
  carpetGray(ctx, R) {
    ctx.fillStyle = "#5b6370";
    ctx.fillRect(R.x, R.y, R.w, R.h);
    // carpet tiles laid in alternating directions
    for (let y = R.y, j = 0; y < R.y + R.h; y += 32, j++) {
      for (let x = R.x, i = 0; x < R.x + R.w; x += 32, i++) {
        const vertical = (i + j) % 2 === 0;
        ctx.fillStyle = vertical ? "rgba(255,255,255,0.025)" : "rgba(0,0,0,0.035)";
        ctx.fillRect(x, y, 32, 32);
        ctx.strokeStyle = "rgba(255,255,255,0.03)";
        ctx.lineWidth = 0.4;
        for (let k = 2; k < 32; k += 2.5) {
          ctx.beginPath();
          if (vertical) {
            ctx.moveTo(x + k, y);
            ctx.lineTo(x + k, Math.min(y + 32, R.y + R.h));
          } else {
            ctx.moveTo(x, y + k);
            ctx.lineTo(Math.min(x + 32, R.x + R.w), y + k);
          }
          ctx.stroke();
        }
      }
    }
    ctx.fillStyle = noisePattern(ctx);
    ctx.fillRect(R.x, R.y, R.w, R.h);
  },
  checker(ctx, R) {
    // terrazzo
    ctx.fillStyle = "#e8e1d2";
    ctx.fillRect(R.x, R.y, R.w, R.h);
    const rand = rng(31);
    const chips = ["#b9a98f", "#8d9ca8", "#c98f6b", "#6f7a6a", "#ffffff"];
    ctx.globalAlpha = 0.55;
    for (let i = 0; i < R.w * R.h * 0.022; i++) {
      ctx.fillStyle = chips[Math.floor(rand() * chips.length)];
      const s = 0.25 + rand() * 0.5;
      ctx.beginPath();
      ctx.ellipse(R.x + rand() * R.w, R.y + rand() * R.h, s, s * (0.6 + rand() * 0.4), rand() * 3, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (let x = R.x; x <= R.x + R.w; x += 48) line(ctx, x, R.y, x, R.y + R.h, "rgba(120,110,95,0.12)", 0.3);
    ctx.fillStyle = lin(ctx, R.x, R.y, R.x + R.w, R.y + R.h, ["rgba(255,255,255,0.15)", "rgba(255,255,255,0)"]);
    ctx.fillRect(R.x, R.y, R.w, R.h);
  },
  carpetPurple(ctx, R) {
    ctx.fillStyle = "#4f456b";
    ctx.fillRect(R.x, R.y, R.w, R.h);
    ctx.fillStyle = noisePattern(ctx);
    ctx.fillRect(R.x, R.y, R.w, R.h);
  },
};

export function drawDoorTile(ctx, x, y) {
  const vertical = grid[y][x - 1] === WALL && grid[y][x + 1] === WALL;
  const neighbour = vertical ? floorType[y][x - 1] || floorType[y][x + 1] : floorType[y + 1]?.[x] || floorType[y - 1]?.[x];
  ctx.save();
  ctx.beginPath();
  ctx.rect(x * T, y * T, T, T);
  ctx.clip();
  const R = { x: x * T, y: y * T, w: T, h: T };
  (FLOOR_DRAW[neighbour] || FLOOR_DRAW.corridor)(ctx, R);
  ctx.restore();
  ctx.fillStyle = "#8b8f98";
  if (vertical) ctx.fillRect(x * T + 6, y * T, 4, T);
  else ctx.fillRect(x * T, y * T + 6, T, 4);
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  if (vertical) ctx.fillRect(x * T + 6, y * T, 0.6, T);
  else ctx.fillRect(x * T, y * T + 6, T, 0.6);
}

// flat things on the floor: mats, the corridor runner and rugs
export function drawDecal(ctx, f) {
  const x = f.x0 * T;
  const y = f.y0 * T;
  const w = (f.x1 - f.x0 + 1) * T;
  const h = (f.y1 - f.y0 + 1) * T;
  if (f.kind === "mat") {
    fillRR(ctx, x + 2, y + 2, w - 3, h - 4, 1.5, "#4a2c2a");
    ctx.fillStyle = noisePattern(ctx);
    ctx.fillRect(x + 2, y + 2, w - 3, h - 4);
    rr(ctx, x + 3.5, y + 3.5, w - 6, h - 7, 1);
    ctx.strokeStyle = "#7a4a44";
    ctx.lineWidth = 0.8;
    ctx.stroke();
  } else if (f.kind === "runner") {
    fillRR(ctx, x, y + 3, w, h - 6, 1, "#4a505b");
    ctx.fillStyle = noisePattern(ctx);
    ctx.fillRect(x, y + 3, w, h - 6);
    rr(ctx, x + 1.5, y + 4.5, w - 3, h - 9, 0.8);
    ctx.strokeStyle = "rgba(220,225,232,0.35)";
    ctx.lineWidth = 0.5;
    ctx.stroke();
  } else if (f.kind === "rug") rug(ctx, f, x, y, w, h);
}

function rug(ctx, f, x, y, w, h) {
  if (f.round) {
    ellipse(ctx, x + w / 2, y + h / 2, w / 2, h / 2 - 1, "#c99a6a");
    ellipse(ctx, x + w / 2, y + h / 2, w / 2 - 2, h / 2 - 3, "#e1bf8f");
    ellipse(ctx, x + w / 2, y + h / 2, w / 2 - 6, h / 2 - 7, "#c99a6a");
    return;
  }
  fillRR(ctx, x + 1, y + 1, w - 2, h - 2, 1.5, "#2f5a62");
  rr(ctx, x + 3, y + 3, w - 6, h - 6, 1);
  ctx.strokeStyle = "#e3c58f";
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.fillStyle = "rgba(227,197,143,0.35)";
  for (let k = 0; k < 6; k++) {
    const cx = x + 10 + k * ((w - 20) / 5);
    ctx.beginPath();
    ctx.moveTo(cx, y + h / 2 - 5);
    ctx.lineTo(cx + 4, y + h / 2);
    ctx.lineTo(cx, y + h / 2 + 5);
    ctx.lineTo(cx - 4, y + h / 2);
    ctx.fill();
  }
  ctx.fillStyle = noisePattern(ctx);
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
}

