'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const root = path.resolve(__dirname, '..');

async function freePort() {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitFor(check, message, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(30);
  }
  throw new Error(message);
}

function readStatus(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(`${url}/events`, response => {
      let buffer = '';
      response.on('data', chunk => {
        buffer += chunk;
        const match = buffer.match(/event: status\ndata: ([^\n]+)\n\n/);
        if (match) {
          response.destroy();
          resolve(JSON.parse(match[1]));
        }
      });
      response.on('error', reject);
    });
    request.on('error', reject);
    request.setTimeout(3000, () => request.destroy(new Error('status timed out')));
  });
}

async function setLive(url, enabled, origin = url) {
  return fetch(`${url}/api/live`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ enabled }),
  });
}

function userEvent(text) {
  return JSON.stringify({ type: 'response_item', payload: {
    type: 'message', role: 'user', content: [{ type: 'input_text', text }],
  } }) + '\n';
}

test('fresh startup, consent, pause, and restart', { timeout: 15000 }, async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yourtube-test-'));
  const sessions = path.join(temp, 'sessions');
  fs.mkdirSync(sessions);
  const session = path.join(sessions, 'session.jsonl');
  fs.writeFileSync(session, JSON.stringify({ type: 'session_meta', payload: {
    originator: 'Codex Desktop', source: 'vscode', thread_source: 'user',
  } }) + '\n');
  const marker = path.join(temp, 'codex-calls');
  const fakeCodex = path.join(temp, 'fake-codex');
  fs.writeFileSync(fakeCodex, `#!/usr/bin/env node\nrequire('node:fs').appendFileSync(process.env.TEST_MARKER, 'called\\n');\nprocess.stdin.resume();\nprocess.exitCode = 1;\n`, { mode: 0o755 });
  const feed = path.join(temp, 'feed.json');
  const settings = path.join(temp, 'settings.json');
  // Simulate a stale setting left by an older version after a failed pause write.
  fs.writeFileSync(settings, JSON.stringify({ enabled: true }));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  let child;
  async function start() {
    child = spawn(process.execPath, ['server.js'], { cwd: root, env: {
      ...process.env, YOURTUBE_PORT: String(port), YOURTUBE_SESSIONS_DIR: sessions,
      YOURTUBE_FEED: feed, YOURTUBE_SETTINGS: settings, YOURTUBE_CODEX: fakeCodex,
      YOURTUBE_DEBOUNCE_MS: '40', TEST_MARKER: marker,
    }, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    await waitFor(async () => {
      if (child.exitCode !== null) throw new Error(`server exited: ${stderr}`);
      try { return (await fetch(`${url}/feed.json`)).ok; } catch { return false; }
    }, 'server failed to start');
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const done = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM');
    await done;
  }
  t.after(async () => { await stop(); fs.rmSync(temp, { recursive: true, force: true }); });

  await start();
  const malformedUrlResponse = await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.write(`GET http://[ HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
    });
    let response = '';
    socket.on('data', chunk => { response += chunk; });
    socket.on('end', () => resolve(response));
    socket.on('error', reject);
    socket.setTimeout(3000, () => socket.destroy(new Error('request timed out')));
  });
  assert.match(malformedUrlResponse, /^HTTP\/1\.1 400\b/, 'invalid URL syntax must be rejected');
  assert.equal((await fetch(`${url}/%ZZ`)).status, 400, 'malformed percent escapes must be rejected');
  assert.equal((await fetch(`${url}/feed.json`)).status, 200, 'malformed requests must not terminate the server');
  const initial = await (await fetch(`${url}/feed.json`)).json();
  assert.deepEqual(initial.contexts, []);
  assert.deepEqual(initial.videos, []);
  assert.equal((await readStatus(url)).mode, 'paused');
  const stale = await fetch(`${url}/api/live`, { method:'POST', headers:{'content-type':'application/json',origin:url}, body:JSON.stringify({enabled:true,expectedEnabled:true}) });
  assert.equal(stale.status,409,'a stale expected state must not enable Live');
  assert.equal((await readStatus(url)).mode, 'paused');
  const demo = await (await fetch(`${url}/demo.html`)).text();
  assert.match(demo, /SAMPLE MODE/);
  assert.doesNotMatch(demo, /<(?:script|img|iframe)\b/i, 'sample page must not load model or video content');

  const rejected = await setLive(url, true, 'https://untrusted.example');
  assert.equal(rejected.status, 403);
  assert.equal((await readStatus(url)).mode, 'paused');
  const stale = await fetch(`${url}/api/live`, { method:'POST', headers:{'content-type':'application/json',origin:url}, body:JSON.stringify({enabled:true,expectedEnabled:true}) });
  assert.equal(stale.status, 409, 'a stale client must not enable Live');
  assert.equal((await readStatus(url)).mode, 'paused');

  fs.appendFileSync(session, userEvent('A private message sent while the app is paused.'));
  await delay(250);
  assert.equal(fs.existsSync(marker), false, 'paused events must not invoke Codex');

  assert.equal((await setLive(url, true)).status, 200);
  await delay(250);
  assert.equal(fs.existsSync(marker), false, 'enabling must not replay paused events');
  fs.appendFileSync(session, userEvent('A fresh work message after live mode is enabled.'));
  await waitFor(() => fs.existsSync(marker), 'new live event did not invoke the fake Codex');

  await stop();
  await start();
  assert.equal((await readStatus(url)).mode, 'paused', 'restart must not restore live consent');
  const callsBeforePausedEvent = fs.readFileSync(marker, 'utf8');
  fs.appendFileSync(session, userEvent('A synthetic message sent after the service restarted.'));
  await delay(250);
  assert.equal(fs.readFileSync(marker, 'utf8'), callsBeforePausedEvent, 'restart must not send paused messages to Codex');
  await setLive(url, true);
  assert.equal((await setLive(url, false)).status, 200);
  await stop();
  await start();
  assert.equal((await readStatus(url)).mode, 'paused');
});
