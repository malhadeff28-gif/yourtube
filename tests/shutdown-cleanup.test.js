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
async function waitFor(fn, message, timeout=5000) { const end=Date.now()+timeout;while(Date.now()<end){const x=await fn();if(x)return x;await delay(25)}throw Error(message) }
function event(text){return JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}})+'\n'}
async function fixture(t, { mode='hang', preload='' }={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yourtube-shutdown-cleanup-'));
  const sessions=path.join(dir,'sessions'),tmp=path.join(dir,'tmp');fs.mkdirSync(sessions);fs.mkdirSync(tmp);
  const session=path.join(sessions,'synthetic.jsonl');
  fs.writeFileSync(session,JSON.stringify({type:'session_meta',payload:{originator:'Codex Desktop',source:'vscode',thread_source:'user'}})+'\n');
  const fake=path.join(dir,'fake-codex'),marker=path.join(dir,'called'),feed=path.join(dir,'feed.json');
  fs.writeFileSync(fake,`#!/usr/bin/env node
const fs=require('node:fs');process.on('SIGTERM',()=>{});process.stdin.resume();process.stdin.on('end',()=>{
const out=process.argv[process.argv.indexOf('-o')+1];fs.writeFileSync(out,JSON.stringify(process.env.TEST_MODE==='substantive'?(process.argv.includes('--search')?{videos:[{id:'testVideo01',reason:'Synthetic'}]}:{relevant:true,context_id:'',project:'Synthetic',task:'Synthetic task',public_search:'synthetic topic'}):{relevant:false,context_id:'',project:'Synthetic',task:'Synthetic task',public_search:''}));
fs.appendFileSync(process.env.TEST_MARKER,'called\\n');if(process.env.TEST_MODE==='done'||process.env.TEST_MODE==='substantive')process.exit(0);else setTimeout(()=>process.exit(0),6000);
});`,{mode:0o755});
  fs.writeFileSync(path.join(dir,'curl'),`#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({title:'Synthetic',author_name:'Synthetic'}));`,{mode:0o755});
  fs.writeFileSync(path.join(dir,'python3'),`#!/usr/bin/env node\nrequire('node:fs').writeFileSync(process.env.TEST_MARKER+'.validator','');`,{mode:0o755});
  let nodeOptions=process.env.NODE_OPTIONS||'';
  if(preload){const script=path.join(dir,'preload.js');fs.writeFileSync(script,preload);nodeOptions+=` --require=${JSON.stringify(script)}`}
  const socket=http.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  const base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,NODE_OPTIONS:nodeOptions,PATH:`${dir}${path.delimiter}${process.env.PATH}`,TMPDIR:tmp,YOURTUBE_PORT:String(port),YOURTUBE_SESSIONS_DIR:sessions,YOURTUBE_FEED:feed,YOURTUBE_CODEX:mode==='missing'?path.join(dir,'missing-codex'):fake,YOURTUBE_DEBOUNCE_MS:'30',TEST_MODE:mode,TEST_MARKER:marker,TEST_TEMP_DIR:tmp},stdio:['ignore','ignore','pipe']});
  let stderr='';child.stderr.on('data',x=>{stderr+=x});
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await done}fs.rmSync(dir,{recursive:true,force:true})});
  await waitFor(async()=>{try{return(await fetch(`${base}/feed.json`)).ok}catch{return false}},'server did not start');
  const setLive=enabled=>fetch(`${base}/api/live`,{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({enabled})});
  return {dir,tmp,session,marker,feed,base,child,setLive,stderr:()=>stderr};
}
async function startFake(f){assert.equal((await f.setLive(true)).status,200);fs.appendFileSync(f.session,event('A synthetic topic to exercise shutdown cleanup.'));await waitFor(()=>fs.existsSync(f.marker),'fake Codex did not start')}
function outputs(f){return fs.readdirSync(f.tmp).filter(x=>/^yourtube-.*\.json$/.test(x))}
async function stop(f){const done=new Promise(resolve=>f.child.once('exit',(code,signal)=>resolve({code,signal})));f.child.kill('SIGTERM');return done}

test('shutdown waits for the killed fake child output cleanup', {timeout:10000}, async t=>{
  const f=await fixture(t);await startFake(f);assert.equal(outputs(f).length,1,'fake wrote a synthetic output first');
  assert.deepEqual(await stop(f),{code:0,signal:null});assert.deepEqual(outputs(f),[]);
});
test('shutdown with no child or an already-closed child exits cleanly', {timeout:10000}, async t=>{
  const a=await fixture(t);assert.equal((await stop(a)).code,0);
  const b=await fixture(t,{mode:'done'});await startFake(b);await waitFor(()=>outputs(b).length===0,'completed output was not cleaned');assert.equal((await stop(b)).code,0);
});
test('cleanup failures are reported and shutdown does not claim success', {timeout:10000}, async t=>{
  const preload=`if(process.argv[1]&&process.argv[1].endsWith('/server.js')){const fs=require('node:fs'),original=fs.rm;fs.rm=(p,opts,cb)=>String(p).startsWith(process.env.TEST_TEMP_DIR+'/yourtube-')?setImmediate(()=>cb(Object.assign(new Error('synthetic failure'),{code:'EACCES'}))):original(p,opts,cb)}`;
  const f=await fixture(t,{preload});await startFake(f);assert.equal((await stop(f)).code,1);assert.match(f.stderr(),/Could not remove temporary Codex output/);assert.equal(outputs(f).length,1);
});
test('shutdown has a bounded deadline if output cleanup never completes', {timeout:10000}, async t=>{
  const preload=`if(process.argv[1]&&process.argv[1].endsWith('/server.js')){const fs=require('node:fs'),rm=fs.rm,timer=global.setTimeout;fs.rm=(p,opts,cb)=>String(p).startsWith(process.env.TEST_TEMP_DIR+'/yourtube-')?undefined:rm(p,opts,cb);global.setTimeout=(fn,ms,...args)=>timer(fn,ms===2000?250:ms,...args)}`;
  const f=await fixture(t,{preload});await startFake(f);assert.equal((await stop(f)).code,1);assert.match(f.stderr(),/Shutdown timed out/);assert.equal(outputs(f).length,1);
});

const gateFeedRead=`if(process.argv[1]&&process.argv[1].endsWith('/server.js')){const fs=require('node:fs'),read=fs.promises.readFile;fs.promises.readFile=async function(p,...args){if(p===process.env.YOURTUBE_FEED&&new Error().stack.includes('processQueue')){fs.writeFileSync(process.env.TEST_MARKER+'.blocked','');while(!fs.existsSync(process.env.TEST_MARKER+'.release'))await new Promise(r=>setTimeout(r,10))}return read.call(this,p,...args)}}`;
async function startBlocked(f){assert.equal((await f.setLive(true)).status,200);fs.appendFileSync(f.session,event('A synthetic topic to exercise invalidation.'));await waitFor(()=>fs.existsSync(f.marker+'.blocked'),'feed read was not blocked')}
test('pausing during feed read prevents a new classifier process', {timeout:10000}, async t=>{
  const f=await fixture(t,{preload:gateFeedRead});await startBlocked(f);assert.equal((await f.setLive(false)).status,200);fs.writeFileSync(f.marker+'.release','');await delay(150);assert.equal(fs.existsSync(f.marker),false);assert.equal((await stop(f)).code,0);
});
test('shutdown during feed read waits for invalidated work without starting a classifier', {timeout:10000}, async t=>{
  const f=await fixture(t,{preload:gateFeedRead});await startBlocked(f);const done=stop(f);await delay(100);assert.equal(f.child.exitCode,null,'shutdown should wait for the in-flight read');fs.writeFileSync(f.marker+'.release','');assert.equal((await done).code,0);assert.equal(fs.existsSync(f.marker),false);
});

function status(base){return new Promise((resolve,reject)=>{const req=http.get(base+'/events',res=>{let text='';res.on('data',chunk=>{text+=chunk;const m=text.match(/event: status\ndata: ([^\n]+)\n\n/);if(m){res.destroy();resolve(JSON.parse(m[1]))}});res.on('error',reject)});req.on('error',reject)})}
const gateLatestRead=`if(process.argv[1]&&process.argv[1].endsWith('/server.js')){const fs=require('node:fs'),read=fs.promises.readFile;let count=0;fs.promises.readFile=async function(p,...args){if(p===process.env.YOURTUBE_FEED&&new Error().stack.includes('processQueue')&&++count===2){fs.writeFileSync(process.env.TEST_MARKER+'.blocked','');while(!fs.existsSync(process.env.TEST_MARKER+'.release'))await new Promise(r=>setTimeout(r,10))}return read.call(this,p,...args)}}`;
test('pausing during the latest feed read prevents validation and stale feed writes', {timeout:10000}, async t=>{
  const f=await fixture(t,{mode:'substantive',preload:gateLatestRead});const before=fs.readFileSync(f.feed,'utf8');await startBlockedFlow(f);assert.equal((await f.setLive(false)).status,200);fs.writeFileSync(f.marker+'.release','');await delay(150);assert.equal(fs.existsSync(f.marker+'.validator'),false);assert.equal(fs.readFileSync(f.feed,'utf8'),before);assert.equal((await stop(f)).code,0);
});
async function startBlockedFlow(f){assert.equal((await f.setLive(true)).status,200);fs.appendFileSync(f.session,event('Synthetic work topic for invalidation.'));const review=await waitFor(async()=>{const s=await status(f.base);return s.mode==='awaiting-review'&&s},'review not reached');const response=await fetch(f.base+'/api/search-review',{method:'POST',headers:{'content-type':'application/json',origin:f.base},body:JSON.stringify({requestId:review.requestId,action:'approve',query:'synthetic topic',projectId:review.pendingProject.id,projectName:review.pendingProject.name,projectTask:review.pendingProject.task})});assert.equal(response.status,200);await waitFor(()=>fs.existsSync(f.marker+'.blocked'),'latest feed read was not blocked')}
const gateTempWrite=`if(process.argv[1]&&process.argv[1].endsWith('/server.js')){const fs=require('node:fs'),write=fs.promises.writeFile;fs.promises.writeFile=async function(p,...args){const result=await write.call(this,p,...args);if(String(p).startsWith(process.env.YOURTUBE_FEED+'.tmp-')){fs.writeFileSync(process.env.TEST_MARKER+'.blocked','');while(!fs.existsSync(process.env.TEST_MARKER+'.release'))await new Promise(r=>setTimeout(r,10))}return result}}`;
test('shutdown during temp feed write removes the temp and starts no validator', {timeout:10000}, async t=>{
  const f=await fixture(t,{mode:'substantive',preload:gateTempWrite});const before=fs.readFileSync(f.feed,'utf8');await startBlockedFlow(f);assert.ok(fs.readdirSync(f.dir).some(x=>x.startsWith('feed.json.tmp-')));const done=stop(f);await delay(100);fs.writeFileSync(f.marker+'.release','');assert.equal((await done).code,0);assert.equal(fs.existsSync(f.marker+'.validator'),false);assert.equal(fs.readFileSync(f.feed,'utf8'),before);assert.equal(fs.readdirSync(f.dir).some(x=>x.startsWith('feed.json.tmp-')),false);
});
test('a hung cleanup pauses curation and blocks re-enabling it', {timeout:10000}, async t=>{
  const preload=`if(process.argv[1]&&process.argv[1].endsWith('/server.js')){const fs=require('node:fs'),rm=fs.rm,timer=global.setTimeout;fs.rm=(p,opts,cb)=>String(p).startsWith(process.env.TEST_TEMP_DIR+'/yourtube-')?undefined:rm(p,opts,cb);global.setTimeout=(fn,ms,...args)=>timer(fn,ms===2000?250:ms,...args)}`;
  const f=await fixture(t,{mode:'done',preload});await startFake(f);await waitFor(()=>f.stderr().includes('cleanup timed out'),'cleanup did not time out');const response=await f.setLive(true);const state=await response.json();assert.equal(state.enabled,false);assert.match(state.message,/temporary directory/i);fs.appendFileSync(f.session,event('A second synthetic work topic.'));await delay(200);assert.equal(fs.readFileSync(f.marker,'utf8').trim().split('\n').length,1);assert.equal((await stop(f)).code,1);assert.match(f.stderr(),/Shutdown timed out/);
});
test('a cleanup error prevents additional classifier outputs', {timeout:10000}, async t=>{
  const preload=`if(process.argv[1]&&process.argv[1].endsWith('/server.js')){const fs=require('node:fs'),rm=fs.rm;fs.rm=(p,opts,cb)=>String(p).startsWith(process.env.TEST_TEMP_DIR+'/yourtube-')?setImmediate(()=>cb(Object.assign(new Error('synthetic failure'),{code:'EACCES'}))):rm(p,opts,cb)}`;
  const f=await fixture(t,{mode:'done',preload});await startFake(f);await waitFor(()=>f.stderr().includes('Could not remove temporary'),'cleanup failure was not reported');const state=await (await f.setLive(true)).json();assert.equal(state.enabled,false);assert.match(state.message,/temporary directory/i);fs.appendFileSync(f.session,event('A second synthetic work topic.'));await delay(200);assert.equal(fs.readFileSync(f.marker,'utf8').trim().split('\n').length,1);assert.equal(outputs(f).length,1);assert.equal((await stop(f)).code,1);
});
test('a failed classifier spawn cleans up and permits shutdown', {timeout:10000}, async t=>{
  const f=await fixture(t,{mode:'missing'});assert.equal((await f.setLive(true)).status,200);fs.appendFileSync(f.session,event('Synthetic topic for spawn failure.'));await waitFor(async()=>{const s=await status(f.base);return s.mode==='error'},'spawn failure was not reported');assert.deepEqual(outputs(f),[]);assert.equal((await stop(f)).code,0);
});

test('cleanup warning remains visible after pause, delete, and watcher errors', {timeout:10000}, async t=>{
  const preload=`if(process.argv[1]&&process.argv[1].endsWith('/server.js')){const fs=require('node:fs'),rm=fs.rm,watch=fs.watch;fs.rm=(p,opts,cb)=>String(p).startsWith(process.env.TEST_TEMP_DIR+'/yourtube-')?setImmediate(()=>cb(Object.assign(new Error('synthetic failure'),{code:'EACCES'}))):rm(p,opts,cb);fs.watch=(...args)=>{const watcher=watch(...args);const t=setInterval(()=>{if(fs.existsSync(process.env.TEST_MARKER+'.watch-error')){clearInterval(t);watcher.emit('error',Error('synthetic watcher failure'))}},10);t.unref();return watcher}}`;
  const f=await fixture(t,{mode:'done',preload});await startFake(f);await waitFor(()=>f.stderr().includes('Could not remove temporary'),'cleanup failure was not reported');let state=await (await f.setLive(false)).json();assert.equal(state.enabled,false);assert.match(state.message,/temporary directory/i);assert.equal(state.mode,'error');const deleted=await fetch(f.base+'/api/context/delete',{method:'POST',headers:{'content-type':'application/json',origin:f.base},body:JSON.stringify({id:'synthetic'})});assert.equal(deleted.status,200);state=await status(f.base);assert.equal(state.enabled,false);assert.match(state.message,/temporary directory/i);assert.equal(state.mode,'error');fs.writeFileSync(f.marker+'.watch-error','');state=await waitFor(async()=>{const s=await status(f.base);return s.message.includes('Chat watcher stopped')&&s},'watcher error was not surfaced');assert.match(state.message,/temporary directory/i);assert.equal(state.enabled,false);assert.equal(state.mode,'error');state=await (await f.setLive(false)).json();assert.match(state.message,/temporary directory/i);assert.match(state.message,/Chat watcher stopped/);assert.equal((await stop(f)).code,1);
});
