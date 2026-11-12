'use strict';
const { fencedBody } = require('./support/live-control');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

test('watcher drains a large append and continues after an oversized record', { timeout: 15000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yourtube-large-'));
  const sessions = path.join(dir, 'sessions'); fs.mkdirSync(sessions);
  const session = path.join(sessions, 'synthetic.jsonl');
  fs.writeFileSync(session, JSON.stringify({ type: 'session_meta', payload: { originator: 'Codex Desktop', source: 'vscode', thread_source: 'user' } }) + '\n');
  const marker = path.join(dir, 'calls');
  const fake = path.join(dir, 'fake-codex');
  fs.writeFileSync(fake, `#!/usr/bin/env node
const fs=require('node:fs'); let input='';
process.stdin.on('data',x=>input+=x); process.stdin.on('end',()=>{
  fs.appendFileSync(process.env.TEST_MARKER,JSON.stringify(input)+'\\n');
  fs.writeFileSync(process.argv[process.argv.indexOf('-o')+1],JSON.stringify({relevant:false,project:'',task:'',context_id:'',public_search:''}));
});`, { mode: 0o755 });
  const socket = http.createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], { cwd: path.resolve(__dirname, '..'), env: {
    ...process.env, YOURTUBE_PORT: String(port), YOURTUBE_SESSIONS_DIR: sessions,
    YOURTUBE_FEED: path.join(dir, 'feed.json'), YOURTUBE_SETTINGS: path.join(dir, 'settings.json'),
    YOURTUBE_CODEX: fake, YOURTUBE_DEBOUNCE_MS: '40', TEST_MARKER: marker,
  }, stdio: 'ignore' });
  t.after(async () => { if(child.exitCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await done}fs.rmSync(dir,{recursive:true,force:true}) });
  async function waitFor(check) { for (let i=0;i<200;i++){if(await check())return;await delay(25)}throw Error('timed out'); }
  await waitFor(async()=>{try{return (await fetch(`${base}/feed.json`)).ok}catch{return false}});
  await fetch(`${base}/api/live`,{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify(await fencedBody(base,{enabled:true}))});
  const event = text => JSON.stringify({ type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}})+'\n';
  const waitForText = text => waitFor(()=>fs.existsSync(marker)&&fs.readFileSync(marker,'utf8').includes(text));

  // Each malformed shape and a valid event share one read; neither the rest of
  // that read nor a future append may be lost or combined with bad bytes.
  const malformed = [
    null,
    { type:'response_item', payload:null },
    { type:'response_item', payload:{type:'message',role:'user',content:{type:'input_text',text:'object content'}} },
    { type:'response_item', payload:{type:'message',role:'user',content:[null,{type:'input_text',text:{invalid:'object text'}}]} },
  ];
  for (let i=0;i<malformed.length;i++) {
    const sentinel = `A valid synthetic message following malformed record ${i}.`;
    fs.appendFileSync(session, JSON.stringify(malformed[i])+'\n'+event(sentinel));
    await waitForText(sentinel);
  }
  fs.appendFileSync(session,event('A valid synthetic message in the later append.'));
  await waitForText('A valid synthetic message in the later append.');
  const observed = fs.readFileSync(marker,'utf8');
  assert.doesNotMatch(observed,/object content|object text/);

  // A single append exceeding the read chunk must not strand its last record.
  fs.appendFileSync(session, JSON.stringify({type:'synthetic_padding',value:'x'.repeat(600000)})+'\n'+event('A tail message after the large synthetic append.'));
  await waitForText('A tail message after the large synthetic append.');
  // A multibyte character split at a chunk boundary must survive decoding.
  const unicodeRecord = padding => JSON.stringify({type:'response_item',padding:'x'.repeat(padding),payload:{type:'message',role:'user',content:[{type:'input_text',text:'é and a synthetic message crossing the chunk boundary.'}]}})+'\n';
  const baseOffset = Buffer.byteLength(unicodeRecord(0).split('é')[0]);
  const splitRecord = unicodeRecord(512*1024-1-baseOffset);
  assert.equal(Buffer.byteLength(splitRecord.split('é')[0]),512*1024-1);
  fs.appendFileSync(session, splitRecord);
  await waitForText('é and a synthetic message crossing the chunk boundary.');
  // An oversized line is skipped, then parsing resumes at the next newline.
  fs.appendFileSync(session, JSON.stringify({type:'synthetic_padding',value:'x'.repeat(1200000)})+'\n'+event('A message after the oversized synthetic record.'));
  await waitForText('A message after the oversized synthetic record.');
  const partial = event('A synthetic message begun before pausing and finished while paused.');
  fs.appendFileSync(session,event('A sentinel message before the partial record.')+partial.slice(0,-4));
  await waitForText('A sentinel message before the partial record.');
  const beforePause = fs.readFileSync(marker,'utf8').trim().split('\n').length;
  await fetch(`${base}/api/live`,{method:'POST',headers:{'content-type':'application/json',origin:base},body:'{"enabled":false}'});
  fs.appendFileSync(session,partial.slice(-4));
  await fetch(`${base}/api/live`,{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify(await fencedBody(base,{enabled:true}))});
  await delay(150);
  assert.equal(fs.readFileSync(marker,'utf8').trim().split('\n').length,beforePause,'partial records must not be replayed after pause');
  fs.appendFileSync(session,event('A new synthetic message after resuming live mode.'));
  await waitForText('A new synthetic message after resuming live mode.');
  assert.equal(child.exitCode, null);
});
