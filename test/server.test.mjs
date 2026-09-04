import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.HERDR_BIN = '/nonexistent/herdr'; // never touch a real Herdr from the tests
const { startServer } = await import('../server.mjs');

let srv, base, port;
before(async () => { srv = await startServer({ port: 0, host: '127.0.0.1', pollMs: 60000, quiet: true }); base = srv.url; port = srv.port; });
after(async () => { await srv.close(); });

const post = (path, headers = {}) => fetch(base + path, { method: 'POST', headers });
// fetch() refuses to override Host, so raw http for the rebinding test
const getWithHost = (path, host) => new Promise((resolve, reject) => {
  http.request({ host: '127.0.0.1', port, path, headers: { Host: host } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject).end();
});

test('static page and read endpoints answer on the loopback host', async () => {
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/api/version`)).status, 200);
  const state = await (await fetch(`${base}/api/state`)).json();
  assert.equal(state.herdr.running, false); // herdr binary is missing on purpose
  assert.match(state.herdr.error, /herdr was not found/);
});

test('POST from a foreign origin is refused before reaching the handler', async () => {
  assert.equal((await post('/api/prompt?pane=w1:p1&text=hi', { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('/api/agent/close?pane=w1:p1&confirm=yes', { Origin: `http://localhost:${port + 1}` })).status, 403);
  assert.equal((await post('/api/workspace/close?workspace=w1&confirm=yes', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
});

test('POST from our own origin or a non-browser client goes through to validation', async () => {
  // 400 = the handler ran and rejected the bogus pane id, i.e. the guard let it pass
  assert.equal((await post('/api/focus?pane=nope', { Origin: `http://127.0.0.1:${port}`, 'Sec-Fetch-Site': 'same-origin' })).status, 400);
  assert.equal((await post('/api/focus?pane=nope')).status, 400); // curl-style: no Origin, no Sec-Fetch-Site
});

test('requests with a foreign Host header are refused (DNS rebinding)', async () => {
  assert.equal(await getWithHost('/api/state', `attacker.example:${port}`), 421);
  assert.equal(await getWithHost('/api/state', `127.0.0.1:${port + 1}`), 421);
  assert.equal(await getWithHost('/api/state', `localhost:${port}`), 200);
  assert.equal(await getWithHost('/api/state', `[::1]:${port}`), 200);
});
