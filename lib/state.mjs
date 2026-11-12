// The office state machine. Hook events come in, a snapshot of sessions and
// subagents goes out. Nothing here touches the network or the disk.

const NEEDS_YOU = new Set([
  "permission_prompt",
  "elicitation_dialog",
  "elicitation_url_dialog",
  "agent_needs_input",
]);
// Claude asking you something itself fires no Notification, only the tool:
// these tools wait for you until their result comes back
const ASKS = new Map([
  ["AskUserQuestion", "question"],
  ["ExitPlanMode", "plan_approval"],
]);
const LOG_MAX = 40;
const SUBAGENTS_MAX = 40;
const PENDING_MAX = 20;
const PENDING_TTL = 10 * 60_000;
const BUSY_STALE = 15 * 60_000; // an interrupt (Esc) fires no hook: give up on "busy" after this
const ENDED_KEEP = 60_000; // long enough for the page to walk the character out
const DONE_KEEP = 90_000;

export class Office {
  constructor({ forgetAfterHours = 6 } = {}) {
    this.sessions = new Map();
    this.forgetAfter = forgetAfterHours * 3600_000;
    this.version = 0;
    // how many times a session started waiting for the user (the server rings a bell)
    this.alerts = 0;
    this.lastAlert = null;
  }

  load(data) {
    if (!data || !Array.isArray(data.sessions)) return;
    for (const s of data.sessions) {
      if (!s || typeof s.id !== "string") continue;
      s.subagents = new Map((s.subagents || []).map((a) => [a.id, a]));
      s.openTools = new Set();
      s.pendingAgents = [];
      this.sessions.set(s.id, s);
    }
    this.prune(Date.now());
  }

  // sessions whose transcript should be watched for an Esc interrupt
  watchList() {
    const out = [];
    for (const s of this.sessions.values()) {
      if ((s.state === "busy" || s.state === "needs-you") && s.transcript) out.push({ id: s.id, transcript: s.transcript, lastAt: s.lastAt });
    }
    return out;
  }

  // Esc fires no hook, but the transcript records it: stop the turn there
  interrupt(id, at, now = Date.now()) {
    const s = this.sessions.get(id);
    if (!s || (s.state !== "busy" && s.state !== "needs-you") || at < s.lastAt - 1000) return false;
    this.#setState(s, "idle", now);
    s.tool = s.detail = s.reason = null;
    s.openTools.clear();
    for (const l of s.log) if (l.ok === null) l.ok = false;
    this.version++;
    return true;
  }

  dump() {
    return { sessions: [...this.sessions.values()].map((s) => this.#plain(s, true)) };
  }

  snapshot(now = Date.now()) {
    this.prune(now);
    return {
      now,
      version: this.version,
      sessions: [...this.sessions.values()]
        .sort((a, b) => a.startedAt - b.startedAt)
        .map((s) => this.#plain(s, false)),
    };
  }

  #plain(s, full) {
    const out = {
      id: s.id,
      project: s.project,
      model: s.model,
      state: s.state,
      since: s.since,
      startedAt: s.startedAt,
      lastAt: s.lastAt,
      tool: s.tool,
      detail: s.detail,
      reason: s.reason,
      error: s.error,
      log: s.log,
      subagents: [...s.subagents.values()].sort((a, b) => a.startedAt - b.startedAt),
    };
    if (full) {
      out.cwd = s.cwd;
      out.transcript = s.transcript || "";
    }
    return out;
  }

  prune(now) {
    let changed = false;
    for (const [id, s] of this.sessions) {
      const gone =
        (s.state === "ended" && now - s.since > ENDED_KEEP) || now - s.lastAt > this.forgetAfter;
      if (gone) {
        this.sessions.delete(id);
        changed = true;
        continue;
      }
      if (s.state === "busy" && now - s.lastAt > BUSY_STALE && !this.#anyRunning(s)) {
        this.#setState(s, "idle", now);
        s.tool = s.detail = null;
        changed = true;
      }
      for (const [aid, a] of s.subagents) {
        if (a.state === "done" && now - a.endedAt > DONE_KEEP) {
          s.subagents.delete(aid);
          changed = true;
        } else if (a.state === "running" && now - a.lastAt > this.forgetAfter) {
          a.state = "done";
          a.endedAt = now;
          changed = true;
        }
      }
      s.pendingAgents = s.pendingAgents.filter((p) => now - p.at < PENDING_TTL);
    }
    if (changed) this.version++;
  }

  #anyRunning(s) {
    for (const a of s.subagents.values()) if (a.state === "running") return true;
    return false;
  }

  #needsYou(s, e, now) {
    if (!NEEDS_YOU.has(e.notification) && ![...ASKS.values()].includes(e.notification)) return;
    // A permission notice for a tool that already ran is late: ignore it.
    if (e.notification === "permission_prompt" && s.openTools.size === 0) return;
    if (s.state !== "needs-you") {
      this.alerts++;
      this.lastAlert = { session: s.id, project: s.project, reason: e.notification, agentType: e.agentId ? e.agentType || "subagent" : null };
    }
    this.#setState(s, "needs-you", now);
    s.reason = e.notification;
  }

  #setState(s, state, now) {
    if (s.state !== state) {
      s.state = state;
      s.since = now;
    }
  }

  #session(e, now) {
    let s = this.sessions.get(e.session);
    if (s && s.state === "ended" && e.event !== "SessionStart") return null;
    if (!s) {
      s = {
        id: e.session,
        project: "",
        cwd: "",
        model: "",
        state: "idle",
        since: now,
        startedAt: now,
        lastAt: now,
        tool: null,
        detail: null,
        reason: null,
        error: null,
        log: [],
        subagents: new Map(),
        openTools: new Set(),
        pendingAgents: [],
      };
      this.sessions.set(e.session, s);
    }
    if (e.cwd) {
      s.cwd = e.cwd;
      s.project = e.cwd.split(/[\\/]/).filter(Boolean).pop() || e.cwd;
    }
    if (e.model) s.model = e.model;
    if (e.transcript && !e.agentId) s.transcript = e.transcript;
    s.lastAt = now;
    return s;
  }

  #subagent(s, e, now) {
    let a = s.subagents.get(e.agentId);
    if (!a) {
      const type = e.agentType || "general-purpose";
      const i = s.pendingAgents.findIndex((p) => p.type === type);
      const label = i >= 0 ? s.pendingAgents.splice(i, 1)[0].label : "";
      a = {
        id: e.agentId,
        type,
        label,
        state: "running",
        startedAt: now,
        endedAt: null,
        lastAt: now,
        tool: null,
        detail: null,
        log: [],
      };
      s.subagents.set(e.agentId, a);
      if (s.subagents.size > SUBAGENTS_MAX) {
        const oldest = [...s.subagents.values()].find((x) => x.state === "done");
        if (oldest) s.subagents.delete(oldest.id);
      }
    }
    if (e.agentType && a.type !== e.agentType) a.type = e.agentType;
    a.lastAt = now;
    return a;
  }

  apply(e, now = Date.now()) {
    if (!e || typeof e.session !== "string" || !e.session || typeof e.event !== "string") return false;
    const s = this.#session(e, now);
    if (!s) return false;

    if (e.agentId) {
      this.#applySubagent(s, e, now);
    } else {
      this.#applyMain(s, e, now);
    }
    this.version++;
    return true;
  }

  #applySubagent(s, e, now) {
    const a = this.#subagent(s, e, now);
    switch (e.event) {
      case "SubagentStop":
        a.state = "done";
        a.endedAt = now;
        a.tool = a.detail = null;
        break;
      case "PreToolUse":
        if (a.state === "done") a.state = "running";
        a.tool = e.tool || null;
        a.detail = e.detail || null;
        pushLog(a.log, { t: now, tool: e.tool, detail: e.detail, ok: null, id: e.toolUseId });
        if (e.toolUseId) s.openTools.add(e.toolUseId);
        if (isAgentTool(e.tool)) queuePending(s, e, now);
        if (ASKS.has(e.tool)) this.#needsYou(s, { ...e, notification: ASKS.get(e.tool) }, now);
        break;
      case "PostToolUse":
      case "PostToolUseFailure":
        a.tool = a.detail = null;
        closeLog(a.log, e, now);
        if (e.toolUseId) s.openTools.delete(e.toolUseId);
        if (s.state === "needs-you") this.#setState(s, "busy", now);
        break;
      case "Notification":
        // a subagent waiting for permission or input holds up its session
        this.#needsYou(s, e, now);
        break;
      default:
        break;
    }
  }

  #applyMain(s, e, now) {
    switch (e.event) {
      case "SessionStart":
        if (e.source !== "compact") this.#setState(s, "idle", now);
        if (s.state === "ended") this.#setState(s, "idle", now);
        s.reason = s.error = null;
        break;
      case "UserPromptSubmit":
        this.#setState(s, "busy", now);
        s.reason = s.error = null;
        break;
      case "PreToolUse":
        this.#setState(s, "busy", now);
        s.tool = e.tool || null;
        s.detail = e.detail || null;
        pushLog(s.log, { t: now, tool: e.tool, detail: e.detail, ok: null, id: e.toolUseId });
        if (e.toolUseId) s.openTools.add(e.toolUseId);
        if (isAgentTool(e.tool)) queuePending(s, e, now);
        if (ASKS.has(e.tool)) this.#needsYou(s, { ...e, notification: ASKS.get(e.tool) }, now);
        break;
      case "PostToolUse":
      case "PostToolUseFailure":
        s.tool = s.detail = null;
        closeLog(s.log, e, now);
        if (e.toolUseId) s.openTools.delete(e.toolUseId);
        if (s.state === "needs-you") this.#setState(s, "busy", now);
        if (s.state === "idle") this.#setState(s, "busy", now);
        break;
      case "Notification":
        this.#needsYou(s, e, now);
        break;
      case "Stop":
        this.#setState(s, "idle", now);
        s.tool = s.detail = null;
        s.reason = s.error = null;
        s.openTools.clear();
        s.pendingAgents = [];
        break;
      case "StopFailure":
        this.#setState(s, "idle", now);
        s.tool = s.detail = null;
        s.error = e.error || "error";
        s.openTools.clear();
        break;
      case "SessionEnd":
        this.#setState(s, "ended", now);
        s.tool = s.detail = null;
        for (const a of s.subagents.values()) {
          if (a.state === "running") {
            a.state = "done";
            a.endedAt = now;
          }
        }
        break;
      default:
        break;
    }
  }
}

function isAgentTool(tool) {
  return tool === "Agent" || tool === "Task";
}

function queuePending(s, e, now) {
  s.pendingAgents.push({ type: e.subagentType || "general-purpose", label: e.description || "", at: now });
  if (s.pendingAgents.length > PENDING_MAX) s.pendingAgents.shift();
}

function pushLog(log, entry) {
  log.push(entry);
  if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX);
}

function closeLog(log, e, now) {
  const ok = e.event === "PostToolUse";
  for (let i = log.length - 1; i >= 0; i--) {
    const l = log[i];
    if (l.ok !== null) continue;
    if ((e.toolUseId && l.id === e.toolUseId) || (!e.toolUseId && l.tool === e.tool)) {
      l.ok = ok;
      l.ms = now - l.t;
      return;
    }
  }
}
