'use strict';
const { fencedBody } = require('./support/live-control');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {spawn,spawnSync}=require('node:child_process');
const {setTimeout:delay}=require('node:timers/promises');

async function waitFor(check,message){const until=Date.now()+8000;while(Date.now()<until){const value=await check();if(value)return value;await delay(30)}throw Error(message)}
function status(base){return new Promise((resolve,reject)=>{const req=http.get(base+'/events',res=>{let text='';res.on('data',chunk=>{text+=chunk;const m=text.match(/event: status\ndata: ([^\n]+)\n\n/);if(m){res.destroy();resolve(JSON.parse(m[1]))}});res.on('error',reject)});req.on('error',reject);req.setTimeout(3000,()=>req.destroy(Error('status timeout')))})}

test('Live updates retain a video in other projects and replace its current-project association', {timeout:20000}, async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yourtube-project-video-'));
  const sessions=path.join(dir,'sessions');fs.mkdirSync(sessions);
  const session=path.join(sessions,'synthetic.jsonl');
  fs.writeFileSync(session,JSON.stringify({type:'session_meta',payload:{originator:'Codex Desktop',source:'vscode',thread_source:'user'}})+'\n');
  const feed=path.join(dir,'feed.json');
  const old={id:'testVideo01',title:'Earlier title',channel:'Example',reason:'Earlier association',source:'Synthetic'};
  fs.writeFileSync(feed,JSON.stringify({contexts:[{id:'a',name:'Project A',task:'Study A'},{id:'b',name:'Project B',task:'Study B'}],videos:[{...old,context:'a'}],focusContext:'a',contextSource:'Synthetic',updatedAt:'2026-01-01T00:00:00Z'}));
  const fake=path.join(dir,'fake-codex');
  fs.writeFileSync(fake,`#!/usr/bin/env node
const fs=require('node:fs');process.stdin.resume();process.stdin.on('end',()=>{const out=process.argv[process.argv.indexOf('-o')+1],search=process.argv.includes('--search');let reason='New association';if(search){if(fs.existsSync(process.env.TEST_SEARCH_MARKER))reason='Refreshed association';else fs.writeFileSync(process.env.TEST_SEARCH_MARKER,'called')}fs.writeFileSync(out,JSON.stringify(search?{videos:[{id:'testVideo01',reason},{id:'testVideo01',reason:'Duplicate result'}]}:{relevant:true,project:'Project B',task:'Study B',context_id:'b',public_search:'synthetic topic'}))});\n`,{mode:0o755});
  fs.writeFileSync(path.join(dir,'curl'),`#!/usr/bin/env node
process.stdout.write(JSON.stringify({title:'New title',author_name:'Example'}));\n`,{mode:0o755});
  const socket=http.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));const base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PATH:`${dir}${path.delimiter}${process.env.PATH}`,YOURTUBE_PORT:String(port),YOURTUBE_SESSIONS_DIR:sessions,YOURTUBE_FEED:feed,YOURTUBE_CODEX:fake,YOURTUBE_DEBOUNCE_MS:'30',TEST_SEARCH_MARKER:path.join(dir,'search-called')},stdio:'ignore'});
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await done}fs.rmSync(dir,{recursive:true,force:true})});
  const post=async(endpoint,body)=>fetch(base+endpoint,{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify(await fencedBody(base,body))});
  await waitFor(async()=>{try{return (await fetch(base+'/feed.json')).ok}catch{return false}},'server failed to start');
  assert.equal((await post('/api/live',{enabled:true})).status,200);
  fs.appendFileSync(session,JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'A synthetic topic for the project association test.'}]}})+'\n');
  const pending=await waitFor(async()=>{const s=await status(base);if(s.mode==='error')throw Error(s.message);return s.mode==='awaiting-review'&&s},'classification did not reach review');
  assert.equal((await post('/api/search-review',{requestId:pending.requestId,action:'approve',query:pending.pendingQuery,projectId:pending.pendingProject.id,projectName:pending.pendingProject.name,projectTask:pending.pendingProject.task})).status,200);
  await waitFor(async()=>{const s=await status(base);if(s.mode==='error')throw Error(s.message);return s.lastUpdate},'feed was not updated');
  let updated=JSON.parse(fs.readFileSync(feed,'utf8'));
  assert.deepEqual(updated.videos.map(v=>[v.id,v.context,v.reason]),[['testVideo01','b','New association'],['testVideo01','a','Earlier association']]);
  fs.appendFileSync(session,JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'Another synthetic message updating the same project.'}]}})+'\n');
  const again=await waitFor(async()=>{const s=await status(base);if(s.mode==='error')throw Error(s.message);return s.mode==='awaiting-review'&&s.requestId!==pending.requestId&&s},'second classification did not reach review');
  assert.equal((await post('/api/search-review',{requestId:again.requestId,action:'approve',query:again.pendingQuery,projectId:again.pendingProject.id,projectName:again.pendingProject.name,projectTask:again.pendingProject.task})).status,200);
  await waitFor(()=>JSON.parse(fs.readFileSync(feed,'utf8')).videos.some(v=>v.reason==='Refreshed association'),'same-project update did not finish');
  updated=JSON.parse(fs.readFileSync(feed,'utf8'));
  assert.deepEqual(updated.videos.map(v=>[v.id,v.context,v.reason]),[['testVideo01','b','Refreshed association'],['testVideo01','a','Earlier association']]);
  assert.equal((await post('/api/context/delete',{id:'b'})).status,503);
  assert.deepEqual(JSON.parse(fs.readFileSync(feed,'utf8')).videos.map(v=>[v.id,v.context]),[['testVideo01','b'],['testVideo01','a']]);
  const duplicate=path.join(dir,'duplicate.json');
  updated.videos.push({...updated.videos[0]});fs.writeFileSync(duplicate,JSON.stringify(updated));
  assert.notEqual(spawnSync('python3',[path.resolve(__dirname,'../scripts/validate_feed.py'),duplicate]).status,0,'validator must reject duplicate associations within a project');
});
