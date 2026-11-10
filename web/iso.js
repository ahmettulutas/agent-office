// Isometric projection and 3D drawing primitives. World units: x and y on the
// floor (1 tile = 16), z up. Screen (iso) units: sx = x - y, sy = (x + y) / 2 - z.
// Every face is drawn through an affine transform, so plain 2D drawing code
// (gradients, text, patterns) lands on the floor or on a wall in perspective.

import { W, H } from "./map.js";
import { shade, TAU } from "./floors.js";

export const M = 40; // outdoor margin around the building
export const WALL_H = 54; // outer back walls
export const OX = H + 2 * M;
export const OY = M + WALL_H + 14;
export const IW = W + H + 4 * M;
export const IH = Math.ceil((W + H) / 2 + M + OY + 6);

export function iso(x, y, z = 0) {
  return [x - y + OX, (x + y) / 2 - z + OY];
}

// floor plane at height z: draw with world (x, y)
export function onGround(ctx, z, fn) {
  ctx.save();
  ctx.transform(1, 0.5, -1, 0.5, OX, OY - z);
  fn(ctx);
  ctx.restore();
}
// face at y = Y seen from +y (the viewer's lower left): s runs +x from x0, t runs down from zTop
export function onFaceY(ctx, Y, x0, zTop, fn) {
  ctx.save();
  ctx.transform(1, 0.5, 0, 1, x0 - Y + OX, (x0 + Y) / 2 - zTop + OY);
  fn(ctx);
  ctx.restore();
}
// face at x = X seen from +x (the viewer's lower right): s runs -y from y1, t runs down from zTop
export function onFaceX(ctx, X, y1, zTop, fn) {
  ctx.save();
  ctx.transform(1, -0.5, 0, 1, X - y1 + OX, (X + y1) / 2 - zTop + OY);
  fn(ctx);
  ctx.restore();
}

function paint(g, fill, w, h) {
  if (typeof fill === "function") return fill(g, w, h);
  g.fillStyle = fill;
  g.fillRect(0, 0, w, h);
}

// A lit box. c is the base colour; o.top, o.left (the +y face) and o.right
// (the +x face) override a face with a colour or a painter (g, w, h).
// Light comes from the upper left, so the top is brightest and +x darkest.
export function box(ctx, x, y, z, w, d, h, c, o = {}) {
  const left = o.left ?? shade(c, 0.84);
  const right = o.right ?? shade(c, 0.66);
  if (h > 0) {
    onFaceY(ctx, y + d, x, z + h, (g) => {
      paint(g, left, w, h);
      if (o.ao !== false && z < 1 && h > 3) {
        const gr = g.createLinearGradient(0, h - Math.min(6, h), 0, h);
        gr.addColorStop(0, "rgba(0,0,0,0)");
        gr.addColorStop(1, "rgba(0,0,0,0.22)");
        g.fillStyle = gr;
        g.fillRect(0, h - Math.min(6, h), w, Math.min(6, h));
      }
    });
    onFaceX(ctx, x + w, y + d, z + h, (g) => {
      paint(g, right, d, h);
      if (o.ao !== false && z < 1 && h > 3) {
        const gr = g.createLinearGradient(0, h - Math.min(6, h), 0, h);
        gr.addColorStop(0, "rgba(0,0,0,0)");
        gr.addColorStop(1, "rgba(0,0,0,0.25)");
        g.fillStyle = gr;
        g.fillRect(0, h - Math.min(6, h), d, Math.min(6, h));
      }
    });
  }
  onGround(ctx, z + h, (g) => {
    if (typeof o.top === "function") {
      g.save();
      g.translate(x, y);
      o.top(g, w, d);
      g.restore();
    } else {
      g.fillStyle = o.top ?? shade(c, 1.08);
      g.fillRect(x, y, w, d);
    }
  });
  if (o.edge !== false) edges(ctx, x, y, z, w, d, h, o.edge);
}

// thin highlights on the edges that face the light, and a darker vertical corner
export function edges(ctx, x, y, z, w, d, h, a = 0.35) {
  const p = (X, Y, Z) => iso(X, Y, Z);
  ctx.save();
  ctx.lineWidth = 0.35;
  ctx.lineCap = "round";
  ctx.strokeStyle = `rgba(255,255,255,${a})`;
  ctx.beginPath();
  ctx.moveTo(...p(x, y + d, z + h));
  ctx.lineTo(...p(x + w, y + d, z + h));
  ctx.lineTo(...p(x + w, y, z + h));
  ctx.stroke();
  if (h > 1) {
    ctx.strokeStyle = `rgba(255,255,255,${a * 0.45})`;
    ctx.beginPath();
    ctx.moveTo(...p(x + w, y + d, z + h));
    ctx.lineTo(...p(x + w, y + d, z));
    ctx.stroke();
  }
  ctx.restore();
}

// rounded slab: a box whose top is a rounded rectangle (table tops, cushions)
export function slab(ctx, x, y, z, w, d, h, r, c, top) {
  const steps = Math.max(1, Math.ceil(h / 0.6));
  for (let i = 0; i <= steps; i++) {
    const zz = z + (h * i) / steps;
    const last = i === steps;
    onGround(ctx, zz, (g) => {
      g.beginPath();
      g.roundRect(x, y, w, d, r);
      if (last && typeof top === "function") {
        g.save();
        g.clip();
        g.translate(x, y);
        top(g, w, d);
        g.restore();
      } else {
        g.fillStyle = last ? top ?? shade(c, 1.08) : shade(c, 0.62 + (0.2 * i) / steps);
        g.fill();
      }
    });
  }
}

// vertical cylinder centred on (cx, cy)
export function cyl(ctx, cx, cy, z, r, h, c, topFill) {
  const [sx, s0] = iso(cx, cy, z);
  const s1 = s0 - h;
  const rx = r * Math.SQRT2;
  const ry = rx / 2;
  const g = ctx.createLinearGradient(sx - rx, 0, sx + rx, 0);
  g.addColorStop(0, shade(c, 0.95));
  g.addColorStop(0.35, shade(c, 1.12));
  g.addColorStop(1, shade(c, 0.6));
  ctx.beginPath();
  ctx.moveTo(sx - rx, s1);
  ctx.lineTo(sx - rx, s0);
  ctx.ellipse(sx, s0, rx, ry, 0, Math.PI, 0, true);
  ctx.lineTo(sx + rx, s1);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(sx, s1, rx, ry, 0, 0, TAU);
  ctx.fillStyle = topFill ?? shade(c, 1.15);
  ctx.fill();
}

// disc lying flat at height z
export function disc(ctx, cx, cy, z, r, fill) {
  const [sx, sy] = iso(cx, cy, z);
  ctx.beginPath();
  ctx.ellipse(sx, sy, r * Math.SQRT2, (r * Math.SQRT2) / 2, 0, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
}

// straight 3D line
export function seg(ctx, a, b, color, w = 0.6) {
  ctx.beginPath();
  ctx.moveTo(...iso(...a));
  ctx.lineTo(...iso(...b));
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = "round";
  ctx.stroke();
}

// Shadow of a box from z0 to z1 over rect r, on the floor, in world units.
// The sun comes from the windows (north west), so shadows fall south east.
export const SUN = { x: 0.32, y: 0.5 };
export function shadowPath(g, [x0, y0, x1, y1], z0, z1) {
  const a = { x: z0 * SUN.x, y: z0 * SUN.y };
  const b = { x: z1 * SUN.x, y: z1 * SUN.y };
  // hull of the rect moved by a and by b (both down and right): a hexagon
  g.moveTo(x0 + a.x, y0 + a.y);
  g.lineTo(x1 + a.x, y0 + a.y);
  g.lineTo(x1 + b.x, y0 + b.y);
  g.lineTo(x1 + b.x, y1 + b.y);
  g.lineTo(x0 + b.x, y1 + b.y);
  g.lineTo(x0 + a.x, y1 + a.y);
  g.closePath();
}
