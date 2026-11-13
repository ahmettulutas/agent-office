// The settings panel: the sound when an agent needs you (on or off, which
// one, a preview), the desktop notification and the reminder. Everything
// plays and is saved on the server, so it works with this page closed too.

import { el } from "./ui.js";

const panel = document.getElementById("settings");
const openBtn = document.getElementById("settings-open");
const soundOn = document.getElementById("sound-on");
const soundList = document.getElementById("sound-list");
const note = document.getElementById("settings-note");
const notifyOn = document.getElementById("notify-on");
const metricsOn = document.getElementById("metrics-on");
const remind = document.getElementById("remind");
let prefs = { bell: true, sound: "bell", notify: true, metrics: false, remindMinutes: 3, remindChoices: [], sounds: [] };

function render() {
  soundOn.checked = prefs.bell;
  notifyOn.checked = prefs.notify;
  metricsOn.checked = prefs.metrics === true;
  remind.replaceChildren(
    ...prefs.remindChoices.map((m) => {
      const o = el("option", "", m ? `every ${m} min` : "never");
      o.value = String(m);
      o.selected = m === prefs.remindMinutes;
      return o;
    }),
  );
  soundList.classList.toggle("off", !prefs.bell);
  const legend = soundList.querySelector("legend");
  soundList.replaceChildren(legend);
  for (const s of prefs.sounds) {
    const row = el("label", `sound-row${s.id === prefs.sound ? " sel" : ""}`);
    const radio = el("input");
    radio.type = "radio";
    radio.name = "sound";
    radio.value = s.id;
    radio.checked = s.id === prefs.sound;
    radio.addEventListener("change", () => save({ sound: s.id, preview: s.id }, `${s.name} chosen`));
    const text = el("span", "sound-text");
    text.append(el("b", "", s.name), el("small", "", s.about));
    const play = el("button", "play", "Play");
    play.type = "button";
    play.setAttribute("aria-label", `Play ${s.name}`);
    play.addEventListener("click", (ev) => {
      ev.preventDefault();
      save({ preview: s.id }, `playing ${s.name}`);
    });
    row.append(radio, text, play);
    soundList.append(row);
  }
}

async function save(body, done) {
  try {
    const r = await fetch("/api/settings", body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
    if (!r.ok) throw new Error(String(r.status));
    prefs = await r.json();
    render();
    if (done) note.textContent = done;
  } catch {
    note.textContent = "Could not reach the office server.";
  }
}

export function toggleSound() {
  const on = !prefs.bell;
  // play it once when it goes on, so you know what to listen for
  save({ bell: on, preview: on || undefined }, on ? "Sound on" : "Sound off");
}

export const settingsOpen = () => !panel.hidden;
export function openSettings(open = panel.hidden) {
  panel.hidden = !open;
  openBtn.setAttribute("aria-expanded", String(open));
  if (open) {
    note.textContent = "";
    save();
    soundOn.focus();
  } else openBtn.focus();
}

soundOn.addEventListener("change", toggleSound);
notifyOn.addEventListener("change", () => save({ notify: notifyOn.checked }, notifyOn.checked ? "Notifications on" : "Notifications off"));
remind.addEventListener("change", () => {
  const m = Number(remind.value);
  save({ remindMinutes: m }, m ? `Reminding every ${m} min` : "No reminders");
});
openBtn.addEventListener("click", () => openSettings());
document.getElementById("settings-close").addEventListener("click", () => openSettings(false));
document.addEventListener("pointerdown", (ev) => {
  if (!panel.hidden && !panel.contains(ev.target) && ev.target !== openBtn) openSettings(false);
});
save();
metricsOn.addEventListener("change", () => save({ metrics: metricsOn.checked }, metricsOn.checked ? "Token card on" : "Token card off"));
