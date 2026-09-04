#!/usr/bin/env node
// Bullpen command line: starts the server (or finds one already running) and opens the browser.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { startServer, VERSION } = await import(pathToFileURL(path.join(here, '..', 'server.mjs')).href);

const HELP = `bullpen ${VERSION} — a 3D voxel office for the coding agents inside Herdr

Usage: bullpen [options]

  -p, --port <n>       port to listen on            (default 4877, env PORT)
      --host <addr>    address to bind              (default 127.0.0.1, env HOST)
      --herdr <path>   herdr binary to use          (default: found on PATH, env HERDR_BIN)
      --poll <ms>      Herdr polling interval       (default 1000, env POLL_MS)
      --demo           open the office with fake agents (no Herdr needed)
      --no-open        start the server without opening a browser
  -v, --version        print the version
  -h, --help           show this help

Requires Herdr (https://herdr.dev) running on this machine for live data.
Press Ctrl+C to stop.`;

const opts = { port: Number(process.env.PORT || 4877), host: process.env.HOST || '127.0.0.1', pollMs: Number(process.env.POLL_MS || 1000), open: true, demo: false };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i], next = () => { if (i + 1 >= argv.length) fail(`${a} needs a value`); return argv[++i]; };
  if (a === '-h' || a === '--help') { console.log(HELP); process.exit(0); }
  else if (a === '-v' || a === '--version') { console.log(VERSION); process.exit(0); }
  else if (a === '-p' || a === '--port') opts.port = Number(next());
  else if (a.startsWith('--port=')) opts.port = Number(a.slice(7));
  else if (a === '--host') opts.host = next();
  else if (a === '--herdr') process.env.HERDR_BIN = next();
  else if (a === '--poll') opts.pollMs = Number(next());
  else if (a === '--demo') opts.demo = true;
  else if (a === '--no-open') opts.open = false;
  else if (a === '--open') opts.open = true;
  else fail(`unknown option ${a}\n\n${HELP}`);
}
if (!Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535) fail('port must be a number between 0 and 65535');
if (!Number.isFinite(opts.pollMs) || opts.pollMs < 200) fail('poll interval must be at least 200 ms');

function fail(msg) { console.error(`bullpen: ${msg}`); process.exit(2); }

function openBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true });
    child.on('error', () => console.log(`open ${url} in your browser`));
    child.unref();
  } catch { console.log(`open ${url} in your browser`); }
}

async function alreadyRunning(url) {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 1500);
    const res = await fetch(`${url}/api/version`, { signal: ctl.signal }); clearTimeout(t);
    if (!res.ok) return null;
    const j = await res.json();
    return j && j.name === 'bullpen' ? j : null;
  } catch { return null; }
}

let url;
try {
  ({ url } = await startServer(opts));
} catch (err) {
  if (err.code === 'EADDRINUSE') {
    const base = `http://${opts.host}:${opts.port}`;
    const other = await alreadyRunning(base);
    if (other) {
      console.log(`bullpen ${other.version} is already running at ${base}`);
      if (opts.open) openBrowser(opts.demo ? `${base}/?demo=1` : base);
      process.exit(0);
    }
    fail(`port ${opts.port} is in use by something else; pick another with --port`);
  }
  fail(err.message);
}
if (opts.open) openBrowser(opts.demo ? `${url}/?demo=1` : url);
if (!opts.open && opts.demo) console.log(`demo: ${url}/?demo=1`);

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { console.log('\nbullpen stopped'); process.exit(0); });
