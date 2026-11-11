'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {spawn}=require('node:child_process');
const {setTimeout:delay}=require('node:timers/promises');

async function waitFor(check,message){const until=Date.now()+8000;while(Date.now()<until){const result=await check();if(result)return result;await delay(25)}throw Error(message)}

test('copy to Live updates only an existing project and rejects stale, absent or busy writes',{timeout:18000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yourtube-context-sync-'));const sessions=path.join(dir,'sessions');fs.mkdirSync(sessions);
 const session=path.join(sessions,'synthetic.jsonl');fs.writeFileSync(session,JSON.stringify({type:'session_meta',payload:{originator:'Codex Desktop',source:'vscode',thread_source:'user'}})+'\n');
 const feed=path.join(dir,'feed.json'),marker=path.join(dir,'invoked');const original={contexts:[{id:'a',name:'Stored A',task:'First task',note:'Keep this note'},{id:'b',name:'Stored B',task:'Other task'}],videos:[{id:'testVideo01',context:'b',title:'Video',channel:'Channel',reason:'Reason',source:'Synthetic'}],focusContext:'b',contextSource:'Synthetic',updatedAt:'2026-01-01T00:00:00Z'};fs.writeFileSync(feed,JSON.stringify(original));
 const fake=path.join(dir,'fake-codex');fs.writeFileSync(fake,`#!/usr/bin/env node\nrequire('node:fs').writeFileSync(process.env.TEST_MARKER,'started');process.stdin.resume();setInterval(()=>{},1000);\n`,{mode:0o755});
 const socket=http.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));const base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,YOURTUBE_PORT:String(port),YOURTUBE_SESSIONS_DIR:sessions,YOURTUBE_FEED:feed,YOURTUBE_CODEX:fake,YOURTUBE_DEBOUNCE_MS:'30',TEST_MARKER:marker},stdio:'ignore'});
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await done}fs.rmSync(dir,{recursive:true,force:true})});
 const post=(endpoint,body,origin=base)=>fetch(base+endpoint,{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(body)});
 await waitFor(async()=>{try{return (await fetch(base+'/feed.json')).ok}catch{return false}},'server failed to start');
 const request={id:'a',name:'New A',task:'Changed task',expected:original.contexts[0]};assert.equal((await post('/api/context/sync',request,'https://untrusted.example')).status,403);assert.equal((await post('/api/context/sync',{...request,name:' '})).status,400);assert.equal((await post('/api/context/sync',request)).status,200);
 let updated=JSON.parse(fs.readFileSync(feed,'utf8'));assert.deepEqual(updated.contexts[0],{id:'a',name:'New A',task:'Changed task',note:'Keep this note'});assert.deepEqual(updated.contexts[1],original.contexts[1]);assert.deepEqual(updated.videos,original.videos);assert.equal(fs.existsSync(marker),false,'copying must not run Codex');
 assert.equal((await post('/api/context/sync',request)).status,409,'stale stored project must not be overwritten');assert.equal((await post('/api/context/delete',{id:'new-project'})).status,200,'deleting an absent project is idempotent');assert.equal((await post('/api/context/sync',{id:'new-project',name:'Local project',task:'Local task',expected:null})).status,400,'a delayed creation cannot resurrect a deleted browser-only project');updated=JSON.parse(fs.readFileSync(feed,'utf8'));assert.equal(updated.contexts.some(c=>c.id==='new-project'),false);assert.equal((await post('/api/context/sync',{id:'gone',name:'Local',task:'Task',expected:{id:'gone',name:'Old',task:'Old'}})).status,409,'a project deleted on the server cannot be recreated by a delayed update');
 assert.equal((await post('/api/live',{enabled:true})).status,200);fs.appendFileSync(session,JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'Synthetic topic to keep the classifier busy.'}]}})+'\n');await waitFor(()=>fs.existsSync(marker),'fake classifier did not start');
 const before=fs.readFileSync(feed,'utf8');assert.equal((await post('/api/context/sync',{id:'b',name:'Would overwrite',task:'Draft',expected:original.contexts[1]})).status,409,'a running update must not be canceled or overwritten');assert.equal(fs.readFileSync(feed,'utf8'),before);
});

const vm=require('node:vm');
const {setImmediate:tick}=require('node:timers/promises');
async function setupBrowser({lostResponse=false,browserOnly=false,serverConflict=false}={}){
 const elements=new Map();function el(id){if(!elements.has(id))elements.set(id,{id,disabled:false,value:'',textContent:'',innerHTML:'',open:false,dataset:{},classList:{add(){},remove(){},toggle(){}},listeners:{},addEventListener(k,f){this.listeners[k]=f},showModal(){this.open=true},close(){this.open=false;this.listeners.close?.()},replaceChildren(){},reset(){}});return elements.get(id)}
 let raw=JSON.stringify(browserOnly?{customContexts:[{id:'local',name:'My project',task:'My task',note:'Private note'}]}:{contextEdits:{local:{id:'local',name:'My project',task:'My task',note:'Private note'}}}),feed={contexts:browserOnly?[]:[{id:'local',name:'Stored project',task:'Stored task',note:'Server note'}],videos:[],focusContext:'local',contextSource:'Synthetic'},allowed=false,requests=[],confirmMessage='';
 let events,lockWait=null;class FakeEvents{constructor(){this.listeners={};events=this}addEventListener(k,f){this.listeners[k]=f}close(){}}
 const context={window:{},document:{getElementById:el,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>el('new')},localStorage:{getItem:()=>raw,setItem:(_k,v)=>{raw=v}},navigator:{locks:{request:async(_key,_opts,fn)=>{if(lockWait)await lockWait;return fn({})}}},EventSource:FakeEvents,fetch:async(url,options={})=>{if(url==='/api/context/sync'){const data=JSON.parse(options.body);requests.push(data);if(serverConflict)return {ok:false,status:409};feed={...feed,contexts:[{...feed.contexts[0],id:data.id,name:data.name,task:data.task}]};if(lostResponse)throw Error('response lost');return {ok:true,status:200}}if(url==='feed.json')return {ok:true,json:async()=>feed};throw Error('Unexpected request '+url)},setTimeout,clearTimeout,AbortController,URL,console,crypto:{randomUUID:()=> 'new-id'},confirm:message=>{confirmMessage=message;return allowed}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','dist','app.js'),'utf8'),context);await tick();
 return {el,allow:()=>allowed=true,requests:()=>requests,stored:()=>raw,externalWrite:()=>{raw=JSON.stringify({customContexts:[{id:'local',name:'Elsewhere',task:'Changed'}]})},confirmMessage:()=>confirmMessage,holdLock:()=>{let release;lockWait=new Promise(resolve=>release=resolve);return ()=>{lockWait=null;release()}},refreshStored:async project=>{feed={...feed,contexts:project?[project]:[]};events.listeners.feed();await tick();await tick()}};
}

test('browser sync requires confirmation and copies only saved fields',async()=>{
 const b=await setupBrowser();b.el('edit-context').listeners.click();assert.equal(b.el('context-id').value,'local');await b.el('context-sync').listeners.click();assert.equal(b.requests().length,0);assert.match(b.confirmMessage(),/may be sent to Codex/i);assert.match(b.confirmMessage(),/does not start Live/i);
 b.allow();b.el('context-name').value='Unsaved edit';await b.el('context-sync').listeners.click();assert.match(b.el('context-error').textContent,/save.*edits/i);assert.equal(b.requests().length,0);
 b.el('context-name').value='My project';const before=b.stored();await b.el('context-sync').listeners.click();assert.deepEqual(b.requests(),[{id:'local',name:'My project',task:'My task',expected:{id:'local',name:'Stored project',task:'Stored task',note:'Server note'}}]);assert.equal(b.stored(),before,'copying must not alter local browser state');assert.equal((b.el('context-nav').innerHTML.match(/data-context="local"/g)||[]).length,1,'the stored project must render once');assert.match(b.el('context-error').textContent,/copied/i);
});

test('browser sync does not accept a refreshed Live project while waiting for the lock',async()=>{
 for(const changed of [{id:'local',name:'Changed by Live',task:'New task',note:'New server note'},null]){
  const b=await setupBrowser();b.allow();b.el('edit-context').listeners.click();const original=b.stored(),release=b.holdLock();const pending=b.el('context-sync').listeners.click();
  await b.refreshStored(changed);assert.equal(b.requests().length,0);release();await pending;
  assert.equal(b.requests().length,0,'a changed or deleted Live project must not be overwritten');assert.equal(b.stored(),original);assert.equal(b.el('context-name').value,'My project','local draft is preserved');assert.match(b.el('context-error').textContent,/(stored|browser) project.*changed|stored project.*no longer available/i);
 }
});

test('browser sync rejects a Live project changed after the dialog opened even if the browser overlay masks it',async()=>{
 const b=await setupBrowser();b.allow();b.el('edit-context').listeners.click();const original=b.stored();
 await b.refreshStored({id:'local',name:'Changed by Live',task:'New task',note:'Server note'});
 await b.el('context-sync').listeners.click();assert.equal(b.requests().length,0);assert.equal(b.stored(),original);assert.equal(b.el('context-name').value,'My project');assert.match(b.el('context-error').textContent,/stored project changed.*reopen/i);
});

test('browser sync reports a server-side stale compare-and-swap without overwriting',async()=>{
 const b=await setupBrowser({serverConflict:true});b.allow();b.el('edit-context').listeners.click();const original=b.stored();await b.el('context-sync').listeners.click();
 assert.equal(b.requests().length,1);assert.deepEqual(b.requests()[0].expected,{id:'local',name:'Stored project',task:'Stored task',note:'Server note'});assert.equal(b.stored(),original);assert.match(b.el('context-error').textContent,/stored project changed/i);assert.equal(b.el('context-dialog').open,true);
});

test('browser sync rejects stale browser data and reports a lost response without claiming failure',async()=>{
 const stale=await setupBrowser();stale.allow();stale.el('edit-context').listeners.click();stale.externalWrite();await stale.el('context-sync').listeners.click();assert.equal(stale.requests().length,0);assert.match(stale.el('context-error').textContent,/changed|reload/i);
 const browserOnly=await setupBrowser({browserOnly:true});browserOnly.allow();browserOnly.el('edit-context').listeners.click();await browserOnly.el('context-sync').listeners.click();assert.equal(browserOnly.requests().length,0);assert.match(browserOnly.el('context-error').textContent,/browser-only.*cannot/i);
 const lost=await setupBrowser({lostResponse:true});lost.allow();lost.el('edit-context').listeners.click();await lost.el('context-sync').listeners.click();assert.equal(lost.requests().length,1);assert.match(lost.el('context-error').textContent,/could not confirm.*refresh.*check/i);assert.equal(lost.el('context-dialog').open,true);
});
