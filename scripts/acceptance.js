'use strict';

// Uses only a disposable synthetic session, feed, and settings directory.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const mode = process.argv[2];
if (!['--mock', '--live'].includes(mode) || process.argv.length !== 3) {
  console.error('Usage: node scripts/acceptance.js --mock | --live');
  process.exit(2);
}
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yourtube-acceptance-'));
const sessions = path.join(temp, 'sessions'); fs.mkdirSync(sessions);
const session = path.join(sessions, 'session.jsonl');
fs.writeFileSync(session, JSON.stringify({ type: 'session_meta', payload: { originator: 'Codex Desktop', source: 'vscode', thread_source: 'user' } }) + '\n');
const feed = path.join(temp, 'feed.json'), settings = path.join(temp, 'settings.json');
let child;
async function waitFor(fn, timeout, message) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await fn(); if (result) return result; await delay(100); }
  throw Error(message);
}
function status(base) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${base}/events`, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; const match = text.match(/event: status\ndata: ([^\n]+)\n\n/); if (match) { res.destroy(); resolve(JSON.parse(match[1])); } });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(Error('status request timed out')));
  });
}
async function post(base, endpoint, value) {
  const response = await fetch(`${base}${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(value) });
  if (!response.ok) throw Error(`${endpoint} returned ${response.status}`);
  return response.json();
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const done = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await done;
}
async function main() {
  const socket = http.createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, YOURTUBE_PORT: String(port), YOURTUBE_SESSIONS_DIR: sessions, YOURTUBE_FEED: feed, YOURTUBE_SETTINGS: settings, YOURTUBE_DEBOUNCE_MS: '100' };
  if (mode === '--mock') {
    const fake = path.join(temp, 'fake-codex');
    fs.writeFileSync(fake, `#!/usr/bin/env node\nconst fs=require('node:fs');process.stdin.resume();process.stdin.on('end',()=>{const out=process.argv[process.argv.indexOf('-o')+1];fs.writeFileSync(out,JSON.stringify(process.argv.includes('--search')?{videos:[{id:'testVideo01',reason:'First video'},{id:'testVideo01',reason:'Duplicate video'},{id:'testVideo02',reason:'Second video'}]}:{relevant:true,project:'Sample',task:'Learn about photography',context_id:'',public_search:'photography basics'}))});\n`, { mode: 0o755 });
    const curl = path.join(temp, 'curl');
    fs.writeFileSync(curl, '#!/usr/bin/env node\nrequire("node:fs").appendFileSync(process.env.TEST_CURL_CALLS,"call\\n");process.stdout.write(JSON.stringify({title:"Photography basics",author_name:"Example"}));\n', { mode: 0o755 });
    env.YOURTUBE_CODEX = fake; env.PATH = `${temp}${path.delimiter}${process.env.PATH}`; env.TEST_CURL_CALLS = path.join(temp, 'curl-calls');
  } else {
    console.log('Live mode uses your signed-in Codex CLI and web search, may consume usage, and sends one synthetic topic to the provider.');
  }
  function start() {
    child = spawn(process.execPath, ['server.js'], { cwd: root, env, stdio: 'ignore' });
  }
  async function ready() {
    await waitFor(async () => { if (child.exitCode !== null) throw Error('server exited'); try { return (await fetch(`${base}/feed.json`)).ok; } catch { return false; } }, 5000, 'server did not start');
  }
  start(); await ready();
  const initial=await status(base);
  if (initial.mode !== 'paused') throw Error('fresh instance was not paused');
  await post(base, '/api/live', { enabled: true, automatic:true, controlInstance:initial.controlInstance, expectedGeneration:initial.controlGeneration });
  fs.appendFileSync(session, JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'I am learning beginner photography basics and want helpful video tutorials.' }] } }) + '\n');
  // --live is explicit consent for this synthetic automatic search, not real chat data.
  // No per-search approval is expected after opting into automatic mode.
  await waitFor(async () => { const s = await status(base); if (s.mode === 'error') throw Error(`search failed: ${s.message}`); return s.lastUpdate; }, 180000, 'feed was not updated');
  const result = JSON.parse(fs.readFileSync(feed));
  if (!result.contexts.length || !result.videos.length) throw Error('updated feed contains no project or videos');
  if (mode === '--mock') {
    if (result.videos.map(video => video.id).join(',') !== 'testVideo01,testVideo02') throw Error('duplicate IDs were not removed in order');
    if (result.videos[0].reason !== 'First video') throw Error('first occurrence was not retained');
    if (fs.readFileSync(env.TEST_CURL_CALLS, 'utf8').trim().split('\n').length !== 2) throw Error('duplicate IDs should not cause duplicate metadata requests');
  }
  await post(base, '/api/live', { enabled: false }); await stop();
  start(); await ready();
  if ((await status(base)).mode !== 'paused') throw Error('service did not restart paused');
  console.log(`PASS: ${mode.slice(2)} classification, automatic search, feed update and paused restart. All state was temporary.`);
}
main().catch(error => { console.error('FAIL:', error.message); process.exitCode = 1; }).finally(async () => { await stop(); fs.rmSync(temp, { recursive: true, force: true }); });
