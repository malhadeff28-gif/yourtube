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
const header = JSON.stringify({type:'session_meta',payload:{originator:'Codex Desktop',source:'vscode',thread_source:'user'}})+'\n';
const message = text => JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}})+'\n';
async function fixture(t,{fastReview=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yourtube-loss-test-')),sessions=path.join(dir,'sessions'),session=path.join(sessions,'session.jsonl'),feed=path.join(dir,'feed.json'),mode=path.join(dir,'mode'),calls=path.join(dir,'calls'),renameFail=path.join(dir,'rename-fail');
 fs.mkdirSync(sessions);fs.writeFileSync(session,header);fs.writeFileSync(feed,JSON.stringify({contexts:[],videos:[],focusContext:''}));fs.writeFileSync(mode,'irrelevant');
 const codex=path.join(dir,'codex');fs.writeFileSync(codex,`#!/usr/bin/env node
const fs=require('node:fs');process.stdin.resume();process.stdin.on('end',()=>{const mode=fs.readFileSync(process.env.TEST_MODE,'utf8').trim(),search=process.argv.includes('--search');fs.appendFileSync(process.env.TEST_CALLS,JSON.stringify({mode,search})+'\\n');if(mode==='hang'){setInterval(()=>{},1000);return}if(mode==='exit'||(mode==='search-error'&&search))process.exit(1);const out=process.argv[process.argv.indexOf('-o')+1];if(mode==='malformed'){fs.writeFileSync(out,'{broken synthetic payload');return}const value=search?(mode==='empty'?{videos:[]}:{videos:[{id:'abc123def45',reason:'A synthetic reason'}]}):(mode==='irrelevant'?{relevant:false}:{relevant:true,project:'Synthetic project',task:'Study synthetic topic',context_id:'',public_search:'general learning topic'});fs.writeFileSync(out,JSON.stringify(value))});`,{mode:0o755});
 const curl=path.join(dir,'curl');fs.writeFileSync(curl,'#!/bin/sh\nprintf \'%s\' \'{"title":"Synthetic title","author_name":"Synthetic channel"}\'\n',{mode:0o755});
 const hook=path.join(dir,'hook.cjs');fs.writeFileSync(hook,`if(process.argv[1]&&process.argv[1].endsWith('/server.js')){const fs=require('node:fs'),{EventEmitter}=require('node:events'),realWatch=fs.watch,realSet=global.setTimeout,rename=fs.renameSync;global.setTimeout=(fn,ms,...args)=>realSet(fn,ms===120000?1500:(ms===600000&&process.env.TEST_FAST_REVIEW==='yes'?900:ms),...args);fs.renameSync=function(from,to){if(to===process.env.YOURTUBE_FEED&&fs.existsSync(process.env.TEST_RENAME_FAIL))throw Error(fs.readFileSync(process.env.TEST_RENAME_FAIL,'utf8'));return rename.apply(this,arguments)};fs.watch=function(dir,opts,cb){if(String(dir)!==process.env.YOURTUBE_SESSIONS_DIR)return realWatch.apply(this,arguments);const w=new EventEmitter();w.close=()=>{};process.on('message',m=>{if(m?.kind==='watch'){cb('change',m.filename);process.send({ack:m.id})}});return w}}`);
 const socket=http.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));const base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,YOURTUBE_PORT:String(port),YOURTUBE_SESSIONS_DIR:sessions,YOURTUBE_FEED:feed,YOURTUBE_CODEX:codex,YOURTUBE_DEBOUNCE_MS:'20',TEST_MODE:mode,TEST_CALLS:calls,TEST_RENAME_FAIL:renameFail,TEST_FAST_REVIEW:fastReview?'yes':'no',PATH:`${dir}${path.delimiter}${process.env.PATH}`,NODE_OPTIONS:`${process.env.NODE_OPTIONS||''} --require=${JSON.stringify(hook)}`},stdio:['ignore','ignore','ignore','ipc']});
 t.after(async()=>{if(child.exitCode===null){const done=new Promise(r=>child.once('exit',r));if(child.connected)child.disconnect();child.kill('SIGTERM');const killer=setTimeout(()=>child.kill('SIGKILL'),3000);await done;clearTimeout(killer)}fs.rmSync(dir,{recursive:true,force:true})});
 async function waitFor(fn){for(let i=0;i<500;i++){try{const result=await fn();if(result)return result}catch{}await delay(20)}throw Error('synthetic wait timed out')}
 await waitFor(async()=>(await fetch(`${base}/feed.json`)).ok);
 let sequence=0;function notify(){return new Promise((resolve,reject)=>{const id=++sequence,timeout=setTimeout(()=>reject(Error('watch acknowledgement timed out')),3000);const listener=m=>{if(m?.ack===id){clearTimeout(timeout);child.off('message',listener);resolve()}};child.on('message',listener);child.send({kind:'watch',filename:'session.jsonl',id})})}
 async function append(text){fs.appendFileSync(session,message(text));await notify()}
 const post=(endpoint,value)=>fetch(`${base}${endpoint}`,{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify(value)});
 const status=()=>new Promise((resolve,reject)=>{const req=http.get(`${base}/events`,res=>{let text='';res.on('data',chunk=>{text+=chunk;const m=text.match(/event: status\ndata: ([^\n]+)\n\n/);if(m){res.destroy();resolve(JSON.parse(m[1]))}});res.on('error',reject)});req.on('error',reject)});
 const live=async enabled=>assert.equal((await post('/api/live',{enabled})).status,200);
 const setMode=value=>fs.writeFileSync(mode,value);
 const getCalls=()=>fs.existsSync(calls)?fs.readFileSync(calls,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
 const approve=async pending=>assert.equal((await post('/api/search-review',{requestId:pending.requestId,action:'approve',query:pending.pendingQuery,projectId:pending.pendingProject.id,projectName:pending.pendingProject.name,projectTask:pending.pendingProject.task})).status,200);
 return {append,waitFor,status,live,setMode,getCalls,approve,post,renameFail};
}

test('operational classifier failures retain a coarse warning until pause without leaking details',{timeout:25000},async t=>{
 const f=await fixture(t);await f.live(true);
 for(const mode of ['malformed','exit','hang']){
  f.setMode(mode);await f.append('SYNTHETIC_PRIVATE_MESSAGE_SHOULD_NOT_APPEAR');
  const failed=await f.waitFor(async()=>{const s=await f.status();return s.mode==='error'&&s.activityMayBeMissed&&s});
  assert.doesNotMatch(JSON.stringify(failed),/SYNTHETIC_PRIVATE_MESSAGE|SYNTHETIC_PRIVATE_PATH|yourtube-loss-test/);
  f.setMode('irrelevant');const count=f.getCalls().length;await f.append('Synthetic unrelated follow-up');await f.waitFor(()=>f.getCalls().length>count);const later=await f.waitFor(async()=>{const s=await f.status();return s.mode==='listening'&&s});assert.equal(later.activityMayBeMissed,true,'later successful no-op does not erase loss warning');
  await f.live(false);assert.equal((await f.status()).activityMayBeMissed,false);await f.live(true);
 }
});

test('empty results and intentional cancellation are not operational failures',{timeout:18000},async t=>{
 const f=await fixture(t);await f.live(true);f.setMode('irrelevant');await f.append('Synthetic irrelevant message');await f.waitFor(()=>f.getCalls().length===1);await f.waitFor(async()=>{const s=await f.status();return s.mode==='listening'});assert.equal((await f.status()).activityMayBeMissed,false);
 f.setMode('empty');await f.append('Synthetic task for search');let pending=await f.waitFor(async()=>{const s=await f.status();return s.mode==='awaiting-review'&&s});await f.approve(pending);const empty=await f.waitFor(async()=>{const s=await f.status();return /No video candidates/.test(s.message)&&s});assert.equal(empty.mode,'listening');assert.equal(empty.activityMayBeMissed,false);
 f.setMode('relevant');await f.append('Synthetic task to cancel');pending=await f.waitFor(async()=>{const s=await f.status();return s.mode==='awaiting-review'&&s});assert.equal((await f.post('/api/search-review',{requestId:pending.requestId,action:'cancel'})).status,200);const canceled=await f.waitFor(async()=>{const s=await f.status();return s.mode==='listening'&&s});assert.equal(canceled.activityMayBeMissed,false);
 f.setMode('hang');await f.append('Synthetic task stopped by pause');await f.waitFor(()=>f.getCalls().some(x=>x.mode==='hang'));await f.live(false);await delay(100);const paused=await f.status();assert.equal(paused.mode,'paused');assert.equal(paused.activityMayBeMissed,false);
});

test('feed write failures preserve the feed and mark loss without exposing errors',{timeout:15000},async t=>{
 const f=await fixture(t);await f.live(true);f.setMode('relevant');fs.writeFileSync(f.renameFail,'SYNTHETIC_PRIVATE_PATH_AND_CONTENT');await f.append('Synthetic task triggering failed commit');const pending=await f.waitFor(async()=>{const s=await f.status();return s.mode==='awaiting-review'&&s});await f.approve(pending);const failed=await f.waitFor(async()=>{const s=await f.status();return s.mode==='error'&&s.activityMayBeMissed&&s});assert.match(failed.message,/Live update failed/);assert.doesNotMatch(JSON.stringify(failed),/SYNTHETIC_PRIVATE_PATH|yourtube-loss-test/);
});


test('review timeout is intentional but search provider failure warns', {timeout:15000}, async t=>{
 const f=await fixture(t,{fastReview:true});await f.live(true);f.setMode('relevant');await f.append('Synthetic request to allow review timeout');await f.waitFor(async()=>{const s=await f.status();return s.mode==='awaiting-review'});const timedOut=await f.waitFor(async()=>{const s=await f.status();return s.mode==='listening'&&s});assert.equal(timedOut.activityMayBeMissed,false);
 f.setMode('search-error');await f.append('Synthetic request causing search failure');const pending=await f.waitFor(async()=>{const s=await f.status();return s.mode==='awaiting-review'&&s});await f.approve(pending);const failed=await f.waitFor(async()=>{const s=await f.status();return s.mode==='error'&&s.activityMayBeMissed&&s});assert.match(failed.message,/Live update failed/);
});


test('only the exact fixed allocator error is publicly displayed',{timeout:15000},async t=>{
 const f=await fixture(t);await f.live(true);f.setMode('relevant');let previous=null;
 for(const [detail,expected] of [['Could not allocate a unique project ID','Could not allocate a unique project ID'],['Could not allocate a unique project ID SYNTHETIC_PRIVATE_PATH','An unexpected error occurred']]){
  fs.writeFileSync(f.renameFail,detail);await f.append('Synthetic work for an allocation failure');const pending=await f.waitFor(async()=>{const s=await f.status();return s.mode==='awaiting-review'&&s.requestId!==previous&&s});previous=pending.requestId;await f.approve(pending);const failed=await f.waitFor(async()=>{const s=await f.status();return s.mode==='error'&&s.activityMayBeMissed&&s});assert.ok(failed.message.includes(expected));assert.doesNotMatch(JSON.stringify(failed),/SYNTHETIC_PRIVATE_PATH/);
 }
});
