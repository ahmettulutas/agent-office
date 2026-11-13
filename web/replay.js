// Turns a TraceExport v1 (safe mode) into flat timeline rows. Pure: no DOM,
// no network. The panel draws the rows with textContent only.

const SHOW = 160; // characters of text shown per row
const MAX_ROWS = 400;

const short = (s) => {
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length > SHOW ? `${t.slice(0, SHOW)}…` : t;
};

export function timelineRows(trace) {
  const rows = [];
  const messages = trace && Array.isArray(trace.messages) ? trace.messages : [];
  const names = new Map(); // tool_use id -> tool name
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : Array.isArray(m.content) ? m.content : [];
    for (const b of blocks) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "text" && typeof b.text === "string") {
        if (b.text.trim()) rows.push({ kind: m.role === "user" ? "user" : "reply", label: m.role === "user" ? "You" : "Claude", text: short(b.text), error: false });
      } else if (b.type === "tool_use") {
        const name = typeof b.name === "string" ? b.name : "tool";
        names.set(String(b.id), name);
        const d = b.input && typeof b.input.detail === "string" ? b.input.detail : "";
        rows.push({ kind: "tool", label: name, text: short(d), error: false });
      } else if (b.type === "tool_result") {
        const name = names.get(String(b.tool_use_id)) || "tool";
        rows.push({ kind: "result", label: `${name} result`, text: short(typeof b.content === "string" ? b.content : ""), error: b.is_error === true });
      }
    }
  }
  const more = Math.max(0, rows.length - MAX_ROWS);
  return { rows: rows.slice(-MAX_ROWS), omitted: more, truncated: !!(trace && trace.truncated) };
}
