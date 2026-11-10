// The camera: zoom 1 fits the whole office, cx, cy is the screen (iso) point
// in the middle of the view. Other modules listen for view changes.

import { IW, IH } from "./iso.js";
import { ui } from "./ui.js";

export const W = IW;
export const H = IH;
export const MAX_ZOOM = 8;
export const stage = document.getElementById("stage");
export const canvas = document.getElementById("office");

export const cam = { zoom: 1, cx: W / 2, cy: H / 2 };
export const view = { scale: 1, ox: 0, oy: 0, dpr: 1, w: 0, h: 0 };

const listeners = [];
export const onView = (fn) => listeners.push(fn);

export function updateView() {
  const fit = Math.min(view.w / W, view.h / H);
  const scale = fit * cam.zoom;
  // keep the office on screen
  const halfW = view.w / 2 / scale;
  const halfH = view.h / 2 / scale;
  cam.cx = halfW * 2 >= W ? W / 2 : Math.min(W - halfW, Math.max(halfW, cam.cx));
  cam.cy = halfH * 2 >= H ? H / 2 : Math.min(H - halfH, Math.max(halfH, cam.cy));
  view.scale = scale;
  view.ox = view.w / 2 - cam.cx * scale;
  view.oy = view.h / 2 - cam.cy * scale;
  for (const fn of listeners) fn();
}

function resize() {
  const r = stage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  canvas.style.width = `${r.width}px`;
  canvas.style.height = `${r.height}px`;
  view.dpr = dpr;
  view.w = r.width;
  view.h = r.height;
  updateView();
}
new ResizeObserver(resize).observe(stage);
resize();

// zoom by factor, keeping the point under (sx, sy) where it is
export function zoomAt(factor, sx = view.w / 2, sy = view.h / 2) {
  const bx = (sx - view.ox) / view.scale;
  const by = (sy - view.oy) / view.scale;
  cam.zoom = Math.min(MAX_ZOOM, Math.max(1, cam.zoom * factor));
  const scale = Math.min(view.w / W, view.h / H) * cam.zoom;
  cam.cx = bx - (sx - view.w / 2) / scale;
  cam.cy = by - (sy - view.h / 2) / scale;
  updateView();
}

export function panBy(dx, dy) {
  cam.cx -= dx / view.scale;
  cam.cy -= dy / view.scale;
  updateView();
}

export function resetCamera() {
  cam.zoom = 1;
  cam.cx = W / 2;
  cam.cy = H / 2;
  ui.following = null;
  updateView();
}

export function lookAt(x, y, zoom = cam.zoom) {
  cam.zoom = zoom;
  cam.cx = x;
  cam.cy = y;
  updateView();
}

export function follow(key) {
  ui.following = key;
  if (cam.zoom < 3.5) cam.zoom = 3.5;
}

export const toScreen = (x, y) => [view.ox + x * view.scale, view.oy + y * view.scale];
export const toWorld = (sx, sy) => [(sx - view.ox) / view.scale, (sy - view.oy) / view.scale];
