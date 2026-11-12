// Page state shared by the modules, small DOM helpers, and a tiny event bus
// ("side" redraws the side panel).

export const ui = {
  selectedKey: null,
  hoverKey: null,
  showAllLabels: true,
  following: null,
};

const handlers = new Map();
export function on(name, fn) {
  if (!handlers.has(name)) handlers.set(name, []);
  handlers.get(name).push(fn);
}
export function emit(name, ...args) {
  for (const fn of handlers.get(name) || []) fn(...args);
}

export const SEC = 1000;
export const now = () => Date.now();
export const rand = (a, b) => a + Math.random() * (b - a);

export const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export const STATE_LABEL = { busy: "working", idle: "idle", "needs-you": "needs you", ended: "left", running: "working", done: "done" };

export function relTime(ms) {
  const s = Math.max(0, Math.round((now() - ms) / SEC));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
}

export function reasonText(r) {
  switch (r) {
    case "permission_prompt":
      return "needs your OK";
    case "elicitation_dialog":
    case "elicitation_url_dialog":
    case "question":
      return "has a question";
    case "plan_approval":
      return "wants a plan approved";
    case "agent_needs_input":
      return "needs input";
    default:
      return "needs you";
  }
}
