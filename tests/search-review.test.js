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

test('search waits for a valid user-approved phrase', { timeout: 12000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yourtube-review-'));
  const sessions = path.join(dir, 'sessions'); fs.mkdirSync(sessions);
  const session = path.join(sessions, 'session.jsonl');
  fs.writeFileSync(session, JSON.stringify({ type: 'session_meta', payload: { originator: 'Codex Desktop', source: 'vscode', thread_source: 'user' } }) + '\n');
  const feed = path.join(dir, 'feed.json');
  fs.writeFileSync(feed, JSON.stringify({contexts:[{id:'example',name:'Photography contact@example.com',task:'Study https://example.com/private token=synthetic-secret'}],videos:[],focusContext:'example'}));
  const marker = path.join(dir, 'calls');
  const fake = path.join(dir, 'fake-codex');
  fs.writeFileSync(fake, `#!/usr/bin/env node
const fs=require('node:fs'); let input='';
process.stdin.on('data',x=>input+=x); process.stdin.on('end',()=>{
  fs.appendFileSync(process.env.TEST_MARKER,JSON.stringify({search:process.argv.includes('--search'),input})+'\\n');
  const out=process.argv[process.argv.indexOf('-o')+1];
  fs.writeFileSync(out,JSON.stringify(process.argv.includes('--search')?{videos:[]}:{relevant:true,project:'Example',task:'Study a topic',context_id:'',public_search:'original topic'}));
});`, { mode: 0o755 });
  const socket = http.createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], { cwd: path.resolve(__dirname, '..'), env: {
    ...process.env, YOURTUBE_PORT: String(port), YOURTUBE_SESSIONS_DIR: sessions,
    YOURTUBE_FEED: feed, YOURTUBE_SETTINGS: path.join(dir, 'settings.json'),
    YOURTUBE_CODEX: fake, YOURTUBE_DEBOUNCE_MS: '40', TEST_MARKER: marker,
  }, stdio: 'ignore' });
  t.after(async () => { if(child.exitCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await done}fs.rmSync(dir,{recursive:true,force:true}) });
  async function waitFor(fn) { for(let i=0;i<200;i++){const value=await fn();if(value)return value;await delay(25)}throw Error('timed out') }
  await waitFor(async()=>{try{return (await fetch(`${base}/feed.json`)).ok}catch{return false}});
  const post = (endpoint, value, origin=base) => fetch(`${base}${endpoint}`, { method:'POST', headers:{'content-type':'application/json',origin}, body:JSON.stringify(value) });
  const status = () => new Promise((resolve,reject)=>{const req=http.get(`${base}/events`,res=>{let text='';res.on('data',chunk=>{text+=chunk;const match=text.match(/event: status\ndata: ([^\n]+)\n\n/);if(match){res.destroy();resolve(JSON.parse(match[1]))}});res.on('error',reject)});req.on('error',reject)});
  await post('/api/live',{enabled:true});
  fs.appendFileSync(session,JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'A synthetic message about studying a topic.'}]}})+'\n');
  let pending = await waitFor(async()=>{const s=await status();return s.mode==='awaiting-review'&&s});
  assert.equal(pending.pendingQuery,'original topic');
  // A newly discovered chat can be baselined while a prior search awaits review.
  // The warning must not replace or change the in-flight approval request.
  fs.writeFileSync(path.join(sessions,'unseen.jsonl'),JSON.stringify({type:'session_meta',payload:{originator:'Codex Desktop',source:'vscode',thread_source:'user'}})+'\n'+JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'A synthetic newly discovered work message.'}]}})+'\n');
  const warning = await waitFor(async()=>{const s=await status();return s.activityMayBeMissed&&s});
  assert.equal(warning.mode,'awaiting-review');
  assert.equal(warning.requestId,pending.requestId);
  assert.equal(warning.pendingQuery,pending.pendingQuery);
  await delay(200);
  assert.equal(fs.readFileSync(marker,'utf8').trim().split('\n').length,1,'search must not start before review');
  const classification = JSON.parse(fs.readFileSync(marker,'utf8').trim()).input;
  assert.match(classification, /Photography \[email\]/);
  assert.match(classification, /Study \[link\] \[credential\]/);
  assert.match(classification, /"id":"example"/);
  assert.doesNotMatch(classification, /contact@example\.com|example\.com\/private|synthetic-secret/);
  const client=net.connect(port,'127.0.0.1');
  await new Promise((resolve,reject)=>{client.once('connect',resolve);client.once('error',reject)});
  const partial=JSON.stringify({requestId:pending.requestId,action:'approve',query:'unapproved phrase'}).slice(0,-1);
  client.write(`POST /api/search-review HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: ${base}\r\nContent-Type: application/json\r\nContent-Length: 200\r\n\r\n${partial}`);
  await delay(100);client.destroy();await delay(100);
  const afterAbort=await status();
  assert.equal(afterAbort.mode,'awaiting-review','an aborted approval must leave the review pending');
  assert.equal(afterAbort.requestId,pending.requestId);
  assert.equal(afterAbort.pendingQuery,pending.pendingQuery);
  assert.equal(fs.readFileSync(marker,'utf8').trim().split('\n').length,1,'an aborted approval must not start a search');
  fs.appendFileSync(session,JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'A second synthetic message while the search is awaiting review.'}]}})+'\n');
  await delay(250);
  const stillPending = await status();
  assert.equal(stillPending.mode,'awaiting-review','new chat activity must not hide the pending review');
  assert.equal(stillPending.requestId,pending.requestId);
  await post('/api/live',{enabled:true});
  assert.equal((await status()).requestId,pending.requestId,'a repeated enable must not cancel or hide the review');
  assert.equal((await status()).mode,'awaiting-review');
  await post('/api/search-review',{requestId:pending.requestId,action:'cancel'});
  const queued = await waitFor(async()=>{const s=await status();return s.mode==='awaiting-review'&&s.requestId!==pending.requestId&&s});
  const queuedCalls=fs.readFileSync(marker,'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(queuedCalls.length,2);
  assert.match(queuedCalls[1].input,/second synthetic message/,'the event was queued for later classification');
  await post('/api/live',{enabled:false});
  await delay(100);
  fs.writeFileSync(marker,'');
  await post('/api/live',{enabled:true});
  fs.appendFileSync(session,JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'A fresh synthetic work message after restarting live mode.'}]}})+'\n');
  pending = await waitFor(async()=>{const s=await status();return s.mode==='awaiting-review'&&s});
  assert.equal((await post('/api/search-review',{requestId:pending.requestId,action:'approve',query:'edited topic',projectId:pending.pendingProject.id,projectName:pending.pendingProject.name,projectTask:pending.pendingProject.task},'https://untrusted.example')).status,403);
  assert.equal((await post('/api/search-review',{requestId:pending.requestId,action:'approve',query:'token=secret'})).status,400);
  assert.equal((await post('/api/search-review',{requestId:pending.requestId,action:'approve',query:'edited topic',projectId:pending.pendingProject.id,projectName:pending.pendingProject.name,projectTask:pending.pendingProject.task})).status,200);
  await waitFor(()=>fs.readFileSync(marker,'utf8').trim().split('\n').length===2);
  const calls=fs.readFileSync(marker,'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls[1].search,true);
  assert.match(calls[1].input,/edited topic/);
  assert.doesNotMatch(calls[1].input,/original topic/);
  await waitFor(async()=>{const s=await status();return s.mode==='error'});
  fs.appendFileSync(session,JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'Another synthetic work message for review.'}]}})+'\n');
  const second = await waitFor(async()=>{const s=await status();return s.mode==='awaiting-review'&&s});
  await post('/api/live',{enabled:false});
  assert.equal((await status()).mode,'paused');
  assert.equal((await post('/api/search-review',{requestId:second.requestId,action:'approve',query:'too late'})).status,400);
  await delay(100);
  assert.equal(fs.readFileSync(marker,'utf8').trim().split('\n').length,3,'paused review must not start a search');
});
