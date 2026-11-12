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

async function waitFor(check,message,timeout=5000){const end=Date.now()+timeout;while(Date.now()<end){const v=await check();if(v)return v;await delay(25)}throw Error(message)}
function alive(pid){try{process.kill(pid,0);return true}catch(err){if(err.code==='ESRCH')return false;throw err}}
function readStatus(base){return new Promise((resolve,reject)=>{const req=http.get(base+'/events',res=>{let s='';res.on('data',part=>{s+=part;const m=s.match(/event: status\ndata: ([^\n]+)\n\n/);if(m){res.destroy();resolve(JSON.parse(m[1]))}});res.on('error',reject)});req.on('error',reject);req.setTimeout(3000,()=>req.destroy(Error('status timeout')))})}

test('pausing stops an in-flight YouTube metadata process', {timeout:15000}, async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yourtube-metadata-stop-'));
  const sessions=path.join(dir,'sessions');fs.mkdirSync(sessions);
  const session=path.join(sessions,'synthetic.jsonl');
  fs.writeFileSync(session,JSON.stringify({type:'session_meta',payload:{originator:'Codex Desktop',source:'vscode',thread_source:'user'}})+'\n');
  const fake=path.join(dir,'fake-codex'),curl=path.join(dir,'curl'),marker=path.join(dir,'curl-pid');
  fs.writeFileSync(fake,`#!/usr/bin/env node
const fs=require('node:fs');process.stdin.resume();process.stdin.on('end',()=>{const out=process.argv[process.argv.indexOf('-o')+1];fs.writeFileSync(out,JSON.stringify(process.argv.includes('--search')?{videos:[{id:'testVideo01',reason:'Synthetic'}]}:{relevant:true,project:'Synthetic',task:'Learn a topic',context_id:'',public_search:'synthetic topic'}))});\n`,{mode:0o755});
  fs.writeFileSync(curl,`#!/usr/bin/env node
const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(process.env.TEST_CURL_MARKER,String(process.pid));setTimeout(()=>process.exit(0),6000);\n`,{mode:0o755});
  const socket=http.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));const base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PATH:`${dir}${path.delimiter}${process.env.PATH}`,YOURTUBE_PORT:String(port),YOURTUBE_SESSIONS_DIR:sessions,YOURTUBE_FEED:path.join(dir,'feed.json'),YOURTUBE_CODEX:fake,YOURTUBE_DEBOUNCE_MS:'30',TEST_CURL_MARKER:marker},stdio:'ignore'});
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await done}fs.rmSync(dir,{recursive:true,force:true})});
  const post=async(endpoint,body)=>fetch(base+endpoint,{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify(await fencedBody(base,body))});
  await waitFor(async()=>{try{return (await fetch(base+'/feed.json')).ok}catch{return false}},'server failed to start');
  assert.equal((await post('/api/live',{enabled:true})).status,200);
  fs.appendFileSync(session,JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'A synthetic topic for the metadata cancellation test.'}]}})+'\n');
  const pending=await waitFor(async()=>{const s=await readStatus(base);return s.mode==='awaiting-review'&&s},'classification did not reach review');
  assert.equal((await post('/api/search-review',{requestId:pending.requestId,action:'approve',query:'synthetic topic',projectId:pending.pendingProject.id,projectName:pending.pendingProject.name,projectTask:pending.pendingProject.task})).status,200);
  await waitFor(()=>fs.existsSync(marker),'fake metadata process did not start');
  const pid=Number(fs.readFileSync(marker,'utf8'));assert.ok(alive(pid));
  assert.equal((await post('/api/live',{enabled:false})).status,200);
  await waitFor(()=>!alive(pid),'pause left the metadata process running',4000);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'feed.json'),'utf8')).videos,[]);
});
