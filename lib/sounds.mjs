// The sounds that ring when an agent needs you. Each one is synthesised once
// into ~/.agent-office/sounds/<id>.wav (no sound files in the repo) and played
// with the system's own player, so it rings even when no office page is open.
// AGENT_OFFICE_MUTE=1 (the tests) only logs.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { HOME_DIR, ensureHome } from "./paths.mjs";

export const SOUND_DIR = path.join(HOME_DIR, "sounds");
const VERSION = 2; // bump to regenerate the files when a sound changes
const RATE = 44100;

// ---------- building blocks ----------
// Partials of a struck bell: frequency ratio, loudness, decay in seconds. The
// slightly inharmonic ratios are what make it sound like metal, not a beep.
const BELL = [
  [0.5, 0.35, 2.2],
  [1, 1, 1.6],
  [1.19, 0.45, 1.1],
  [1.5, 0.35, 0.9],
  [2.0, 0.5, 0.8],
  [2.74, 0.3, 0.5],
  [3.76, 0.22, 0.35],
  [5.4, 0.12, 0.2],
];
// a struck metal tube, as in a door chime: few partials, a long clean note
const TUBE = [
  [1, 1, 1.9],
  [2.76, 0.32, 0.7],
  [5.4, 0.12, 0.3],
];
// a large gong: low, wide and slow
const GONG = [
  [1, 1, 3.2],
  [1.52, 0.6, 2.6],
  [2.03, 0.45, 2.1],
  [2.61, 0.3, 1.5],
  [3.32, 0.22, 1],
  [4.18, 0.14, 0.7],
];

// add one strike of a struck object starting at `start` seconds
function strike(out, start, base, partials, gain = 1, click = 0.6, decayScale = 1) {
  const n = out.length;
  const s0 = Math.round(start * RATE);
  for (const [ratio, amp, decay] of partials) {
    const w = (2 * Math.PI * base * ratio) / RATE;
    const k = -1 / (decay * decayScale * RATE);
    const end = Math.min(n, s0 + Math.ceil(decay * decayScale * RATE * 9)); // until it is inaudible
    for (let i = s0; i < end; i++) {
      const t = i - s0;
      const attack = Math.min(1, t / (0.002 * RATE)); // no click from the start
      out[i] += gain * amp * attack * Math.exp(k * t) * Math.sin(w * t + ratio);
    }
  }
  // the clapper or mallet: a very short noisy tick
  let seed = 7 + s0;
  const len = 0.006 * RATE;
  for (let i = 0; i < len && s0 + i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out[s0 + i] += gain * ((seed / 0x7fffffff) * 2 - 1) * click * (1 - i / len);
  }
}

// add a steady electronic tone (odd harmonics: a bright, square-ish beep)
function beep(out, start, dur, freq, gain = 1) {
  const s0 = Math.round(start * RATE);
  const len = Math.round(dur * RATE);
  const edge = 0.004 * RATE;
  for (let i = 0; i < len && s0 + i < out.length; i++) {
    const env = Math.min(1, i / edge, (len - i) / edge);
    const ph = (2 * Math.PI * freq * i) / RATE;
    out[s0 + i] += gain * env * (Math.sin(ph) + Math.sin(3 * ph) / 3 + Math.sin(5 * ph) / 5);
  }
}

// as loud as the format allows, with a short fade at the end
function finish(out) {
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const g = peak ? 0.97 / peak : 1;
  const fade = Math.round(0.05 * RATE);
  for (let i = 0; i < out.length; i++) out[i] *= g * Math.min(1, (out.length - i) / fade);
  return out;
}

const buffer = (seconds) => new Float32Array(Math.round(RATE * seconds));

// ---------- the set ----------
export const SOUNDS = [
  {
    id: "bell",
    name: "Brass bell",
    about: "three strikes of a hand bell, loud and bright",
    make() {
      const out = buffer(2.6);
      for (const t of [0, 0.38, 0.76]) strike(out, t, 1046.5, BELL);
      return finish(out);
    },
  },
  {
    id: "alarm",
    name: "Alarm clock",
    about: "a fast ringing bell for a second and a half, the hardest to miss",
    make() {
      const out = buffer(2.1);
      for (let i = 0; i * 0.065 < 1.5; i++) strike(out, i * 0.065, i % 2 ? 1661 : 1568, BELL, 1, 0.5, 0.35);
      return finish(out);
    },
  },
  {
    id: "ship",
    name: "Ship's bell",
    about: "two pairs of strikes, lower and fuller",
    make() {
      const out = buffer(3.4);
      for (const t of [0, 0.34, 1.1, 1.44]) strike(out, t, 740, BELL, 1, 0.5, 1.2);
      return finish(out);
    },
  },
  {
    id: "chime",
    name: "Door chime",
    about: "a two-note ding-dong, gentler",
    make() {
      const out = buffer(2.8);
      strike(out, 0, 659.3, TUBE, 1, 0.25);
      strike(out, 0.6, 523.3, TUBE, 1, 0.25);
      return finish(out);
    },
  },
  {
    id: "beeps",
    name: "Digital beeps",
    about: "three short pairs of electronic beeps",
    make() {
      const out = buffer(1.5);
      for (let k = 0; k < 3; k++) {
        beep(out, k * 0.45, 0.09, 2093);
        beep(out, k * 0.45 + 0.14, 0.09, 2093);
      }
      return finish(out);
    },
  },
  {
    id: "gong",
    name: "Gong",
    about: "one deep, slow strike",
    make() {
      const out = buffer(4);
      strike(out, 0, 174.6, GONG, 1, 0.15);
      return finish(out);
    },
  },
];
export const DEFAULT_SOUND = "bell";
export const soundById = (id) => SOUNDS.find((s) => s.id === id) || SOUNDS.find((s) => s.id === DEFAULT_SOUND);
export const soundList = () => SOUNDS.map(({ id, name, about }) => ({ id, name, about }));

// ---------- files ----------
export function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVE", 8);
  head.write("fmt ", 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); // PCM
  head.writeUInt16LE(1, 22); // mono
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

export function soundFile(id) {
  const s = soundById(id);
  const file = path.join(SOUND_DIR, `${s.id}.v${VERSION}.wav`);
  if (fs.existsSync(file)) return file;
  ensureHome();
  fs.mkdirSync(SOUND_DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, wav(s.make()));
  fs.renameSync(tmp, file);
  return file;
}

function player(file) {
  if (process.platform === "darwin") return [["afplay", [file]]];
  if (process.platform === "win32") return [["powershell", ["-NoProfile", "-Command", `(New-Object Media.SoundPlayer '${file.replace(/'/g, "''")}').PlaySync()`]]];
  return [["paplay", [file]], ["aplay", ["-q", file]]];
}

// Plays a sound without waiting for it. Returns false when it could not be made.
export function play(id, log = () => {}) {
  if (process.env.AGENT_OFFICE_MUTE === "1") {
    log(`play (muted): ${soundById(id).id}`);
    return true;
  }
  let file;
  try {
    file = soundFile(id);
  } catch (err) {
    log("sound: could not write the file:", err.message);
    return false;
  }
  const tries = player(file);
  const attempt = (i) => {
    if (i >= tries.length) {
      log("sound: no audio player found");
      return;
    }
    const [cmd, args] = tries[i];
    try {
      spawn(cmd, args, { stdio: "ignore" }).on("error", () => attempt(i + 1));
    } catch {
      attempt(i + 1);
    }
  };
  attempt(0);
  return true;
}
