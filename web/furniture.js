// Every piece of furniture as a lit 3D model: desks, chairs, tables, shelves,
// racks, plants, the cafe and the lounge. itemsFor(f) turns a floor plan entry
// into one or more items for the scene (see scene.js for what an item is).

import { T } from "./map.js";
import { TAU, rng, shade, lin, ellipse, fillRR } from "./floors.js";
import { iso, onGround, onFaceY, onFaceX, box, slab, cyl, disc, seg } from "./iso.js";

const BOOKS = ["#8e3b46", "#2f5d8a", "#3f7d58", "#c79a3b", "#6b4c8a", "#b9643a", "#e8e0cc", "#2f3a4a", "#5d8aa8", "#a23e48", "#1f1f24", "#d6cdb8"];
const ART = [
  ["#264653", "#2a9d8f", "#e9c46a", "#f4a261", "#e76f51"],
  ["#1d3557", "#457b9d", "#a8dadc", "#f1faee", "#e63946"],
  ["#3d405b", "#81b29a", "#f2cc8f", "#e07a5f", "#f4f1de"],
  ["#22223b", "#4a4e69", "#9a8c98", "#c9ada7", "#f2e9e4"],
];
const MUGS = ["#f4f4f2", "#2f5d8a", "#c0392b", "#f2c14e", "#3f7d58", "#2b2b30"];

function grain(g, w, d, base, seed, along = "x") {
  g.fillStyle = base;
  g.fillRect(0, 0, w, d);
  const r = rng(seed);
  g.lineWidth = 0.25;
  for (let i = 0; i < (along === "x" ? d : w) * 1.4; i++) {
    const p = r() * (along === "x" ? d : w);
    g.strokeStyle = r() < 0.5 ? "rgba(70,40,20,0.13)" : "rgba(255,240,220,0.1)";
    g.beginPath();
    if (along === "x") {
      g.moveTo(0, p);
      g.bezierCurveTo(w * 0.3, p + r() - 0.5, w * 0.6, p + r() - 0.5, w, p + (r() - 0.5) * 0.6);
    } else {
      g.moveTo(p, 0);
      g.bezierCurveTo(p + r() - 0.5, d * 0.3, p + r() - 0.5, d * 0.6, p, d);
    }
    g.stroke();
  }
  // soft sheen
  g.fillStyle = lin(g, 0, 0, w, d, ["rgba(255,255,255,0.10)", "rgba(255,255,255,0)", "rgba(0,0,0,0.06)"]);
  g.fillRect(0, 0, w, d);
}

export function leaves(g, bx, by, n, seed, size, spread, height, greens) {
  const r = rng(seed);
  const list = [];
  for (let i = 0; i < n; i++) {
    const a = r() * TAU;
    const rad = Math.sqrt(r()) * spread;
    list.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad * 0.55 - r() * height, a: r() * TAU, s: size * (0.7 + r() * 0.5), k: r() });
  }
  list.sort((p, q) => p.y - q.y);
  for (const l of list) {
    const c = greens[Math.floor(l.k * greens.length)];
    g.save();
    g.translate(bx + l.x, by + l.y);
    g.rotate(l.a);
    const gr = g.createLinearGradient(-l.s, -l.s, l.s, l.s);
    gr.addColorStop(0, shade(c, 1.25));
    gr.addColorStop(1, shade(c, 0.75));
    g.beginPath();
    g.ellipse(0, 0, l.s, l.s * 0.42, 0, 0, TAU);
    g.fillStyle = gr;
    g.fill();
    g.strokeStyle = "rgba(255,255,255,0.18)";
    g.lineWidth = 0.15;
    g.beginPath();
    g.moveTo(-l.s * 0.9, 0);
    g.lineTo(l.s * 0.9, 0);
    g.stroke();
    g.restore();
  }
}

function deskItem(f) {
  const x0 = f.x0 * T + 1;
  const x1 = (f.x1 + 1) * T - 1;
  const y0 = f.y0 * T + 1;
  const y1 = f.y0 * T + 12;
  const Z = 13;
  const v = f.variant;
  const oak = v % 3 !== 1;
  const topC = oak ? "#c49a6c" : "#ebe8e2";
  const mx = f.seatX * T + 8;
  const setup = v % 4; // 0 dual monitors, 1 and 3 one monitor, 2 laptop
  return {
    kind: "desk",
    seatKey: `${f.seatX},${f.y0 - 1}`,
    box: [x0, y0, x1, y1],
    vis: [x0, y0, 0, x1, y1, 28],
    shadows: [
      [[x0, y0, x1, y1], 11.8, Z],
      [[x0 + 1, y0 + 1, x0 + 2.4, y1 - 1], 0, 12],
      [[x1 - 2.4, y0 + 1, x1 - 1, y1 - 1], 0, 12],
      [[x0 + 3, y1 - 2, x1 - 3, y1 - 1], 4, 11],
    ],
    lights(state) {
      return state?.screen ? [{ x: mx, y: y0 - 4, z: 20, r: 30, color: "#8ce6ff", strength: 0.8 }] : [];
    },
    draw(g) {
      const leg = "#4b5059";
      box(g, x0 + 1, y0 + 1, 0, 1.4, y1 - y0 - 2, Z - 1, leg);
      box(g, x0 + 3, y1 - 2, 4, x1 - x0 - 6, 1, 7, oak ? "#a98257" : "#d9d6cf", { edge: 0.15 });
      box(g, x1 - 2.4, y0 + 1, 0, 1.4, y1 - y0 - 2, Z - 1, leg);
      box(g, x0, y0, Z - 1.2, x1 - x0, y1 - y0, 1.2, topC, { top: (t, w, d) => (oak ? grain(t, w, d, topC, v * 7 + 1) : ((t.fillStyle = lin(t, 0, 0, w, d, ["#f3f1ec", "#e3e0d9"])), t.fillRect(0, 0, w, d))) });
      // papers and a notebook near the sitter
      onGround(g, Z + 0.05, (t) => {
        t.save();
        t.translate(x0 + 5, y0 + 2.5);
        t.rotate(-0.12);
        t.fillStyle = "#fbfbf8";
        t.fillRect(0, 0, 6, 4.5);
        t.fillStyle = "rgba(60,80,120,0.35)";
        for (let k = 0; k < 4; k++) t.fillRect(0.8, 0.8 + k * 0.9, 4.2 - (k % 2) * 1.2, 0.25);
        t.restore();
        t.fillStyle = MUGS[(v + 2) % MUGS.length] === "#f4f4f2" ? "#2b3a55" : "#38404d";
        t.fillRect(x1 - 11, y0 + 2, 4.5, 5.5);
      });
      // keyboard and mouse
      if (setup !== 2) {
        box(g, mx - 5, y0 + 1.6, Z, 10, 3.2, 0.55, "#d8dadf", {
          top: (t, w, d) => {
            t.fillStyle = "#cfd2d8";
            t.fillRect(0, 0, w, d);
            t.fillStyle = "#f4f5f7";
            for (let i = 0; i < 4; i++) for (let j = 0; j < 14; j++) t.fillRect(0.4 + j * 0.68, 0.35 + i * 0.7, 0.52, 0.52);
          },
          edge: 0.2,
        });
        disc(g, mx + 7.5, y0 + 3.4, Z + 0.4, 0.9, "#e9eaee");
      }
      // mug
      const mug = MUGS[v % MUGS.length];
      cyl(g, x1 - 5, y0 + 4.5, Z, 1.2, 2.6, mug, "#4a2c17");
      // desk plant or lamp
      if (v % 5 === 1) {
        cyl(g, x0 + 4.5, y1 - 4, Z, 1.6, 2.4, "#e9e4da", "#4a3626");
        const [px, py] = iso(x0 + 4.5, y1 - 4, Z + 3.5);
        leaves(g, px, py, 14, v + 3, 1.5, 2.2, 3, ["#4f8a46", "#3d7a3a", "#6aa457"]);
      } else if (v % 5 === 3) {
        disc(g, x0 + 5, y1 - 4, Z + 0.3, 1.6, "#2d3036");
        seg(g, [x0 + 5, y1 - 4, Z + 0.3], [x0 + 6, y1 - 6, Z + 8], "#2d3036", 0.6);
        seg(g, [x0 + 6, y1 - 6, Z + 8], [x0 + 9, y1 - 5.5, Z + 9.5], "#2d3036", 0.6);
        cyl(g, x0 + 9.5, y1 - 5.5, Z + 8, 1.2, 1.8, "#2d3036", "#fff3d1");
      }
      if (setup === 2) {
        // laptop: we see the back of the lid
        box(g, mx - 5, y0 + 2, Z, 10, 7, 0.6, "#c4c8ce", { top: "#cdd1d6", edge: 0.3 });
        box(g, mx - 5, y0 + 8.4, Z + 0.6, 10, 0.5, 7, "#b9bec5", {
          left: (t, w, h) => {
            t.fillStyle = lin(t, 0, 0, w, h, ["#d6dade", "#a9aeb6"]);
            t.fillRect(0, 0, w, h);
            ellipse(t, w / 2, h / 2, 0.9, 1.1, "rgba(255,255,255,0.6)");
          },
          edge: 0.4,
        });
        return;
      }
      const monitor = (cx) => {
        box(g, cx - 2.6, y1 - 5, Z, 5.2, 3.2, 0.45, "#2b2e35", { edge: 0.25 });
        box(g, cx - 0.6, y1 - 3.4, Z + 0.45, 1.2, 0.9, 5.2, "#3a3e46", { edge: 0.2 });
        box(g, cx - 7, y1 - 4.4, Z + 3, 14, 0.9, 8.8, "#24272d", {
          left: (t, w, h) => {
            t.fillStyle = lin(t, 0, 0, w, h, ["#3a3e46", "#1d2025"]);
            t.fillRect(0, 0, w, h);
            t.fillStyle = "rgba(255,255,255,0.06)";
            for (let k = 0; k < 6; k++) t.fillRect(w / 2 - 3, 1.5 + k * 0.6, 6, 0.25);
            ellipse(t, w / 2, h - 2, 0.35, 0.35, "rgba(140,230,255,0.7)");
          },
          edge: 0.35,
        });
      };
      if (setup === 0) {
        monitor(mx - 7.4);
        monitor(mx + 7.4);
      } else monitor(mx);
    },
  };
}

function chairItem(f) {
  const cx = f.x0 * T + 8;
  const cy = f.y0 * T + 8;
  const dir = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] }[f.facing];
  const sx = cx - dir[0] * 1.2;
  const sy = cy - dir[1] * 1.2;
  const office = f.style === "office";
  const r = office ? 4.6 : 3.6;
  let back;
  if (f.facing === "down") back = [sx - r, sy - r - 1.4, 2 * r, 1.6];
  else if (f.facing === "up") back = [sx - r, sy + r - 0.2, 2 * r, 1.6];
  else if (f.facing === "right") back = [sx - r - 1.4, sy - r, 1.6, 2 * r];
  else back = [sx + r - 0.2, sy - r, 1.6, 2 * r];
  const backInFront = f.facing === "up" || f.facing === "left";
  const fabric = office ? "#2e323b" : "#9a6b45";
  const seatZ = office ? 7 : 8.6;
  return {
    kind: "chair",
    box: [back[0], back[1], back[0] + back[2], back[1] + back[3]],
    vis: [sx - 6, sy - 6, 0, sx + 6, sy + 6, office ? 21 : 18],
    shadows: [[[sx - r, sy - r, sx + r, sy + r], seatZ - 1, seatZ + 1]],
    draw(g) {
      const backrest = () => {
        if (office) {
          const mid = [back[0] + back[2] / 2, back[1] + back[3] / 2];
          seg(g, [sx, sy, seatZ - 0.5], [mid[0], mid[1], seatZ + 1], "#3a3e46", 1.1);
          seg(g, [mid[0], mid[1], seatZ + 1], [mid[0], mid[1], seatZ + 4], "#3a3e46", 1.1);
          backPanel(g, back, seatZ + 2.2, 9.5);
        } else {
          for (const k of [0.15, 0.85]) {
            const px = back[0] + back[2] * (back[2] > 2 ? k : 0.5);
            const py = back[1] + back[3] * (back[3] > 2 ? k : 0.5);
            seg(g, [px, py, seatZ], [px, py, seatZ + 8], "#2d2f33", 0.45);
          }
          box(g, back[0], back[1], seatZ + 5.5, back[2], back[3], 2.6, "#8a5d3b", { edge: 0.2 });
        }
      };
      if (office) {
        onGround(g, 0.8, (t) => {
          t.strokeStyle = "#5a5f68";
          t.lineWidth = 0.9;
          t.lineCap = "round";
          for (let k = 0; k < 5; k++) {
            const a = (k / 5) * TAU + 0.3;
            t.beginPath();
            t.moveTo(sx, sy);
            t.lineTo(sx + Math.cos(a) * 5, sy + Math.sin(a) * 5);
            t.stroke();
          }
        });
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * TAU + 0.3;
          disc(g, sx + Math.cos(a) * 5, sy + Math.sin(a) * 5, 0.3, 0.6, "#1e2025");
        }
        cyl(g, sx, sy, 0.8, 0.55, seatZ - 1.5, "#6b707a");
      } else {
        for (const [dx, dy] of [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6]]) seg(g, [sx + dx, sy + dy, 0], [sx + dx * 0.85, sy + dy * 0.85, seatZ], "#2d2f33", 0.5);
      }
      const arms = () => {
        if (!office) return;
        const lat = dir[0] === 0 ? [1, 0] : [0, 1];
        for (const s of [-1, 1]) {
          const ax = sx + lat[0] * s * 4.4;
          const ay = sy + lat[1] * s * 4.4;
          seg(g, [ax, ay, seatZ], [ax, ay, seatZ + 3.6], "#3a3e46", 0.6);
          seg(g, [ax - dir[0] * 2.4, ay - dir[1] * 2.4, seatZ + 3.8], [ax + dir[0] * 2, ay + dir[1] * 2, seatZ + 3.8], "#1e2025", 1.1);
        }
      };
      if (!backInFront) backrest();
      if (office) slab(g, sx - r, sy - r, seatZ - 1.6, 2 * r, 2 * r, 1.8, 1.8, fabric, shade(fabric, 1.25));
      else slab(g, sx - r, sy - r, seatZ - 0.8, 2 * r, 2 * r, 0.9, r, "#8a5d3b", "#a8744c");
      arms();
      if (backInFront) backrest();
    },
  };
}

// a curved mesh chair back, drawn as a rounded panel with a little thickness
function backPanel(g, back, z0, h) {
  const thinY = back[3] < back[2];
  const w = thinY ? back[2] : back[3];
  const shape = (f, fill, stroke) => {
    f.beginPath();
    f.roundRect(0.3, 0, w - 0.6, h, [3, 3, 1.6, 1.6]);
    f.fillStyle = fill;
    f.fill();
    if (stroke) {
      f.strokeStyle = stroke;
      f.lineWidth = 0.5;
      f.stroke();
    }
  };
  const near = (f) => {
    const gr = f.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, "#40454f");
    gr.addColorStop(1, "#22252b");
    shape(f, gr, "#15171b");
    f.save();
    f.clip();
    f.strokeStyle = "rgba(255,255,255,0.06)";
    f.lineWidth = 0.2;
    for (let k = -h; k < w; k += 0.8) {
      f.beginPath();
      f.moveTo(k, h);
      f.lineTo(k + h, 0);
      f.stroke();
    }
    f.fillStyle = "rgba(255,255,255,0.07)";
    f.fillRect(0, h * 0.55, w, 1.4);
    f.restore();
  };
  if (thinY) {
    onFaceY(g, back[1], back[0], z0 + h, (f) => shape(f, "#16181c"));
    onFaceY(g, back[1] + back[3], back[0], z0 + h, near);
  } else {
    onFaceX(g, back[0], back[1] + back[3], z0 + h, (f) => shape(f, "#16181c"));
    onFaceX(g, back[0] + back[2], back[1] + back[3], z0 + h, near);
  }
}

function tableItem(f) {
  const x0 = f.x0 * T + 2;
  const x1 = (f.x1 + 1) * T - 2;
  const y0 = f.y0 * T + 2;
  const y1 = (f.y1 + 1) * T - 2;
  const Z = 13;
  const walnut = "#6a4630";
  const seatsN = [24, 26, 28, 30];
  return {
    kind: "table",
    box: [x0, y0, x1, y1],
    vis: [x0, y0, 0, x1, y1, 22],
    shadows: [
      [[x0, y0, x1, y1], 12, Z],
      [[x0 + 22, y0 + 8, x0 + 34, y1 - 8], 0, 12],
      [[x1 - 34, y0 + 8, x1 - 22, y1 - 8], 0, 12],
    ],
    lights(state) {
      return state?.screen ? seatsN.map((sx) => ({ x: sx * T + 8, y: y1 - 4, z: 16, r: 24, color: "#8ce6ff", strength: 0.5 })) : [];
    },
    draw(g) {
      box(g, x0 + 22, y0 + 8, 0, 12, y1 - y0 - 16, Z - 1, "#2c2f35");
      box(g, x1 - 34, y0 + 8, 0, 12, y1 - y0 - 16, Z - 1, "#2c2f35");
      slab(g, x0, y0, Z - 1.4, x1 - x0, y1 - y0, 1.4, 10, walnut, (t, w, d) => {
        grain(t, w, d, walnut, 5);
        t.fillStyle = lin(t, 0, 0, w * 0.6, d, ["rgba(255,255,255,0.16)", "rgba(255,255,255,0)"]);
        t.fillRect(0, 0, w, d);
      });
      // centre: conference speaker, water and glasses
      disc(g, (x0 + x1) / 2, (y0 + y1) / 2, Z + 0.4, 3, "#1f2126");
      disc(g, (x0 + x1) / 2, (y0 + y1) / 2, Z + 0.6, 1.2, "#3b8f5f");
      for (const k of [-1, 1]) {
        const bx = (x0 + x1) / 2 + k * 30;
        const by = (y0 + y1) / 2;
        g.globalAlpha = 0.7;
        cyl(g, bx, by, Z, 1.3, 5.5, "#b9dcef", "#d7ecf7");
        g.globalAlpha = 1;
        cyl(g, bx, by, Z + 5.5, 0.6, 0.8, "#2f5d8a");
      }
      for (const sx of seatsN) {
        const cx = sx * T + 8;
        // north side: lid back faces us
        onGround(g, Z + 0.05, (t) => {
          t.fillStyle = "#fbfaf6";
          t.fillRect(cx + 5, y0 + 3, 4, 5);
          t.fillStyle = "#fbfaf6";
          t.fillRect(cx - 9, y1 - 8, 4, 5);
        });
        box(g, cx - 4.5, y0 + 2, Z, 9, 6, 0.5, "#c4c8ce", { top: "#ced2d7", edge: 0.3 });
        box(g, cx - 4.5, y0 + 7.6, Z + 0.5, 9, 0.45, 6.2, "#b9bec5", {
          left: (t, w, h) => {
            t.fillStyle = lin(t, 0, 0, w, h, ["#d6dade", "#a9aeb6"]);
            t.fillRect(0, 0, w, h);
            ellipse(t, w / 2, h / 2, 0.8, 1, "rgba(255,255,255,0.6)");
          },
          edge: 0.4,
        });
        // south side: the screen faces us
        box(g, cx - 4.5, y1 - 8.6, Z + 0.5, 9, 0.45, 6.2, "#b9bec5", {
          left: (t, w, h) => {
            t.fillStyle = "#c9cdd3";
            t.fillRect(0, 0, w, h);
            t.fillStyle = "#14171c";
            t.fillRect(0.5, 0.5, w - 1, h - 1);
          },
          edge: 0.4,
        });
        box(g, cx - 4.5, y1 - 8.2, Z, 9, 6, 0.5, "#c4c8ce", {
          top: (t, w, d) => {
            t.fillStyle = "#ced2d7";
            t.fillRect(0, 0, w, d);
            t.fillStyle = "#2a2d33";
            t.fillRect(0.8, 0.6, w - 1.6, 3);
          },
          edge: 0.3,
        });
      }
    },
    anim(g, t, state) {
      if (!state?.screen) return;
      for (const [i, sx] of seatsN.entries()) {
        const cx = sx * T + 8;
        onFaceY(g, y1 - 8.15, cx - 4, Z + 6.2, (f) => {
          const gr = f.createLinearGradient(0, 0, 0, 5.2);
          gr.addColorStop(0, "#2c3e66");
          gr.addColorStop(1, "#16213a");
          f.fillStyle = gr;
          f.fillRect(0, 0, 8, 5.2);
          f.fillStyle = "rgba(140,230,255,0.85)";
          for (let k = 0; k < 4; k++) {
            const wv = 2 + ((Math.sin(t * 1.3 + k * 1.7 + i) + 1) / 2) * 4.5;
            f.fillRect(0.7, 0.8 + k * 1.1, wv, 0.45);
          }
        });
      }
    },
  };
}

function shelfItem(f) {
  const x0 = f.x0 * T;
  const x1 = (f.x1 + 1) * T;
  const y0 = 16;
  const y1 = 23;
  const Hh = 38;
  const body = "#a07a54";
  return {
    kind: "shelf",
    box: [x0, y0, x1, y1],
    vis: [x0, y0, 0, x1, y1, Hh + 8],
    shadows: [[[x0, y0, x1, y1], 0, Hh]],
    draw(g) {
      box(g, x0, y0, 0, x1 - x0, y1 - y0, Hh, body, {
        top: (t, w, d) => grain(t, w, d, shade(body, 1.05), 77),
        left: (t, w, h) => {
          t.fillStyle = body;
          t.fillRect(0, 0, w, h);
          const r = rng(19);
          const bay = 31.5;
          for (let bx = 0; bx < w - 1; bx += bay) {
            const bw = Math.min(bay, w - bx) - 1.4;
            const ix = bx + 1.2;
            for (let row = 0; row < 4; row++) {
              const top = 1.4 + row * 9;
              const ih = 7.8;
              t.fillStyle = "#3b2d22";
              t.fillRect(ix, top, bw, ih);
              t.fillStyle = lin(t, 0, top, 0, top + ih, ["rgba(0,0,0,0.45)", "rgba(0,0,0,0)"]);
              t.fillRect(ix, top, bw, ih);
              let x = ix + 0.3;
              while (x < ix + bw - 1) {
                const roll = r();
                if (roll < 0.08) {
                  // a small plant or a box
                  const pw = 3.2;
                  if (x + pw > ix + bw) break;
                  fillRR(t, x, top + ih - 2.6, pw, 2.6, 0.4, r() < 0.5 ? "#e9e2d6" : "#4a5a6a");
                  ellipse(t, x + pw / 2, top + ih - 3.6, 1.9, 1.5, "#4f8a46");
                  x += pw + 0.6;
                  continue;
                }
                if (roll < 0.16) {
                  // a stack lying flat
                  const sw = 4 + r() * 1.5;
                  if (x + sw > ix + bw) break;
                  for (let k = 0; k < 3; k++) {
                    t.fillStyle = BOOKS[Math.floor(r() * BOOKS.length)];
                    t.fillRect(x, top + ih - 1 - k * 1, sw - k * 0.3, 0.9);
                  }
                  x += sw + 0.4;
                  continue;
                }
                const bwid = 0.9 + r() * 1.1;
                const bh = ih - 0.6 - r() * 2.6;
                if (x + bwid > ix + bw) break;
                const c = BOOKS[Math.floor(r() * BOOKS.length)];
                t.fillStyle = lin(t, x, 0, x + bwid, 0, [shade(c, 1.15), c, shade(c, 0.75)]);
                t.fillRect(x, top + ih - bh, bwid, bh);
                t.fillStyle = "rgba(255,240,200,0.35)";
                t.fillRect(x, top + ih - bh + bh * 0.25, bwid, 0.35);
                t.fillRect(x, top + ih - bh + bh * 0.7, bwid, 0.25);
                x += bwid + 0.05;
              }
              // shelf board edge
              t.fillStyle = shade(body, 1.12);
              t.fillRect(ix - 0.2, top + ih, bw + 0.4, 1.2);
            }
          }
          t.fillStyle = shade(body, 0.8);
          t.fillRect(0, h - 1.2, w, 1.2);
        },
        edge: 0.3,
      });
      // things on top
      for (const [k, kind] of [[0.12, "box"], [0.4, "plant"], [0.7, "box"], [0.9, "plant"]]) {
        const px = x0 + (x1 - x0) * k;
        if (kind === "box") box(g, px - 4, y0 + 1, Hh, 8, 5, 4, "#c9b48f", { edge: 0.25 });
        else {
          cyl(g, px, y0 + 3.5, Hh, 2, 3.5, "#efe9df", "#4a3626");
          const [lx, ly] = iso(px, y0 + 3.5, Hh + 5);
          leaves(g, lx, ly, 12, Math.round(px), 2, 2.5, 3, ["#4f8a46", "#3d7a3a", "#6aa457"]);
          // trailing vine
          g.strokeStyle = "#3d7a3a";
          g.lineWidth = 0.4;
          g.beginPath();
          g.moveTo(lx + 1.5, ly + 3);
          g.quadraticCurveTo(lx + 3, ly + 8, lx + 2, ly + 14);
          g.stroke();
          for (let j = 0; j < 6; j++) ellipse(g, lx + 1.8 + Math.sin(j) * 0.8, ly + 4 + j * 1.8, 0.9, 0.5, "#4f8a46");
        }
      }
    },
  };
}

function whiteboardItem(f) {
  const x0 = f.x0 * T + 2;
  const x1 = (f.x1 + 1) * T - 2;
  return {
    kind: "whiteboard",
    box: [x0, 16, x1, 17.4],
    vis: [x0, 16, 12, x1, 20, 38],
    draw(g) {
      box(g, x0, 16, 14, x1 - x0, 1.2, 23, "#f6f7f8", {
        left: (t, w, h) => {
          t.fillStyle = "#b8bfc7";
          t.fillRect(0, 0, w, h);
          t.fillStyle = lin(t, 0, 0, w, h, ["#ffffff", "#eef0f2"]);
          t.fillRect(0.8, 0.8, w - 1.6, h - 1.6);
          t.lineWidth = 0.35;
          t.lineCap = "round";
          // a diagram: boxes and arrows
          t.strokeStyle = "#2457a6";
          for (const [bx, by] of [[5, 4], [21, 4], [37, 4], [21, 13]]) t.strokeRect(bx, by, 10, 5);
          t.beginPath();
          t.moveTo(15, 6.5);
          t.lineTo(21, 6.5);
          t.moveTo(31, 6.5);
          t.lineTo(37, 6.5);
          t.moveTo(26, 9);
          t.lineTo(26, 13);
          t.stroke();
          t.strokeStyle = "rgba(36,87,166,0.6)";
          for (const [bx, by] of [[5, 4], [21, 4], [37, 4], [21, 13]]) {
            t.beginPath();
            t.moveTo(bx + 1.5, by + 2);
            t.lineTo(bx + 8, by + 2);
            t.moveTo(bx + 1.5, by + 3.4);
            t.lineTo(bx + 6, by + 3.4);
            t.stroke();
          }
          // a red chart
          t.strokeStyle = "#c0392b";
          t.beginPath();
          t.moveTo(52, 18);
          t.lineTo(56, 14);
          t.lineTo(60, 15.5);
          t.lineTo(64, 9);
          t.lineTo(68, 6);
          t.stroke();
          t.strokeStyle = "#333";
          t.beginPath();
          t.moveTo(51, 4);
          t.lineTo(51, 19);
          t.lineTo(70, 19);
          t.stroke();
          // sticky notes
          const notes = ["#ffe066", "#ff9fb2", "#9be7a5", "#ffe066", "#8fd3ff"];
          notes.forEach((c, i) => {
            fillRR(t, 4 + i * 4.2, 14 + (i % 2) * 1.2, 3.4, 3.4, 0.2, c);
            t.fillStyle = "rgba(0,0,0,0.25)";
            t.fillRect(4.6 + i * 4.2, 15.4 + (i % 2) * 1.2, 2.2, 0.25);
          });
        },
        edge: 0.4,
      });
      // marker tray
      box(g, x0 + 8, 16, 13, x1 - x0 - 16, 2.6, 1, "#b8bfc7", { edge: 0.3 });
      for (const [i, c] of ["#c0392b", "#2457a6", "#222", "#2e8b57"].entries()) box(g, x0 + 12 + i * 3.4, 16.6, 14, 2.6, 0.8, 0.8, c, { edge: false });
    },
  };
}

function rackItem(f) {
  const out = [];
  for (let x = f.x0; x <= f.x1; x++) {
    const x0 = x * T + 0.5;
    const x1 = x * T + T - 0.5;
    const y0 = 16.5;
    const y1 = 29;
    const Hh = 40;
    const seed = x;
    out.push({
      kind: "rack",
      box: [x0, y0, x1, y1],
      vis: [x0, y0, 0, x1, y1, Hh],
      shadows: [[[x0, y0, x1, y1], 0, Hh]],
      lights: () => [{ x: (x0 + x1) / 2, y: y1 + 3, z: 20, r: 18, color: "#43e08b", strength: 0.35 }],
      draw(g) {
        box(g, x0, y0, 0, x1 - x0, y1 - y0, Hh, "#22252c", {
          left: (t, w, h) => {
            t.fillStyle = "#1b1d22";
            t.fillRect(0, 0, w, h);
            t.fillStyle = "#2b2f37";
            t.fillRect(0.8, 1.5, w - 1.6, h - 3);
            // perforated door
            t.fillStyle = "rgba(0,0,0,0.55)";
            for (let yy = 3; yy < h - 3; yy += 0.9) for (let xx = 1.6; xx < w - 3.5; xx += 0.9) t.fillRect(xx, yy, 0.45, 0.45);
            // servers behind, seen through
            for (let k = 0; k < 9; k++) {
              t.fillStyle = "rgba(90,100,115,0.25)";
              t.fillRect(1.6, 3 + k * 3.9, w - 5, 0.4);
            }
            t.fillStyle = "#8d949d";
            t.fillRect(w - 2.6, h / 2 - 4, 0.6, 8);
            t.fillStyle = "#e9edf2";
            t.fillRect(2, 0.4, 5, 0.8);
          },
          edge: 0.25,
        });
      },
      anim(g, t) {
        onFaceY(g, y1, x0, Hh, (s) => {
          for (let k = 0; k < 9; k++) {
            for (let j = 0; j < 3; j++) {
              const on = Math.sin(t * (3 + ((seed * 7 + k * 3 + j) % 5)) + k * 1.3 + j * 2 + seed) > 0.1;
              s.fillStyle = on ? (j === 2 && k % 4 === 1 ? "#ffb347" : "#43e08b") : "rgba(67,224,139,0.18)";
              s.fillRect(x1 - x0 - 4.6 + j * 0.9, 3.6 + k * 3.9, 0.5, 0.5);
            }
          }
        });
      },
    });
  }
  return out;
}

function plantItem(f) {
  const cx = f.x0 * T + 8;
  const cy = f.y0 * T + 8;
  const kind = (f.x0 * 7 + f.y0 * 3) % 3;
  const pot = ["#e9e4da", "#b86f4c", "#3c3f46"][(f.x0 + f.y0) % 3];
  return {
    kind: "plant",
    box: [cx - 4.5, cy - 4.5, cx + 4.5, cy + 4.5],
    vis: [cx - 9, cy - 9, 0, cx + 9, cy + 9, 34],
    shadows: [
      [[cx - 4, cy - 4, cx + 4, cy + 4], 0, 8],
      [[cx - 6, cy - 6, cx + 6, cy + 6], 12, 26],
    ],
    draw(g) {
      cyl(g, cx, cy, 0, 4.4, 8.5, pot, "#3b2a1f");
      disc(g, cx, cy, 8.5, 4.4, shade(pot, 1.1));
      disc(g, cx, cy, 8.5, 3.8, "#3b2a1f");
      const [bx, by] = iso(cx, cy, 8.5);
      if (kind === 0) {
        // rubber tree: a trunk and big glossy leaves
        g.strokeStyle = "#5a4330";
        g.lineWidth = 0.8;
        g.beginPath();
        g.moveTo(bx, by);
        g.quadraticCurveTo(bx + 1, by - 8, bx - 0.5, by - 16);
        g.stroke();
        leaves(g, bx, by - 13, 26, f.x0 * 13 + f.y0, 3.4, 6.5, 10, ["#2f6b3a", "#3f7f46", "#24552d", "#4d8f4f"]);
      } else if (kind === 1) {
        // snake plant: upright blades
        const r = rng(f.x0 * 5 + f.y0);
        const blades = [];
        for (let i = 0; i < 13; i++) blades.push({ x: (r() - 0.5) * 6, h: 9 + r() * 10, lean: (r() - 0.5) * 3, w: 1 + r() * 0.8 });
        blades.sort((a, b) => a.x - b.x);
        for (const b of blades) {
          g.beginPath();
          g.moveTo(bx + b.x - b.w, by);
          g.quadraticCurveTo(bx + b.x - b.w * 0.8 + b.lean * 0.4, by - b.h * 0.6, bx + b.x + b.lean, by - b.h);
          g.quadraticCurveTo(bx + b.x + b.w * 0.8 + b.lean * 0.4, by - b.h * 0.6, bx + b.x + b.w, by);
          g.closePath();
          g.fillStyle = lin(g, bx + b.x - b.w, 0, bx + b.x + b.w, 0, ["#cdbf55", "#2f5e35", "#3f7a45", "#cdbf55"]);
          g.fill();
        }
      } else {
        // palm: arching fronds
        const r = rng(f.x0 * 3 + f.y0 * 11);
        for (let i = 0; i < 11; i++) {
          const a = (i / 11) * TAU + r() * 0.4;
          const len = 9 + r() * 6;
          const ex = bx + Math.cos(a) * len;
          const ey = by - 12 - r() * 6 + Math.sin(a) * len * 0.45 + len * 0.3;
          const mx = bx + Math.cos(a) * len * 0.4;
          const my = by - 20 - r() * 4;
          g.strokeStyle = "#4b7a3a";
          g.lineWidth = 0.4;
          g.beginPath();
          g.moveTo(bx, by - 2);
          g.quadraticCurveTo(mx, my, ex, ey);
          g.stroke();
          for (let k = 1; k < 9; k++) {
            const u = k / 9;
            const px = (1 - u) * (1 - u) * bx + 2 * (1 - u) * u * mx + u * u * ex;
            const py = (1 - u) * (1 - u) * (by - 2) + 2 * (1 - u) * u * my + u * u * ey;
            const s = 2.4 * (1 - u * 0.5);
            for (const side of [-1, 1]) {
              g.save();
              g.translate(px, py);
              g.rotate(a + side * 0.9 + Math.PI / 2 * side * 0.3);
              ellipse(g, s * 0.5, 0, s * 0.6, 0.35, i % 2 ? "#5f9a48" : "#4b8a3c");
              g.restore();
            }
          }
        }
      }
    },
  };
}

function artItem(f) {
  const pal = ART[f.seed % ART.length];
  const painter = (t, w, h) => {
    t.fillStyle = "#26272b";
    t.fillRect(0, 0, w, h);
    t.fillStyle = "#f4f1ea";
    t.fillRect(0.7, 0.7, w - 1.4, h - 1.4);
    const ix = 2.4;
    const iy = 2.4;
    const iw = w - 4.8;
    const ih = h - 4.8;
    t.save();
    t.beginPath();
    t.rect(ix, iy, iw, ih);
    t.clip();
    t.fillStyle = pal[4];
    t.fillRect(ix, iy, iw, ih);
    const r = rng(f.seed * 101);
    const style = f.seed % 3;
    if (style === 0) {
      for (let i = 0; i < 6; i++) {
        t.fillStyle = pal[i % 4];
        t.beginPath();
        t.arc(ix + r() * iw, iy + r() * ih, 2 + r() * iw * 0.25, 0, TAU);
        t.fill();
      }
    } else if (style === 1) {
      for (let i = 0; i < 5; i++) {
        t.fillStyle = pal[i % 4];
        t.fillRect(ix + (i * iw) / 5, iy + r() * ih * 0.4, iw / 5 - 0.6, ih);
      }
    } else {
      // landscape
      t.fillStyle = lin(t, 0, iy, 0, iy + ih, [pal[2], pal[4]]);
      t.fillRect(ix, iy, iw, ih);
      for (let k = 0; k < 3; k++) {
        t.fillStyle = pal[k];
        t.beginPath();
        t.moveTo(ix, iy + ih);
        for (let s = 0; s <= 8; s++) t.lineTo(ix + (s / 8) * iw, iy + ih * (0.45 + k * 0.17) - Math.sin(s * 1.3 + k * 2) * 2.2);
        t.lineTo(ix + iw, iy + ih);
        t.fill();
      }
      ellipse(t, ix + iw * 0.75, iy + ih * 0.25, 1.8, 1.8, pal[3]);
    }
    t.fillStyle = "rgba(255,255,255,0.08)";
    t.fillRect(ix, iy, iw, ih * 0.4);
    t.restore();
  };
  if (f.wall === "north") {
    const x0 = f.x0 * T + 3;
    const x1 = (f.x1 + 1) * T - 3;
    return {
      kind: "art",
      box: [x0, 16, x1, 17],
      vis: [x0, 16, 18, x1, 17, 42],
      draw(g) {
        box(g, x0, 16, 18, x1 - x0, 0.9, 22, "#26272b", { left: painter, edge: 0.3 });
      },
    };
  }
  const y0 = f.y0 * T + 3;
  const y1 = (f.y1 + 1) * T - 3;
  return {
    kind: "art",
    box: [16, y0, 17, y1],
    vis: [16, y0, 18, 17, y1, 42],
    draw(g) {
      box(g, 16, y0, 18, 0.9, y1 - y0, 22, "#26272b", { right: painter, edge: 0.3 });
    },
  };
}

function clockItem(f) {
  const cx = f.x0 * T + 8;
  const Z = 44;
  return {
    kind: "clock",
    box: [cx - 5, 16, cx + 5, 17],
    vis: [cx - 6, 16, Z - 6, cx + 6, 17, Z + 6],
    draw(g) {
      onFaceY(g, 16.8, cx - 5, Z + 5, (t) => {
        ellipse(t, 5, 5, 5, 5, "#2a2c31");
        ellipse(t, 5, 5, 4.4, 4.4, "#fbfaf6");
        t.fillStyle = "#2a2c31";
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * TAU;
          t.fillRect(5 + Math.cos(a) * 3.7 - 0.2, 5 + Math.sin(a) * 3.7 - 0.2, 0.4, 0.4);
        }
      });
    },
    anim(g) {
      const d = new Date();
      const hr = ((d.getHours() % 12) + d.getMinutes() / 60) / 12;
      const mn = (d.getMinutes() + d.getSeconds() / 60) / 60;
      const sc = d.getSeconds() / 60;
      onFaceY(g, 16.9, cx - 5, Z + 5, (t) => {
        t.lineCap = "round";
        for (const [k, len, w, c] of [[hr, 2.2, 0.55, "#1d1f24"], [mn, 3.3, 0.4, "#1d1f24"], [sc, 3.5, 0.18, "#c0392b"]]) {
          const a = k * TAU - Math.PI / 2;
          t.strokeStyle = c;
          t.lineWidth = w;
          t.beginPath();
          t.moveTo(5, 5);
          t.lineTo(5 + Math.cos(a) * len, 5 + Math.sin(a) * len);
          t.stroke();
        }
      });
    },
  };
}

function pendant(g, x, y, z) {
  seg(g, [x, y, z + 3], [x, y, z + 30], "#2a2c31", 0.3);
  const [sx, sy] = iso(x, y, z);
  g.beginPath();
  g.moveTo(sx - 1, sy - 3);
  g.lineTo(sx + 1, sy - 3);
  g.lineTo(sx + 3.6, sy);
  g.ellipse(sx, sy, 3.6, 1.6, 0, 0, Math.PI);
  g.closePath();
  g.fillStyle = lin(g, sx - 3.6, 0, sx + 3.6, 0, ["#3b3e45", "#1f2126", "#141518"]);
  g.fill();
  ellipse(g, sx, sy + 0.2, 2.6, 1, "#ffe7b3");
}

function counterItem(f) {
  const x0 = f.x0 * T + 1;
  const x1 = (f.x1 + 1) * T - 1;
  const y0 = f.y0 * T + 1;
  const y1 = f.y0 * T + 13;
  const Z = 15;
  const pend = [x0 + 24, x0 + 72, x0 + 120];
  return {
    kind: "counter",
    box: [x0, y0, x1, y1],
    vis: [x0, y0, 0, x1, y1 + 4, Z + 48],
    shadows: [[[x0, y0, x1, y1], 0, Z]],
    lights: () => pend.map((px) => ({ x: px, y: y1 + 2, z: 32, r: 38, color: "#ffd9a0", strength: 0.9, day: 0.04 })),
    draw(g) {
      const wood = "#7a5233";
      box(g, x0, y0, 0, x1 - x0, y1 - y0, Z - 1.2, wood, {
        left: (t, w, h) => {
          t.fillStyle = wood;
          t.fillRect(0, 0, w, h);
          for (let s = 0; s < w; s += 1.5) {
            t.fillStyle = lin(t, s, 0, s + 1.5, 0, [shade(wood, 1.18), shade(wood, 0.92), shade(wood, 0.72)]);
            t.fillRect(s, 0.6, 1.5, h - 2.6);
          }
          t.fillStyle = "#26211d";
          t.fillRect(0, h - 2, w, 2);
          t.fillStyle = "rgba(255,214,150,0.55)";
          t.fillRect(0, 0.6, w, 0.35);
        },
        edge: 0.2,
      });
      box(g, x0 - 0.6, y0 - 0.4, Z - 1.2, x1 - x0 + 1.2, y1 - y0 + 1.6, 1.2, "#f1eee8", {
        top: (t, w, d) => {
          t.fillStyle = "#f2efe9";
          t.fillRect(0, 0, w, d);
          const r = rng(4);
          t.strokeStyle = "rgba(150,150,160,0.25)";
          t.lineWidth = 0.2;
          for (let i = 0; i < 9; i++) {
            t.beginPath();
            const sx = r() * w;
            t.moveTo(sx, 0);
            t.bezierCurveTo(sx + 6, d * 0.3, sx - 4, d * 0.6, sx + 8 * r(), d);
            t.stroke();
          }
        },
        edge: 0.5,
      });
      // espresso machine
      const ex = x0 + 8;
      box(g, ex, y0 + 1.5, Z, 17, 8, 10, "#c9ccd2", {
        top: (t, w, d) => {
          t.fillStyle = "#b5b9c0";
          t.fillRect(0, 0, w, d);
          for (let k = 0; k < 4; k++) {
            ellipse(t, 2.5 + k * 3.8, d / 2, 1.3, 1.3, "#f6f6f4");
            ellipse(t, 2.5 + k * 3.8, d / 2, 0.8, 0.8, "#dcdcd8");
          }
        },
        left: (t, w, h) => {
          t.fillStyle = lin(t, 0, 0, w, 0, ["#e3e6ea", "#aeb3ba", "#d5d8dd", "#9aa0a8"]);
          t.fillRect(0, 0, w, h);
          t.fillStyle = "#b8392f";
          t.fillRect(0, 0, w, 2.2);
          t.fillStyle = "#1d1f24";
          t.fillRect(2, 3.4, 13, 1.2);
          for (const gx of [4.5, 12.5]) {
            fillRR(t, gx - 1.6, 4.6, 3.2, 1.6, 0.4, "#2b2d32");
            t.fillStyle = "#2b2d32";
            t.fillRect(gx - 0.3, 6.2, 0.6, 1);
          }
          t.fillStyle = "#3a3d43";
          t.fillRect(1, h - 1.6, w - 2, 1.6);
          ellipse(t, 8.5, 3.9, 0.5, 0.5, "#4fd16b");
        },
        edge: 0.45,
      });
      cyl(g, ex + 4.5, y0 + 10.2, Z, 0.9, 1.6, "#f6f6f4", "#5a3a22");
      cyl(g, ex + 12.5, y0 + 10.2, Z, 0.9, 1.6, "#f6f6f4", "#f1e2c8");
      // grinder
      box(g, x0 + 30, y0 + 3, Z, 5, 6, 6, "#2b2d32", { edge: 0.3 });
      g.globalAlpha = 0.85;
      cyl(g, x0 + 32.5, y0 + 6, Z + 6, 2.2, 4, "#6b4226", "#3b2416");
      g.globalAlpha = 1;
      // cup stacks
      for (let k = 0; k < 3; k++) cyl(g, x0 + 40 + k * 3.2, y0 + 4, Z, 1.2, 3 + k, "#f6f6f4", "#e9e9e6");
      // pastry case
      const px0 = x0 + 56;
      box(g, px0, y0 + 1, Z, 26, 9, 1, "#d6d0c6", { edge: 0.3 });
      for (let k = 0; k < 9; k++) {
        const [cx, cy] = iso(px0 + 3 + (k % 5) * 4.6, y0 + 3 + Math.floor(k / 5) * 4, Z + 1.8);
        ellipse(g, cx, cy, 1.7, 0.9, k % 3 === 0 ? "#7a3d1c" : "#d79a4a");
        ellipse(g, cx - 0.4, cy - 0.3, 0.8, 0.35, "rgba(255,240,200,0.6)");
      }
      box(g, px0, y0 + 1, Z + 1, 26, 9, 6, "#cfe6f0", { top: "rgba(220,240,250,0.25)", left: "rgba(220,240,250,0.22)", right: "rgba(200,225,240,0.28)", edge: 0.5 });
      // till
      box(g, x0 + 96, y0 + 3, Z, 4, 4, 2, "#2b2d32", { edge: 0.3 });
      box(g, x0 + 95.5, y0 + 4.5, Z + 2, 5, 0.6, 4, "#14161a", {
        left: (t, w, h) => {
          t.fillStyle = "#1c2a3a";
          t.fillRect(0.3, 0.3, w - 0.6, h - 0.6);
          t.fillStyle = "rgba(140,230,255,0.6)";
          t.fillRect(0.8, 0.8, w - 1.6, 0.4);
        },
        edge: 0.3,
      });
      // a tip jar and a menu stand
      g.globalAlpha = 0.6;
      cyl(g, x0 + 108, y0 + 6, Z, 1.6, 3.2, "#cfe6f0", "#c9a14a");
      g.globalAlpha = 1;
      box(g, x0 + 116, y0 + 6, Z, 6, 0.6, 5, "#222", {
        left: (t, w, h) => {
          t.fillStyle = "#222";
          t.fillRect(0, 0, w, h);
          t.fillStyle = "rgba(255,255,255,0.75)";
          for (let k = 0; k < 4; k++) t.fillRect(0.8, 1 + k * 1, 2 + (k % 2), 0.3);
        },
        edge: false,
      });
      for (const px of pend) pendant(g, px, y1 + 2, 33);
    },
  };
}

function coolerItem(f) {
  const x = f.x0 * T + 3;
  const y = f.y0 * T + 3;
  return {
    kind: "cooler",
    box: [x, y, x + 10, y + 10],
    vis: [x, y, 0, x + 10, y + 10, 26],
    shadows: [[[x, y, x + 10, y + 10], 0, 24]],
    draw(g) {
      box(g, x, y, 0, 10, 10, 14, "#e6e8eb", {
        left: (t, w, h) => {
          t.fillStyle = lin(t, 0, 0, w, 0, ["#f2f4f6", "#d9dde2"]);
          t.fillRect(0, 0, w, h);
          t.fillStyle = "#3a3d44";
          t.fillRect(2.5, 2.5, w - 5, 3.2);
          fillRR(t, 3.3, 3, 1.3, 1.8, 0.3, "#3b8fd9");
          fillRR(t, w - 4.6, 3, 1.3, 1.8, 0.3, "#d94b3b");
          t.fillStyle = "#c4c9cf";
          t.fillRect(2, 7, w - 4, 0.5);
        },
        edge: 0.4,
      });
      g.globalAlpha = 0.8;
      cyl(g, x + 5, y + 5, 14, 3.8, 10, "#8cc8ec", "#b9e0f5");
      g.globalAlpha = 1;
      const [sx, sy] = iso(x + 5, y + 5, 20);
      g.fillStyle = "rgba(255,255,255,0.35)";
      g.fillRect(sx - 4, sy - 2, 1, 7);
    },
  };
}

function cafeTableItem(f) {
  const cx = f.x0 * T + 8;
  const cy = f.y0 * T + 8;
  return {
    kind: "cafeTable",
    box: [cx - 5, cy - 5, cx + 5, cy + 5],
    vis: [cx - 7, cy - 7, 0, cx + 7, cy + 7, 50],
    shadows: [
      [[cx - 6, cy - 6, cx + 6, cy + 6], 12, 13],
      [[cx - 3.5, cy - 3.5, cx + 3.5, cy + 3.5], 0, 1],
    ],
    lights: () => [{ x: cx, y: cy, z: 30, r: 34, color: "#ffcf8a", strength: 0.9, day: 0.04 }],
    draw(g) {
      cyl(g, cx, cy, 0, 3.6, 0.7, "#2a2c31");
      cyl(g, cx, cy, 0.7, 0.6, 11.6, "#3a3d44");
      cyl(g, cx, cy, 12.3, 6.4, 0.9, "#d8d3ca", "#f3f0ea");
      cyl(g, cx - 2.4, cy + 1.6, 13.2, 1, 1.6, "#f6f6f4", "#5a3a22");
      disc(g, cx - 2.4, cy + 1.6, 13.25, 1.6, "rgba(255,255,255,0.5)");
      cyl(g, cx + 2.6, cy - 1.4, 13.2, 1, 1.6, "#2f5d8a", "#5a3a22");
      g.globalAlpha = 0.7;
      cyl(g, cx + 0.3, cy - 3, 13.2, 0.7, 3, "#cfe6f0", "#cfe6f0");
      g.globalAlpha = 1;
      const [fx, fy] = iso(cx + 0.3, cy - 3, 17);
      ellipse(g, fx, fy, 1, 1, "#e76f51");
      ellipse(g, fx + 0.8, fy - 0.8, 0.8, 0.8, "#f4a261");
      pendant(g, cx, cy, 31);
    },
  };
}

function sofaItems(f) {
  const x0 = f.x0 * T + 1;
  const x1 = (f.x1 + 1) * T - 1;
  const y0 = f.y0 * T;
  const y1 = f.y0 * T + 14;
  const fab = "#50707a";
  const n = 3;
  const inner0 = x0 + 4;
  const inner1 = x1 - 4;
  const cw = (inner1 - inner0) / n;
  const legs = (g, xs) => xs.forEach((lx) => box(g, lx, y1 - 2.5, 0, 1.2, 1.2, 2, "#2a2018", { edge: false }));
  return [
    {
      kind: "sofa",
      box: [x0, y0, x1 - 4, y1],
      vis: [x0, y0, 0, x1, y1, 18],
      shadows: [[[x0, y0, x1, y1], 1, 9], [[x0, y0, x1, y0 + 5], 0, 17]],
      draw(g) {
        legs(g, [x0 + 1, x1 - 2]);
        box(g, x0, y0, 2, x1 - x0, 5, 15, shade(fab, 0.95), { edge: 0.15 });
        box(g, x0, y0, 2, 4, y1 - y0, 9, fab, { edge: 0.2 });
        box(g, inner0, y0 + 5, 2, inner1 - inner0, y1 - y0 - 5, 4.2, shade(fab, 0.9), { edge: 0.1 });
        for (let i = 0; i < n; i++) {
          const cx = inner0 + i * cw;
          slab(g, cx + 0.3, y0 + 1.6, 9, cw - 0.6, 4, 8, 1.4, shade(fab, 1.05), shade(fab, 1.18));
          slab(g, cx + 0.3, y0 + 5.2, 6.2, cw - 0.6, y1 - y0 - 5.6, 2.6, 1.6, fab, shade(fab, 1.16));
        }
        // throw pillows
        box(g, inner0 + 2, y0 + 5, 9, 7, 2.2, 6.5, "#d9a441", { edge: 0.25 });
        box(g, inner1 - 9, y0 + 5, 9, 7, 2.2, 6.5, "#d9705b", { edge: 0.25 });
      },
    },
    {
      kind: "sofaArm",
      box: [x1 - 4, y0, x1, y1],
      vis: [x1 - 4, y0, 0, x1, y1, 12],
      draw(g) {
        box(g, x1 - 4, y0, 2, 4, y1 - y0, 9, fab, { edge: 0.2 });
      },
    },
  ];
}

function lampItem(f) {
  const cx = f.x0 * T + 8;
  const cy = f.y0 * T + 8;
  return {
    kind: "lamp",
    box: [cx - 3, cy - 3, cx + 3, cy + 3],
    vis: [cx - 6, cy - 6, 0, cx + 6, cy + 6, 34],
    shadows: [[[cx - 4, cy - 4, cx + 4, cy + 4], 22, 30]],
    lights: () => [{ x: cx, y: cy, z: 26, r: 46, color: "#ffd9a0", strength: 1, day: 0 }],
    draw(g) {
      for (const [dx, dy] of [[-3, -2], [3, -2], [0, 3.4]]) seg(g, [cx + dx, cy + dy, 0], [cx, cy, 20], "#6b4a33", 0.55);
      seg(g, [cx, cy, 20], [cx, cy, 24], "#2a2c31", 0.4);
      const [sx, sy] = iso(cx, cy, 23);
      g.beginPath();
      g.moveTo(sx - 3, sy - 7);
      g.lineTo(sx + 3, sy - 7);
      g.lineTo(sx + 4.6, sy);
      g.ellipse(sx, sy, 4.6, 2, 0, 0, Math.PI);
      g.closePath();
      g.fillStyle = lin(g, sx - 4.6, 0, sx + 4.6, 0, ["#fbf3e0", "#efe2c4", "#cdbd9b"]);
      g.fill();
      ellipse(g, sx, sy - 7, 3, 1.3, "#e9dcbd");
    },
  };
}

function tvItem(f) {
  const x0 = f.x0 * T + 4;
  const x1 = (f.x1 + 1) * T - 4;
  const y0 = f.y0 * T + 2;
  const y1 = f.y0 * T + 10;
  const cx = (x0 + x1) / 2;
  const sx0 = cx - 21;
  return {
    kind: "tv",
    box: [x0, y0, x1, y1],
    vis: [x0, y0, 0, x1, y1, 38],
    shadows: [[[x0, y0, x1, y1], 0, 8], [[sx0, y0 + 3, sx0 + 42, y0 + 4], 12, 36]],
    lights: () => [{ x: cx, y: y1 + 8, z: 22, r: 40, color: "#5cc8ff", strength: 0.6 }],
    draw(g) {
      const wood = "#5b4030";
      box(g, x0, y0, 1.5, x1 - x0, y1 - y0, 7, wood, {
        top: (t, w, d) => grain(t, w, d, shade(wood, 1.1), 9),
        left: (t, w, h) => {
          t.fillStyle = wood;
          t.fillRect(0, 0, w, h);
          for (let k = 0; k < 4; k++) {
            t.fillStyle = "rgba(0,0,0,0.25)";
            t.fillRect((k * w) / 4, 0, 0.3, h);
            t.fillStyle = "rgba(255,255,255,0.1)";
            t.fillRect((k * w) / 4 + w / 8 - 0.2, h / 2 - 1.5, 0.4, 3);
          }
        },
        edge: 0.25,
      });
      for (const lx of [x0 + 2, x1 - 3]) box(g, lx, y1 - 2, 0, 1, 1, 1.5, "#2a2018", { edge: false });
      // speaker bar, then the screen on a stand
      box(g, cx - 10, y0 + 5, 8.5, 20, 2.5, 1.5, "#1b1c20", { edge: 0.2 });
      box(g, cx - 1.5, y0 + 2.5, 8.5, 3, 1, 5, "#2a2c31", { edge: 0.2 });
      box(g, sx0, y0 + 3, 12, 42, 1, 24, "#101114", {
        left: (t, w, h) => {
          t.fillStyle = "#0c0d10";
          t.fillRect(0, 0, w, h);
          t.fillStyle = lin(t, 0, 0, w, h, ["rgba(255,255,255,0.08)", "rgba(255,255,255,0)"]);
          t.fillRect(0.6, 0.6, w - 1.2, h - 1.2);
        },
        edge: 0.35,
      });
    },
    anim(g, t) {
      onFaceY(g, y0 + 4.05, sx0 + 0.7, 12 + 24 - 0.7, (s) => {
        const w = 40.6;
        const h = 22.6;
        // a slow nature film: sky, sea, hills, drifting clouds
        s.fillStyle = lin(s, 0, 0, 0, h, ["#4a8fd6", "#a9d4f2", "#f4d8a8"]);
        s.fillRect(0, 0, w, h);
        ellipse(s, w * 0.72, h * 0.32, 2.4, 2.4, "#fff3c4");
        s.fillStyle = "#2f6f8f";
        s.fillRect(0, h * 0.62, w, h * 0.38);
        s.fillStyle = "rgba(255,255,255,0.35)";
        for (let k = 0; k < 6; k++) s.fillRect(((k * 7.3 + t * 2) % (w + 6)) - 3, h * 0.7 + (k % 3) * 2, 3, 0.3);
        s.fillStyle = "#3e6b3a";
        s.beginPath();
        s.moveTo(0, h * 0.64);
        for (let k = 0; k <= 10; k++) s.lineTo((k / 10) * w * 0.5, h * 0.64 - Math.sin(k * 0.8) * 3 - 2);
        s.lineTo(w * 0.5, h * 0.64);
        s.fill();
        for (let k = 0; k < 3; k++) {
          const cxk = ((k * 17 + t * 1.2) % (w + 12)) - 6;
          ellipse(s, cxk, h * (0.15 + k * 0.08), 3.5, 1, "rgba(255,255,255,0.8)");
          ellipse(s, cxk + 2, h * (0.15 + k * 0.08) - 0.6, 2.4, 1, "rgba(255,255,255,0.8)");
        }
      });
    },
  };
}

function coffeeTableItem(f) {
  const x0 = f.x0 * T + 2;
  const x1 = (f.x1 + 1) * T - 2;
  const y0 = f.y0 * T + 3;
  const y1 = (f.y1 + 1) * T - 3;
  const wood = "#6a4630";
  return {
    kind: "coffeeTable",
    box: [x0, y0, x1, y1],
    vis: [x0, y0, 0, x1, y1, 10],
    shadows: [[[x0, y0, x1, y1], 5, 7]],
    draw(g) {
      for (const [lx, ly] of [[x0 + 1, y0 + 1], [x1 - 2, y0 + 1], [x0 + 1, y1 - 2], [x1 - 2, y1 - 2]]) box(g, lx, ly, 0, 1, 1, 6, "#2a2c31", { edge: false });
      box(g, x0 + 1.5, y0 + 1.5, 2, x1 - x0 - 3, y1 - y0 - 3, 0.6, shade(wood, 0.9), { edge: 0.1 });
      slab(g, x0, y0, 6, x1 - x0, y1 - y0, 1.1, 2, wood, (t, w, d) => grain(t, w, d, wood, 12));
      box(g, x0 + 8, y0 + 3, 7.1, 9, 6, 0.9, "#2f5d8a", { edge: 0.3 });
      box(g, x0 + 8.5, y0 + 3.3, 8, 8, 5.5, 0.8, "#e8e0cc", { edge: 0.3 });
      cyl(g, x0 + 34, y0 + 6.5, 7.1, 3.2, 1.6, "#d8d3ca", "#c7a96b");
      for (let k = 0; k < 3; k++) disc(g, x0 + 33 + k * 1.2, y0 + 6 + (k % 2), 8.8, 0.9, k === 1 ? "#c0392b" : "#e9b44c");
      box(g, x0 + 22, y0 + 8, 7.1, 4, 1.4, 0.6, "#1d1f24", { edge: false });
    },
  };
}

function pingpongItem(f) {
  const x0 = f.x0 * T + 2;
  const x1 = (f.x1 + 1) * T - 2;
  const y0 = f.y0 * T + 3;
  const y1 = (f.y1 + 1) * T - 3;
  const Z = 12;
  const mid = (x0 + x1) / 2;
  return {
    kind: "pingpong",
    box: [x0, y0, x1, y1],
    vis: [x0, y0, 0, x1, y1, Z + 4],
    shadows: [[[x0, y0, x1, y1], Z - 1, Z]],
    draw(g) {
      for (const lx of [x0 + 8, x1 - 9]) {
        seg(g, [lx, y0 + 3, 0], [lx, y1 - 3, Z - 1], "#2a2c31", 0.7);
        seg(g, [lx, y1 - 3, 0], [lx, y0 + 3, Z - 1], "#2a2c31", 0.7);
      }
      box(g, x0, y0, Z - 0.8, x1 - x0, y1 - y0, 0.8, "#1d4f91", {
        top: (t, w, d) => {
          t.fillStyle = lin(t, 0, 0, w, d, ["#2462ad", "#1b4c8c"]);
          t.fillRect(0, 0, w, d);
          t.strokeStyle = "#f4f6f8";
          t.lineWidth = 0.5;
          t.strokeRect(0.4, 0.4, w - 0.8, d - 0.8);
          t.lineWidth = 0.25;
          t.beginPath();
          t.moveTo(0.4, d / 2);
          t.lineTo(w - 0.4, d / 2);
          t.stroke();
        },
        edge: 0.4,
      });
      onFaceX(g, mid, y1 + 1, Z + 3, (t) => {
        const w = y1 - y0 + 2;
        t.fillStyle = "rgba(30,30,35,0.55)";
        t.fillRect(0, 0, w, 3);
        t.fillStyle = "rgba(255,255,255,0.25)";
        for (let s = 0; s < w; s += 0.8) t.fillRect(s, 0, 0.12, 3);
        t.fillStyle = "#f4f6f8";
        t.fillRect(0, 0, w, 0.5);
        t.fillStyle = "#2a2c31";
        t.fillRect(0, 0, 0.8, 3.6);
        t.fillRect(w - 0.8, 0, 0.8, 3.6);
      });
    },
  };
}

function arcadeItems(f) {
  const out = [];
  const bodies = ["#26307a", "#7a1f42"];
  for (let i = 0; i <= f.x1 - f.x0; i++) {
    const x = (f.x0 + i) * T + 1.5;
    const y = f.y0 * T + 1;
    const body = bodies[i % 2];
    const Hh = 32;
    out.push({
      kind: "arcade",
      box: [x, y, x + 13, y + 13.5],
      vis: [x, y, 0, x + 13, y + 14, Hh],
      shadows: [[[x, y, x + 13, y + 11], 0, Hh]],
      lights: () => [{ x: x + 6.5, y: y + 15, z: 22, r: 26, color: i % 2 ? "#ff4fa3" : "#5c7cff", strength: 0.8 }],
      draw(g) {
        box(g, x, y, 0, 13, 11, Hh, body, {
          right: (t, w, h) => {
            t.fillStyle = shade(body, 0.62);
            t.fillRect(0, 0, w, h);
            t.fillStyle = shade(body, 0.85);
            t.beginPath();
            t.moveTo(0, h * 0.5);
            t.lineTo(w, h * 0.25);
            t.lineTo(w, h * 0.38);
            t.lineTo(0, h * 0.63);
            t.fill();
            t.fillStyle = "rgba(255,209,102,0.7)";
            t.beginPath();
            t.moveTo(0, h * 0.66);
            t.lineTo(w, h * 0.41);
            t.lineTo(w, h * 0.44);
            t.lineTo(0, h * 0.69);
            t.fill();
          },
          left: (t, w, h) => {
            t.fillStyle = shade(body, 0.8);
            t.fillRect(0, 0, w, h);
            t.fillStyle = "#121318";
            t.fillRect(1, 5.5, w - 2, 10);
            t.fillStyle = "#0a0b0e";
            t.fillRect(1.6, 6, w - 3.2, 9);
            // coin door
            fillRR(t, w / 2 - 3, h - 11, 6, 6, 0.4, shade(body, 0.6));
            t.fillStyle = "#e9c46a";
            t.fillRect(w / 2 - 1.7, h - 9.6, 0.5, 1.4);
            t.fillRect(w / 2 + 1.2, h - 9.6, 0.5, 1.4);
            t.fillStyle = "#16171c";
            t.fillRect(0, h - 1.5, w, 1.5);
          },
          edge: 0.3,
        });
        // control panel sticking out
        box(g, x + 0.5, y + 11, 14, 12, 2.5, 2, "#1a1b20", {
          top: (t, w, d) => {
            t.fillStyle = "#24252c";
            t.fillRect(0, 0, w, d);
            for (const [bx, c] of [[6.5, "#e63946"], [8.2, "#ffd166"], [9.9, "#43e08b"]]) ellipse(t, bx, d / 2, 0.6, 0.6, c);
          },
          edge: 0.3,
        });
        const [jx, jy] = iso(x + 3, y + 12.2, 16);
        g.strokeStyle = "#1a1b20";
        g.lineWidth = 0.4;
        g.beginPath();
        g.moveTo(jx, jy);
        g.lineTo(jx, jy - 2);
        g.stroke();
        ellipse(g, jx, jy - 2.2, 0.8, 0.8, "#e63946");
      },
      anim(g, t) {
        onFaceY(g, y + 11.02, x, Hh, (s) => {
          // marquee
          const pulse = 0.75 + Math.sin(t * 3 + i) * 0.25;
          s.fillStyle = i % 2 ? `rgba(255,79,163,${pulse})` : `rgba(92,124,255,${pulse})`;
          s.fillRect(1, 1, 11, 3.4);
          s.fillStyle = "#fff";
          s.font = "700 2.2px ui-sans-serif, system-ui, sans-serif";
          s.textAlign = "center";
          s.fillText(i % 2 ? "BLASTER" : "GALAXY", 6.5, 3.5);
          // the game
          s.fillStyle = "#05060a";
          s.fillRect(1.6, 6, 9.8, 9);
          for (let k = 0; k < 8; k++) {
            s.fillStyle = "rgba(255,255,255,0.7)";
            s.fillRect(1.8 + ((k * 3.7) % 9.4), 6.2 + ((k * 2.3 + t * 3) % 8.6), 0.25, 0.25);
          }
          const px = 6.5 + Math.sin(t * 2 + i) * 3.5;
          s.fillStyle = i % 2 ? "#ff4fa3" : "#43e08b";
          s.fillRect(px - 0.8, 13.6, 1.6, 0.8);
          for (let k = 0; k < 4; k++) {
            s.fillStyle = "#ffd166";
            s.fillRect(2.6 + k * 2.2 + Math.sin(t + k) * 0.5, 7.5 + Math.abs(Math.sin(t * 0.7)) * 1.5, 1.2, 0.8);
          }
        });
      },
    });
  }
  return out;
}

function beanbagItem(f) {
  const cx = f.x0 * T + 8;
  const cy = f.y0 * T + 8;
  const c = f.color;
  return {
    kind: "beanbag",
    box: [cx - 6, cy - 6, cx + 6, cy + 2],
    vis: [cx - 9, cy - 9, 0, cx + 9, cy + 9, 12],
    shadows: [[[cx - 6, cy - 6, cx + 6, cy + 6], 0, 4]],
    draw(g) {
      const [sx, sy] = iso(cx, cy, 0);
      const gr = g.createRadialGradient(sx - 3, sy - 8, 1, sx, sy - 4, 11);
      gr.addColorStop(0, shade(c, 1.3));
      gr.addColorStop(0.6, c);
      gr.addColorStop(1, shade(c, 0.6));
      g.beginPath();
      g.moveTo(sx - 9, sy - 1);
      g.bezierCurveTo(sx - 10, sy - 7, sx - 6, sy - 12, sx, sy - 11);
      g.bezierCurveTo(sx + 6, sy - 12, sx + 10, sy - 7, sx + 9, sy - 1);
      g.bezierCurveTo(sx + 7, sy + 3, sx - 7, sy + 3, sx - 9, sy - 1);
      g.fillStyle = gr;
      g.fill();
      ellipse(g, sx + 1, sy - 6, 4.5, 2, "rgba(0,0,0,0.16)");
      g.strokeStyle = "rgba(255,255,255,0.15)";
      g.lineWidth = 0.3;
      g.beginPath();
      g.moveTo(sx - 6, sy - 9);
      g.quadraticCurveTo(sx - 2, sy - 4, sx - 3, sy + 1);
      g.stroke();
    },
  };
}

export function itemsFor(f) {
  const made = (() => {
    switch (f.kind) {
      case "desk":
        return deskItem(f);
      case "chair":
        return chairItem(f);
      case "table":
        return tableItem(f);
      case "shelf":
        return shelfItem(f);
      case "whiteboard":
        return whiteboardItem(f);
      case "rack":
        return rackItem(f);
      case "plant":
        return plantItem(f);
      case "art":
        return artItem(f);
      case "clock":
        return clockItem(f);
      case "counter":
        return counterItem(f);
      case "cooler":
        return coolerItem(f);
      case "cafeTable":
        return cafeTableItem(f);
      case "sofa":
        return sofaItems(f);
      case "lamp":
        return lampItem(f);
      case "tv":
        return tvItem(f);
      case "coffeeTable":
        return coffeeTableItem(f);
      case "pingpong":
        return pingpongItem(f);
      case "arcade":
        return arcadeItems(f);
      case "beanbag":
        return beanbagItem(f);
      default:
        return null;
    }
  })();
  return [made].flat().filter(Boolean);
}
