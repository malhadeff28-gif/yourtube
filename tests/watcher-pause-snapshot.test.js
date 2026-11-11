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
// A newly created marker can be visible while its JSON record is still being
// written. Only a complete, newline-terminated JSON string is evidence that
// the fake CLI received the full synthetic prompt.
function markerHasCompleteMessage(file,text) {
 if(!fs.existsSync(file))return false;
 const contents=fs.readFileSync(file,'utf8'),end=contents.lastIndexOf('\n');
 if(end<0)return false;
 return contents.slice(0,end).split('\n').some(line=>{try{const value=JSON.parse(line);return typeof value==='string'&&value.includes(text)}catch{return false}});
}
async function waitForMarker(file,text) { await waitFor(()=>markerHasCompleteMessage(file,text)); }

test('marker wait requires the entire newline-terminated JSON record', {timeout:10000}, async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yourtube-marker-test-')),file=path.join(dir,'marker');
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const record=JSON.stringify('fresh synthetic message followed by paused sentinel')+'\n';
 const boundary=record.indexOf(' followed');fs.writeFileSync(file,record.slice(0,boundary));
 let complete=false;const pending=waitForMarker(file,'fresh synthetic message').then(()=>{complete=true});
 await delay(60);assert.equal(complete,false,'partial JSON containing the expected text must not resolve');
 fs.appendFileSync(file,record.slice(boundary,-1));await delay(60);assert.equal(complete,false,'JSON without its terminating newline must not resolve');
 fs.appendFileSync(file,'\n');await pending;
 assert.match(JSON.parse(fs.readFileSync(file,'utf8').trim()),/paused sentinel/,'the complete prompt remains available for privacy assertions');
});

async function fixture(t) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yourtube-snapshot-')),sessions=path.join(dir,'sessions');fs.mkdirSync(sessions);
 const gate=path.join(dir,'gate'),notice=path.join(dir,'notice'),delivered=path.join(dir,'delivered'),marker=path.join(dir,'calls'),inject=path.join(dir,'inject'),injected=path.join(dir,'injected'),fail=path.join(dir,'fail'),append=path.join(dir,'append'),appended=path.join(dir,'appended');
 const hook=path.join(dir,'hook.js');fs.writeFileSync(hook,`const fs=require('fs');const oldWatch=fs.watch,oldRead=fs.readdirSync,oldStat=fs.statSync;let didInject=false,didAppend=false;
 fs.readdirSync=function(dir,...args){if(String(dir)===process.env.TEST_SESSIONS&&fs.existsSync(process.env.TEST_FAIL))throw Error('synthetic snapshot failure');const result=oldRead.call(this,dir,...args);if(String(dir)===process.env.TEST_SESSIONS&&fs.existsSync(process.env.TEST_INJECT)&&!didInject){didInject=true;fs.writeFileSync(process.env.TEST_INJECTED_SESSION,process.env.TEST_INJECTED_CONTENT);fs.writeFileSync(process.env.TEST_INJECTED,'yes')}return result};
 fs.statSync=function(file,...args){const result=oldStat.call(this,file,...args);if(String(file)===process.env.TEST_APPEND_SESSION&&fs.existsSync(process.env.TEST_APPEND)&&!didAppend){didAppend=true;fs.appendFileSync(file,process.env.TEST_APPEND_CONTENT);fs.writeFileSync(process.env.TEST_APPENDED,'yes')}return result};
 fs.watch=function(...args){const cb=args.pop();return oldWatch.call(this,...args,(...e)=>{fs.appendFileSync(process.env.TEST_NOTICE,'x');const deliver=()=>{cb(...e);fs.appendFileSync(process.env.TEST_DELIVERED,JSON.stringify(e)+'\\n')};if(fs.existsSync(process.env.TEST_GATE))deliver();else{const t=setInterval(()=>{if(fs.existsSync(process.env.TEST_GATE)){clearInterval(t);deliver()}},10)}})};`);
 const fake=path.join(dir,'fake-codex');fs.writeFileSync(fake,`#!/usr/bin/env node\nconst fs=require('fs');let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{fs.appendFileSync(process.env.TEST_MARKER,JSON.stringify(input)+'\\n');process.exit(1)})`,{mode:0o755});
 const socket=http.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));const base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,NODE_OPTIONS:`--require=${hook}`,YOURTUBE_PORT:String(port),YOURTUBE_SESSIONS_DIR:sessions,YOURTUBE_FEED:path.join(dir,'feed.json'),YOURTUBE_CODEX:fake,YOURTUBE_DEBOUNCE_MS:'30',TEST_SESSIONS:sessions,TEST_GATE:gate,TEST_NOTICE:notice,TEST_DELIVERED:delivered,TEST_MARKER:marker,TEST_INJECT:inject,TEST_INJECTED:injected,TEST_INJECTED_SESSION:path.join(sessions,'during-scan.jsonl'),TEST_INJECTED_CONTENT:meta+event('A synthetic paused message created during the snapshot.'),TEST_APPEND:append,TEST_APPENDED:appended,TEST_APPEND_SESSION:path.join(sessions,'known.jsonl'),TEST_APPEND_CONTENT:event('A synthetic paused message appended after its first stat.'),TEST_FAIL:fail},stdio:'ignore'});
 t.after(async()=>{if(child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await done}fs.rmSync(dir,{recursive:true,force:true})});
 await waitFor(async()=>{try{return (await fetch(`${base}/feed.json`)).ok}catch{return false}});
 const live = enabled => fetch(`${base}/api/live`,{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({enabled})});
 const status = () => new Promise((resolve,reject)=>{const req=http.get(`${base}/events`,res=>{let text='';res.on('data',chunk=>{text+=chunk;const match=text.match(/event: status\ndata: ([^\n]+)\n\n/);if(match){res.destroy();resolve(JSON.parse(match[1]))}});res.on('error',reject)});req.on('error',reject)});
 return {sessions,gate,notice,delivered,marker,inject,injected,append,appended,fail,live,status};
}

test('delayed notification for a new paused session does not replay it', {timeout:10000}, async t=>{
 const f=await fixture(t),file=path.join(f.sessions,'paused.jsonl');
 fs.writeFileSync(file,meta+event('A synthetic message written while paused.'));
 await waitFor(()=>fs.existsSync(f.notice));
 assert.equal((await (await f.live(true)).json()).enabled,true);
 fs.writeFileSync(f.gate,'yes');await waitFor(()=>fs.existsSync(f.delivered));await delay(150);
 assert.equal(fs.existsSync(f.marker),false,'paused content must not reach Codex');
 fs.appendFileSync(file,event('A fresh synthetic message after enabling.'));
 await waitForMarker(f.marker,'fresh synthetic message');
 const called=fs.readFileSync(f.marker,'utf8');assert.match(called,/fresh synthetic message/);assert.doesNotMatch(called,/written while paused/);
});

test('a file created during the enable scan is baselined on discovery', {timeout:10000}, async t=>{
 const f=await fixture(t);fs.writeFileSync(f.inject,'yes');
 assert.equal((await (await f.live(true)).json()).enabled,true);
 assert.equal(fs.existsSync(f.injected),true,'test must create a file during scanning');
 await waitFor(()=>fs.existsSync(f.notice));fs.writeFileSync(f.gate,'yes');await waitFor(()=>fs.existsSync(f.delivered));await delay(150);
 assert.equal(fs.existsSync(f.marker),false,'uncertain-age content must not reach Codex');
 fs.appendFileSync(path.join(f.sessions,'during-scan.jsonl'),event('A fresh message after the scan completed.'));
 await waitForMarker(f.marker,'fresh message after the scan completed');assert.doesNotMatch(fs.readFileSync(f.marker,'utf8'),/created during the snapshot/);
});

test('a snapshot failure leaves Live disabled and can be retried', {timeout:10000}, async t=>{
 const f=await fixture(t);fs.writeFileSync(f.fail,'yes');
 const failed=await (await f.live(true)).json();assert.equal(failed.enabled,false);assert.equal(failed.mode,'error');assert.match(failed.message,/snapshot/i);
 fs.unlinkSync(f.fail);const recovered=await (await f.live(true)).json();assert.equal(recovered.enabled,true);assert.equal(recovered.mode,'listening');
});

test('a paused append after a known file is first scanned is not replayed', {timeout:10000}, async t=>{
 const f=await fixture(t),file=path.join(f.sessions,'known.jsonl');fs.writeFileSync(file,meta);
 await waitFor(()=>fs.existsSync(f.notice));fs.writeFileSync(f.append,'yes');
 assert.equal((await (await f.live(true)).json()).enabled,true);
 assert.equal(fs.existsSync(f.appended),true,'test must append during the enable scan');
 fs.writeFileSync(f.gate,'yes');await waitFor(()=>fs.existsSync(f.delivered));await delay(150);
 assert.equal(fs.existsSync(f.marker),false,'append before enable must not reach Codex');
 fs.appendFileSync(file,event('A fresh message after the known-file scan.'));
 await waitForMarker(f.marker,'fresh message after the known-file scan');assert.doesNotMatch(fs.readFileSync(f.marker,'utf8'),/appended after its first stat/);
});

test('a session first discovered live skips existing contents but processes later appends', {timeout:10000}, async t=>{
 const f=await fixture(t);fs.writeFileSync(f.gate,'yes');assert.equal((await (await f.live(true)).json()).enabled,true);
 const file=path.join(f.sessions,'new-live.jsonl');fs.writeFileSync(file,meta+event('A first fresh message in a new session.'));
 await waitFor(()=>fs.existsSync(f.delivered));await delay(150);assert.equal(fs.existsSync(f.marker),false,'first discovery deliberately baselines content');
 fs.appendFileSync(file,event('A later fresh message in the new session.'));await waitForMarker(f.marker,'later fresh message');assert.match(fs.readFileSync(f.marker,'utf8'),/later fresh message/);
});

test('possible missed activity is a coarse live-session warning', {timeout:10000}, async t=>{
 const f=await fixture(t);fs.writeFileSync(f.gate,'yes');
 const paused=path.join(f.sessions,'paused.jsonl');fs.writeFileSync(paused,meta+event('Synthetic paused activity.'));
 await waitFor(()=>fs.existsSync(f.delivered));assert.equal((await f.status()).activityMayBeMissed,false,'paused scanning must not warn');
 assert.equal((await (await f.live(true)).json()).activityMayBeMissed,false,'enabling starts without a warning');
 const before=fs.readFileSync(f.delivered,'utf8').length;
 const headerOnly=path.join(f.sessions,'header-only.jsonl');fs.writeFileSync(headerOnly,meta);
 await waitFor(()=>fs.readFileSync(f.delivered,'utf8').length>before);assert.equal((await f.status()).activityMayBeMissed,false,'header-only session must not warn');
 const source=path.join(f.sessions,'new-synthetic.jsonl');fs.writeFileSync(source,meta+event('A private synthetic message written in a fresh chat.'));
 await waitFor(async()=> (await f.status()).activityMayBeMissed===true);
 const warning=await f.status();assert.equal(warning.enabled,true);assert.doesNotMatch(JSON.stringify(warning),/private synthetic message|new-synthetic\.jsonl/,'status must not expose message or file');
 fs.appendFileSync(source,event('A later synthetic message in the same chat.'));await waitForMarker(f.marker,'later synthetic message in the same chat');
 assert.equal((await f.status()).activityMayBeMissed,true,'later processing must not erase warning');
 await f.live(false);assert.equal((await f.status()).activityMayBeMissed,false,'pause clears the session warning');
 assert.equal((await (await f.live(true)).json()).activityMayBeMissed,false,'a new live session starts without a warning');
});

test('a replaced session cannot reuse cached Desktop authorization', {timeout:10000}, async t=>{
 const f=await fixture(t),file=path.join(f.sessions,'s.jsonl');fs.writeFileSync(file,meta);await waitFor(()=>fs.existsSync(f.notice));
 assert.equal((await (await f.live(true)).json()).enabled,true);fs.writeFileSync(f.gate,'yes');await waitFor(()=>fs.existsSync(f.delivered));
 fs.appendFileSync(file,event('A synthetic Desktop message establishing authorization.'));await waitForMarker(f.marker,'synthetic Desktop message establishing authorization');
 const oldSize=fs.statSync(file).size;fs.writeFileSync(f.marker,'');
 const nonDesktop=JSON.stringify({type:'session_meta',payload:{originator:'Other Client',source:'vscode',thread_source:'user'}})+'\n';
 const padding=oldSize-Buffer.byteLength(nonDesktop);assert.ok(padding>1);
 const deliveredBefore=fs.readFileSync(f.delivered,'utf8').split('\n').filter(x=>x.includes('s.jsonl')).length;
 const temporary=path.join(f.sessions,'replacement.tmp');
 fs.writeFileSync(temporary,nonDesktop+' '.repeat(padding-1)+'\n'+event('A synthetic non Desktop message before replacement was noticed.'));fs.renameSync(temporary,file);
 await waitFor(()=>fs.readFileSync(f.delivered,'utf8').split('\n').filter(x=>x.includes('s.jsonl')).length>deliveredBefore);await delay(100);
 fs.appendFileSync(file,event('Another synthetic non Desktop message.'));await delay(250);
 assert.equal(fs.readFileSync(f.marker,'utf8'),'','non Desktop replacements and later appends must not reach Codex');
 const beforeSecond=fs.readFileSync(f.delivered,'utf8').split('\n').filter(x=>x.includes('s.jsonl')).length;
 fs.writeFileSync(temporary,meta+event('A Desktop message already present in the replacement.'));fs.renameSync(temporary,file);
 await waitFor(()=>fs.readFileSync(f.delivered,'utf8').split('\n').filter(x=>x.includes('s.jsonl')).length>beforeSecond);await delay(100);
 assert.equal(fs.readFileSync(f.marker,'utf8'),'','replacement content of unknown age is baselined');
 fs.appendFileSync(file,event('A fresh Desktop message after replacement.'));await waitFor(()=>fs.readFileSync(f.marker,'utf8').includes('fresh Desktop message'));
 assert.doesNotMatch(fs.readFileSync(f.marker,'utf8'),/already present in the replacement/);
});

test('an in-place rewrite cannot retain Desktop authorization', {timeout:10000}, async t=>{
 const f=await fixture(t),file=path.join(f.sessions,'s.jsonl');fs.writeFileSync(file,meta);await waitFor(()=>fs.existsSync(f.notice));
 assert.equal((await (await f.live(true)).json()).enabled,true);fs.writeFileSync(f.gate,'yes');await waitFor(()=>fs.existsSync(f.delivered));
 fs.appendFileSync(file,event('A Desktop message establishing authorization for rewrite.'));await waitForMarker(f.marker,'Desktop message establishing authorization for rewrite');
 const oldSize=fs.statSync(file).size;fs.writeFileSync(f.marker,'');
 const nonDesktop=JSON.stringify({type:'session_meta',payload:{originator:'Other Client',source:'vscode',thread_source:'user'}})+'\n';
 fs.writeFileSync(file,nonDesktop+' '.repeat(oldSize)+'\n'+event('A synthetic non Desktop message after rewrite.'));
 await delay(250);assert.equal(fs.readFileSync(f.marker,'utf8'),'','changed headers must be revalidated even on the same inode');
});
