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
 const marker=path.join(dir,'calls'),release=path.join(dir,'release');
 const fake=path.join(dir,'fake-codex');fs.writeFileSync(fake,`#!/usr/bin/env node
const fs=require('node:fs');let input='';process.stdin.on('data',s=>input+=s);process.stdin.on('end',()=>{fs.appendFileSync(process.env.TEST_CALLS,JSON.stringify(input)+'\\n');if(process.env.TEST_BLOCK_CODEX==='yes'){const waiting=setInterval(()=>{if(fs.existsSync(process.env.TEST_RELEASE)){clearInterval(waiting);fs.writeFileSync(process.argv[process.argv.indexOf('-o')+1],JSON.stringify({relevant:false}));}},20);return}fs.writeFileSync(process.argv[process.argv.indexOf('-o')+1],JSON.stringify({relevant:false}));});`,{mode:0o755});
 const hook=path.join(dir,'watch-hook.cjs');fs.writeFileSync(hook,`
if(process.argv[1]&&process.argv[1].endsWith('/server.js')){
 const fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events'),old=fs.watch,oldStat=fs.statSync,oldOpen=fs.openSync,oldRead=fs.readSync,oldFstat=fs.fstatSync;let removeBeforeRecheck=null,fault=null;
 fs.openSync=function(file,...args){if(fault&&fault.file===String(file)){if(fault.stage==='open'){fault=null;throw Object.assign(Error('synthetic sensitive open detail'),{code:'EACCES'})}const fd=oldOpen.call(this,file,...args);fault.fd=fd;return fd}return oldOpen.call(this,file,...args)};
 fs.readSync=function(fd,...args){if(fault&&fault.fd===fd&&(fault.stage==='read'||(fault.stage==='content'&&args[3]>0))){fault=null;throw Object.assign(Error('synthetic sensitive read detail'),{code:'EIO'})}return oldRead.call(this,fd,...args)};
 fs.fstatSync=function(fd,...args){if(fault&&fault.stage==='fstat'&&fault.fd===fd){fault=null;throw Object.assign(Error('synthetic sensitive stat detail'),{code:'EIO'})}return oldFstat.call(this,fd,...args)};
 fs.statSync=function(file,...args){if(fault&&fault.stage==='path-stat'&&fault.file===String(file)){fault=null;throw Object.assign(Error('synthetic sensitive path detail'),{code:'EACCES'})}if(removeBeforeRecheck===String(file)){removeBeforeRecheck=null;fs.unlinkSync(file)}return oldStat.call(this,file,...args)};
 fs.watch=function(dir,opts,cb){if(String(dir)!==process.env.YOURTUBE_SESSIONS_DIR)return old.apply(this,arguments);const w=new EventEmitter();w.close=()=>{};process.on('message',m=>{if(m&&m.kind==='synthetic-watch'){if(m.removeBeforeRecheck)removeBeforeRecheck=path.join(dir,String(m.filename));if(m.fault)fault={file:path.join(dir,String(m.filename)),stage:m.fault};try{cb('change',m.filename)}finally{removeBeforeRecheck=null;fault=null}process.send({ack:m.id})}});return w};
}`);
 const socket=http.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));const base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,YOURTUBE_PORT:String(port),YOURTUBE_SESSIONS_DIR:sessions,YOURTUBE_FEED:feed,YOURTUBE_CODEX:fake,YOURTUBE_DEBOUNCE_MS:'700',TEST_CALLS:marker,TEST_RELEASE:release,TEST_BLOCK_CODEX:blockCodex?'yes':'no',NODE_OPTIONS:`${process.env.NODE_OPTIONS||''} --require=${JSON.stringify(hook)}`},stdio:['ignore','ignore','ignore','ipc']});
 t.after(async()=>{if(child.exitCode===null){const done=new Promise(resolve=>child.once('exit',resolve));if(child.connected)child.disconnect();child.kill('SIGTERM');const deadline=setTimeout(()=>child.kill('SIGKILL'),3000);await done;clearTimeout(deadline)}fs.rmSync(dir,{recursive:true,force:true})});
 async function waitFor(fn){for(let i=0;i<480;i++){const result=await fn();if(result)return result;await delay(25)}throw Error('timed out')}
 await waitFor(async()=>{try{return (await fetch(`${base}/feed.json`)).ok}catch{return false}});
 let id=0;
 async function notify(filename,removeBeforeRecheck=false,fault=null){const n=++id;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('watch callback timed out')),2000);function onMessage(m){if(m&&m.ack===n){clearTimeout(timer);child.off('message',onMessage);resolve()}}child.on('message',onMessage);child.send({kind:'synthetic-watch',filename,id:n,removeBeforeRecheck,fault})})}
 const live=async enabled=>(await fetch(`${base}/api/live`,{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({enabled})})).json();
 const status=()=>new Promise((resolve,reject)=>{const req=http.get(`${base}/events`,res=>{let text='';res.on('data',chunk=>{text+=chunk;const match=text.match(/event: status\ndata: ([^\n]+)\n\n/);if(match){res.destroy();resolve(JSON.parse(match[1]))}});res.on('error',reject)});req.on('error',reject)});
 return {sessions,marker,release,notify,live,status,waitFor};
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


test('discarding queued work on an unapproved replacement warns without replaying it', {timeout:15000},async t=>{
 const f=await fixture(t,2,true);await f.live(true);
 const first=path.join(f.sessions,'synthetic-0.jsonl'),second=path.join(f.sessions,'synthetic-1.jsonl');
 fs.appendFileSync(first,event('Synthetic active work for the blocked classifier.'));await f.notify('synthetic-0.jsonl');
 await f.waitFor(()=>fs.existsSync(f.marker));assert.equal((await f.status()).mode,'curating');
 fs.appendFileSync(second,event('Synthetic queued work that should be discarded.'));await f.notify('synthetic-1.jsonl');
 assert.equal((await f.status()).activityMayBeMissed,false);
 const replacement=path.join(f.sessions,'replacement.tmp');fs.writeFileSync(replacement,JSON.stringify({type:'session_meta',payload:{originator:'Unapproved'}})+'\n');fs.renameSync(replacement,second);await f.notify('synthetic-1.jsonl');
 let s=await f.status();assert.equal(s.activityMayBeMissed,true,'dropping queued activity is reported');
 assert.doesNotMatch(JSON.stringify(s),/synthetic-|queued work|replacement.tmp|yourtube-loss-warning/,'status contains no path or message');
 fs.writeFileSync(f.release,'release');await f.waitFor(async()=> (await f.status()).mode==='listening');await delay(900);
 const calls=fs.readFileSync(f.marker,'utf8').trim().split('\n').map(JSON.parse);assert.equal(calls.length,1,'discarded queued work is not processed or replayed');
 assert.equal((await f.status()).activityMayBeMissed,true,'warning stays until pause');
 await f.live(false);assert.equal((await f.status()).activityMayBeMissed,false);
});

test('an unapproved replacement without queued work does not warn, including while paused', {timeout:10000},async t=>{
 const f=await fixture(t,2);await f.live(true);
 async function replace(i){const target=path.join(f.sessions,`synthetic-${i}.jsonl`),temp=path.join(f.sessions,`replacement-${i}.tmp`);fs.writeFileSync(temp,JSON.stringify({type:'session_meta',payload:{originator:'Unapproved'}})+'\n');fs.renameSync(temp,target);await f.notify(`synthetic-${i}.jsonl`)}
 await replace(0);assert.equal((await f.status()).activityMayBeMissed,false,'no queued work was lost');
 await f.live(false);await replace(1);assert.equal((await f.status()).activityMayBeMissed,false,'paused replacements do not warn');
});

test('an unapproved same-file rewrite warns only when it clears queued work', {timeout:12000},async t=>{
 const f=await fixture(t,2,true);await f.live(true);
 const active=path.join(f.sessions,'synthetic-0.jsonl'),queued=path.join(f.sessions,'synthetic-1.jsonl');
 fs.appendFileSync(active,event('Synthetic classifier work that is already active.'));await f.notify('synthetic-0.jsonl');await f.waitFor(()=>fs.existsSync(f.marker));
 // The active entry has already left the queue; invalidating its file alone must not warn.
 const badHeader=JSON.stringify({type:'session_meta',payload:{originator:'Unapproved'}})+'\n';
 const activeSize=fs.statSync(active).size;fs.writeFileSync(active,badHeader+' '.repeat(activeSize+10));await f.notify('synthetic-0.jsonl');
 assert.equal((await f.status()).activityMayBeMissed,false,'already-dequeued active work is not queue loss');
 fs.appendFileSync(queued,event('Synthetic queued work in a changing file.'));await f.notify('synthetic-1.jsonl');
 const queuedSize=fs.statSync(queued).size;fs.writeFileSync(queued,badHeader+' '.repeat(queuedSize+10));await f.notify('synthetic-1.jsonl');
 const s=await f.status();assert.equal(s.activityMayBeMissed,true,'unauthorized header rewrite dropped queued work');
 assert.doesNotMatch(JSON.stringify(s),/synthetic-|changing file|already active/);
 await f.live(false);assert.equal((await f.status()).activityMayBeMissed,false);
});

test('observed deletion discards queued and recent activity, then baselines a reappearing file', {timeout:18000},async t=>{
 const f=await fixture(t,3,true);await f.live(true);
 async function append(i,text){fs.appendFileSync(path.join(f.sessions,`synthetic-${i}.jsonl`),event(text));await f.notify(`synthetic-${i}.jsonl`)}
 await append(0,'Synthetic active topic held while other activity is queued.');await f.waitFor(()=>fs.existsSync(f.marker));
 await append(1,'Synthetic deleted topic that must not be processed.');
 await append(2,'Synthetic unrelated topic must still be processed.');
 const removed=path.join(f.sessions,'synthetic-1.jsonl');fs.unlinkSync(removed);await f.notify('synthetic-1.jsonl');
 let s=await f.status();assert.equal(s.activityMayBeMissed,true,'discarded queued activity is reported');
 assert.doesNotMatch(JSON.stringify(s),/synthetic-|deleted topic|yourtube-loss-warning/,'status does not expose paths or content');
 fs.writeFileSync(removed,meta+event('Synthetic preexisting message in reappearing session.'));await f.notify('synthetic-1.jsonl');
 fs.writeFileSync(f.release,'release');
 await f.waitFor(()=>fs.readFileSync(f.marker,'utf8').trim().split('\n').length===2);
 let calls=fs.readFileSync(f.marker,'utf8').trim().split('\n').map(JSON.parse);
 assert.ok(calls.some(call=>call.includes('unrelated topic')),'other file remains queued');
 assert.ok(calls.every(call=>!call.includes('deleted topic')&&!call.includes('preexisting message')),'deleted and preexisting text are not replayed');
 await append(1,'Synthetic fresh activity after the new session baseline.');
 await f.waitFor(()=>fs.readFileSync(f.marker,'utf8').trim().split('\n').length===3);
 calls=fs.readFileSync(f.marker,'utf8').trim().split('\n').map(JSON.parse);
 assert.ok(calls.some(call=>call.includes('fresh activity')),'new activity after the baseline is processed');
 assert.ok(calls.every(call=>!call.includes('deleted topic')&&!call.includes('preexisting message')),'old recent context is cleared');
 assert.equal((await f.status()).activityMayBeMissed,true,'warning stays until pause');await f.live(false);assert.equal((await f.status()).activityMayBeMissed,false);
});

test('missing files without queued work do not warn, including while paused', {timeout:10000},async t=>{
 const f=await fixture(t,2);await f.live(true);
 fs.unlinkSync(path.join(f.sessions,'synthetic-0.jsonl'));await f.notify('synthetic-0.jsonl');
 assert.equal((await f.status()).activityMayBeMissed,false,'no queued work was dropped');
 await f.live(false);fs.unlinkSync(path.join(f.sessions,'synthetic-1.jsonl'));await f.notify('synthetic-1.jsonl');
 assert.equal((await f.status()).activityMayBeMissed,false,'paused missing-file events do not warn');
});

test('disappearance during pathname revalidation also clears queued activity', {timeout:15000},async t=>{
 const f=await fixture(t,2,true);await f.live(true);
 const active=path.join(f.sessions,'synthetic-0.jsonl'),queued=path.join(f.sessions,'synthetic-1.jsonl');
 fs.appendFileSync(active,event('Synthetic active work blocking the classifier.'));await f.notify('synthetic-0.jsonl');await f.waitFor(()=>fs.existsSync(f.marker));
 fs.appendFileSync(queued,event('Synthetic queued work in a soon missing session.'));await f.notify('synthetic-1.jsonl');
 fs.appendFileSync(queued,event('Synthetic additional message interrupted during read.'));await f.notify('synthetic-1.jsonl',true);
 assert.equal(fs.existsSync(queued),false);let s=await f.status();assert.equal(s.activityMayBeMissed,true);
 assert.doesNotMatch(JSON.stringify(s),/synthetic-|soon missing|interrupted during read/);
 fs.writeFileSync(queued,meta+event('Synthetic old message in the recreated session.'));await f.notify('synthetic-1.jsonl');
 fs.writeFileSync(f.release,'release');await f.waitFor(async()=>(await f.status()).mode==='listening');await delay(900);
 const calls=fs.readFileSync(f.marker,'utf8').trim().split('\n').map(JSON.parse);assert.equal(calls.length,1,'no stale or recreated preexisting activity is processed');
 await f.live(false);assert.equal((await f.status()).activityMayBeMissed,false);
});

test('same-size malformed authorization drops queued work and repair baselines uncertain bytes', {timeout:20000},async t=>{
 const f=await fixture(t,3,true);await f.live(true);
 async function append(i,text){fs.appendFileSync(path.join(f.sessions,`synthetic-${i}.jsonl`),event(text));await f.notify(`synthetic-${i}.jsonl`)}
 await append(0,'Synthetic active classifier remains blocked.');await f.waitFor(()=>fs.existsSync(f.marker));
 await append(1,'Synthetic previously queued message must be discarded.');
 await append(2,'Synthetic unrelated queued topic remains eligible.');
 const file=path.join(f.sessions,'synthetic-1.jsonl'), original=fs.readFileSync(file);const malformed=Buffer.from(original);malformed[0]='!'.charCodeAt(0);fs.writeFileSync(file,malformed);
 await f.notify('synthetic-1.jsonl');let s=await f.status();assert.equal(s.activityMayBeMissed,true,'same-size invalid header drops pending work');
 assert.doesNotMatch(JSON.stringify(s),/synthetic-|previously queued|loss-warning/);
 fs.writeFileSync(file,original);await f.notify('synthetic-1.jsonl');
 await append(1,'Synthetic fresh authorized message after safe baseline.');
 fs.writeFileSync(f.release,'release');await f.waitFor(()=>fs.readFileSync(f.marker,'utf8').trim().split('\n').length===3);
 const calls=fs.readFileSync(f.marker,'utf8').trim().split('\n').map(JSON.parse);
 assert.ok(calls.some(x=>x.includes('unrelated queued topic')));assert.ok(calls.some(x=>x.includes('fresh authorized message')));
 assert.ok(calls.every(x=>!x.includes('previously queued message')),'old queued/recent text cannot replay');
 assert.equal((await f.status()).activityMayBeMissed,true);await f.live(false);assert.equal((await f.status()).activityMayBeMissed,false);
});

test('unverifiable appended bytes are skipped until a repaired header has been baselined', {timeout:16000},async t=>{
 const f=await fixture(t,1);await f.live(true);const file=path.join(f.sessions,'synthetic-0.jsonl');
 fs.writeFileSync(file,'!'+meta.slice(1)+event('Synthetic content under an invalid header.'));await f.notify('synthetic-0.jsonl');
 assert.equal((await f.status()).activityMayBeMissed,true,'unverifiable appended bytes may contain activity');
 fs.writeFileSync(file,meta+event('Synthetic uncertain bytes while header was invalid.'));await f.notify('synthetic-0.jsonl');
 fs.appendFileSync(file,event('Synthetic new message after repair is baselined.'));await f.notify('synthetic-0.jsonl');
 await f.waitFor(()=>fs.existsSync(f.marker));const calls=fs.readFileSync(f.marker,'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(calls.length,1);assert.ok(calls[0].includes('new message after repair'));assert.ok(!calls[0].includes('uncertain bytes'));
});

test('observed open and read failures fail closed and recovery baselines without replay', {timeout:25000},async t=>{
 for(const stage of ['open','read','content','fstat','path-stat']){
  await t.test(stage,async t=>{
   const f=await fixture(t,3,true);await f.live(true);
   async function append(i,text){fs.appendFileSync(path.join(f.sessions,`synthetic-${i}.jsonl`),event(text));await f.notify(`synthetic-${i}.jsonl`)}
   await append(0,'Synthetic active classifier remains blocked.');await f.waitFor(()=>fs.existsSync(f.marker));
   await append(1,'Synthetic queued secret must be removed after error.');await append(2,'Synthetic unrelated work must survive an error.');
   if(stage==='content'||stage==='path-stat')fs.appendFileSync(path.join(f.sessions,'synthetic-1.jsonl'),event('Synthetic unread new activity before read error.'));
   await f.notify('synthetic-1.jsonl',false,stage);const s=await f.status();assert.equal(s.activityMayBeMissed,true);assert.match(s.message,/Could not read a local chat event/);
   assert.doesNotMatch(JSON.stringify(s),/synthetic-|sensitive|queued secret|EACCES|EIO/,'status must not expose paths, text or raw errors');
   await f.notify('synthetic-1.jsonl');await append(1,'Synthetic new activity after readable baseline.');
   fs.writeFileSync(f.release,'release');await f.waitFor(()=>fs.readFileSync(f.marker,'utf8').trim().split('\n').length===3);
   const calls=fs.readFileSync(f.marker,'utf8').trim().split('\n').map(JSON.parse);
   assert.ok(calls.some(x=>x.includes('unrelated work')));assert.ok(calls.some(x=>x.includes('new activity after readable baseline')));
   assert.ok(calls.every(x=>!x.includes('queued secret')),'cached text from the failed path is discarded');
   await f.live(false);assert.equal((await f.status()).activityMayBeMissed,false);
  });
 }
});

test('a read failure without queued work warns while live but never while paused', {timeout:12000},async t=>{
 const f=await fixture(t,2);await f.live(true);await f.notify('synthetic-0.jsonl',false,'open');
 assert.equal((await f.status()).activityMayBeMissed,true,'a failed observed read may have missed activity');
 await f.live(false);await f.notify('synthetic-1.jsonl',false,'read');assert.equal((await f.status()).activityMayBeMissed,false,'paused errors do not warn');
});

test('same-size unapproved header clears queued text and does not replay after repair', {timeout:15000},async t=>{
 const f=await fixture(t,2,true);await f.live(true);const active=path.join(f.sessions,'synthetic-0.jsonl'),file=path.join(f.sessions,'synthetic-1.jsonl');
 fs.appendFileSync(active,event('Synthetic active classifier is held.'));await f.notify('synthetic-0.jsonl');await f.waitFor(()=>fs.existsSync(f.marker));
 fs.appendFileSync(file,event('Synthetic queued content from an unapproved rewrite.'));await f.notify('synthetic-1.jsonl');
 const original=fs.readFileSync(file,'utf8'), changed=original.replace('Codex Desktop','Other Desktop');assert.equal(Buffer.byteLength(changed),Buffer.byteLength(original));fs.writeFileSync(file,changed);await f.notify('synthetic-1.jsonl');
 assert.equal((await f.status()).activityMayBeMissed,true);
 fs.writeFileSync(file,original);await f.notify('synthetic-1.jsonl');fs.appendFileSync(file,event('Synthetic fresh authorized content after repair.'));await f.notify('synthetic-1.jsonl');
 fs.writeFileSync(f.release,'release');await f.waitFor(()=>fs.readFileSync(f.marker,'utf8').trim().split('\n').length===2);
 const calls=fs.readFileSync(f.marker,'utf8').trim().split('\n').map(JSON.parse);assert.ok(calls.some(x=>x.includes('fresh authorized content')));assert.ok(calls.every(x=>!x.includes('queued content from an unapproved')));
});

test('same-size pathname disappearance during header validation removes queued text', {timeout:15000},async t=>{
 const f=await fixture(t,2,true);await f.live(true);const active=path.join(f.sessions,'synthetic-0.jsonl'),file=path.join(f.sessions,'synthetic-1.jsonl');
 fs.appendFileSync(active,event('Synthetic active classifier is held.'));await f.notify('synthetic-0.jsonl');await f.waitFor(()=>fs.existsSync(f.marker));
 fs.appendFileSync(file,event('Synthetic queued content before path disappears.'));await f.notify('synthetic-1.jsonl');await f.notify('synthetic-1.jsonl',true);
 assert.equal(fs.existsSync(file),false);assert.equal((await f.status()).activityMayBeMissed,true);
 fs.writeFileSync(f.release,'release');await f.waitFor(async()=>(await f.status()).mode==='listening');await delay(900);
 assert.equal(fs.readFileSync(f.marker,'utf8').trim().split('\n').length,1,'no discarded queued text is processed');
});

test('structurally incomplete session headers with appended bytes are unverifiable', {timeout:10000},async t=>{
 const f=await fixture(t,1);await f.live(true);const file=path.join(f.sessions,'synthetic-0.jsonl');
 fs.writeFileSync(file,JSON.stringify({type:'session_meta',payload:{originator:'Codex Desktop'}})+'\n'+event('Synthetic message beneath an incomplete header.'));
 await f.notify('synthetic-0.jsonl');assert.equal((await f.status()).activityMayBeMissed,true);
 assert.equal(fs.existsSync(f.marker),false,'unverifiable bytes are not sent for processing');
 await f.live(false);assert.equal((await f.status()).activityMayBeMissed,false);
});
