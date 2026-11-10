# Agent Office

A live 3D office of your Claude Code agents, seen from above at an angle. Each session is a lead at a
desk, and each subagent is a coworker who walks in and works in the room that
fits its type. When it finishes, it hands its paper to the lead and leaves.
Idle leads go to the cafe and the lounge, and a session that waits for you
stands up, waves, shows a red `!`, a sound of your choice plays and a desktop
notification says which session it is.

It runs by itself: Claude Code hooks start the server the first time a session
reports anything, and open the page when a session starts and no page is open.

No dependencies, Node 20+ only. Everything stays on `127.0.0.1`.

## Setup

```bash
cd ~/Desktop/projects/agent-office
npm link                  # puts the agent-office command on your PATH
agent-office install      # adds async hooks to ~/.claude/settings.json (backs it up first)
```

Without `npm link`, run the same commands as `node bin/agent-office.mjs <command>`.

That's all. Run `claude` (or open a session in the desktop app) and the office
opens at <http://127.0.0.1:47800/>.

To try it with no real sessions:

```bash
agent-office demo
```

## Commands

| command | what it does |
| --- | --- |
| `install [--yes]` | add the hooks to `~/.claude/settings.json`, after yours; a backup goes to `~/.agent-office/backups/` |
| `uninstall [--yes]` | remove exactly those hooks (they all end in `# agent-office`) |
| `start [--no-open]` | run the server in this terminal |
| `on` / `off` | run it in the background, or stop it |
| `open` | open the page, starting the server if needed |
| `status` | running or not, hooks installed or not, which sound |
| `sound on` / `sound off` | turn the sound on or off |
| `sound list` / `sound use <name>` | list the sounds, or pick one |
| `sound test [name]` | play the chosen sound, or another one, now |
| `demo [--short]` | three fake sessions and their subagents for about a minute |

`npm test` runs the tests: the state machine and privacy filter, the floor plan
and paths, the 3D draw order, the sounds, and a real server in a temporary home
(host and origin checks, settings, sound, notifications, reminders, Esc).

## The office

| room | who works there |
| --- | --- |
| Leads row | your sessions, one desk each |
| Research | `Explore`, analysts, web fetch, docs and guide agents |
| Meeting room | `Plan`, orchestrators, architects |
| Review & QA | reviewers, testers, security and audit agents |
| Dev floor | everyone else (`general-purpose`, developers, workers) |
| Cafe, lounge | idle leads on a break: coffee, sofa, ping-pong, arcade, bean bags |

When a room is full, the rest sit on the dev floor. When every desk is taken,
people work standing in the corridor with a laptop, and move to a desk as soon
as one is free.

Controls: wheel, trackpad pinch or `+`/`-` to zoom, drag to pan, double-click
to zoom in, `0` to fit the floor again, click someone for details, `F` to
follow them, `L` for name tags, `N` for the lighting (auto follows your clock,
or force day or night), `S` for Settings, `B` to turn the sound on or off,
`Esc` to clear. On a touch screen: drag with one finger, pinch with two, tap
to select, double tap to zoom in.

Zoomed out, where people are only a few pixels tall, each one gets a pin in the
colour of their state: green working, orange a subagent at work, red waiting for
you (it bounces), grey idle.

Everything is drawn in code, in an isometric 3D view at screen resolution, so
it stays sharp at any zoom. Every object is a lit 3D model: walls with windows
that show the sky and city of the hour, glass partitions with frosted room
names, desks with monitors, keyboards and mugs, mesh office chairs, bookcases,
server racks, a cafe counter with an espresso machine and pendant lamps, a
lounge with a sofa, TV, ping-pong table and arcade cabinets. Things cast soft
shadows away from the windows, sunlight falls through the panes by day, and
lamps, screens and arcades light up the dark at night. People are small 3D
figures with faces, hair and outfits, so walking, sitting, typing and waving
look right from every side: leads wear a blazer and tie, subagents wear their
team colour and a badge. They walk the shortest way, cutting across rooms in
straight lines, and step aside when they pass each other.

The page, in `web/`:

| file | what it holds |
| --- | --- |
| `app.js` | the frame loop and the live data |
| `office.js` | what people do: seats, breaks, hand-offs, walking |
| `render.js` | drawing a frame: layers, light, pins, labels |
| `camera.js` | zoom, pan and follow |
| `input.js` | mouse, touch and keys |
| `panel.js`, `settings.js` | the side panel and the settings panel |
| `map.js` | the floor plan and path finding |
| `iso.js` | the projection and 3D primitives |
| `scene.js` | walls, glass, draw order and the static layer |
| `furniture.js` | every piece of furniture |
| `people.js`, `look.js` | people and how each one looks |
| `floors.js` | floors, rugs and the time of day |

## The sound

When a session or one of its subagents starts waiting for you (a permission
prompt, a question, or a request for input), the server plays a sound. It
plays on the server, not in the page, so it works with the page closed and is
not blocked by the browser. Several agents asking at once play it once (at most
every 6 seconds), and a session that is already waiting does not play it again.

Pick it in **Settings** in the page header (or press `S`): a switch turns it
on or off, and each sound has a Play button to hear it first. The choice is
saved to `~/.agent-office/config.json`, so the terminal and the page agree.

| sound | what it is |
| --- | --- |
| `bell` | Brass bell: three strikes of a hand bell, loud and bright (default) |
| `alarm` | Alarm clock: a fast ringing bell for a second and a half, the hardest to miss |
| `ship` | Ship's bell: two pairs of strikes, lower and fuller |
| `chime` | Door chime: a two-note ding-dong, gentler |
| `beeps` | Digital beeps: three short pairs of electronic beeps |
| `gong` | Gong: one deep, slow strike |

Each sound is synthesised in code on first use into `~/.agent-office/sounds/`,
at full volume, and played with `afplay` on macOS, `paplay` or `aplay` on
Linux, and PowerShell on Windows. How loud it is then depends on your system
volume.

## Notifications and reminders

Next to the sound, a desktop notification says who is waiting and why, for
example "web-shop (Explore) needs your OK". On macOS it comes from Script
Editor: if none appears, allow Script Editor in System Settings, Notifications.
On Linux it uses `notify-send`.

While a session keeps waiting, the sound and the notification come again every
few minutes (3 by default) until you answer. Both are in Settings.

## How it works

```
claude ──hook (async)──▶ bin/hook.mjs ──POST /api/event──▶ bin/server.mjs ──SSE──▶ web/app.js
                              │ server down?                  │ state machine (lib/state.mjs)
                              └─▶ starts it in the background  └─▶ ~/.agent-office/state.json
```

- **Hooks**: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
  `PostToolUseFailure`, `Notification`, `Stop`, `StopFailure`, `SubagentStart`,
  `SubagentStop`, `SessionEnd`. They are `async`, so Claude never waits for them,
  and they always exit 0 without printing.
- **States**: a prompt makes a session `busy`, `Stop` makes it `idle`, a permission
  or question notification makes it `needs-you` until the next tool result,
  `SessionEnd` walks it out. Sessions that report nothing for 6 hours are dropped.
- **Esc**: an interrupt fires no hook, but Claude Code writes
  `[Request interrupted by user]` into the session's transcript. The server
  watches the end of the transcript of a working session and makes it `idle`
  within about two seconds. If that ever fails, `busy` still falls back to
  `idle` after 15 minutes without news.
- **Subagents**: tool events from inside a subagent carry its `agent_id` and
  `agent_type`. The label is the `description` of the matching `Agent` call.

## Privacy

The hook keeps only names: the event, the session id, the project folder name,
the tool name and a short label (a file's base name, a Bash command's
`description`, a search pattern, a URL's host). It never keeps prompts, replies,
file contents, full commands or tool output. The server listens on
`127.0.0.1` only, refuses other `Host` headers (DNS rebinding), and takes events
only as JSON from no origin or its own.

To spot an Esc, the server reads the last 16 KB of a working session's
transcript, only for files under `~/.claude/projects/`, and only looks for the
interrupt record. Nothing from the transcript is kept, shown or sent; the page
never learns the transcript's path.

## Settings

`~/.agent-office/config.json` (all optional):

```json
{
  "port": 47800,
  "openBrowser": "when-closed",
  "forgetAfterHours": 6,
  "bell": true,
  "sound": "bell",
  "notify": true,
  "remindMinutes": 3
}
```

`openBrowser` is `when-closed` (open the page when a session starts and none is
open, at most every 10 minutes), `on-start` (only when the server starts) or
`never`. `bell` turns the sound on or off, `sound` picks it, `notify` turns the
desktop notification on or off, and `remindMinutes` is 0, 1, 3, 5 or 10 (0: no
reminders). `AGENT_OFFICE_PORT` overrides the port.

Files: `~/.agent-office/` holds `state.json`, `run.json`, `server.log` and the
settings backups.

## Credits

Ideas from [clalt](https://github.com/dhitalkamal/clalt) (MIT): the hook-fed state
machine, the room per agent type and the paper hand-off. Also from
[office-for-claude-agents](https://github.com/percheniy/office-for-claude-agents):
the office and the idle activities. No code or art was copied: everything is
drawn in code.
