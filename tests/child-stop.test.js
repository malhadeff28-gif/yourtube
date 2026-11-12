'use strict';
const { fencedBody } = require('./support/live-control');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');
const {setTimeout: delay} = require('node:timers/promises');

async function waitFor(check, message, timeout=5000){
  const end=Date.now()+timeout;
  while(Date.now()<end){if(await check())return;await delay(25)}
  throw Error(message);
}
function alive(pid){try{process.kill(pid,0);return true}catch(err){if(err.code==='ESRCH')return false;throw err}}
function userEvent(text){return JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}})+'\n'}

test('pause escalates an unresponsive Codex process and permits future work', {timeout:15000}, async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yourtube-child-stop-'));
  const sessions=path.join(dir,'sessions');fs.mkdirSync(sessions);
  const session=path.join(sessions,'synthetic.jsonl');
  fs.writeFileSync(session,JSON.stringify({type:'session_meta',payload:{originator:'Codex Desktop',source:'vscode',thread_source:'user'}})+'\n');
  const fake=path.join(dir,'fake-codex'), marker=path.join(dir,'calls');
  fs.writeFileSync(fake,`#!/usr/bin/env node
const fs=require('node:fs');process.on('SIGTERM',()=>{});process.stdin.resume();process.stdin.on('end',()=>{
 fs.appendFileSync(process.env.TEST_MARKER,String(process.pid)+'\\n');
 setTimeout(()=>process.exit(0),6000);
});`,{mode:0o755});
  const socket=http.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
  const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  const base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{
    ...process.env,YOURTUBE_PORT:String(port),YOURTUBE_SESSIONS_DIR:sessions,
    YOURTUBE_FEED:path.join(dir,'feed.json'),YOURTUBE_CODEX:fake,YOURTUBE_DEBOUNCE_MS:'30',TEST_MARKER:marker,
  },stdio:'ignore'});
  const pids=[];
  t.after(async()=>{
    if(child.exitCode===null&&child.signalCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await done}
    fs.rmSync(dir,{recursive:true,force:true});
  });
  await waitFor(async()=>{try{return (await fetch(base+'/feed.json')).ok}catch{return false}},'server failed to start');
  const setLive=async enabled=>fetch(base+'/api/live',{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify(await fencedBody(base,{enabled}))});
  assert.equal((await setLive(true)).status,200);
  fs.appendFileSync(session,userEvent('A synthetic topic to exercise an unresponsive fake process.'));
  await waitFor(()=>fs.existsSync(marker),'fake Codex did not start');
  pids.push(Number(fs.readFileSync(marker,'utf8').trim()));
  assert.ok(alive(pids[0]));
  assert.equal((await setLive(false)).status,200);
  await waitFor(()=>!alive(pids[0]),'pause left the fake Codex process running',4000);
  assert.equal((await setLive(true)).status,200);
  fs.appendFileSync(session,userEvent('A second synthetic topic after resuming live mode.'));
  await waitFor(()=>fs.readFileSync(marker,'utf8').trim().split('\n').length===2,'resuming did not process a new event');
  pids.push(Number(fs.readFileSync(marker,'utf8').trim().split('\n')[1]));
  const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await done;
  await waitFor(()=>!alive(pids[1]),'server shutdown left the fake Codex process running',4000);
});

test('the Codex timeout escalates when the child ignores SIGTERM', {timeout:12000}, async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yourtube-child-timeout-'));
  const sessions=path.join(dir,'sessions');fs.mkdirSync(sessions);
  const session=path.join(sessions,'synthetic.jsonl');
  fs.writeFileSync(session,JSON.stringify({type:'session_meta',payload:{originator:'Codex Desktop',source:'vscode',thread_source:'user'}})+'\n');
  const fake=path.join(dir,'fake-codex'),marker=path.join(dir,'pid'),preload=path.join(dir,'test-timeout.js');
  fs.writeFileSync(fake,`#!/usr/bin/env node
const fs=require('node:fs');process.on('SIGTERM',()=>{});process.stdin.resume();process.stdin.on('end',()=>{
 fs.writeFileSync(process.env.TEST_MARKER,String(process.pid));setTimeout(()=>process.exit(0),6000);
});`,{mode:0o755});
  // Shorten only the server's Codex deadline; leave process cleanup timing intact.
  fs.writeFileSync(preload,`if(process.argv[1]&&process.argv[1].endsWith('/server.js')){const original=global.setTimeout;global.setTimeout=(fn,ms,...args)=>original(fn,ms===120000?1200:ms,...args)}\n`);
  const socket=http.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
  const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  const base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{
    ...process.env,NODE_OPTIONS:`${process.env.NODE_OPTIONS||''} --require=${JSON.stringify(preload)}`,
    YOURTUBE_PORT:String(port),YOURTUBE_SESSIONS_DIR:sessions,YOURTUBE_FEED:path.join(dir,'feed.json'),
    YOURTUBE_CODEX:fake,YOURTUBE_DEBOUNCE_MS:'30',TEST_MARKER:marker,
  },stdio:'ignore'});
  let pid;
  t.after(async()=>{
    if(child.exitCode===null&&child.signalCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await done}
    fs.rmSync(dir,{recursive:true,force:true});
  });
  await waitFor(async()=>{try{return (await fetch(base+'/feed.json')).ok}catch{return false}},'server failed to start');
  assert.equal((await fetch(base+'/api/live',{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify(await fencedBody(base,{enabled:true}))})).status,200);
  fs.appendFileSync(session,userEvent('A synthetic topic for the fake Codex timeout check.'));
  await waitFor(()=>fs.existsSync(marker),'fake Codex did not start');
  pid=Number(fs.readFileSync(marker,'utf8'));assert.ok(alive(pid));
  await waitFor(()=>!alive(pid),'timeout left the fake Codex process running',4500);
  assert.equal((await fetch(base+'/feed.json')).status,200,'server must remain responsive after timing out');
});

test('a timed-out Codex response is rejected even if the child exits successfully', {timeout:12000}, async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yourtube-expired-output-'));
  const sessions=path.join(dir,'sessions');fs.mkdirSync(sessions);
  const session=path.join(sessions,'synthetic.jsonl');
  fs.writeFileSync(session,JSON.stringify({type:'session_meta',payload:{originator:'Codex Desktop',source:'vscode',thread_source:'user'}})+'\n');
  const fake=path.join(dir,'fake-codex'),marker=path.join(dir,'calls'),preload=path.join(dir,'test-timeout.js');
  fs.writeFileSync(fake,`#!/usr/bin/env node
const fs=require('node:fs');const out=process.argv[process.argv.indexOf('-o')+1];
process.on('SIGTERM',()=>{fs.writeFileSync(out,JSON.stringify({relevant:true,project:'Synthetic',task:'Synthetic task',context_id:'',public_search:'synthetic topic'}));process.exit(0)});
process.stdin.resume();process.stdin.on('end',()=>{fs.appendFileSync(process.env.TEST_MARKER,'called\\n');setTimeout(()=>process.exit(1),6000)});`,{mode:0o755});
  fs.writeFileSync(preload,`if(process.argv[1]&&process.argv[1].endsWith('/server.js')){const original=global.setTimeout;global.setTimeout=(fn,ms,...args)=>original(fn,ms===120000?1200:ms,...args)}\n`);
  const socket=http.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
  const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  const base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{
    ...process.env,NODE_OPTIONS:`${process.env.NODE_OPTIONS||''} --require=${JSON.stringify(preload)}`,
    YOURTUBE_PORT:String(port),YOURTUBE_SESSIONS_DIR:sessions,YOURTUBE_FEED:path.join(dir,'feed.json'),
    YOURTUBE_CODEX:fake,YOURTUBE_DEBOUNCE_MS:'30',TEST_MARKER:marker,
  },stdio:'ignore'});
  t.after(async()=>{
    if(child.exitCode===null&&child.signalCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await done}
    fs.rmSync(dir,{recursive:true,force:true});
  });
  async function status(){return new Promise((resolve,reject)=>{const req=http.get(base+'/events',res=>{let body='';res.on('data',part=>{body+=part;const m=body.match(/event: status\ndata: ([^\n]+)\n\n/);if(m){res.destroy();resolve(JSON.parse(m[1]))}});res.on('error',reject)});req.on('error',reject);req.setTimeout(3000,()=>req.destroy(Error('status timeout')))})}
  await waitFor(async()=>{try{return (await fetch(base+'/feed.json')).ok}catch{return false}},'server failed to start');
  assert.equal((await fetch(base+'/api/live',{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify(await fencedBody(base,{enabled:true}))})).status,200);
  fs.appendFileSync(session,userEvent('A synthetic topic for the expired output check.'));
  await waitFor(()=>fs.existsSync(marker),'fake Codex did not start');
  await waitFor(async()=>{const current=await status();return current.mode==='error'&&/timed out/i.test(current.message)},'timed-out response was not rejected');
  assert.equal(fs.readFileSync(marker,'utf8').trim().split('\n').length,1,'timed-out output must not trigger a search');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'feed.json'),'utf8')).videos,[],'timed-out output must not update the feed');
});
