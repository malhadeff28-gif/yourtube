'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { allocateLiveProjectId } = require('../lib/live-project-id');

const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const firstId = `live-${first}`;
const secondId = `live-${second}`;

test('full IDs avoid existing projects and even orphan associations', () => {
  const feed = { contexts: [{ id: firstId }, { id: 'legacy-id' }], videos: [{ context: secondId }] };
  const third = '33333333-3333-4333-8333-333333333333';
  const sequence = [first, second, third];
  const before = JSON.stringify(feed);
  assert.equal(allocateLiveProjectId(feed, () => sequence.shift()), `live-${third}`);
  assert.equal(JSON.stringify(feed), before);
  assert.match(`live-${third}`, /^[A-Za-z0-9_-]{1,80}$/);
});

test('bounded collision exhaustion fails before mutating input', () => {
  const feed = { contexts: [{ id: firstId }], videos: [] };
  const before = JSON.stringify(feed); let calls = 0;
  assert.throws(() => allocateLiveProjectId(feed, () => { calls++; return first; }), /unique project ID/);
  assert.equal(calls, 8);
  assert.equal(JSON.stringify(feed), before);
  assert.throws(() => allocateLiveProjectId({ contexts: [] }, () => second), /unique project ID/);
});

async function waitFor(check, message) {
  const end = Date.now() + 10000;
  while (Date.now() < end) { const value = await check(); if (value) return value; await delay(30); }
  throw Error(message);
}
function readStatus(base) {
  return new Promise((resolve, reject) => {
    const req = http.get(base + '/events', res => {
      let data = ''; res.on('data', chunk => { data += chunk; const match = data.match(/event: status\ndata: ([^\n]+)\n\n/); if (match) { res.destroy(); resolve(JSON.parse(match[1])); } }); res.on('error', reject);
    }); req.on('error', reject); req.setTimeout(3000, () => req.destroy(Error('status timeout')));
  });
}

for (const exhaustion of [false, true]) test(`Live new-project allocation ${exhaustion ? 'fails without writing after repeated collisions' : 'uses the latest feed and retries collisions'}`, { timeout: 25000 }, async t => {
  const root = path.resolve(__dirname, '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yourtube-project-id-'));
  const sessions = path.join(dir, 'sessions'); fs.mkdirSync(sessions);
  const session = path.join(sessions, 'synthetic.jsonl');
  fs.writeFileSync(session, JSON.stringify({ type: 'session_meta', payload: { originator: 'Codex Desktop', source: 'vscode', thread_source: 'user' } }) + '\n');
  const feed = path.join(dir, 'feed.json');
  fs.writeFileSync(feed, JSON.stringify({ contexts: [{ id: 'legacy-id', name: 'Existing', task: 'Existing task' }], videos: [], focusContext: 'legacy-id', contextSource: 'Synthetic', updatedAt: '2026-01-01T00:00:00Z' }));
  const fake = path.join(dir, 'fake-codex');
  fs.writeFileSync(fake, `#!/usr/bin/env node\nconst fs=require('node:fs');process.stdin.resume();process.stdin.on('end',()=>{const out=process.argv[process.argv.indexOf('-o')+1];if(process.argv.includes('--search')){fs.writeFileSync(process.env.TEST_STARTED,'yes');const timer=setInterval(()=>{if(!fs.existsSync(process.env.TEST_RELEASE))return;clearInterval(timer);fs.writeFileSync(out,JSON.stringify({videos:[{id:'testVideo01',reason:'Synthetic'}]}))},10)}else fs.writeFileSync(out,JSON.stringify({relevant:true,context_id:'',project:'New',task:'Study',public_search:'synthetic topic'}))});\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'curl'), `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({title:'Synthetic title',author_name:'Synthetic channel'}));\n`, { mode: 0o755 });
  const hook = path.join(dir, 'hook.js');
  fs.writeFileSync(hook, `const c=require('node:crypto');const original=c.randomUUID;let calls=0;c.randomUUID=function(...args){if(new Error().stack.includes('allocateLiveProjectId')){calls++;return ${JSON.stringify(exhaustion)}||calls===1?${JSON.stringify(first)}:${JSON.stringify(second)}}return original.apply(this,args)};\n`);
  const socket = http.createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve)); const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const base = `http://127.0.0.1:${port}`; const started = path.join(dir, 'started'); const release = path.join(dir, 'release');
  const child = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`, YOURTUBE_PORT: String(port), YOURTUBE_SESSIONS_DIR: sessions, YOURTUBE_FEED: feed, YOURTUBE_CODEX: fake, YOURTUBE_DEBOUNCE_MS: '30', TEST_STARTED: started, TEST_RELEASE: release, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require=${JSON.stringify(hook)}` }, stdio: 'ignore' });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { const done = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await done; } fs.rmSync(dir, { recursive: true, force: true }); });
  const post = (endpoint, body) => fetch(base + endpoint, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) });
  await waitFor(async () => { try { return (await fetch(base + '/feed.json')).ok; } catch { return false; } }, 'server failed to start');
  assert.equal((await post('/api/live', { enabled: true })).status, 200);
  fs.appendFileSync(session, JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'A synthetic topic for a new project.' }] } }) + '\n');
  const review = await waitFor(async () => { const s = await readStatus(base); return s.mode === 'awaiting-review' && s; }, 'review not reached');
  assert.equal((await post('/api/search-review', { requestId: review.requestId, action: 'approve', query: 'synthetic topic', projectId: '', projectName: 'New', projectTask: 'Study' })).status, 200);
  await waitFor(() => fs.existsSync(started), 'search did not start');
  const latest = JSON.parse(fs.readFileSync(feed, 'utf8'));
  latest.contexts.push({ id: firstId, name: 'Added concurrently', task: 'Keep this' });
  fs.writeFileSync(feed, JSON.stringify(latest)); const before = fs.readFileSync(feed, 'utf8');
  fs.writeFileSync(release, 'yes');
  if (exhaustion) {
    const status = await waitFor(async () => { const s = await readStatus(base); return s.mode === 'error' && s; }, 'collision did not fail');
    assert.match(status.message, /unique project ID/);
    assert.equal(fs.readFileSync(feed, 'utf8'), before);
  } else {
    await waitFor(() => JSON.parse(fs.readFileSync(feed, 'utf8')).videos.length === 1, 'new project not created');
    const updated = JSON.parse(fs.readFileSync(feed, 'utf8'));
    assert.deepEqual(updated.contexts.find(c => c.id === firstId), { id: firstId, name: 'Added concurrently', task: 'Keep this' });
    assert.equal(updated.contexts.find(c => c.id === 'legacy-id').name, 'Existing');
    assert.equal(updated.contexts.find(c => c.id === secondId).name, 'New');
    assert.equal(updated.videos[0].context, secondId);
  }
});
