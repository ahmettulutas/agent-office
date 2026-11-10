// Mouse, touch and keys. Pointer events cover mouse, pen and fingers: drag to
// pan, pinch (or a trackpad pinch) to zoom, tap or click to select, double tap
// or double click to zoom in.

import { canvas, stage, cam, zoomAt, panBy, resetCamera, follow, toWorld, MAX_ZOOM } from "./camera.js";
import { walkers } from "./office.js";
import { boxes, cycleLight, lightMode } from "./render.js";
import { describe, select, renderSide } from "./panel.js";
import { toggleSound, openSettings, settingsOpen } from "./settings.js";
import { ui } from "./ui.js";

const tip = document.getElementById("tip");

// who is under this screen point: the one nearest the viewer wins
function hit(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  const [x, y] = toWorld(clientX - r.left, clientY - r.top);
  let found = null;
  let best = -Infinity;
  for (const [key, b] of boxes) {
    const w = walkers.get(key);
    if (!w) continue;
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h && w.px + w.py > best) {
      found = key;
      best = w.px + w.py;
    }
  }
  return found;
}

function showTip(ev) {
  ui.hoverKey = hit(ev.clientX, ev.clientY);
  canvas.style.cursor = ui.hoverKey ? "pointer" : "default";
  const w = ui.hoverKey && walkers.get(ui.hoverKey);
  if (!w) {
    tip.hidden = true;
    return;
  }
  tip.hidden = false;
  tip.replaceChildren(...describe(w, true));
  const r = stage.getBoundingClientRect();
  const left = Math.min(ev.clientX - r.left + 14, r.width - tip.offsetWidth - 8);
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${ev.clientY - r.top + 14}px`;
}

// ---------- pointers ----------
const pointers = new Map(); // id -> last client point
let gesture = null; // { moved, startX, startY, dist, midX, midY }
let lastTap = { t: 0, x: 0, y: 0 };
const local = (x, y) => {
  const r = canvas.getBoundingClientRect();
  return [x - r.left, y - r.top];
};
function pinchState() {
  const [a, b] = [...pointers.values()];
  return { dist: Math.hypot(a.x - b.x, a.y - b.y), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
}

canvas.addEventListener("pointerdown", (ev) => {
  if (ev.pointerType === "mouse" && ev.button !== 0) return;
  try {
    canvas.setPointerCapture(ev.pointerId);
  } catch {
    /* a pointer the browser no longer knows */
  }
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pointers.size === 1) gesture = { moved: false, startX: ev.clientX, startY: ev.clientY };
  else if (pointers.size === 2) gesture = { ...gesture, moved: true, ...pinchState() };
  tip.hidden = true;
});

canvas.addEventListener("pointermove", (ev) => {
  const p = pointers.get(ev.pointerId);
  if (!p) {
    if (ev.pointerType === "mouse") showTip(ev);
    return;
  }
  const dx = ev.clientX - p.x;
  const dy = ev.clientY - p.y;
  p.x = ev.clientX;
  p.y = ev.clientY;
  if (pointers.size >= 2) {
    // pinch: zoom around the middle of the fingers, and move with it
    const now = pinchState();
    const [mx, my] = local(now.midX, now.midY);
    if (gesture.dist > 0) zoomAt(now.dist / gesture.dist, mx, my);
    panBy(now.midX - gesture.midX, now.midY - gesture.midY);
    Object.assign(gesture, now);
    ui.following = null;
    return;
  }
  if (!gesture.moved && Math.hypot(ev.clientX - gesture.startX, ev.clientY - gesture.startY) > 5) gesture.moved = true;
  if (gesture.moved) {
    ui.following = null;
    panBy(dx, dy);
    canvas.style.cursor = "grabbing";
  }
});

function endPointer(ev) {
  if (!pointers.has(ev.pointerId)) return;
  pointers.delete(ev.pointerId);
  if (pointers.size === 1) {
    // one finger left after a pinch: carry on as a drag from here
    const [q] = [...pointers.values()];
    gesture = { moved: true, startX: q.x, startY: q.y };
    return;
  }
  if (pointers.size > 0) return;
  canvas.style.cursor = "default";
  const tapped = gesture && !gesture.moved && ev.type === "pointerup";
  gesture = null;
  if (!tapped) return;
  // a tap or click selects; a second one close by zooms in
  const t = performance.now();
  const double = t - lastTap.t < 320 && Math.hypot(ev.clientX - lastTap.x, ev.clientY - lastTap.y) < 24;
  lastTap = { t: double ? 0 : t, x: ev.clientX, y: ev.clientY };
  if (double) {
    const [x, y] = local(ev.clientX, ev.clientY);
    if (cam.zoom >= MAX_ZOOM - 0.1) resetCamera();
    else zoomAt(2, x, y);
    return;
  }
  select(hit(ev.clientX, ev.clientY));
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("pointerleave", (ev) => {
  if (ev.pointerType !== "mouse" || pointers.size) return;
  ui.hoverKey = null;
  tip.hidden = true;
});

canvas.addEventListener(
  "wheel",
  (ev) => {
    ev.preventDefault();
    const [x, y] = local(ev.clientX, ev.clientY);
    // a trackpad pinch arrives as a wheel with ctrl held
    zoomAt(Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.012 : 0.0025)), x, y);
  },
  { passive: false },
);

// ---------- keys and buttons ----------
const lightBtn = document.getElementById("light");
const LIGHT_LABEL = { auto: "Auto light", day: "Day", night: "Night" };
lightBtn.textContent = LIGHT_LABEL[lightMode];
const nextLight = () => (lightBtn.textContent = LIGHT_LABEL[cycleLight()]);
const labelsBtn = document.getElementById("labels");
function toggleLabels() {
  ui.showAllLabels = !ui.showAllLabels;
  labelsBtn.setAttribute("aria-pressed", String(ui.showAllLabels));
}

window.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && settingsOpen()) return openSettings(false);
  if (ev.target.closest("input, textarea, select") || ev.metaKey || ev.ctrlKey) return;
  const k = ev.key.toLowerCase();
  if (k === "l") toggleLabels();
  if (k === "n") nextLight();
  if (k === "b") toggleSound();
  if (k === "s") openSettings();
  if (ev.key === "+" || ev.key === "=") zoomAt(1.4);
  if (ev.key === "-") zoomAt(1 / 1.4);
  if (ev.key === "0") resetCamera();
  if (k === "f" && ui.selectedKey) follow(ui.selectedKey);
  if (ev.key === "Escape") {
    ui.selectedKey = null;
    ui.following = null;
    renderSide();
  }
});
labelsBtn.addEventListener("click", toggleLabels);
lightBtn.addEventListener("click", nextLight);
document.getElementById("zoom-in").addEventListener("click", () => zoomAt(1.4));
document.getElementById("zoom-out").addEventListener("click", () => zoomAt(1 / 1.4));
document.getElementById("zoom-fit").addEventListener("click", resetCamera);

