'use strict';
const { fencedBody } = require('./support/live-control');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process'),{setTimeout:delay}=require('node:timers/promises');
const root=path.resolve(__dirname,'..');
const meta=JSON.stringify({type:'session_meta',payload:{originator:'Codex Desktop',source:'vscode',thread_source:'user'}})+'\n';
const event=text=>JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}})+'\n';
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yourtube-bounded-synthetic-')),sessions=path.join(dir,'sessions');fs.mkdirSync(sessions);
 for(const name of ['a','b','c'])fs.writeFileSync(path.join(sessions,`${name}.jsonl`),meta);
 const feed=path.join(dir,'feed.json'),calls=path.join(dir,'calls'),release=path.join(dir,'release');fs.writeFileSync(feed,JSON.stringify({contexts:[],videos:[],focusContext:''}));
 const fake=path.join(dir,'codex');fs.writeFileSync(fake,`#!/usr/bin/env node
const fs=require('fs');let input='';process.stdin.on('data',v=>input+=v);process.stdin.on('end',()=>{fs.appendFileSync(process.env.TEST_CALLS,JSON.stringify(input)+'\\n');const done=()=>fs.writeFileSync(process.argv[process.argv.indexOf('-o')+1],JSON.stringify({relevant:false}));if(process.env.TEST_BLOCK==='yes'&&!fs.existsSync(process.env.TEST_RELEASE)){const i=setInterval(()=>{if(fs.existsSync(process.env.TEST_RELEASE)){clearInterval(i);done()}},10)}else done()});`,{mode:0o755});
 const hook=path.join(dir,'hook.cjs');fs.writeFileSync(hook,`
if(process.argv[1]&&process.argv[1].endsWith('/server.js')){
 const fs=require('fs'),{EventEmitter}=require('events'),realWatch=fs.watch,realSet=global.setTimeout,realClear=global.clearTimeout;let now=0,next=0;const jobs=new Map();
 global.setTimeout=(fn,ms,...args)=>{if(ms!==12000&&ms!==60000)return realSet(fn,ms,...args);const id={syntheticTimer:++next,at:now+ms,fn:()=>fn(...args)};jobs.set(id,id);return id};
 global.clearTimeout=id=>{if(id&&id.syntheticTimer)jobs.delete(id);else realClear(id)};
 fs.watch=function(dir,opts,cb){if(String(dir)!==process.env.YOURTUBE_SESSIONS_DIR)return realWatch.apply(this,arguments);const w=new EventEmitter();w.close=()=>{};process.on('message',m=>{if(m?.kind==='watch'){cb('change',m.filename);process.send({ack:m.id})}else if(m?.kind==='advance'){const end=now+m.ms;while(true){const candidates=[...jobs.values()].filter(v=>v.at<=end).sort((a,b)=>a.at-b.at||a.syntheticTimer-b.syntheticTimer);if(!candidates.length)break;const x=candidates[0];jobs.delete(x);now=x.at;x.fn()}now=end;process.send({ack:m.id})}});return w};
}`);
 const socket=http.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));const base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,YOURTUBE_PORT:String(port),YOURTUBE_SESSIONS_DIR:sessions,YOURTUBE_FEED:feed,YOURTUBE_CODEX:fake,YOURTUBE_DEBOUNCE_MS:'12000',TEST_CALLS:calls,TEST_RELEASE:release,TEST_BLOCK:'yes',NODE_OPTIONS:`${process.env.NODE_OPTIONS||''} --require=${JSON.stringify(hook)}`},stdio:['ignore','ignore','ignore','ipc']});
 t.after(async()=>{if(child.exitCode===null){const done=new Promise(r=>child.once('exit',r));if(child.connected)child.disconnect();child.kill('SIGTERM');const killer=setTimeout(()=>child.kill('SIGKILL'),3000);await done;clearTimeout(killer)}fs.rmSync(dir,{recursive:true,force:true})});
 async function waitFor(fn){for(let i=0;i<400;i++){try{const value=await fn();if(value)return value}catch{}await delay(20)}throw Error('timeout')}
 await waitFor(async()=>(await fetch(`${base}/feed.json`)).ok);let sequence=0;
 const send=message=>new Promise((resolve,reject)=>{const id=++sequence;const timeout=setTimeout(()=>reject(Error('IPC timeout')),3000);const on=m=>{if(m?.ack===id){clearTimeout(timeout);child.off('message',on);resolve()}};child.on('message',on);child.send({...message,id})});
 async function append(file,text){fs.appendFileSync(path.join(sessions,`${file}.jsonl`),event(text));await send({kind:'watch',filename:`${file}.jsonl`})}
 async function live(enabled){const r=await fetch(`${base}/api/live`,{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify(await fencedBody(base,{enabled}))});assert.equal(r.status,200)}
 const getCalls=()=>fs.existsSync(calls)?fs.readFileSync(calls,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
 return {sessions,release,send,append,live,waitFor,getCalls};
}
test('synthetic Live batches dispatch at maximum wait and do not overlap a busy worker',{timeout:15000},async t=>{
 const f=await fixture(t);await f.live(true);await f.append('a','Synthetic first project needs reliable bounded scheduling.');
 for(let i=0;i<5;i++){await f.send({kind:'advance',ms:10000});await f.append('b',`Synthetic follow up ${i} on another project.`);assert.equal(f.getCalls().length,0)}
 await f.send({kind:'advance',ms:10000});await f.waitFor(()=>f.getCalls().length===1);assert.match(f.getCalls()[0],/first project/);
 await f.append('c','Synthetic pending activity while worker is held.');await f.send({kind:'advance',ms:60000});assert.equal(f.getCalls().length,1,'no overlapping classifiers');
 fs.writeFileSync(f.release,'go');await f.waitFor(()=>f.getCalls().length>=2);assert.ok(f.getCalls().some(x=>x.includes('another project')),'pending work starts when the worker finishes');
 await f.live(false);
});
test('pause clears pending synthetic work and its scheduling timers',{timeout:10000},async t=>{
 const f=await fixture(t);await f.live(true);await f.append('a','Synthetic pending item is canceled on pause.');await f.live(false);await f.send({kind:'advance',ms:70000});assert.equal(f.getCalls().length,0);
 await f.live(true);await f.send({kind:'advance',ms:70000});assert.equal(f.getCalls().length,0,'a stale timer never processes a prior Live run');await f.live(false);
});
