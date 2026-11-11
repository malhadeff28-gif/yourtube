'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

test('unavailable chat directory reports an error and can be retried', { timeout: 10000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yourtube-watcher-'));
  const sessions = path.join(dir, 'missing-sessions');
  const settings = path.join(dir, 'settings.json');
  fs.writeFileSync(settings, JSON.stringify({ enabled: true }));
  const socket = http.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], { cwd: path.resolve(__dirname, '..'), env: {
    ...process.env, YOURTUBE_PORT: String(port), YOURTUBE_SESSIONS_DIR: sessions,
    YOURTUBE_FEED: path.join(dir, 'feed.json'), YOURTUBE_SETTINGS: settings,
  }, stdio: 'ignore' });
  t.after(async () => {
    if (child.exitCode === null) {
      const done = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM');
      await done;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(`${base}/feed.json`)).ok) break; } catch {}
    await delay(30);
  }
  const setLive = () => fetch(`${base}/api/live`, { method: 'POST',
    headers: { 'content-type': 'application/json', origin: base }, body: '{"enabled":true}' });
  let status = await (await setLive()).json();
  assert.equal(status.mode, 'error');
  assert.equal(status.enabled, false);
  assert.equal(status.watcherReady, false);
  assert.match(status.message, /Retry/);
  assert.equal(JSON.parse(fs.readFileSync(settings)).enabled, false);
  fs.mkdirSync(sessions);
  status = await (await setLive()).json();
  assert.equal(status.mode, 'listening');
  assert.equal(status.enabled, true);
  assert.equal(status.watcherReady, true);
});
