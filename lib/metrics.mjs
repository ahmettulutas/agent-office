// SessionMetrics v1: observed token, cache, cost and duration counters for the
// main session, read from its transcript. Only counter fields are looked at;
// no content, path or repo name is kept. Nothing is estimated: cost and
// durations are what Claude Code itself recorded (the last cost-state), or null.

import fs from "node:fs";
import { readTranscript, MAX_BYTES } from "./transcript-reader.mjs";

export function newState() {
  return { offset: 0, size: 0, mtimeMs: 0, msgs: new Map(), cost: null, partial: false };
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
const maybe = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// one assistant message may be split over several records that repeat its usage:
// keep one entry per message id, the one with the most output tokens
function take(state, r) {
  const m = r.message;
  const u = m && m.usage;
  if (!u || typeof u !== "object" || typeof m.id !== "string" || typeof m.model !== "string" || m.model.startsWith("<")) return;
  const e = { model: m.model, input: num(u.input_tokens), output: num(u.output_tokens), cacheRead: num(u.cache_read_input_tokens), cacheWrite: num(u.cache_creation_input_tokens) };
  const old = state.msgs.get(m.id);
  if (!old || e.output >= old.output) state.msgs.set(m.id, e);
}

export async function advance(file, state, { maxBytes = MAX_BYTES } = {}) {
  const st = await fs.promises.stat(file);
  if (st.size < state.offset) Object.assign(state, newState()); // compacted or rewritten: start over
  const stats = {};
  for await (const r of readTranscript(file, { from: state.offset, maxBytes, stats })) {
    if (r.type === "cost-state") state.cost = r;
    else if (r.type === "assistant" && r.isSidechain !== true) take(state, r);
  }
  state.offset = stats.offset;
  state.size = st.size;
  state.mtimeMs = st.mtimeMs;
  if (stats.truncated) state.partial = true;
  return state;
}

export function summarize(state, sessionId) {
  const models = {};
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const e of state.msgs.values()) {
    const m = (models[e.model] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: null });
    for (const k of Object.keys(totals)) {
      m[k] += e[k];
      totals[k] += e[k];
    }
  }
  const c = state.cost;
  const used = c && c.modelUsage && typeof c.modelUsage === "object" ? c.modelUsage : {};
  for (const [name, m] of Object.entries(models)) {
    const u = used[name];
    m.costUsd = u && typeof u === "object" ? maybe(u.costUSD ?? u.costUsd) : null;
  }
  const denom = totals.input + totals.cacheRead + totals.cacheWrite;
  return {
    version: 1,
    sessionId,
    scope: "main-session",
    models,
    totals: { ...totals, cacheHitRatio: denom ? totals.cacheRead / denom : null, costUsd: c ? maybe(c.totalCostUSD) : null },
    durationsMs: { api: c ? maybe(c.totalAPIDuration) : null, tools: c ? maybe(c.totalToolDuration) : null, wall: c ? maybe(c.totalDuration) : null },
    source: "transcript",
    confidence: "observed",
    privacy: "metadata",
    partial: state.partial,
  };
}

// keeps each file's state between requests, so a poll reads only what was appended
export function createMetricsService({ max = 20 } = {}) {
  const cache = new Map(); // file -> state, oldest first
  const svc = {
    reads: 0,
    async get(file, sessionId) {
      let state = cache.get(file);
      if (state) cache.delete(file);
      else state = newState();
      cache.set(file, state);
      while (cache.size > max) cache.delete(cache.keys().next().value);
      // one read at a time per file, so two pages asking at once do not both advance it
      const run = async () => {
        const st = await fs.promises.stat(file);
        if (st.size !== state.size || st.mtimeMs !== state.mtimeMs) {
          svc.reads++;
          await advance(file, state);
        }
        return summarize(state, sessionId);
      };
      const next = (state.busy ?? Promise.resolve()).then(run, run);
      state.busy = next.catch(() => {});
      return next;
    },
  };
  return svc;
}
