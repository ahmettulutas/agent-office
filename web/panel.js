// The side panel: the counts in the header, the list of sessions and their
// subagents, and the details of whoever is selected.

import { walkers, office } from "./office.js";
import { follow } from "./camera.js";
import { ui, on, el, STATE_LABEL, relTime } from "./ui.js";

const list = document.getElementById("list");
const details = document.getElementById("details");
const empty = document.getElementById("empty");

// the lines shown in a hover tip and at the top of the details
export function describe(w, short) {
  const d = w.data;
  const out = [];
  out.push(el("div", "tip-title", w.kind === "main" ? d.project || "session" : d.type || "subagent"));
  out.push(el("div", `pill st-${d.state}`, STATE_LABEL[d.state] || d.state));
  if (w.kind === "sub" && d.label) out.push(el("div", "tip-line", d.label));
  if (w.kind === "main" && d.model) out.push(el("div", "tip-line muted", d.model));
  if (d.tool) out.push(el("div", "tip-line", `${d.tool}${d.detail ? `: ${d.detail}` : ""}`));
  if (w.kind === "main" && w.mode === "break" && w.spot) out.push(el("div", "tip-line muted", `on a break: ${w.spot.act}`));
  if (w.seat?.stand) out.push(el("div", "tip-line muted", "every desk is taken: working in the corridor"));
  if (!short) out.push(el("div", "tip-line muted", `since ${relTime(d.since || d.startedAt)}`));
  return out;
}

function counts() {
  let working = 0;
  let waiting = 0;
  let idle = 0;
  let subs = 0;
  for (const s of office.snapshot.sessions) {
    if (s.state === "busy") working++;
    else if (s.state === "needs-you") waiting++;
    else if (s.state === "idle") idle++;
    for (const a of s.subagents || []) if (a.state === "running") subs++;
  }
  return { working, waiting, idle, subs };
}

export function select(key) {
  ui.selectedKey = key;
  loadMetrics(key);
  renderSide();
}

export function renderSide() {
  const c = counts();
  document.getElementById("c-working").textContent = c.working;
  document.getElementById("c-waiting").textContent = c.waiting;
  document.getElementById("c-idle").textContent = c.idle;
  document.getElementById("c-subs").textContent = c.subs;
  document.title = c.waiting ? `(${c.waiting}) Agent Office` : "Agent Office";
  const sessions = office.snapshot.sessions;
  empty.hidden = sessions.some((s) => s.state !== "ended");

  list.replaceChildren();
  for (const s of sessions) {
    if (s.state === "ended") continue;
    const key = `s:${s.id}`;
    const row = el("button", `row${ui.selectedKey === key ? " sel" : ""}`);
    row.type = "button";
    row.append(el("span", `dot st-${s.state}`), el("span", "row-name", s.project || "session"), el("span", "row-state", s.tool || STATE_LABEL[s.state]));
    row.addEventListener("click", () => select(key));
    list.append(row);
    for (const a of s.subagents || []) {
      const akey = `a:${s.id}:${a.id}`;
      if (a.state === "done" && !walkers.has(akey)) continue;
      const sub = el("button", `row sub${ui.selectedKey === akey ? " sel" : ""}`);
      sub.type = "button";
      sub.append(el("span", `dot st-${a.state}`), el("span", "row-name", a.type), el("span", "row-state", a.tool || a.label || STATE_LABEL[a.state]));
      sub.addEventListener("click", () => select(akey));
      list.append(sub);
    }
  }
  renderDetails();
}

// ---------- metrics (only when the metrics setting is on) ----------
const metricsCache = new Map(); // session id -> summary | "none"
const nf = new Intl.NumberFormat("en-US");

function sessionOf(key) {
  const w = key && walkers.get(key);
  return w && w.kind === "main" ? w.data : null;
}

async function loadMetrics(key) {
  const d = sessionOf(key);
  if (!d || !metricsOn) return;
  try {
    const r = await fetch(`/api/metrics?session=${encodeURIComponent(d.id)}`);
    metricsCache.set(d.id, r.ok ? await r.json() : "none");
  } catch {
    metricsCache.set(d.id, "none");
  }
  if (ui.selectedKey === key) renderDetails();
}

// refresh only while the session is selected and working
setInterval(() => {
  const d = sessionOf(ui.selectedKey);
  if (metricsOn && d && d.state === "busy") loadMetrics(ui.selectedKey);
}, 10000);

function metricsCard(id) {
  const m = metricsCache.get(id);
  if (!m || m === "none") return null;
  const box = el("div", "metrics");
  box.append(el("h3", "", "Tokens (observed, main session only)"));
  const t = m.totals;
  const lines = [
    `in ${nf.format(t.input)} · out ${nf.format(t.output)}`,
    `cache read ${nf.format(t.cacheRead)} · write ${nf.format(t.cacheWrite)}`,
    `cache hit ${t.cacheHitRatio === null ? "unknown" : `${Math.round(t.cacheHitRatio * 100)}%`}`,
    `cost ${t.costUsd === null ? "unknown" : `$${t.costUsd.toFixed(2)}`}`,
  ];
  if (m.durationsMs.api !== null) lines.push(`API ${Math.round(m.durationsMs.api / 1000)}s · tools ${Math.round((m.durationsMs.tools || 0) / 1000)}s`);
  if (m.partial) lines.push("large transcript: newest part only");
  for (const l of lines) box.append(el("div", "tip-line", l));
  return box;
}

// ---------- export (only when exportEnabled is on) ----------
let exportOn = false;
let metricsOn = false;
fetch("/api/settings")
  .then((r) => r.json())
  .then((j) => {
    exportOn = j.exportEnabled === true;
    metricsOn = j.metrics === true;
    renderDetails();
  })
  .catch(() => {});
const exportOpen = new Set(); // sessions whose export options are showing
const exportNote = new Map(); // session -> last result line

async function download(id, mode) {
  exportNote.set(id, "Building the file…");
  renderDetails();
  try {
    const r = await fetch("/api/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: id, mode }) });
    if (!r.ok) throw new Error(r.status === 429 ? "another export is running" : "the transcript could not be read");
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `agent-office-trace-${String(id).replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "session"}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    exportNote.set(id, "Saved to your downloads.");
  } catch (err) {
    exportNote.set(id, `Export failed: ${err.message}`);
  }
  renderDetails();
}

function exportCard(id) {
  const box = el("div", "export");
  const btn = el("button", "follow", exportOpen.has(id) ? "Hide export" : "Export trace…");
  btn.type = "button";
  btn.addEventListener("click", () => {
    if (exportOpen.has(id)) exportOpen.delete(id);
    else exportOpen.add(id);
    renderDetails();
  });
  box.append(btn);
  if (!exportOpen.has(id)) return box;
  box.append(
    el("div", "tip-line muted", "Makes a JSON file of this session for agent-replay and similar tools. Secret patterns are removed on a best-effort basis; review the file before sharing it."),
  );
  for (const [mode, label, about] of [
    ["safe", "Safe", "prompts, replies, tool names; thinking dropped, tool results cut short"],
    ["full", "Full", "everything, including thinking and complete tool results and inputs"],
  ]) {
    const b = el("button", "follow", `Download ${label}`);
    b.type = "button";
    b.title = about;
    b.addEventListener("click", () => download(id, mode));
    box.append(b, el("div", "tip-line muted", about));
  }
  if (exportNote.has(id)) box.append(el("div", "tip-line", exportNote.get(id)));
  return box;
}

function renderDetails() {
  const w = ui.selectedKey && walkers.get(ui.selectedKey);
  details.hidden = !w;
  if (!w) return;
  const d = w.data;
  details.replaceChildren();
  details.append(...describe(w, false));
  const fb = el("button", "follow", ui.following === w.key ? "Following (Esc stops)" : "Follow (F)");
  fb.type = "button";
  fb.addEventListener("click", () => {
    follow(w.key);
    renderDetails();
  });
  details.append(fb);
  if (w.kind === "main") {
    details.append(el("div", "tip-line muted", `session ${String(d.id).slice(0, 8)}`));
    if (d.error) details.append(el("div", "tip-line err", `last turn ended with ${d.error}`));
    if (metricsOn) {
      const mc = metricsCard(d.id);
      if (mc) details.append(mc);
    }
    if (exportOn) details.append(exportCard(d.id));
  }
  const log = (d.log || []).slice().reverse();
  if (log.length) {
    details.append(el("h3", "", "Recent tools"));
    const ul = el("ul", "log");
    for (const l of log.slice(0, 25)) {
      const li = el("li");
      const mark = el("span", l.ok === null ? "run" : l.ok ? "ok" : "fail", l.ok === null ? "▶" : l.ok ? "✓" : "✗");
      li.append(mark, el("span", "log-tool", l.tool), el("span", "log-detail", l.detail || ""), el("span", "log-time", l.ms != null ? `${(l.ms / 1000).toFixed(1)}s` : relTime(l.t)));
      ul.append(li);
    }
    details.append(ul);
  }
}

on("side", renderSide);
setInterval(renderDetails, 2000);
