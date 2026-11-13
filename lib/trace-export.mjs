// TraceExport v1: a Claude Code transcript as {messages:[{role, content}]},
// the shape agent-replay reads. Follows one conversation line (the leaf's
// parent chain), skips sidechains, and merges an assistant message that the
// transcript split into several records. Redaction is best-effort.
//
// safe (default): thinking dropped, tool input reduced to its short detail,
//                 tool results cut short.
// full:           everything kept, secret patterns still redacted.

import { readTranscript } from "./transcript-reader.mjs";
import { toolDetail } from "./extract.mjs";
import { redactString, redactValue } from "./redact.mjs";

const TEXT_CAP = 2000;
const RESULT_CAP = 200;

const cut = (s, n) => (s.length > n ? `${s.slice(0, n)}… [${s.length - n} chars omitted]` : s);

function resultText(c) {
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return "";
  return c.map((b) => (b?.type === "text" && typeof b.text === "string" ? b.text : b?.type === "image" ? "[image]" : "")).filter(Boolean).join("\n");
}

function convert(block, safe) {
  if (!block || typeof block !== "object") return null;
  switch (block.type) {
    case "text": {
      if (typeof block.text !== "string" || !block.text.trim()) return null;
      const t = redactString(block.text);
      return { type: "text", text: safe ? cut(t, TEXT_CAP) : t };
    }
    case "thinking":
      if (safe || typeof block.thinking !== "string" || !block.thinking.trim()) return null;
      return { type: "thinking", thinking: redactString(block.thinking) };
    case "tool_use": {
      const name = typeof block.name === "string" ? block.name : "tool";
      const input = safe ? { detail: redactString(toolDetail(name, block.input)) } : redactValue(block.input ?? {});
      return { type: "tool_use", id: String(block.id ?? ""), name, input };
    }
    case "tool_result": {
      const t = redactString(resultText(block.content));
      const out = { type: "tool_result", tool_use_id: String(block.tool_use_id ?? ""), content: safe ? cut(t, RESULT_CAP) : t };
      if (block.is_error) out.is_error = true;
      return out;
    }
    default:
      return null;
  }
}

function convertContent(content, safe) {
  if (typeof content === "string") {
    const t = redactString(content);
    return t.trim() ? (safe ? cut(t, TEXT_CAP) : t) : [];
  }
  return Array.isArray(content) ? content.map((b) => convert(b, safe)).filter(Boolean) : [];
}

export async function buildTrace(records, { mode = "safe", truncated = false } = {}) {
  const safe = mode !== "full";
  const nodes = new Map();
  let leaf = null;
  let lastUuid = null;

  for await (const r of records) {
    if (r.type === "last-prompt" && typeof r.leafUuid === "string") {
      leaf = r.leafUuid;
      continue;
    }
    if (typeof r.uuid !== "string" || r.isSidechain === true) continue;
    const parent = typeof r.parentUuid === "string" ? r.parentUuid : null;
    const m = r.message;
    if ((r.type === "user" || r.type === "assistant") && m && typeof m === "object") {
      nodes.set(r.uuid, {
        parent,
        role: r.type,
        msgId: r.type === "assistant" ? m.id ?? null : null,
        content: convertContent(m.content, safe),
      });
    } else {
      nodes.set(r.uuid, { parent, role: null }); // attachment, system: keeps the chain linked
    }
    lastUuid = r.uuid;
  }

  const chain = [];
  const seen = new Set();
  for (let id = nodes.has(leaf) ? leaf : lastUuid; id && nodes.has(id) && !seen.has(id); ) {
    seen.add(id);
    const n = nodes.get(id);
    chain.push(n);
    id = n.parent;
  }
  chain.reverse();

  const messages = [];
  let prev = null;
  for (const n of chain) {
    if (!n.role) continue;
    const empty = Array.isArray(n.content) ? !n.content.length : !n.content;
    if (n.role === "assistant" && prev && prev.msgId && prev.msgId === n.msgId) {
      prev.msg.content.push(...n.content);
      continue;
    }
    if (empty) continue;
    const msg = { role: n.role, content: Array.isArray(n.content) ? [...n.content] : n.content };
    messages.push(msg);
    prev = n.role === "assistant" ? { msgId: n.msgId, msg } : null;
  }

  let toolCalls = 0;
  let errors = 0;
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type === "tool_use") toolCalls++;
      else if (b.is_error) errors++;
    }
  }
  return {
    version: 1,
    source: "claude-code-transcript",
    privacy: safe ? "safe" : "full",
    redaction: "best-effort",
    truncated,
    messages,
    stats: { messages: messages.length, toolCalls, errors },
  };
}

export async function exportTranscript(file, { mode = "safe" } = {}) {
  const stats = {};
  const trace = await buildTrace(readTranscript(file, { stats }), { mode });
  trace.truncated = stats.truncated === true;
  return trace;
}
