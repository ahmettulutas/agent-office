// Turns a raw Claude Code hook payload into the small event the office keeps.
// Prompts, replies, file contents, commands and tool output are never kept:
// only names, a short label per tool call, and the state fields.

const MAX = 80;

export function clean(v, max = MAX) {
  if (typeof v !== "string") return "";
  // drop control and format characters, collapse whitespace
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f]/g, " ").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function base(p) {
  return clean(String(p || "").split(/[\\/]/).filter(Boolean).pop() || "");
}

export function toolDetail(tool, input) {
  if (!input || typeof input !== "object") return "";
  switch (tool) {
    case "Read":
    case "Edit":
    case "Write":
    case "MultiEdit":
      return base(input.file_path);
    case "NotebookEdit":
      return base(input.notebook_path);
    case "Bash":
      // the description is meant for humans; the command itself may hold secrets
      return input.description ? clean(input.description) : clean(String(input.command || "").split(/\s+/)[0], 24);
    case "Grep":
    case "Glob":
      return clean(input.pattern, 40);
    case "WebFetch":
      try {
        return clean(new URL(input.url).hostname);
      } catch {
        return "";
      }
    case "WebSearch":
      return clean(input.query, 50);
    case "Agent":
    case "Task":
      return clean(input.description || input.subagent_type || "");
    case "Skill":
      return clean(input.skill || input.name || "");
    default:
      return "";
  }
}

export function shortTool(tool) {
  if (typeof tool !== "string") return "";
  const m = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (m) {
    const server = m[1].replace(/^[0-9a-f-]{20,}$/i, "mcp").replace(/^plugin_[^_]+_/, "");
    return clean(`${server}:${m[2]}`, 48);
  }
  return clean(tool, 48);
}

export function extract(p) {
  if (!p || typeof p !== "object") return null;
  const event = clean(p.hook_event_name, 40);
  const session = clean(p.session_id, 80);
  if (!event || !session) return null;
  const e = { event, session, t: Date.now() };
  if (p.cwd) e.cwd = String(p.cwd).slice(0, 1024);
  // only its path: the server reads its last few KB to see an Esc interrupt
  if (p.transcript_path && !p.agent_id) e.transcript = String(p.transcript_path).slice(0, 1024);
  if (p.agent_id) e.agentId = clean(p.agent_id, 80);
  if (p.agent_type) e.agentType = clean(p.agent_type, 64);
  if (p.tool_name) {
    e.tool = shortTool(p.tool_name);
    e.detail = toolDetail(p.tool_name, p.tool_input);
    if (p.tool_name === "Agent" || p.tool_name === "Task") {
      e.subagentType = clean(p.tool_input?.subagent_type || "general-purpose", 64);
      e.description = clean(p.tool_input?.description || "");
    }
  }
  if (p.tool_use_id) e.toolUseId = clean(p.tool_use_id, 80);
  if (p.notification_type) e.notification = clean(p.notification_type, 40);
  if (p.source) e.source = clean(p.source, 20);
  if (p.reason) e.reason = clean(p.reason, 40);
  if (p.error) e.error = clean(typeof p.error === "string" ? p.error : p.error?.type || "error", 40);
  const model = typeof p.model === "string" ? p.model : p.model?.display_name || p.model?.id;
  if (model) e.model = clean(model, 40);
  return e;
}
