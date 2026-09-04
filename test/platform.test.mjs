import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { internals } from '../server.mjs';

const { pathDirs, findInDirs, cmdQuote, needsShell, isTuiCommandLine, HERDR_BIN_DIRS } = internals;

test('pathDirs splits on the platform delimiter and drops empties/duplicates', () => {
  const p = ['/a', '', '/b', '/a'].join(path.delimiter);
  assert.deepEqual(pathDirs(p), ['/a', '/b']);
  assert.deepEqual(pathDirs(''), []);
});

test('findInDirs finds an executable file and ignores directories', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bullpen-'));
  const exe = process.platform === 'win32' ? 'tool.exe' : 'tool';
  await fs.writeFile(path.join(dir, exe), '#!/bin/sh\n', { mode: 0o755 });
  await fs.mkdir(path.join(dir, 'other'));
  assert.equal(await findInDirs('tool', ['/nope', dir]), path.join(dir, exe));
  assert.equal(await findInDirs('other', [dir]), null);
  assert.equal(await findInDirs('missing', [dir]), null);
});

test('herdr TUI detection accepts attach command lines and rejects the server', () => {
  assert.equal(isTuiCommandLine(['/Users/x/.local/bin/herdr']), true);
  assert.equal(isTuiCommandLine(['herdr', '--session', 'work']), true);
  assert.equal(isTuiCommandLine(['herdr', 'session', 'attach', 'work']), true);
  assert.equal(isTuiCommandLine(['"C:\\Users\\x\\AppData\\Local\\Programs\\Herdr\\bin\\herdr.exe"']), true);
  assert.equal(isTuiCommandLine(['herdr', 'server']), false);
  assert.equal(isTuiCommandLine(['herdr', 'api', 'snapshot']), false);
  assert.equal(isTuiCommandLine(['/usr/bin/node', 'herdr']), false);
  assert.equal(isTuiCommandLine([]), false);
});

test('cmd.exe quoting leaves plain tokens alone and escapes quotes', () => {
  assert.equal(cmdQuote('api'), 'api');
  assert.equal(cmdQuote('C:\\Programs\\Herdr\\bin\\herdr.cmd'), 'C:\\Programs\\Herdr\\bin\\herdr.cmd');
  assert.equal(cmdQuote('hello world'), '"hello world"');
  assert.equal(cmdQuote('say "hi"'), '"say \\"hi\\""');
  assert.equal(cmdQuote('trail\\'), 'trail\\'); // plain token, backslash is harmless unquoted
  assert.equal(cmdQuote('trail path\\'), '"trail path\\\\"');
  assert.equal(needsShell('herdr.exe'), false);
});

test('herdr install folders are platform specific', () => {
  const joined = HERDR_BIN_DIRS.join('|');
  if (process.platform === 'win32') assert.match(joined, /Programs[\\/]Herdr[\\/]bin/);
  else assert.match(joined, /\.local[\\/]bin/);
});
