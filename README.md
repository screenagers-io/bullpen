# Bullpen

A 3D voxel office, in the spirit of [pixel-agents](https://github.com/pixel-agents-hq/pixel-agents), that shows what the coding agents inside [Herdr](https://herdr.dev) are doing right now. Built with three.js, no build step, no npm dependencies. Runs on macOS, Linux and Windows.

## Install

One line per OS, on a machine with nothing on it yet. It installs Herdr, Node.js and Bullpen as needed; re-run it to update Bullpen:

**macOS / Linux**

```sh
curl -fsSL https://raw.githubusercontent.com/screenagers-io/bullpen/main/install.sh | sh
```

**Windows** (PowerShell)

```powershell
irm https://raw.githubusercontent.com/screenagers-io/bullpen/main/install.ps1 | iex
```

The installers bring in what is missing, in this order: [Herdr](https://herdr.dev) through its own installer (into `~/.local/bin` on macOS and Linux, `%LOCALAPPDATA%\Programs\Herdr` on Windows), then Node.js (a private copy under `~/.bullpen/node` with no sudo on macOS and Linux; Node LTS through winget on Windows, along with Git), then Bullpen itself (under `~/.bullpen` with a `bullpen` command in `~/.local/bin`, plus `~/Applications/Bullpen.app` on macOS; npm's per-user global folder plus a Desktop shortcut on Windows). Set `BULLPEN_NO_HERDR=1` to leave Herdr alone.

Afterwards, open a new terminal and run `herdr` (the workspace where agents live), then `bullpen`. Herdr drives agent CLIs such as Claude Code, Codex or Gemini CLI, so install at least one, for example `npm install -g @anthropic-ai/claude-code`; the installer lists the ones it can already see.

Already have Node 18.17+ and Git? This works everywhere too:

```sh
npm install -g git+https://github.com/screenagers-io/bullpen.git
```

## Run

`bullpen` starts a local server on http://127.0.0.1:4877 and opens it in your browser. Run it again and it notices the server is already up and just opens the page. Stop it with Ctrl+C (on Windows, closing the console window).

| Flag | Meaning |
| --- | --- |
| `-p, --port <n>` | port to listen on (default 4877, or the `PORT` variable) |
| `--host <addr>` | address to bind (default 127.0.0.1; use 0.0.0.0 to reach it from another device on your LAN) |
| `--herdr <path>` | which herdr binary to use, if it is not on PATH (or `HERDR_BIN`) |
| `--poll <ms>` | how often to ask Herdr for a snapshot (default 1000) |
| `--demo` | open the office with fake agents, no Herdr required |
| `--no-open` | start the server without opening a browser |

The page itself needs no network access: three.js and the two fonts are vendored under `public/vendor` by `npm run vendor`, which is the only script that ever goes online.

### What differs per OS

- **Finding Herdr.** The binary is looked up on PATH, then in Herdr's installer folders: `~/.local/bin`, Homebrew, Nix and mise on Unix; `%LOCALAPPDATA%\Programs\Herdr\bin` on Windows. Agent-kind detection reads Herdr's `agent-detection/status.toml`, found under `$XDG_STATE_HOME` or `~/.local/state`, and on Windows under `%LOCALAPPDATA%\herdr` or `%APPDATA%\herdr`. Set `BULLPEN_HERDR_STATE` if yours lives somewhere else.
- **Finding agent CLIs.** The **+ Agent** list only offers kinds whose CLI exists. On Unix that check uses your login shell's PATH (so npm and pipx globals count); on Windows it uses the current PATH plus `%APPDATA%\npm`, scoop shims and cargo, with `.exe`/`.cmd` resolution.
- **Open in Herdr terminal.** On macOS it raises the terminal app hosting the Herdr TUI, or opens Terminal.app running `herdr` if none is attached. On Linux it opens the first terminal emulator it finds (x-terminal-emulator, gnome-terminal, konsole, kitty, alacritty, wezterm, foot, xterm). On Windows it opens Windows Terminal, or a console window. Raising an already-open window is macOS only; elsewhere the pane is focused inside Herdr and the window is left where it is.
- Claude transcripts are read from `~/.claude/projects` (or `$CLAUDE_CONFIG_DIR/projects`) on every OS.

Windows support in Herdr itself is in beta; Bullpen's Windows paths were written against Herdr's documentation and have not been exercised on a Windows machine yet, so [issues](https://github.com/screenagers-io/bullpen/issues) are welcome.

**Security note.** The server binds to 127.0.0.1 and refuses POST requests that carry a foreign `Origin` or `Sec-Fetch-Site` header, and any request whose `Host` header does not name the server, so web pages you visit cannot drive your Herdr session through Bullpen. There is no authentication: if you bind to a LAN address with `--host`, anyone on that network can control your agents.

One cosy voxel office diorama: everything solid is built from unit cubes with a tiny in-page voxel builder (`Vox`). Walnut plank floor on a dark plinth, beige walls with white cornice and skirting, a bay window with lace valance and sun shafts striping the floor, a gallery wall of botanical prints, wall shelves with plush toys, a lounge with a knit armchair and flowered rug, a meeting table, a help desk, and a mustard backdrop.

Top-right buttons: **Orbit** auto-rotates, **Fit** resets the camera, **List** hides the side panel.

## Action bar

The bar along the bottom does real work in Herdr, not just in the view:

- **+ Agent** starts a coding agent. The kind list shows only agent CLIs actually installed on this machine, found by checking your login shell's PATH against the kinds Herdr can launch. Pick the kind, the workspace, an optional name, and whether it gets its own tab or splits an existing pane. The server creates the pane, then runs `herdr agent start` in it.
- **+ Workspace** creates a Herdr workspace from a folder. Type a path and end it with `/` to list subfolders as suggestions.
- **Customize** restyles the office: Warm oak, Nordic, Walnut, Studio, Sakura or Midnight. The choice is remembered in this browser.
- **Blocked (n)** appears only when agents are waiting on you and jumps the camera to the next one. `b` does the same.
- **?** opens the legend and keyboard shortcuts.

Per-item actions live in a **⋯ menu** on each row of the side list, so nothing destructive sits one stray click away:

- **Agent ⋯** (or right-click the character): open in the Herdr terminal, focus in Herdr, follow it in the office, read its terminal, send it a prompt, rename it, **change its avatar**, and **close agent** at the bottom in orange. The avatar picker offers all ten figures plus Auto, which returns to the kind-based casting; the choice is remembered per agent session in this browser.
- **Shell ⋯** on a pane with no agent: focus, look at it, read its terminal, **start an agent here** in that existing shell, and **close shell**.

Every menu starts with **Open in Herdr terminal**: it focuses that pane in Herdr and brings the terminal window running the Herdr TUI to the front. If nothing is attached to the session, it starts Herdr in a new Terminal window, which reattaches to the session already running.
- **Workspace ⋯** on the heading: focus it, add an agent to it, and **close workspace**.

Closing an agent ends its session and its Herdr pane, and closes the tab too if that was the tab's last pane. Closing a workspace lists every agent that would be ended, and requires typing the workspace name when any are running.

Both close endpoints refuse unless the request carries an explicit confirmation flag.

**Characters.** The cast is the ten figures from the cool-characters project, vendored under `public/characters/` as plain three.js modules: Nova, Moss, Pixel, Rivet, Juno, Koda, Luma, Ember, Milo and Echo, each defined as a colour set plus an accessory and build type. Agent kinds are cast to figures, so every claude is Luma, every codex is Rivet the robot, gemini is Nova and so on, with a small hue shift per agent so two of the same kind still differ. Kinds without a mapping draw from the whole roster. Change the casting in the `KIND_CAST` table; add or edit a figure in `public/characters/roster.js`.

The rig has hips, knees, shoulders, elbows, a head and a coffee cup on the right forearm. The idle, walking, sitting, typing and coffee poses are ported from that project's stage; wave, talk and fidget were added for the help desk, the meeting table and the queue, and finishing a task triggers the project's celebration hop.

**Landscape.** Blocky trees, bushes and fallen logs stand on the ground around the platform. They are placed by walking out along a ray until it leaves the platform rectangle, then padding beyond it, so nothing ever pokes up through the floor. The corner nearest the default camera is kept sparse so the view into the office stays clear.

**Wall ornaments.** Bunting runs under the cornice on both walls. On the left wall there is a working clock showing the real time, a pink neon "SHIP IT" sign, and above the bed a kanban board whose sticky notes are the agents themselves, sorted into Idle, Doing, Needs You and Done in the state colours. An LED strip along the cornice shifts colour with the office mood: orange while anyone is blocked, green while agents are working, warm white when quiet. A vine trails from the back-right corner, and a coat stand and fire extinguisher sit by the door.

**Branding.** The Screenagers mark hangs on the left wall above the desks, built from voxels rather than pasted on as a flat image. `assets/Screenagers-logo.svg` is the source, and `assets/rasterise-logo.cjs` is the one-off script that samples it onto the voxel grid and snaps each pixel to the logo's own gradient stops. The resulting map is embedded in the page as the `LOGO` constant, so there is no runtime dependency on the SVG.

Clutter that carries live data:

- **Easel** shows the focused Herdr pane's terminal output, refreshed every few seconds.
- **Gallery wall**: one framed chart per workspace with tool calls per minute over the last 30 minutes. Spare frames hold botanical prints.
- **Mascot shelf** on the left wall: one voxel Rocky, the five-legged stone alien from *Project Hail Mary*, per agent kind with a live agent. Each wears its provider's brand colour (Anthropic clay, OpenAI green, Gemini blue-violet, Copilot purple, and so on, from the `KIND_COLORS` table), with Rocky's green patches on the shell and knees, or cream patches where the brand itself is green; the kinds currently working bounce, idle ones sit dimmed, and the shelf empties when nothing is running.
- **Bank plants** grow with that workspace's recent tool activity.
- **Floor papers** pile up around a desk once its stack is full of edits, and are tidied when the agent goes idle.
- **Bed**: an idle agent with no transcript activity for 30 minutes goes for a nap with a 💤 bubble.
- **Time of day**: the window light, sun colour and beams follow the wall clock (dawn, day, evening, night). Add `?hour=19` to the URL to preview a time.

- One **bank of desks per Herdr workspace** (its own rug and sign), one **white desk per pane**, an animated character per detected agent. The desk lamp glows with the agent's state.
- **working** → sits at the desk typing, code scrolls on the monitor, a bubble shows the current tool (📖 read, ✏️ edit, ⚙️ run, 👥 subagent, 💬 question). Edits stack paper on the desk; runs flash the screen.
- **idle** → stays seated at the desk for the first minute, resting, then walks to the lounge and sits on the sofa or armchair (or stands by the coffee table) sipping coffee. The timer runs from the last activity in the transcript, so an agent that has just finished a turn doesn't leap straight for the coffee machine.
- **done** → takes a chair at the meeting table with a ✓.
- **blocked** → walks to the help desk and queues in arrival order. The one at the counter waves with a "?" until you answer; the others fidget in line and shuffle forward.
- **Sub-agents** → come in through the door, huddle around the parent's desk while they run, then leave.
- **Chat bubbles** → your new prompts and each tool call appear as fading speech bubbles; an event feed at the bottom-left logs state changes.
- **Gold ring** on the floor marks the pane that has focus in Herdr.
- Click a character, desk or list row to **focus that pane in Herdr**; double-click to **read its recent terminal output**.

## Run from this checkout

One click on macOS: open **Bullpen** from `~/Applications` (there is an alias on the Desktop; drag it to the Dock if you like). It starts the server if it is not already running and opens the browser. Its launcher script lives at `Bullpen.app/Contents/Resources/launcher.sh` and logs to `~/Library/Logs/bullpen.log`. A cross-platform `bullpen install-app` that writes this launcher for you is planned.

From a terminal:

```bash
cd ~/Development/herdr-office
npm run dev          # server + browser; same as: node bin/bullpen.mjs
npm start            # server only, on http://127.0.0.1:4877
npm test             # unit tests for the platform helpers
```

Try it without Herdr: `bullpen --demo` or `http://127.0.0.1:4877/?demo=1`.

Environment variables: `PORT` (4877), `HOST` (127.0.0.1), `HERDR_BIN` (`herdr`), `POLL_MS` (1000), `BULLPEN_HERDR_STATE` (Herdr's state folder), `CLAUDE_CONFIG_DIR` (`~/.claude`).

## How it works

`server.mjs` polls `herdr api snapshot` once a second and merges in per-agent activity from the Claude Code transcript that Herdr links to each pane (`~/.claude/projects/<cwd>/<session-id>.jsonl`, tail only, cached by file size). The merged state streams to the browser over Server-Sent Events at `/events`; `/api/focus` and `/api/read` wrap `herdr agent focus`, `herdr tab focus` and `herdr pane read`.

Only Claude Code sessions get tool-level detail today, because that is the transcript format the server parses. Other agents Herdr detects (codex, gemini, …) still get a character and the idle/working/blocked state from Herdr itself.

## Controls

Drag to orbit, scroll to zoom, right-drag to pan. `f` fits the camera, `b` jumps to the next blocked agent, `Esc` closes a dialog or the terminal popup and stops following. Click a character to focus its pane in Herdr, double-click to read its terminal, right-click for its menu.

**Following.** Clicking an agent in the side list, or choosing *Follow in office* from its menu, locks the camera onto that agent and tracks it as it walks, sits or queues. You can still orbit and zoom around it while following. A chip at the top left names who is being followed; click it, press `Esc`, or press **Fit** to let go.
