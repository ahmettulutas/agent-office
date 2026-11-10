// People in the isometric view. Each person is a small 3D skeleton (feet,
// knees, hips, shoulders, elbows, hands, head) posed in world units, projected
// and drawn back to front, so walking, sitting, typing and waving look right
// from every direction.

import { TAU, shade, ellipse, fillRR } from "./floors.js";

export const SKIN = ["#f3d2b6", "#e8b994", "#d39c74", "#b07650", "#8a5839", "#5c3a27"];
export const HAIR = ["#2b1d14", "#4a2f1e", "#7a4b2a", "#a8743f", "#d6b26e", "#161616", "#8a8a8a", "#9c3b22"];
export const OUTFITS = ["blazer", "hoodie", "sweater", "tee", "shirt"];

const FACING = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };
const SHOE = "#202127";

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (v, k) => [v[0] * k, v[1] * k, v[2] * k];
const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

// c: { look, facing, pose, phase, typing, waving, holding, selected }
// sx, sy: the screen point of the feet. Returns the screen box and the head top.
export function drawPerson(ctx, c, t, sx, sy) {
  const L = c.look;
  const fv = FACING[c.facing] || FACING.down;
  const F = [fv[0], fv[1], 0]; // forward
  const R = [-fv[1], fv[0], 0]; // the person's right
  const U = [0, 0, 1];
  const P = (v) => [sx + v[0] - v[1], sy + (v[0] + v[1]) / 2 - v[2]];
  const depth = (v) => v[0] + v[1];
  const front = fv[0] + fv[1] > 0; // we see the face
  const rightNear = R[0] + R[1] > 0; // the person's right side is towards us

  const sit = c.pose === "sit";
  const walk = c.pose === "walk";
  const ph = t * 8.5 + c.phase;
  const stride = walk ? Math.sin(ph) : 0;
  const bob = walk ? Math.abs(Math.cos(ph)) * 0.55 : Math.sin(t * 1.7 + c.phase) * 0.12;

  // ---------- skeleton ----------
  const hipZ = sit ? 8.6 : 14.6 + bob;
  const hip = sit ? add(mul(F, -1.4), [0, 0, hipZ]) : [0, 0, hipZ];
  const lean = sit ? mul(F, c.typing ? 0.6 : -0.3) : [0, 0, 0];
  const torsoH = 9.4;
  const shoulder = add(add(hip, [0, 0, torsoH]), lean);
  const neck = add(shoulder, [0, 0, 1.1]);
  const head = add(shoulder, [0, 0, 3.9]);
  const hipW = 1.7;
  const shW = 3.6;

  const legs = [-1, 1].map((s) => {
    const h = add(hip, mul(R, s * hipW));
    let knee;
    let foot;
    if (sit) {
      knee = add(add(h, mul(F, 6.4)), [0, 0, 0.5]);
      foot = add(add(knee, mul(F, 0.8)), [0, 0, -(hipZ - 0.6) + 0.5]);
      foot[2] = 0.6;
    } else {
      const sw = s * stride * 3.1;
      const lift = walk ? Math.max(0, -s * Math.cos(ph)) * 1.4 : 0;
      foot = add(mul(R, s * 1.5), [F[0] * sw, F[1] * sw, 0.6 + lift]);
      knee = add(mix(h, foot, 0.5), add(mul(F, 0.9 + lift * 0.4), [0, 0, 0.3]));
    }
    return { s, h, knee, foot };
  });

  const arms = [-1, 1].map((s) => {
    const sh = add(shoulder, add(mul(R, s * shW), [0, 0, -0.6]));
    let elbow;
    let hand;
    if (c.waving && s === 1) {
      elbow = add(sh, add(mul(R, 1.8), [0, 0, 3.6]));
      hand = add(elbow, add(mul(R, Math.sin(t * 9) * 1.6), [0, 0, 4.4]));
    } else if (c.typing && (sit || c.holding == null || c.holding === "laptop")) {
      const jig = Math.sin(t * 15 + s * 2 + c.phase) * 0.35;
      elbow = add(sh, add(mul(F, 2.6), [0, 0, -4.6]));
      hand = add(add(sh, mul(F, 7.2)), add(mul(R, -s * 1.4), [0, 0, -5.2 + jig]));
    } else if (c.holding === "paper") {
      elbow = add(sh, add(mul(F, 2), [0, 0, -4.6]));
      hand = add(add(sh, mul(F, 5.2)), add(mul(R, -s * 1.6), [0, 0, -4.2]));
    } else if (c.holding === "coffee" && s === 1) {
      elbow = add(sh, add(mul(F, 0.8), [0, 0, -4.8]));
      hand = add(add(sh, mul(F, 3.8)), [0, 0, -3.6]);
    } else if (c.holding === "paddle" && s === 1) {
      elbow = add(sh, add(mul(F, 2), add(mul(R, 1.4), [0, 0, -3.4])));
      hand = add(add(sh, mul(F, 4.6)), add(mul(R, 2.6), [0, 0, -3 + Math.sin(t * 3) * 1.2]));
    } else {
      const sw = walk ? -s * stride * 2.4 : 0;
      elbow = add(sh, add(mul(F, sw * 0.5), add(mul(R, s * 0.4), [0, 0, -5])));
      hand = add(elbow, add(mul(F, sw * 0.8 + (sit ? 2.6 : 0.4)), [0, 0, sit ? -2.2 : -4.6]));
    }
    return { s, sh, elbow, hand };
  });

  const topZ = head[2] + 3.3 + (L.style === 2 ? 1.6 : L.style === 4 ? 0.7 : 0);

  // ---------- ground: shadow and selection ----------
  const [gx, gy] = P([0, 0, 0]);
  const sh = ctx.createRadialGradient(gx + 1.5, gy + 0.8, 0, gx + 1.5, gy + 0.8, sit ? 6 : 7);
  sh.addColorStop(0, "rgba(10,12,20,0.38)");
  sh.addColorStop(1, "rgba(10,12,20,0)");
  ctx.save();
  ctx.translate(gx + 1.5, gy + 0.8);
  ctx.scale(1, 0.5);
  ctx.translate(-(gx + 1.5), -(gy + 0.8));
  ctx.fillStyle = sh;
  ctx.beginPath();
  ctx.arc(gx + 1.5, gy + 0.8, sit ? 6 : 7, 0, TAU);
  ctx.fill();
  ctx.restore();
  if (c.selected) {
    ctx.beginPath();
    ctx.ellipse(gx, gy, 9, 4.5, 0, 0, TAU);
    ctx.strokeStyle = "rgba(255,209,102,0.95)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(gx, gy, 10.5, 5.25, 0, 0, TAU);
    ctx.strokeStyle = "rgba(255,209,102,0.3)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  // ---------- parts, back to front ----------
  const parts = [];
  const limb = (pts, w, color, edge) => {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(...P(p)) : ctx.moveTo(...P(p))));
    ctx.strokeStyle = shade(color, 0.72);
    ctx.lineWidth = w + 0.35;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.stroke();
    if (edge) {
      ctx.save();
      ctx.translate(-w * 0.22, -w * 0.12);
      ctx.strokeStyle = shade(color, 1.18);
      ctx.lineWidth = w * 0.35;
      ctx.stroke();
      ctx.restore();
    }
  };

  const pants = L.pants;
  for (const lg of legs) {
    parts.push({
      d: depth(mix(lg.h, lg.foot, 0.5)) - 0.4,
      draw() {
        const h = add(lg.h, [0, 0, 0.6]);
        limb([h, lg.knee, add(lg.foot, [0, 0, 0.9])], 2.5, pants, true);
        // shoe
        const toe = add(lg.foot, mul(F, 1.3));
        const heel = add(lg.foot, mul(F, -0.6));
        limb([heel, toe], 1.7, SHOE, false);
        ctx.strokeStyle = "rgba(255,255,255,0.18)";
        ctx.lineWidth = 0.3;
        ctx.beginPath();
        ctx.moveTo(...P(add(heel, [0, 0, 0.5])));
        ctx.lineTo(...P(add(toe, [0, 0, 0.5])));
        ctx.stroke();
      },
    });
  }

  const sleeve = L.top;
  const forearm = L.outfit === "tee" ? L.skin : L.top;
  for (const a of arms) {
    parts.push({
      d: depth(mix(a.sh, a.hand, 0.6)) + (front ? 0.05 : -0.05),
      draw() {
        limb([a.sh, a.elbow], 2.05, sleeve, true);
        if (L.outfit === "tee") {
          limb([mix(a.sh, a.elbow, 0.55), a.elbow, a.hand], 1.55, forearm, true);
        } else {
          limb([a.elbow, mix(a.elbow, a.hand, 0.82)], 1.8, forearm, true);
          if (L.outfit === "shirt" || L.outfit === "blazer") limb([mix(a.elbow, a.hand, 0.8), mix(a.elbow, a.hand, 0.86)], 1.5, L.outfit === "blazer" ? "#f2f2f0" : shade(L.top, 0.9), false);
        }
        const [hx, hy] = P(a.hand);
        ellipse(ctx, hx, hy, 0.95, 0.95, L.skin);
        ellipse(ctx, hx - 0.25, hy - 0.3, 0.45, 0.4, shade(L.skin, 1.12));
        // held things
        if (a.s === 1 && c.holding === "coffee") {
          const cup = add(a.hand, [0, 0, 0.4]);
          const [cx, cy] = P(cup);
          fillRR(ctx, cx - 0.9, cy - 2.4, 1.8, 2.6, 0.3, "#f7f7f4");
          ctx.fillStyle = "#b5462e";
          ctx.fillRect(cx - 0.9, cy - 1.6, 1.8, 0.7);
          ellipse(ctx, cx, cy - 2.4, 0.9, 0.35, "#5a3a22");
          for (let k = 0; k < 2; k++) {
            const st = (t * 0.8 + k * 0.5) % 1;
            ellipse(ctx, cx + Math.sin(st * 6 + k) * 0.5, cy - 3 - st * 4, 0.4 + st * 0.5, 0.4 + st * 0.5, `rgba(255,255,255,${0.3 * (1 - st)})`);
          }
        }
        if (a.s === 1 && c.holding === "paddle") {
          const [px, py] = P(add(a.hand, add(mul(F, 1.4), [0, 0, 1.2])));
          ellipse(ctx, px, py, 1.7, 2, "#b8322a");
          ellipse(ctx, px - 0.3, py - 0.4, 1.1, 1.3, "#d64a3f");
        }
      },
    });
  }

  // torso: a short extruded shape, front or back panel plus the near side
  const T0 = add(hip, [0, 0, 0]);
  const torsoPart = {
    d: 0,
    draw() {
      const half = 1.35; // chest depth / 2
      const corner = (s, z, k, f) => add(add(add(T0, mul(R, s * k)), [0, 0, z]), mul(F, f * half));
      const outline = (f) => [corner(-1, 0, hipW + 1.4, f), corner(1, 0, hipW + 1.4, f), corner(1, torsoH - 0.7 + lean[2], shW + 0.6, f), corner(0.55, torsoH + 0.3, shW, f), corner(-0.55, torsoH + 0.3, shW, f), corner(-1, torsoH - 0.7, shW + 0.6, f)].map((p) => add(p, mul(lean, p[2] > hipZ + 3 ? 1 : 0.3)));
      const body = L.top;
      // the side that faces us
      const sideS = rightNear ? 1 : -1;
      const back = outline(-1);
      const fr = outline(1);
      const sideIdx = sideS > 0 ? [1, 2] : [0, 5];
      const side = [fr[sideIdx[0]], fr[sideIdx[1]], back[sideIdx[1]], back[sideIdx[0]]];
      const fill = (pts, color) => {
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(...P(p)) : ctx.moveTo(...P(p))));
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.1;
        ctx.lineJoin = "round";
        ctx.fill();
        ctx.stroke();
      };
      fill(side, shade(body, 0.7));
      const panel = front ? fr : back;
      const [ax, ay] = P(panel[0]);
      const [bx, by] = P(panel[3]);
      const g = ctx.createLinearGradient(ax - 3, by, ax + 4, ay);
      g.addColorStop(0, shade(body, 1.12));
      g.addColorStop(1, shade(body, 0.86));
      fill(panel, g);
      clothes(panel, front);
    },
  };
  parts.push(torsoPart);

  // details on the front or back panel, in panel coordinates (u across, z up)
  function clothes(panel, isFront) {
    const pf = (u, z) => add(add(add(T0, mul(R, u)), [0, 0, z]), add(mul(F, (isFront ? 1 : -1) * 1.36), mul(lean, z > 3 ? 1 : 0.3)));
    const poly = (pts, color) => {
      ctx.beginPath();
      pts.forEach(([u, z], i) => (i ? ctx.lineTo(...P(pf(u, z))) : ctx.moveTo(...P(pf(u, z)))));
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    };
    const ln = (pts, color, w = 0.25) => {
      ctx.beginPath();
      pts.forEach(([u, z], i) => (i ? ctx.lineTo(...P(pf(u, z))) : ctx.moveTo(...P(pf(u, z)))));
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.stroke();
    };
    const top = torsoH + 0.3;
    if (!isFront) {
      if (L.outfit === "hoodie") poly([[-2.2, top], [2.2, top], [1.6, top - 2.6], [-1.6, top - 2.6]], shade(L.top, 0.82));
      if (L.outfit === "blazer") ln([[0, top - 3.5], [0, 0.6]], shade(L.top, 0.75), 0.25);
      ln([[-hipW - 1.2, 0.9], [hipW + 1.2, 0.9]], shade(L.pants, 0.7), 0.5);
      return;
    }
    // belt line
    if (L.outfit !== "hoodie" && L.outfit !== "sweater") ln([[-hipW - 1.2, 0.9], [hipW + 1.2, 0.9]], "#2a2522", 0.55);
    if (L.outfit === "blazer") {
      poly([[-1.5, top], [1.5, top], [0, top - 5]], "#f4f3ef");
      poly([[-0.35, top - 0.4], [0.35, top - 0.4], [0.55, top - 5.3], [0, top - 6.2], [-0.55, top - 5.3]], L.tie || "#c0392b");
      ln([[-1.6, top], [-0.2, top - 5.4], [-0.4, 1.2]], shade(L.top, 0.62), 0.35);
      ln([[1.6, top], [0.2, top - 5.4], [0.4, 1.2]], shade(L.top, 0.62), 0.35);
      for (const z of [2.6, 4.2]) {
        const [bx, by] = P(pf(0.55, z));
        ellipse(ctx, bx, by, 0.28, 0.28, shade(L.top, 0.6));
      }
    } else if (L.outfit === "hoodie") {
      poly([[-2.4, top + 0.2], [2.4, top + 0.2], [1.2, top - 1.4], [-1.2, top - 1.4]], shade(L.top, 0.78));
      poly([[-2.2, 3.4], [2.2, 3.4], [2.6, 1.2], [-2.6, 1.2]], shade(L.top, 0.88));
      ln([[-0.6, top - 1.2], [-0.7, top - 3.6]], "#f2f2f0", 0.22);
      ln([[0.6, top - 1.2], [0.7, top - 3.6]], "#f2f2f0", 0.22);
    } else if (L.outfit === "sweater") {
      ln([[-1.4, top - 0.2], [0, top - 1.2], [1.4, top - 0.2]], shade(L.top, 0.7), 0.5);
      ln([[-hipW - 1.3, 1], [hipW + 1.3, 1]], shade(L.top, 0.75), 0.9);
      for (let u = -3; u <= 3; u += 1.2) ln([[u, top - 2.6], [u, 2]], "rgba(0,0,0,0.06)", 0.3);
    } else if (L.outfit === "tee") {
      ln([[-1.3, top - 0.1], [0, top - 1.1], [1.3, top - 0.1]], shade(L.top, 0.7), 0.4);
      const [lx, ly] = P(pf(-1.2, top - 3.2));
      ellipse(ctx, lx, ly, 0.9, 0.6, "rgba(255,255,255,0.55)");
    } else if (L.outfit === "shirt") {
      poly([[-1.5, top + 0.1], [0, top - 1.4], [-0.5, top - 0.1]], shade(L.top, 1.2));
      poly([[1.5, top + 0.1], [0, top - 1.4], [0.5, top - 0.1]], shade(L.top, 1.2));
      ln([[0, top - 1.4], [0, 1.2]], shade(L.top, 0.78), 0.25);
      for (let z = 2; z < top - 2; z += 1.8) {
        const [bx, by] = P(pf(0.05, z));
        ellipse(ctx, bx, by, 0.2, 0.2, "#f6f6f2");
      }
    }
    if (L.badge) {
      ln([[-1, top - 0.6], [-1.7, top - 4.6]], "#2f3a4f", 0.25);
      ln([[1, top - 0.6], [-1.3, top - 4.6]], "#2f3a4f", 0.25);
      poly([[-2.4, top - 4.6], [-0.6, top - 4.6], [-0.6, top - 6.8], [-2.4, top - 6.8]], L.badge);
      poly([[-2.1, top - 5.2], [-0.9, top - 5.2], [-0.9, top - 5.6], [-2.1, top - 5.6]], "rgba(0,0,0,0.35)");
    }
  }

  // long hair falls behind the back
  if (L.style === 3) {
    parts.push({
      d: front ? -0.9 : 0.9,
      draw() {
        const a = P(add(head, add(mul(R, -2.4), [0, 0, 0.5])));
        const b = P(add(head, add(mul(R, 2.4), [0, 0, 0.5])));
        const c2 = P(add(shoulder, add(mul(R, 2.6), add(mul(F, -1), [0, 0, -3.6]))));
        const d2 = P(add(shoulder, add(mul(R, -2.6), add(mul(F, -1), [0, 0, -3.6]))));
        ctx.beginPath();
        ctx.moveTo(...a);
        ctx.lineTo(...b);
        ctx.quadraticCurveTo(b[0] + 0.6, (b[1] + c2[1]) / 2, ...c2);
        ctx.lineTo(...d2);
        ctx.quadraticCurveTo(a[0] - 0.6, (a[1] + d2[1]) / 2, ...a);
        ctx.fillStyle = shade(L.hair, 0.85);
        ctx.fill();
      },
    });
  }

  // neck and head
  parts.push({
    d: 0.02,
    draw() {
      const [nx, ny] = P(neck);
      fillRR(ctx, nx - 0.85, ny - 0.4, 1.7, 1.6, 0.6, shade(L.skin, 0.82));
      drawHead();
    },
  });

  function drawHead() {
    const [hx, hy] = P(head);
    const rx = 2.25;
    const ry = 2.7;
    // the ear on the side we see
    const earS = rightNear ? 1 : -1;
    const [ex, ey] = P(add(head, add(mul(R, earS * 2.15), add(mul(F, front ? -0.3 : 0.3), [0, 0, -0.2]))));
    const hairBack = L.style === 5 ? shade(L.hair, 1.05) : L.hair;
    // hair behind the head (seen from the front)
    if (front && L.style !== 5) {
      const [bx, by] = P(add(head, add(mul(F, -0.9), [0, 0, 0.3])));
      ellipse(ctx, bx, by, rx + 0.45, ry + 0.25, shade(L.hair, 0.8));
      if (L.style === 2) {
        const [kx, ky] = P(add(head, add(mul(F, -1.6), [0, 0, 2.6])));
        ellipse(ctx, kx, ky, 1.35, 1.25, shade(L.hair, 0.9));
      }
    }
    const g = ctx.createRadialGradient(hx - 0.9, hy - 1.1, 0.3, hx, hy, ry + 0.6);
    g.addColorStop(0, shade(L.skin, 1.12));
    g.addColorStop(1, shade(L.skin, 0.84));
    ellipse(ctx, hx, hy, rx, ry, g);
    ellipse(ctx, ex, ey, 0.55, 0.8, shade(L.skin, 0.9));

    if (front) {
      // face, turned towards F
      const eye = (s) => P(add(head, add(mul(F, 1.95), add(mul(R, s * 0.95), [0, 0, 0.35]))));
      const blink = (t * 0.6 + c.phase) % 4.2 < 0.12;
      for (const s of [-1, 1]) {
        const [x, y] = eye(s);
        if (blink) {
          ctx.fillStyle = "#3a2a22";
          ctx.fillRect(x - 0.35, y, 0.7, 0.14);
        } else {
          ellipse(ctx, x, y, 0.42, 0.34, "#fbfbfb");
          ellipse(ctx, x + (F[0] - F[1]) * 0.08, y, 0.24, 0.27, "#2a211d");
        }
        const [bx, by] = P(add(head, add(mul(F, 1.95), add(mul(R, s * 0.95), [0, 0, 1.05]))));
        ctx.strokeStyle = shade(L.hair, 0.8);
        ctx.lineWidth = 0.22;
        ctx.beginPath();
        ctx.moveTo(bx - 0.45, by + 0.05);
        ctx.lineTo(bx + 0.45, by - 0.05);
        ctx.stroke();
      }
      if (L.glasses) {
        ctx.strokeStyle = "#1f2024";
        ctx.lineWidth = 0.2;
        for (const s of [-1, 1]) {
          const [x, y] = eye(s);
          ctx.strokeRect(x - 0.62, y - 0.42, 1.24, 0.86);
        }
        const [a1, b1] = eye(-1);
        const [a2, b2] = eye(1);
        ctx.beginPath();
        ctx.moveTo(Math.min(a1, a2) + 0.62, (b1 + b2) / 2);
        ctx.lineTo(Math.max(a1, a2) - 0.62, (b1 + b2) / 2);
        ctx.stroke();
      }
      const [nx, ny] = P(add(head, add(mul(F, 2.3), [0, 0, -0.45])));
      ellipse(ctx, nx + 0.15, ny + 0.1, 0.32, 0.25, shade(L.skin, 0.78));
      const [m1x, m1y] = P(add(head, add(mul(F, 2.05), add(mul(R, -0.5), [0, 0, -1.25]))));
      const [m2x, m2y] = P(add(head, add(mul(F, 2.05), add(mul(R, 0.5), [0, 0, -1.25]))));
      ctx.strokeStyle = "#8a4a3f";
      ctx.lineWidth = 0.26;
      ctx.beginPath();
      ctx.moveTo(m1x, m1y);
      ctx.quadraticCurveTo((m1x + m2x) / 2, (m1y + m2y) / 2 + 0.25, m2x, m2y);
      ctx.stroke();
      for (const s of [-1, 1]) {
        const [cx, cy] = P(add(head, add(mul(F, 1.7), add(mul(R, s * 1.35), [0, 0, -0.6]))));
        ellipse(ctx, cx, cy, 0.5, 0.3, "rgba(220,110,100,0.16)");
      }
    }

    // hair on top
    ctx.save();
    const capF = front ? -0.85 : 0.35;
    const [cx, cy] = P(add(head, add(mul(F, capF), [0, 0, front ? 1.05 : 0.45])));
    const hg = ctx.createRadialGradient(cx - 1, cy - 1.6, 0.2, cx, cy, 3.6);
    hg.addColorStop(0, shade(L.hair, 1.3));
    hg.addColorStop(1, shade(L.hair, 0.82));
    if (L.style === 4) {
      // curls
      for (let k = 0; k < 11; k++) {
        const a = (k / 11) * TAU;
        const px = cx + Math.cos(a) * 1.9;
        const py = cy - 0.4 + Math.sin(a) * (front ? 1.3 : 2);
        if (front && Math.sin(a) > 0.55 && Math.abs(Math.cos(a)) < 0.6) continue;
        ellipse(ctx, px, py, 1.05, 1.05, hg);
      }
      ellipse(ctx, cx, cy - 0.6, 1.9, front ? 1.3 : 2.1, hg);
    } else {
      const ry2 = front ? 2.15 : 2.95;
      const alpha = L.style === 5 ? 0.75 : 1;
      ctx.globalAlpha = alpha;
      ellipse(ctx, cx, cy, rx + 0.3, ry2, hg);
      ctx.globalAlpha = 1;
      if (front && L.style === 1) {
        // side part sweeping over the forehead
        const [fx, fy] = P(add(head, add(mul(F, 1.2), add(mul(R, -0.7), [0, 0, 1.9]))));
        ellipse(ctx, fx, fy, 1.5, 0.8, shade(L.hair, 1.05));
      }
      if (front && L.style === 0) {
        const [fx, fy] = P(add(head, add(mul(F, 1.3), [0, 0, 2.05])));
        ellipse(ctx, fx, fy, 1.6, 0.55, shade(L.hair, 0.95));
      }
      if (!front && L.style === 2) {
        const [kx, ky] = P(add(head, add(mul(F, -1.6), [0, 0, 2.6])));
        ellipse(ctx, kx, ky, 1.4, 1.3, hairBack);
      }
      if (L.style === 3 && front) {
        for (const s of [-1, 1]) {
          const [lx, ly] = P(add(head, add(mul(R, s * 2.2), add(mul(F, 0.2), [0, 0, -0.8]))));
          ellipse(ctx, lx, ly, 0.75, 2.3, shade(L.hair, 0.95));
        }
      }
    }
    // a soft shine
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 0.35;
    ctx.beginPath();
    ctx.arc(cx - 0.3, cy + 0.4, 1.9, Math.PI * 1.15, Math.PI * 1.55);
    ctx.stroke();
    ctx.restore();
  }

  parts.sort((a, b) => a.d - b.d);
  for (const p of parts) p.draw();

  // working standing up: a laptop on the forearms
  if (c.holding === "laptop" && c.typing && !sit) {
    const mid = add(mix(arms[0].hand, arms[1].hand, 0.5), add(mul(F, 0.6), [0, 0, -0.5]));
    const q = (pts, fill) => {
      ctx.beginPath();
      pts.forEach((v, i) => (i ? ctx.lineTo(...P(v)) : ctx.moveTo(...P(v))));
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };
    const half = mul(R, 2.6);
    const near = mul(F, -1.6);
    const far = mul(F, 1.9);
    const base = [add(add(mid, near), mul(half, -1)), add(add(mid, near), half), add(add(mid, far), half), add(add(mid, far), mul(half, -1))];
    const up = [0, 0, 3.4];
    const lid = [base[3], base[2], add(add(base[2], up), mul(F, 0.5)), add(add(base[3], up), mul(F, 0.5))];
    q(base, "#5d6472");
    q(lid, front ? "#474e5b" : "#1d2a3c");
    if (!front) {
      // we look at the screen
      const inset = (v, k) => mix(mix(lid[0], lid[2], 0.5), v, k);
      q(lid.map((v) => inset(v, 0.82)), "#2c5d8f");
    } else {
      const [lx, ly] = P(mix(lid[0], lid[2], 0.5));
      ellipse(ctx, lx, ly, 0.5, 0.6, "rgba(255,255,255,0.55)");
    }
  }

  // paper held in front
  if (c.holding === "paper") {
    const a = arms[0].hand;
    const b = arms[1].hand;
    const mid = mix(a, b, 0.5);
    const corners = [add(mid, add(mul(R, -2), [0, 0, 3])), add(mid, add(mul(R, 2), [0, 0, 3])), add(mid, add(mul(R, 2), [0, 0, -1])), add(mid, add(mul(R, -2), [0, 0, -1]))].map((p) => add(p, mul(F, 0.6)));
    ctx.beginPath();
    corners.forEach((p, i) => (i ? ctx.lineTo(...P(p)) : ctx.moveTo(...P(p))));
    ctx.closePath();
    ctx.fillStyle = front ? "#ffffff" : "#e9eef5";
    ctx.fill();
    ctx.strokeStyle = "rgba(80,100,140,0.45)";
    ctx.lineWidth = 0.2;
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.moveTo(...P(add(mix(corners[0], corners[3], 0.2 + k * 0.18), mul(R, 0.5))));
      ctx.lineTo(...P(add(mix(corners[1], corners[2], 0.2 + k * 0.18), mul(R, -0.8))));
      ctx.stroke();
    }
    for (const h of [a, b]) {
      const [hx, hy] = P(add(h, mul(F, 0.7)));
      ellipse(ctx, hx, hy, 0.95, 0.95, L.skin);
    }
  }

  return { x: sx - 8, y: sy - topZ - 2, w: 16, h: topZ + 5, head: sy - topZ };
}

// ---------- status marks over heads ----------
export function drawStatus(ctx, kind, x, y, t) {
  ctx.save();
  ctx.translate(x, y);
  if (kind === "busy") {
    fillRR(ctx, -5, -3, 10, 6, 3, "rgba(18,22,34,0.82)");
    for (let i = 0; i < 3; i++) {
      const k = (Math.sin(t * 6 - i * 0.9) + 1) / 2;
      ellipse(ctx, -2.5 + i * 2.5, 0 - k * 0.8, 0.8, 0.8, `rgba(67,224,139,${0.45 + k * 0.55})`);
    }
  } else if (kind === "alert") {
    const b = Math.abs(Math.sin(t * 4)) * 1.5;
    const pulse = (t * 1.5) % 1;
    ctx.beginPath();
    ctx.arc(0, -b, 4 + pulse * 5, 0, TAU);
    ctx.strokeStyle = `rgba(255,93,93,${0.6 * (1 - pulse)})`;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ellipse(ctx, 0, -b, 4, 4, "#ff4d4d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(-0.6, -b - 2.6, 1.2, 3.2);
    ctx.fillRect(-0.6, -b + 1.2, 1.2, 1.1);
  } else if (kind === "check") {
    ellipse(ctx, 0, 0, 4, 4, "#2ecc71");
    ctx.beginPath();
    ctx.moveTo(-1.8, 0);
    ctx.lineTo(-0.4, 1.4);
    ctx.lineTo(2, -1.4);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 0.9;
    ctx.stroke();
  } else if (kind === "zzz") {
    ctx.font = "700 4px ui-sans-serif, system-ui, sans-serif";
    for (let i = 0; i < 3; i++) {
      const k = (t * 0.5 + i / 3) % 1;
      ctx.fillStyle = `rgba(230,235,255,${(1 - k) * 0.9})`;
      ctx.fillText("z", 2 + k * 4, -k * 7);
    }
  }
  ctx.restore();
}

export function drawBall(ctx, x, y, groundY) {
  ellipse(ctx, x + 1, groundY, 1.4, 0.6, "rgba(10,12,20,0.3)");
  const g = ctx.createRadialGradient(x - 0.3, y - 0.3, 0.1, x, y, 0.9);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(1, "#e9e2d0");
  ellipse(ctx, x, y, 0.9, 0.9, g);
}

