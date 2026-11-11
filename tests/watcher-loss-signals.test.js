'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {spawn}=require('node:child_process');
const {setTimeout:delay}=require('node:timers/promises');
const root=path.resolve(__dirname,'..');
const meta=JSON.stringify({type:'session_meta',payload:{originator:'Codex Desktop',source:'vscode',thread_source:'user'}})+'\n';
const event=text=>JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}})+'\n';

async function fixture(t,count=0,blockCodex=false){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yourtube-loss-warning-'));
 const sessions=path.join(dir,'sessions');fs.mkdirSync(sessions);
 for(let i=0;i<count;i++)fs.writeFileSync(path.join(sessions,`synthetic-${i}.jsonl`),meta);
 const feed=path.join(dir,'feed.json');fs.writeFileSync(feed,JSON.stringify({contexts:[],videos:[],focusContext:''}));
 const marker=path.join(dir,'calls');
 const fake=path.join(dir,'fake-codex');fs.writeFileSync(fake,`#!/usr/bin/env node
const fs=require('node:fs');let input='';process.stdin.on('data',s=>input+=s);process.stdin.on('end',()=>{fs.appendFileSync(process.env.TEST_CALLS,JSON.stringify(input)+'\\n');if(process.env.TEST_BLOCK_CODEX==='yes'){setInterval(()=>{},1000);return}fs.writeFileSync(process.argv[process.argv.indexOf('-o')+1],JSON.stringify({relevant:false}));});`,{mode:0o755});
 const hook=path.join(dir,'watch-hook.cjs');fs.writeFileSync(hook,`
if(process.argv[1]&&process.argv[1].endsWith('/server.js')){
 const fs=require('node:fs'),{EventEmitter}=require('node:events'),old=fs.watch;
 fs.watch=function(dir,opts,cb){if(String(dir)!==process.env.YOURTUBE_SESSIONS_DIR)return old.apply(this,arguments);const w=new EventEmitter();w.close=()=>{};process.on('message',m=>{if(m&&m.kind==='synthetic-watch'){cb('change',m.filename);process.send({ack:m.id})}});return w};
}`);
 const socket=http.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));const base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,YOURTUBE_PORT:String(port),YOURTUBE_SESSIONS_DIR:sessions,YOURTUBE_FEED:feed,YOURTUBE_CODEX:fake,YOURTUBE_DEBOUNCE_MS:'700',TEST_CALLS:marker,TEST_BLOCK_CODEX:blockCodex?'yes':'no',NODE_OPTIONS:`${process.env.NODE_OPTIONS||''} --require=${JSON.stringify(hook)}`},stdio:['ignore','ignore','ignore','ipc']});
 t.after(async()=>{if(child.exitCode===null){const done=new Promise(resolve=>child.once('exit',resolve));if(child.connected)child.disconnect();child.kill('SIGTERM');const deadline=setTimeout(()=>child.kill('SIGKILL'),3000);await done;clearTimeout(deadline)}fs.rmSync(dir,{recursive:true,force:true})});
 async function waitFor(fn){for(let i=0;i<480;i++){const result=await fn();if(result)return result;await delay(25)}throw Error('timed out')}
 await waitFor(async()=>{try{return (await fetch(`${base}/feed.json`)).ok}catch{return false}});
 let id=0;
 async function notify(filename){const n=++id;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('watch callback timed out')),2000);function onMessage(m){if(m&&m.ack===n){clearTimeout(timer);child.off('message',onMessage);resolve()}}child.on('message',onMessage);child.send({kind:'synthetic-watch',filename,id:n})})}
 const live=async enabled=>(await fetch(`${base}/api/live`,{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({enabled})})).json();
 const status=()=>new Promise((resolve,reject)=>{const req=http.get(`${base}/events`,res=>{let text='';res.on('data',chunk=>{text+=chunk;const match=text.match(/event: status\ndata: ([^\n]+)\n\n/);if(match){res.destroy();resolve(JSON.parse(match[1]))}});res.on('error',reject)});req.on('error',reject)});
 return {sessions,marker,notify,live,status,waitFor};
}

test('unknown watcher filenames surface only a coarse warning during Live', {timeout:10000},async t=>{
 const f=await fixture(t);
 await f.notify(null);await f.notify('');assert.equal((await f.status()).activityMayBeMissed,false,'paused callbacks do not warn');
 await f.live(true);await f.notify(null);let s=await f.status();assert.equal(s.activityMayBeMissed,true);assert.equal(s.enabled,true);
 assert.doesNotMatch(JSON.stringify(s),/synthetic-|yourtube-loss-warning|private synthetic/,'status must not disclose path or chat text');
 await f.notify('irrelevant.txt');assert.equal((await f.status()).activityMayBeMissed,true,'warning remains sticky');
 await f.live(false);assert.equal((await f.status()).activityMayBeMissed,false,'pause clears the warning');
 await f.live(true);await f.notify('');assert.equal((await f.status()).activityMayBeMissed,true,'empty names also warn while Live is on');
 await f.live(false);assert.equal((await f.status()).activityMayBeMissed,false);
});

test('only eviction of a distinct queued chat warns and the latest eight remain', {timeout:20000},async t=>{
 const f=await fixture(t,9);await f.live(true);
 async function append(i,text){fs.appendFileSync(path.join(f.sessions,`synthetic-${i}.jsonl`),event(text));await f.notify(`synthetic-${i}.jsonl`)}
 for(let i=0;i<8;i++)await append(i,`Synthetic distinct topic number ${i} requires study.`);
 assert.equal((await f.status()).activityMayBeMissed,false,'eight distinct entries fit');
 await append(7,'A second synthetic message in the same chat.');
 assert.equal((await f.status()).activityMayBeMissed,false,'same-chat coalescing must not warn');
 await append(8,'Synthetic distinct topic number 8 requires study.');
 const s=await f.status();assert.equal(s.activityMayBeMissed,true,'a ninth distinct entry evicts one');
 assert.doesNotMatch(JSON.stringify(s),/synthetic-|distinct topic|same chat/,'status must not disclose path or chat text');
 await f.waitFor(()=>fs.existsSync(f.marker)&&fs.readFileSync(f.marker,'utf8').trim().split('\n').length===8);
 const calls=fs.readFileSync(f.marker,'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(calls.length,8);assert.ok(calls.every(x=>!x.includes('topic number 0')),'the oldest queued chat is evicted');
 for(let i=1;i<=8;i++)assert.ok(calls.some(x=>x.includes(`topic number ${i}`)),`retained chat ${i}`);
 assert.ok(calls.some(x=>x.includes('second synthetic message in the same chat')),'the coalesced chat keeps its recent history');
 assert.equal((await f.status()).activityMayBeMissed,true,'warning remains after queue processing');
 await f.live(false);assert.equal((await f.status()).activityMayBeMissed,false,'pause clears the warning');
});

test('eviction while work is active warns without exposing or interrupting it', {timeout:10000},async t=>{
 const f=await fixture(t,10,true);await f.live(true);
 async function append(i,text){fs.appendFileSync(path.join(f.sessions,`synthetic-${i}.jsonl`),event(text));await f.notify(`synthetic-${i}.jsonl`)}
 await append(0,'Synthetic work currently undergoing classification.');
 await f.waitFor(()=>fs.existsSync(f.marker));assert.equal((await f.status()).mode,'curating');
 for(let i=1;i<=8;i++)await append(i,`Synthetic pending work number ${i}.`);
 await append(8,'A follow-up to pending synthetic work.');
 assert.equal((await f.status()).activityMayBeMissed,false,'coalescing at capacity does not drop a chat');
 await append(9,'A ninth distinct synthetic pending work item.');
 const s=await f.status();assert.equal(s.mode,'curating','the warning must not interrupt active work');assert.equal(s.activityMayBeMissed,true);
 assert.doesNotMatch(JSON.stringify(s),/synthetic-|pending work|classification/,'no chat names or message text enter status');
 await f.live(false);assert.equal((await f.status()).activityMayBeMissed,false);
});
