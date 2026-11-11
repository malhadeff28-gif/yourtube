'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {spawn}=require('node:child_process');
const {setTimeout:delay}=require('node:timers/promises');

async function waitFor(check,message){const end=Date.now()+9000;while(Date.now()<end){const value=await check();if(value)return value;await delay(30)}throw Error(message)}
function readStatus(base){return new Promise((resolve,reject)=>{const req=http.get(base+'/events',res=>{let data='';res.on('data',chunk=>{data+=chunk;const match=data.match(/event: status\ndata: ([^\n]+)\n\n/);if(match){res.destroy();resolve(JSON.parse(match[1]))}});res.on('error',reject)});req.on('error',reject);req.setTimeout(3000,()=>req.destroy(Error('status timeout')))})}

test('reviewed project assignment controls the update and rejects stale targets',{timeout:25000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yourtube-project-review-')),sessions=path.join(dir,'sessions');fs.mkdirSync(sessions);
 const session=path.join(sessions,'synthetic.jsonl');fs.writeFileSync(session,JSON.stringify({type:'session_meta',payload:{originator:'Codex Desktop',source:'vscode',thread_source:'user'}})+'\n');
 const feed=path.join(dir,'feed.json');fs.writeFileSync(feed,JSON.stringify({contexts:[{id:'a',name:'Alpha',task:'First task'},{id:'b',name:'Beta',task:'Second task',note:'Keep this note',extra:'Preserve this field'}],videos:[],focusContext:'a',contextSource:'Synthetic',updatedAt:'2026-01-01T00:00:00Z'}));
 const fake=path.join(dir,'fake-codex');fs.writeFileSync(fake,`#!/usr/bin/env node
const fs=require('node:fs');process.stdin.resume();process.stdin.on('end',()=>{const out=process.argv[process.argv.indexOf('-o')+1];fs.writeFileSync(out,JSON.stringify(process.argv.includes('--search')?{videos:[{id:'testVideo01',reason:'Synthetic'}]}:{relevant:true,context_id:'a',project:'Proposed name',task:'Proposed task',public_search:'synthetic topic'}))});\n`,{mode:0o755});
 fs.writeFileSync(path.join(dir,'curl'),`#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({title:'Synthetic title',author_name:'Synthetic channel'}));\n`,{mode:0o755});
 const socket=http.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));const base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PATH:`${dir}${path.delimiter}${process.env.PATH}`,YOURTUBE_PORT:String(port),YOURTUBE_SESSIONS_DIR:sessions,YOURTUBE_FEED:feed,YOURTUBE_CODEX:fake,YOURTUBE_DEBOUNCE_MS:'30'},stdio:'ignore'});
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await done}fs.rmSync(dir,{recursive:true,force:true})});
 const post=(endpoint,body)=>fetch(base+endpoint,{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify(body)});
 await waitFor(async()=>{try{return (await fetch(base+'/feed.json')).ok}catch{return false}},'server failed to start');assert.equal((await post('/api/live',{enabled:true})).status,200);
 const append=text=>fs.appendFileSync(session,JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}})+'\n');
 const pending=async previous=>waitFor(async()=>{const s=await readStatus(base);if(s.mode==='error')throw Error(s.message);return s.mode==='awaiting-review'&&s.requestId!==previous&&s},'review not reached');
 append('A synthetic topic to classify for project selection.');let review=await pending();assert.equal(review.pendingProject.id,'a');assert.deepEqual(review.projectOptions.map(x=>x.id),['a','b']);
 const snapshot=JSON.parse(fs.readFileSync(feed,'utf8')).contexts.find(x=>x.id==='a');assert.equal((await post('/api/context/sync',{id:'a',name:'Concurrent edit',task:'Concurrent task',expected:snapshot})).status,409,'copying context must wait until the pending project review finishes');
 const draft={requestId:review.requestId,action:'approve',query:'synthetic topic',projectId:'b',projectName:'Reviewed Beta',projectTask:'Reviewed task'};
 assert.equal((await post('/api/search-review',{...draft,projectId:'unknown'})).status,400,'unoffered project must be rejected');
 assert.equal((await post('/api/search-review',{...draft,projectName:' '})).status,400,'blank project name must be rejected');
 assert.equal((await post('/api/search-review',draft)).status,200);
 await waitFor(()=>JSON.parse(fs.readFileSync(feed,'utf8')).videos.length===1,'approved update did not complete');let result=JSON.parse(fs.readFileSync(feed,'utf8'));
 assert.equal(result.videos[0].context,'b');assert.equal(result.contexts.find(x=>x.id==='a').name,'Alpha');assert.equal(result.contexts.find(x=>x.id==='b').name,'Reviewed Beta');assert.equal(result.contexts.find(x=>x.id==='b').task,'Reviewed task');assert.equal(result.contexts.find(x=>x.id==='b').note,'Keep this note');assert.equal(result.contexts.find(x=>x.id==='b').extra,'Preserve this field');
 append('A second synthetic topic tests cancellation.');review=await pending(review.requestId);const before=fs.readFileSync(feed,'utf8');assert.equal((await post('/api/search-review',{requestId:review.requestId,action:'cancel'})).status,200);await delay(200);assert.equal(fs.readFileSync(feed,'utf8'),before,'cancel must not change feed');
 append('A third synthetic topic tests changed project data.');review=await pending(review.requestId);const changed=JSON.parse(fs.readFileSync(feed,'utf8'));changed.contexts.find(x=>x.id==='a').name='Externally changed';fs.writeFileSync(feed,JSON.stringify(changed));
 const escapedDraft={requestId:review.requestId,action:'approve',query:'synthetic topic',projectId:'a',projectName:'\\'.repeat(90),projectTask:'\\'.repeat(400)};assert.ok(JSON.stringify(escapedDraft).length>1024,'fixture exercises escaped body length');assert.equal((await post('/api/search-review',escapedDraft)).status,200);
 await waitFor(async()=>{const s=await readStatus(base);return s.mode==='error'&&/changed/.test(s.message)},'stale project update was not rejected');result=JSON.parse(fs.readFileSync(feed,'utf8'));assert.equal(result.contexts.find(x=>x.id==='a').name,'Externally changed');
});
