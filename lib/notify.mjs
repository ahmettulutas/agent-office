// Desktop notifications: "web-shop needs your OK". The text goes to the
// system tool as arguments, never inside a script, so a project name cannot
// inject anything. AGENT_OFFICE_MUTE=1 (the tests) only logs.

import { spawn } from "node:child_process";

const REASON = {
  permission_prompt: "needs your OK",
  elicitation_dialog: "has a question",
  elicitation_url_dialog: "has a question",
  agent_needs_input: "needs input",
};

// the notification text for an alert from the state machine
export function alertText(a, reminder = false) {
  const who = a.project || "a session";
  const what = REASON[a.reason] || "needs you";
  const by = a.agentType ? ` (${a.agentType})` : "";
  return {
    title: reminder ? "Still waiting for you" : "Agent Office",
    body: `${who}${by} ${what}`,
  };
}

function command(title, body) {
  if (process.platform === "darwin") {
    return ["osascript", ["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", title, body]];
  }
  if (process.platform === "linux") return ["notify-send", ["--app-name=Agent Office", title, body]];
  return null; // Windows: the sound still plays
}

export function notify({ title, body }, log = () => {}) {
  if (process.env.AGENT_OFFICE_MUTE === "1") {
    log(`notify (muted): ${title}: ${body}`);
    return true;
  }
  const cmd = command(String(title).slice(0, 80), String(body).slice(0, 200));
  if (!cmd) return false;
  try {
    spawn(cmd[0], cmd[1], { stdio: "ignore" }).on("error", (err) => log("notify:", err.message));
    return true;
  } catch (err) {
    log("notify:", err.message);
    return false;
  }
}
