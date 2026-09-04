#!/usr/bin/env node
// Bullpen server: streams live Herdr agent state to a 3D office in the browser.
// Zero dependencies. Requires the `herdr` binary (found on PATH or in Herdr's usual install folders).
// Runs on macOS, Linux and Windows; see the "platform" section for what differs per OS.

import http from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const run = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
export const VERSION = JSON.parse(fsSync.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version;
const PORT = Number(process.env.PORT || 4877);
const HOST = process.env.HOST || '127.0.0.1';
const POLL_MS = Number(process.env.POLL_MS || 1000);
const TAIL_BYTES = 256 * 1024;

// ------------------------------------------------------------------ platform

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const HOME = os.homedir();
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
const APPDATA = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
const XDG_STATE = process.env.XDG_STATE_HOME || path.join(HOME, '.local', 'state');
const XDG_CONFIG = process.env.XDG_CONFIG_HOME || path.join(HOME, '.config');

// Where Herdr's installers put the binary when it is not on this process's PATH
// (GUI launchers and Windows services often start with a minimal PATH).
const HERDR_BIN_DIRS = IS_WIN
  ? [path.join(LOCALAPPDATA, 'Programs', 'Herdr', 'bin'), path.join(HOME, '.herdr', 'bin'), path.join(APPDATA, 'npm')]
  : [path.join(HOME, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/home/linuxbrew/.linuxbrew/bin', path.join(HOME, '.nix-profile', 'bin'), path.join(HOME, '.local', 'share', 'mise', 'shims')];
// Herdr keeps agent-detection state under XDG_STATE_HOME on Unix; on Windows the location is not documented,
// so every plausible folder is tried and the first one holding status.toml wins.
const HERDR_STATE_DIRS = [
  process.env.BULLPEN_HERDR_STATE,
  path.join(XDG_STATE, 'herdr'),
  IS_WIN && path.join(LOCALAPPDATA, 'herdr'),
  IS_WIN && path.join(APPDATA, 'herdr'),
  path.join(XDG_CONFIG, 'herdr'),
  IS_MAC && path.join(HOME, 'Library', 'Application Support', 'herdr'),
].filter(Boolean);
const CLAUDE_PROJECTS = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude'), 'projects');
// Windows resolves bare command names through PATHEXT; real .exe first, script shims last.
const EXEC_EXTS = IS_WIN
  ? ['.exe', '.com', ...(process.env.PATHEXT || '.BAT;.CMD').split(';').map((e) => e.toLowerCase()).filter((e) => e && e !== '.exe' && e !== '.com')]
  : [''];

function pathDirs(envPath = process.env.PATH) { return [...new Set(String(envPath || '').split(path.delimiter).filter(Boolean))]; }
async function isExecutable(file) {
  try { await fs.access(file, IS_WIN ? fsSync.constants.F_OK : fsSync.constants.X_OK); return (await fs.stat(file)).isFile(); } catch { return false; }
}
async function findInDirs(name, dirs) {
  const names = IS_WIN && !/\.[a-z0-9]+$/i.test(name) ? EXEC_EXTS.map((e) => name + e) : [name];
  for (const d of dirs) for (const n of names) { const f = path.join(d, n); if (await isExecutable(f)) return f; }
  return null;
}
// cmd.exe script shims (.cmd/.bat) cannot be exec'd directly; they need a shell and CRT-style quoting.
const needsShell = (bin) => IS_WIN && /\.(cmd|bat)$/i.test(bin);
function cmdQuote(a) {
  if (/^[\w.:\\/=@%+,-]+$/.test(a)) return a;
  return `"${a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

let herdrPath = null;
let herdrLookupAt = 0;
async function herdrBinPath() {
  if (herdrPath) return herdrPath;
  if (Date.now() - herdrLookupAt < 5000) return null; // do not hammer the filesystem while herdr is absent
  herdrLookupAt = Date.now();
  const want = process.env.HERDR_BIN || 'herdr';
  herdrPath = path.isAbsolute(want) || want.includes(path.sep) || want.includes('/')
    ? ((await isExecutable(want)) ? want : null)                       // explicit path: use it only if it exists
    : await findInDirs(want, [...pathDirs(), ...HERDR_BIN_DIRS]);
  return herdrPath;
}
function herdrMissingMessage() {
  const want = process.env.HERDR_BIN;
  if (want && (path.isAbsolute(want) || want.includes(path.sep) || want.includes('/'))) return `herdr was not found at ${want} (from HERDR_BIN / --herdr).`;
  return `herdr was not found on PATH or in ${HERDR_BIN_DIRS.join(', ')}. Install it from https://herdr.dev or set HERDR_BIN.`;
}

// ---------------------------------------------------------------- herdr calls

function herdrError(err, args) {
  // execFile rejects with "Command failed: …" and buries the reason in stdout/stderr
  const out = String(err.stdout || '').trim(), errText = String(err.stderr || '').trim();
  try { const j = JSON.parse(out); if (j.error) return `${j.error.message || JSON.stringify(j.error)}${j.error.code ? ` (${j.error.code})` : ''}`; } catch { /* not json */ }
  if (errText) return errText.split('\n').filter(Boolean).slice(-3).join(' · ');
  if (out) return out.split('\n').filter(Boolean).slice(-3).join(' · ');
  if (err.killed || /ETIMEDOUT|timed out/i.test(String(err.message))) return `herdr ${args.slice(0, 2).join(' ')} timed out`;
  return String(err.message || err);
}
async function herdr(args, { json = true, timeout = 5000 } = {}) {
  const bin = await herdrBinPath();
  if (!bin) { const e = new Error(herdrMissingMessage()); e.herdr = true; throw e; }
  let stdout;
  try {
    const opts = { timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true };
    ({ stdout } = needsShell(bin)
      ? await run(cmdQuote(bin), args.map(cmdQuote), { ...opts, shell: true })
      : await run(bin, args, opts));
  } catch (err) {
    if (err.code === 'ENOENT') herdrPath = null; // binary vanished (uninstall / update); re-resolve next time
    const e = new Error(herdrError(err, args)); e.herdr = true; throw e;
  }
  if (!json) return stdout;
  const parsed = JSON.parse(stdout);
  if (parsed.error) throw new Error(parsed.error.message || JSON.stringify(parsed.error));
  return parsed.result;
}

// ------------------------------------------------------- transcript activity

const transcriptPathCache = new Map(); // sessionId -> path | null
const transcriptCache = new Map(); // path -> { size, mtimeMs, activity }

function encodeCwd(cwd) {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

async function findTranscript(sessionId, cwd) {
  if (transcriptPathCache.has(sessionId)) return transcriptPathCache.get(sessionId);
  const candidates = [];
  if (cwd) candidates.push(path.join(CLAUDE_PROJECTS, encodeCwd(cwd), `${sessionId}.jsonl`));
  let found = null;
  for (const c of candidates) {
    if (fsSync.existsSync(c)) { found = c; break; }
  }
  if (!found) {
    try {
      const dirs = await fs.readdir(CLAUDE_PROJECTS);
      for (const d of dirs) {
        const p = path.join(CLAUDE_PROJECTS, d, `${sessionId}.jsonl`);
        if (fsSync.existsSync(p)) { found = p; break; }
      }
    } catch { /* no projects dir */ }
  }
  transcriptPathCache.set(sessionId, found);
  return found;
}

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'ToolSearch']);
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const RUN_TOOLS = new Set(['Bash', 'Monitor']);
const AGENT_TOOLS = new Set(['Agent', 'Task', 'Workflow', 'SendMessage']);
const ASK_TOOLS = new Set(['AskUserQuestion']);

function categorize(name) {
  if (READ_TOOLS.has(name)) return 'read';
  if (WRITE_TOOLS.has(name)) return 'write';
  if (RUN_TOOLS.has(name)) return 'run';
  if (AGENT_TOOLS.has(name)) return 'agent';
  if (ASK_TOOLS.has(name)) return 'ask';
  if (name && name.startsWith('mcp__')) return 'mcp';
  return 'other';
}

function summarize(name, input = {}) {
  const trunc = (s, n = 60) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  if (input.file_path) return path.basename(String(input.file_path));
  if (input.notebook_path) return path.basename(String(input.notebook_path));
  if (name === 'Bash' && input.command) return trunc(String(input.command).split('\n')[0].trim());
  if (input.pattern) return trunc(String(input.pattern), 40);
  if (input.description) return trunc(String(input.description), 50);
  if (input.url) { try { return new URL(String(input.url)).host; } catch { return trunc(String(input.url), 40); } }
  if (input.query) return trunc(String(input.query), 40);
  if (input.prompt) return trunc(String(input.prompt), 50);
  return '';
}

function parseActivity(lines) {
  const entries = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { /* partial line */ }
  }
  const main = entries.filter((e) => !e.isSidechain);
  const pendingAgents = new Set();
  const pendingTools = new Set();
  let lastTool = null;
  let lastUserPrompt = null;
  let lastTs = null;
  let lastAssistantTs = null;
  let toolCount = 0;
  let firstTs = null;
  const toolTimes = [];

  for (const e of main) {
    if (e.timestamp) { lastTs = e.timestamp; if (!firstTs) firstTs = e.timestamp; }
    const content = e.message && Array.isArray(e.message.content) ? e.message.content : null;
    if (e.type === 'assistant') {
      lastAssistantTs = e.timestamp || lastAssistantTs;
      if (content) {
        for (const c of content) {
          if (c && c.type === 'tool_use') {
            toolCount++;
            if (e.timestamp) toolTimes.push(e.timestamp);
            pendingTools.add(c.id);
            if (AGENT_TOOLS.has(c.name)) pendingAgents.add(c.id);
            lastTool = { name: c.name, category: categorize(c.name), detail: summarize(c.name, c.input), at: e.timestamp || null, id: c.id };
          }
        }
      }
    } else if (e.type === 'user') {
      if (content) {
        let isResult = false;
        for (const c of content) {
          if (c && c.type === 'tool_result') {
            isResult = true;
            pendingTools.delete(c.tool_use_id);
            pendingAgents.delete(c.tool_use_id);
          }
        }
        if (!isResult) {
          const text = content.filter((c) => c && c.type === 'text').map((c) => c.text).join(' ');
          if (text) lastUserPrompt = { text: text.slice(0, 160), at: e.timestamp || null };
        }
      } else if (e.message && typeof e.message.content === 'string') {
        lastUserPrompt = { text: e.message.content.slice(0, 160), at: e.timestamp || null };
      }
    }
  }
  return {
    lastTool,
    toolInFlight: lastTool ? pendingTools.has(lastTool.id) : false,
    pendingAgents: pendingAgents.size,
    lastUserPrompt,
    lastTs,
    firstTs,
    lastAssistantTs,
    toolCountInWindow: toolCount,
    toolTimes: toolTimes.slice(-400),
  };
}

async function readActivity(sessionId, cwd) {
  const file = await findTranscript(sessionId, cwd);
  if (!file) return null;
  let st;
  try { st = await fs.stat(file); } catch { return null; }
  const cached = transcriptCache.get(file);
  if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) return cached.activity;
  const start = Math.max(0, st.size - TAIL_BYTES);
  const fh = await fs.open(file, 'r');
  try {
    const buf = Buffer.alloc(st.size - start);
    await fh.read(buf, 0, buf.length, start);
    let text = buf.toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    const activity = parseActivity(text.split('\n'));
    activity.transcript = file;
    transcriptCache.set(file, { size: st.size, mtimeMs: st.mtimeMs, activity });
    return activity;
  } finally {
    await fh.close();
  }
}

// ------------------------------------------------- opening the real Herdr TUI

// ---------------------------------------------------- terminal integration
// "Open in Herdr terminal" needs to know whether a Herdr TUI is attached and, on macOS, which .app hosts it.

async function psList() { // unix only
  const { stdout } = await run('ps', IS_MAC ? ['-axo', 'pid=,ppid=,comm='] : ['-eo', 'pid=,ppid=,comm='], { timeout: 5000 });
  return stdout.split('\n').map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean)
    .map((m) => ({ pid: +m[1], ppid: +m[2], comm: m[3] }));
}
// the herdr command line that is a TUI (no subcommand, or a session attach) rather than the background server
function isTuiCommandLine(argv) {
  if (!argv || !argv.length) return false;
  const exe = argv[0].replace(/^["']|["']$/g, '');
  if (!/(^|[\\/])herdr(\.exe)?$/i.test(exe)) return false;
  const rest = argv.slice(1).join(' ').trim();
  return rest === '' || /^(--session|--remote|session attach)/.test(rest);
}
async function findHerdrClient() {
  if (IS_WIN) {
    const ps = 'Get-CimInstance Win32_Process -Filter "Name = \'herdr.exe\'" | ForEach-Object { "$($_.ProcessId)\t$($_.CommandLine)" }';
    const { stdout } = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 15000, windowsHide: true });
    for (const line of stdout.split(/\r?\n/)) {
      const m = line.match(/^(\d+)\t(.*)$/); if (!m) continue;
      const argv = m[2].match(/"[^"]*"|\S+/g) || [];
      if (isTuiCommandLine(argv)) return +m[1];
    }
    return null;
  }
  const { stdout } = await run('ps', IS_MAC ? ['-axo', 'pid=,args='] : ['-eo', 'pid=,args='], { timeout: 5000 });
  for (const line of stdout.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.*)$/); if (!m) continue;
    if (isTuiCommandLine(m[2].split(/\s+/))) return +m[1];
  }
  return null;
}
// macOS: walk up the process tree to the .app bundle that owns the window
async function hostAppOf(pid) {
  if (!IS_MAC) return null;
  const list = await psList(); const byPid = new Map(list.map((p) => [p.pid, p]));
  let cur = byPid.get(pid);
  for (let i = 0; i < 12 && cur && cur.pid > 1; i++) {
    const m = cur.comm.match(/^(.*?\.app)\/Contents\/MacOS\//);
    if (m) return m[1];
    cur = byPid.get(cur.ppid);
  }
  return null;
}
// nothing attached: open a terminal window running `herdr`, which attaches to the session already running
async function launchHerdrTerminal() {
  const bin = await herdrBinPath();
  if (!bin) throw new Error(herdrMissingMessage());
  if (IS_MAC) {
    await run('osascript', ['-e', `tell application "Terminal" to do script "exec ${bin.replace(/"/g, '\\"')}"`, '-e', 'tell application "Terminal" to activate'], { timeout: 15000 });
    return 'Terminal';
  }
  if (IS_WIN) {
    const wt = await findInDirs('wt', [...pathDirs(), path.join(LOCALAPPDATA, 'Microsoft', 'WindowsApps')]);
    if (wt) { spawnDetached(wt, [bin]); return 'Windows Terminal'; }
    spawnDetached('cmd.exe', ['/d', '/c', 'start', '"Herdr"', bin], { windowsVerbatimArguments: true });
    return 'Console';
  }
  // Linux: first terminal emulator that exists
  const terms = [['x-terminal-emulator', ['-e', bin]], ['gnome-terminal', ['--', bin]], ['konsole', ['-e', bin]], ['xfce4-terminal', ['-e', bin]], ['kitty', [bin]], ['alacritty', ['-e', bin]], ['wezterm', ['start', '--', bin]], ['foot', [bin]], ['xterm', ['-e', bin]]];
  for (const [name, args] of terms) {
    const exe = await findInDirs(name, pathDirs());
    if (exe) { spawnDetached(exe, args); return name; }
  }
  throw new Error('no terminal emulator found; run `herdr` in a terminal yourself');
}
function spawnDetached(cmd, args, extra = {}) {
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false, ...extra });
  child.on('error', () => { /* reported by the caller's fallback */ });
  child.unref();
}

// ------------------------------------------------------------- agent kinds

let herdrStatusFile = null;
async function findHerdrStatusFile() {
  if (herdrStatusFile && fsSync.existsSync(herdrStatusFile)) return herdrStatusFile;
  for (const d of HERDR_STATE_DIRS) {
    const f = path.join(d, 'agent-detection', 'status.toml');
    if (fsSync.existsSync(f)) return (herdrStatusFile = f);
  }
  return null;
}
let kindsCache = { at: 0, kinds: [] };
async function agentKinds() {
  if (Date.now() - kindsCache.at < 60000) return kindsCache.kinds;
  try {
    const file = await findHerdrStatusFile();
    if (!file) throw new Error('no status.toml');
    const text = await fs.readFile(file, 'utf8');
    const kinds = [...text.matchAll(/^\[agents\.([a-z0-9_-]+)\]/gm)].map((m) => m[1]);
    kindsCache = { at: Date.now(), kinds };
  } catch { kindsCache = { at: Date.now(), kinds: [] }; }
  return kindsCache.kinds;
}

// Herdr can launch two dozen agent kinds; only offer the ones whose CLI is actually here.
const KIND_BINARIES = { copilot: ['copilot', 'github-copilot'], cursor: ['cursor-agent', 'cursor'], qwen: ['qwen', 'qwen-code'], kimi: ['kimi', 'kimi-code'], qodercli: ['qodercli', 'qoder'], mastracode: ['mastracode', 'mastra'] };
// Agent CLIs are usually installed by npm/pipx/brew and only appear on the user's login-shell PATH,
// which a launcher-started server may not have. Merge that with our own PATH and the usual folders.
let toolDirs = null;
async function shellDirs() {
  if (toolDirs) return toolDirs;
  let login = '';
  if (!IS_WIN) {
    const shell = process.env.SHELL || '/bin/sh';
    try { ({ stdout: login } = await run(shell, ['-lc', 'printf %s "$PATH"'], { timeout: 6000 })); }
    catch { try { ({ stdout: login } = await run('/bin/sh', ['-lc', 'printf %s "$PATH"'], { timeout: 6000 })); } catch { /* keep going */ } }
  }
  const extra = IS_WIN
    ? [path.join(APPDATA, 'npm'), path.join(LOCALAPPDATA, 'Programs'), path.join(HOME, '.cargo', 'bin'), path.join(HOME, 'scoop', 'shims')]
    : [path.join(HOME, '.local', 'bin'), path.join(HOME, '.cargo', 'bin'), path.join(HOME, '.bun', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
  toolDirs = [...new Set([...pathDirs(login.trim()), ...pathDirs(), ...HERDR_BIN_DIRS, ...extra])];
  return toolDirs;
}
async function isInstalled(kind, dirs) {
  for (const name of KIND_BINARIES[kind] || [kind]) if (await findInDirs(name, dirs)) return true;
  return false;
}
let startableCache = { at: 0, kinds: [], all: [] };
async function startableKinds() {
  if (Date.now() - startableCache.at < 300000 && startableCache.all.length) return startableCache;
  let all = [];
  try {
    const out = await herdr(['completion', 'zsh'], { json: false, timeout: 8000 });
    const m = out.match(/KIND:\(([^)]*)\)/);
    all = m ? m[1].trim().split(/\s+/) : [];
  } catch { /* herdr not reachable */ }
  const dirs = await shellDirs();
  const kinds = [];
  for (const k of all) if (await isInstalled(k, dirs)) kinds.push(k);
  startableCache = { at: Date.now(), kinds, all };
  return startableCache;
}

// ------------------------------------------------------------- state builder

async function buildState() {
  const ts = Date.now();
  let snapshot;
  try {
    ({ snapshot } = await herdr(['api', 'snapshot']));
  } catch (err) {
    return { ts, herdr: { running: false, error: String(err.message || err) }, workspaces: [], focused: {} };
  }

  const paneActivity = new Map();
  await Promise.all(
    (snapshot.panes || []).map(async (p) => {
      const sess = p.agent_session;
      if (!sess || sess.kind !== 'id' || !sess.value) return;
      try {
        const act = await readActivity(sess.value, p.cwd);
        if (act) paneActivity.set(p.pane_id, act);
      } catch { /* ignore transcript errors */ }
    }),
  );

  const tabsByWs = new Map();
  for (const t of snapshot.tabs || []) {
    if (!tabsByWs.has(t.workspace_id)) tabsByWs.set(t.workspace_id, []);
    tabsByWs.get(t.workspace_id).push({ id: t.tab_id, label: t.label, number: t.number, focused: t.focused, agent_status: t.agent_status, panes: [] });
  }
  const tabById = new Map();
  for (const list of tabsByWs.values()) for (const t of list) tabById.set(t.id, t);

  const agentByPane = new Map((snapshot.agents || []).map((a) => [a.pane_id, a]));
  for (const p of snapshot.panes || []) {
    const tab = tabById.get(p.tab_id);
    if (!tab) continue;
    const ag = agentByPane.get(p.pane_id);
    tab.panes.push({
      id: p.pane_id,
      cwd: p.cwd,
      cwdName: path.basename(p.cwd || '') || p.cwd,
      agent: p.agent || null,
      name: (ag && ag.name) || null,
      agent_status: p.agent_status || 'unknown',
      focused: !!p.focused,
      title: p.terminal_title_stripped || null,
      rawTitle: p.terminal_title || null,
      sessionId: p.agent_session && p.agent_session.kind === 'id' ? p.agent_session.value : null,
      activity: paneActivity.get(p.pane_id) || null,
    });
  }

  const workspaces = (snapshot.workspaces || []).map((w) => ({
    id: w.workspace_id,
    label: w.label,
    number: w.number,
    focused: w.focused,
    agent_status: w.agent_status,
    active_tab_id: w.active_tab_id,
    tabs: (tabsByWs.get(w.workspace_id) || []).sort((a, b) => a.number - b.number),
  }));

  return {
    ts,
    agentKinds: await agentKinds(),
    ...(({ kinds, all }) => ({ startableKinds: kinds, allKinds: all }))(await startableKinds()),
    herdr: { running: true, version: snapshot.version, protocol: snapshot.protocol },
    focused: { workspace: snapshot.focused_workspace_id, tab: snapshot.focused_tab_id, pane: snapshot.focused_pane_id },
    workspaces,
  };
}

// ---------------------------------------------------------------- SSE + HTTP

const clients = new Set();
let lastPayload = '';
let lastSentAt = 0;
let latestState = null;
let polling = false;

function broadcast(payload) {
  for (const res of clients) {
    res.write(`data: ${payload}\n\n`);
  }
}

async function poll() {
  if (polling) return;
  polling = true;
  try {
    const state = await buildState();
    latestState = state;
    const { ts, ...rest } = state;
    const payload = JSON.stringify(rest);
    const now = Date.now();
    if (payload !== lastPayload || now - lastSentAt > 10000) {
      lastPayload = payload;
      lastSentAt = now;
      broadcast(JSON.stringify(state));
    }
  } catch (err) {
    console.error('[bullpen] poll failed:', err.message);
  } finally {
    polling = false;
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };

async function serveStatic(reqPath, res) {
  const rel = reqPath === '/' ? '/index.html' : reqPath;
  const file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(rel)));
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    const data = await fs.readFile(file);
    const cache = rel.startsWith('/vendor/') ? 'public, max-age=86400' : 'no-cache'; // vendored libs are versioned by path
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(obj));
}

const PANE_ID = /^w[0-9a-z]+:p[0-9a-z]+$/i;

function findTabForPane(paneId) {
  for (const w of (latestState && latestState.workspaces) || []) for (const t of w.tabs) for (const p of t.panes) if (p.id === paneId) return t.id;
  return null;
}

// ------------------------------------------------------------ request guard
// The POST endpoints drive the user's Herdr session (start agents, send prompts, close workspaces).
// A web page in the same browser could otherwise fire such requests at 127.0.0.1 (CSRF), and a DNS
// rebinding attack could point a public hostname at the loopback address. So: the Host header must
// name this server, and a POST must come from our own origin (or from a non-browser client, which
// sends neither Origin nor Sec-Fetch-Site).
let boundHost = HOST, boundPort = PORT;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1', '0.0.0.0', '[::]', '::']);
function allowedHost(hostHeader) {
  if (!hostHeader) return false;
  const m = hostHeader.match(/^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/); if (!m) return false;
  const name = m[1].toLowerCase(), port = m[2] ? Number(m[2]) : 80;
  if (port !== boundPort) return false;
  if (LOOPBACK.has(boundHost)) return LOOPBACK.has(name) && name !== '0.0.0.0' && name !== '[::]' && name !== '::';
  return name === boundHost.toLowerCase() || LOOPBACK.has(name) || /^(\[?[0-9a-f:.]+\]?)$/i.test(name); // bound to a LAN address on purpose
}
function guard(req, res) {
  if (!allowedHost(req.headers.host)) { sendJson(res, 421, { error: 'unexpected Host header' }); return false; }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.origin, site = req.headers['sec-fetch-site'];
    if (origin && origin.toLowerCase() !== `http://${req.headers.host.toLowerCase()}`) { sendJson(res, 403, { error: 'cross-origin request refused' }); return false; }
    if (site && site !== 'same-origin' && site !== 'none') { sendJson(res, 403, { error: 'cross-site request refused' }); return false; }
  }
  return true;
}

const server = http.createServer(async (req, res) => {
  if (!guard(req, res)) return;
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(': connected\n\n');
      clients.add(res);
      if (latestState) res.write(`data: ${JSON.stringify(latestState)}\n\n`);
      const keepalive = setInterval(() => res.write(': ping\n\n'), 15000);
      req.on('close', () => { clearInterval(keepalive); clients.delete(res); });
      return;
    }
    if (url.pathname === '/api/version') {
      return sendJson(res, 200, { name: 'bullpen', version: VERSION, platform: process.platform, herdr: await herdrBinPath() });
    }
    if (url.pathname === '/api/state') {
      return sendJson(res, 200, latestState || (await buildState()));
    }
    if (url.pathname === '/api/focus' && req.method === 'POST') {
      const pane = url.searchParams.get('pane') || '';
      if (!PANE_ID.test(pane)) return sendJson(res, 400, { error: 'bad pane id' });
      // Agent panes accept `agent focus <pane>`; plain shell panes fall back to focusing their tab.
      let result;
      try { result = await herdr(['agent', 'focus', pane]); }
      catch {
        const tabId = findTabForPane(pane);
        if (!tabId) throw new Error(`no tab found for ${pane}`);
        result = await herdr(['tab', 'focus', tabId]);
      }
      setTimeout(poll, 150);
      return sendJson(res, 200, { ok: true, result });
    }
    if (url.pathname === '/api/rename' && req.method === 'POST') {
      const pane = url.searchParams.get('pane') || '';
      if (!PANE_ID.test(pane)) return sendJson(res, 400, { error: 'bad pane id' });
      const name = (url.searchParams.get('name') || '').trim();
      if (name && !/^[a-z][a-z0-9_-]{0,31}$/.test(name)) return sendJson(res, 400, { error: 'name must match [a-z][a-z0-9_-]{0,31}' });
      try {
        const result = await herdr(name ? ['agent', 'rename', pane, name] : ['agent', 'rename', pane, '--clear']);
        setTimeout(poll, 150);
        return sendJson(res, 200, { ok: true, result });
      } catch (err) { return sendJson(res, 400, { error: String(err.message || err) }); }
    }
    if (url.pathname === '/api/agent/new' && req.method === 'POST') {
      const wsId = url.searchParams.get('workspace') || '';
      const kind = url.searchParams.get('kind') || '';
      const placement = url.searchParams.get('placement') === 'split' ? 'split' : 'tab';
      const intoPane = url.searchParams.get('pane') || '';   // start in a shell pane that already exists
      let name = (url.searchParams.get('name') || '').trim();
      if (intoPane && !PANE_ID.test(intoPane)) return sendJson(res, 400, { error: 'bad pane id' });
      if (!intoPane && !/^w[0-9a-z]+$/i.test(wsId)) return sendJson(res, 400, { error: 'bad workspace id' });
      const { kinds, all } = await startableKinds();
      if (all.length && !all.includes(kind)) return sendJson(res, 400, { error: `unknown agent kind "${kind}"` });
      if (kinds.length && !kinds.includes(kind)) return sendJson(res, 400, { error: `${kind} is not installed on this machine` });
      if (name && !/^[a-z][a-z0-9_-]{0,31}$/.test(name)) return sendJson(res, 400, { error: 'name must match [a-z][a-z0-9_-]{0,31}' });
      const state = latestState || (await buildState());
      const ws = state.workspaces.find((w) => (intoPane ? w.tabs.some((t) => t.panes.some((q) => q.id === intoPane)) : w.id === wsId));
      if (!ws) return sendJson(res, 400, { error: intoPane ? 'pane not found' : 'workspace not found' });
      const panes = ws.tabs.flatMap((t) => t.panes);
      if (intoPane) {
        const target = panes.find((q) => q.id === intoPane);
        if (target.agent) return sendJson(res, 400, { error: `${target.agent} is already running in that pane` });
      }
      const cwd = (panes[0] && panes[0].cwd) || os.homedir();
      if (!name) {
        const taken = new Set(panes.map((p) => p.name).filter(Boolean));
        let i = 1; while (taken.has(`${kind}-${i}`)) i++; name = `${kind}-${i}`;
      }
      try {
        let paneId = intoPane;
        if (intoPane) { /* use the shell that is already there */ }
        else if (placement === 'split') {
          const target = panes[panes.length - 1];
          if (!target) return sendJson(res, 400, { error: 'no pane to split' });
          const r = await herdr(['pane', 'split', '--pane', target.id, '--direction', 'right', '--cwd', cwd, '--no-focus']);
          paneId = r.pane && r.pane.pane_id;
        } else {
          const r = await herdr(['tab', 'create', '--workspace', wsId, '--cwd', cwd, '--label', name, '--no-focus']);
          paneId = r.root_pane && r.root_pane.pane_id;
        }
        if (!paneId) return sendJson(res, 500, { error: 'could not create a pane' });
        try {
          await herdr(['agent', 'start', name, '--kind', kind, '--pane', paneId, '--timeout', '90000'], { timeout: 120000 });
        } catch (err) {
          const msg = String(err.message || err);
          setTimeout(poll, 200);
          if (/agent_not_ready/.test(msg)) return sendJson(res, 200, { ok: true, warning: 'agent started but is not ready yet', pane: paneId, name });
          return sendJson(res, 400, { error: `${kind} did not start in ${paneId}: ${msg}`, pane: paneId });
        }
        setTimeout(poll, 200);
        return sendJson(res, 200, { ok: true, pane: paneId, name });
      } catch (err) { return sendJson(res, 400, { error: String(err.message || err) }); }
    }
    if (url.pathname === '/api/workspace/new' && req.method === 'POST') {
      let cwd = (url.searchParams.get('cwd') || '').trim();
      const label = (url.searchParams.get('label') || '').trim();
      if (!cwd) return sendJson(res, 400, { error: 'folder is required' });
      if (cwd.startsWith('~')) cwd = path.join(os.homedir(), cwd.slice(1));
      cwd = path.resolve(cwd);
      try { if (!(await fs.stat(cwd)).isDirectory()) throw new Error('not a directory'); }
      catch { return sendJson(res, 400, { error: `no such folder: ${cwd}` }); }
      try {
        const args = ['workspace', 'create', '--cwd', cwd, '--no-focus'];
        if (label) args.push('--label', label);
        const r = await herdr(args, { timeout: 15000 });
        setTimeout(poll, 200);
        return sendJson(res, 200, { ok: true, result: r });
      } catch (err) { return sendJson(res, 400, { error: String(err.message || err) }); }
    }
    if (url.pathname === '/api/prompt' && req.method === 'POST') {
      const pane = url.searchParams.get('pane') || '';
      const text = url.searchParams.get('text') || '';
      if (!PANE_ID.test(pane)) return sendJson(res, 400, { error: 'bad pane id' });
      if (!text.trim()) return sendJson(res, 400, { error: 'prompt is empty' });
      try {
        const r = await herdr(['agent', 'prompt', pane, text], { timeout: 20000 });
        setTimeout(poll, 300);
        return sendJson(res, 200, { ok: true, result: r });
      } catch (err) { return sendJson(res, 400, { error: String(err.message || err) }); }
    }
    if (url.pathname === '/api/dirs') {
      let dir = (url.searchParams.get('path') || '~').trim();
      if (dir.startsWith('~')) dir = path.join(os.homedir(), dir.slice(1));
      try {
        const entries = await fs.readdir(path.resolve(dir), { withFileTypes: true });
        const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => path.join(path.resolve(dir), e.name)).sort().slice(0, 200);
        return sendJson(res, 200, { path: path.resolve(dir), dirs });
      } catch (err) { return sendJson(res, 400, { error: String(err.message || err) }); }
    }
    if (url.pathname === '/api/agent/close' && req.method === 'POST') {
      const pane = url.searchParams.get('pane') || '';
      const scope = url.searchParams.get('scope') === 'tab' ? 'tab' : 'pane';
      if (url.searchParams.get('confirm') !== 'yes') return sendJson(res, 400, { error: 'confirmation required' });
      if (!PANE_ID.test(pane)) return sendJson(res, 400, { error: 'bad pane id' });
      const state = latestState || (await buildState());
      let tabId = null, siblings = 0;
      for (const w of state.workspaces) for (const t of w.tabs) for (const q of t.panes) if (q.id === pane) { tabId = t.id; siblings = t.panes.length; }
      if (!tabId) return sendJson(res, 400, { error: 'pane not found' });
      try {
        // closing the last pane of a tab leaves an empty tab behind, so close the tab instead
        const useTab = scope === 'tab' || siblings <= 1;
        const r = await herdr(useTab ? ['tab', 'close', tabId] : ['pane', 'close', pane], { timeout: 15000 });
        setTimeout(poll, 250);
        return sendJson(res, 200, { ok: true, closed: useTab ? tabId : pane, result: r });
      } catch (err) { return sendJson(res, 400, { error: String(err.message || err) }); }
    }
    if (url.pathname === '/api/workspace/close' && req.method === 'POST') {
      const wsId = url.searchParams.get('workspace') || '';
      if (url.searchParams.get('confirm') !== 'yes') return sendJson(res, 400, { error: 'confirmation required' });
      if (!/^w[0-9a-z]+$/i.test(wsId)) return sendJson(res, 400, { error: 'bad workspace id' });
      const state = latestState || (await buildState());
      if (!state.workspaces.some((w) => w.id === wsId)) return sendJson(res, 400, { error: 'workspace not found' });
      try {
        const r = await herdr(['workspace', 'close', wsId], { timeout: 15000 });
        setTimeout(poll, 250);
        return sendJson(res, 200, { ok: true, closed: wsId, result: r });
      } catch (err) { return sendJson(res, 400, { error: String(err.message || err) }); }
    }
    if (url.pathname === '/api/open-terminal' && req.method === 'POST') {
      const pane = url.searchParams.get('pane') || '';
      const dry = url.searchParams.get('dry') === '1';
      if (pane && !PANE_ID.test(pane)) return sendJson(res, 400, { error: 'bad pane id' });
      try {
        if (pane && !dry) { // put Herdr on that pane before raising the window
          try { await herdr(['agent', 'focus', pane]); }
          catch { const tabId = findTabForPane(pane); if (tabId) await herdr(['tab', 'focus', tabId]); }
        }
        const clientPid = await findHerdrClient();
        const app = clientPid ? await hostAppOf(clientPid) : null;
        if (dry) return sendJson(res, 200, { ok: true, dry: true, clientPid, app, wouldLaunch: !clientPid });
        if (app) {
          await run('open', ['-a', app], { timeout: 8000 });
          return sendJson(res, 200, { ok: true, action: 'raised', app, pid: clientPid });
        }
        if (clientPid) return sendJson(res, 200, { ok: true, action: 'focused', note: 'Herdr is attached in a terminal this app cannot raise' });
        const launched = await launchHerdrTerminal();
        return sendJson(res, 200, { ok: true, action: 'launched', app: launched });
      } catch (err) { return sendJson(res, 400, { error: String(err.message || err) }); }
    }
    if (url.pathname === '/api/read') {
      const pane = url.searchParams.get('pane') || '';
      if (!PANE_ID.test(pane)) return sendJson(res, 400, { error: 'bad pane id' });
      const lines = String(Math.min(200, Math.max(5, Number(url.searchParams.get('lines') || 40))));
      const text = await herdr(['pane', 'read', pane, '--lines', lines, '--format', 'text'], { json: false });
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(text);
    }
    if (url.pathname === '/api/explain') {
      const pane = url.searchParams.get('pane') || '';
      if (!PANE_ID.test(pane)) return sendJson(res, 400, { error: 'bad pane id' });
      const text = await herdr(['agent', 'explain', pane], { json: false });
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(text);
    }
    return serveStatic(url.pathname, res);
  } catch (err) {
    return sendJson(res, 500, { error: String(err.message || err) });
  }
});

export function startServer({ port = PORT, host = HOST, pollMs = POLL_MS, quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, async () => {
      boundHost = host; boundPort = server.address().port;
      const url = `http://${host.includes(':') ? `[${host}]` : host}:${boundPort}`;
      const bin = await herdrBinPath();
      if (!quiet) {
        console.log(`bullpen ${VERSION}  →  ${url}   (herdr: ${bin || 'not found'}, polling every ${pollMs}ms)`);
        if (!bin) console.warn(`[bullpen] ${herdrMissingMessage()}`);
      }
      poll();
      const timer = setInterval(poll, pollMs);
      timer.unref();
      resolve({ url, port: boundPort, server, close: () => { clearInterval(timer); for (const c of clients) c.end(); return new Promise((r) => server.close(r)); } });
    });
  });
}

export const internals = { pathDirs, findInDirs, cmdQuote, needsShell, isTuiCommandLine, HERDR_BIN_DIRS, HERDR_STATE_DIRS };

// `node server.mjs` still works as before; `bin/bullpen.mjs` imports startServer instead.
const invokedDirectly = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) startServer().catch((err) => { console.error(`[bullpen] ${err.message}`); process.exit(1); });
