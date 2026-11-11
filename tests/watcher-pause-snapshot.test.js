'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const root = path.resolve(__dirname, '..');
const meta = JSON.stringify({type:'session_meta',payload:{originator:'Codex Desktop',source:'vscode',thread_source:'user'}})+'\n';
const event = text => JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}})+'\n';
async function waitFor(check) { for(let i=0;i<250;i++){if(await check())return;await delay(20)}throw Error('timed out'); }

async function fixture(t) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yourtube-snapshot-')),sessions=path.join(dir,'sessions');fs.mkdirSync(sessions);
 const gate=path.join(dir,'gate'),notice=path.join(dir,'notice'),delivered=path.join(dir,'delivered'),marker=path.join(dir,'calls'),inject=path.join(dir,'inject'),injected=path.join(dir,'injected'),fail=path.join(dir,'fail');
 const hook=path.join(dir,'hook.js');fs.writeFileSync(hook,`const fs=require('fs');const oldWatch=fs.watch,oldRead=fs.readdirSync;let didInject=false;
 fs.readdirSync=function(dir,...args){if(String(dir)===process.env.TEST_SESSIONS&&fs.existsSync(process.env.TEST_FAIL))throw Error('synthetic snapshot failure');const result=oldRead.call(this,dir,...args);if(String(dir)===process.env.TEST_SESSIONS&&fs.existsSync(process.env.TEST_INJECT)&&!didInject){didInject=true;fs.writeFileSync(process.env.TEST_INJECTED_SESSION,process.env.TEST_INJECTED_CONTENT);fs.writeFileSync(process.env.TEST_INJECTED,'yes')}return result};
 fs.watch=function(...args){const cb=args.pop();return oldWatch.call(this,...args,(...e)=>{fs.appendFileSync(process.env.TEST_NOTICE,'x');const deliver=()=>{cb(...e);fs.appendFileSync(process.env.TEST_DELIVERED,'x')};if(fs.existsSync(process.env.TEST_GATE))deliver();else{const t=setInterval(()=>{if(fs.existsSync(process.env.TEST_GATE)){clearInterval(t);deliver()}},10)}})};`);
 const fake=path.join(dir,'fake-codex');fs.writeFileSync(fake,`#!/usr/bin/env node\nconst fs=require('fs');let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{fs.appendFileSync(process.env.TEST_MARKER,JSON.stringify(input)+'\\n');process.exit(1)})`,{mode:0o755});
 const socket=http.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));const base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,NODE_OPTIONS:`--require=${hook}`,YOURTUBE_PORT:String(port),YOURTUBE_SESSIONS_DIR:sessions,YOURTUBE_FEED:path.join(dir,'feed.json'),YOURTUBE_CODEX:fake,YOURTUBE_DEBOUNCE_MS:'30',TEST_SESSIONS:sessions,TEST_GATE:gate,TEST_NOTICE:notice,TEST_DELIVERED:delivered,TEST_MARKER:marker,TEST_INJECT:inject,TEST_INJECTED:injected,TEST_INJECTED_SESSION:path.join(sessions,'during-scan.jsonl'),TEST_INJECTED_CONTENT:meta+event('A synthetic paused message created during the snapshot.'),TEST_FAIL:fail},stdio:'ignore'});
 t.after(async()=>{if(child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await done}fs.rmSync(dir,{recursive:true,force:true})});
 await waitFor(async()=>{try{return (await fetch(`${base}/feed.json`)).ok}catch{return false}});
 const live = enabled => fetch(`${base}/api/live`,{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({enabled})});
 return {sessions,gate,notice,delivered,marker,inject,injected,fail,live};
}

test('delayed notification for a new paused session does not replay it', {timeout:10000}, async t=>{
 const f=await fixture(t),file=path.join(f.sessions,'paused.jsonl');
 fs.writeFileSync(file,meta+event('A synthetic message written while paused.'));
 await waitFor(()=>fs.existsSync(f.notice));
 assert.equal((await (await f.live(true)).json()).enabled,true);
 fs.writeFileSync(f.gate,'yes');await waitFor(()=>fs.existsSync(f.delivered));await delay(150);
 assert.equal(fs.existsSync(f.marker),false,'paused content must not reach Codex');
 fs.appendFileSync(file,event('A fresh synthetic message after enabling.'));
 await waitFor(()=>fs.existsSync(f.marker));
 const called=fs.readFileSync(f.marker,'utf8');assert.match(called,/fresh synthetic message/);assert.doesNotMatch(called,/written while paused/);
});

test('a file created during the enable scan is baselined on discovery', {timeout:10000}, async t=>{
 const f=await fixture(t);fs.writeFileSync(f.inject,'yes');
 assert.equal((await (await f.live(true)).json()).enabled,true);
 assert.equal(fs.existsSync(f.injected),true,'test must create a file during scanning');
 await waitFor(()=>fs.existsSync(f.notice));fs.writeFileSync(f.gate,'yes');await waitFor(()=>fs.existsSync(f.delivered));await delay(150);
 assert.equal(fs.existsSync(f.marker),false,'uncertain-age content must not reach Codex');
 fs.appendFileSync(path.join(f.sessions,'during-scan.jsonl'),event('A fresh message after the scan completed.'));
 await waitFor(()=>fs.existsSync(f.marker));assert.doesNotMatch(fs.readFileSync(f.marker,'utf8'),/created during the snapshot/);
});

test('a snapshot failure leaves Live disabled and can be retried', {timeout:10000}, async t=>{
 const f=await fixture(t);fs.writeFileSync(f.fail,'yes');
 const failed=await (await f.live(true)).json();assert.equal(failed.enabled,false);assert.equal(failed.mode,'error');assert.match(failed.message,/snapshot/i);
 fs.unlinkSync(f.fail);const recovered=await (await f.live(true)).json();assert.equal(recovered.enabled,true);assert.equal(recovered.mode,'listening');
});

test('a session first discovered live skips existing contents but processes later appends', {timeout:10000}, async t=>{
 const f=await fixture(t);fs.writeFileSync(f.gate,'yes');assert.equal((await (await f.live(true)).json()).enabled,true);
 const file=path.join(f.sessions,'new-live.jsonl');fs.writeFileSync(file,meta+event('A first fresh message in a new session.'));
 await waitFor(()=>fs.existsSync(f.delivered));await delay(150);assert.equal(fs.existsSync(f.marker),false,'first discovery deliberately baselines content');
 fs.appendFileSync(file,event('A later fresh message in the new session.'));await waitFor(()=>fs.existsSync(f.marker));assert.match(fs.readFileSync(f.marker,'utf8'),/later fresh message/);
});
