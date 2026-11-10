// The office page. The live snapshot comes in over server-sent events; each
// frame the people act (office.js), the camera follows (camera.js) and the
// office is drawn (render.js). Input, the side panel and settings wire
// themselves up on import.

import { seats } from "./map.js";
import { iso } from "./iso.js";
import { cam, updateView, zoomAt, resetCamera, follow, lookAt } from "./camera.js";
import { walkers, sync, step } from "./office.js";
import { draw } from "./render.js";
import "./panel.js";
import "./settings.js";
import "./input.js";
import { ui } from "./ui.js";

let last = performance.now();
function frame(ts) {
  const dt = Math.min(0.1, (ts - last) / 1000);
  last = ts;
  step(dt);
  const fw = ui.following && walkers.get(ui.following);
  if (fw) {
    cam.cx += (fw.sx - cam.cx) * Math.min(1, dt * 5);
    cam.cy += (fw.sy - 16 - cam.cy) * Math.min(1, dt * 5);
    updateView();
  } else ui.following = null;
  draw(ts);
}
function loop(ts) {
  frame(ts);
  requestAnimationFrame(loop);
}

// ---------- live data ----------
const conn = document.getElementById("conn");
function connect() {
  const es = new EventSource("/api/stream");
  es.onopen = () => {
    conn.textContent = "live";
    conn.className = "conn on";
  };
  es.onmessage = (ev) => {
    try {
      sync(JSON.parse(ev.data));
    } catch (err) {
      console.error(err);
    }
  };
  es.onerror = () => {
    conn.textContent = "reconnecting";
    conn.className = "conn off";
  };
}
connect();
requestAnimationFrame(loop);

// for poking at the page from the browser console
window.agentOffice = { walkers, cam, seats, frame: (ts = performance.now()) => frame(ts), zoomAt, resetCamera, follow, lookAt, iso };
