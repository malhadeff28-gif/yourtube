'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {setImmediate:tick}=require('node:timers/promises');
const script=fs.readFileSync(path.join(__dirname,'..','dist','app.js'),'utf8');
function shared(initial=null){
 let raw=initial,busy=false,deleteCalls=0,releaseDelete,hold=false,writeCalls=0,failAt=0,feedFail=false;
 return {
  get raw(){return raw},set raw(value){raw=value},get deleteCalls(){return deleteCalls},
  storage:{getItem(){return raw},setItem(_key,value){writeCalls++;if(writeCalls===failAt)throw Error('quota');raw=value}},
  locks:{async request(_key,opts,callback){assert.equal(opts.ifAvailable,true);if(busy)return callback(null);busy=true;try{return await callback({name:'yourtube.state.v1'})}finally{busy=false}}},
  failOnSecondWrite(){failAt=writeCalls+2},failRefresh(){feedFail=true},
  holdDelete(){hold=true;return ()=>{hold=false;releaseDelete()}},
  async fetch(url,options={}){if(url==='/api/context/delete'){deleteCalls++;if(hold)await new Promise(resolve=>{releaseDelete=resolve});return {ok:true}}if(feedFail)return {ok:false};return {ok:true,json:async()=>({contexts:[{id:'project',name:'Project',task:'Task'}],videos:[],focusContext:'project',contextSource:'Synthetic'})}}
 };
}
async function tab(sharedData,{brokenRead=false,noLocks=false}={}){
 const elements=new Map(),dialogs=['context-dialog','video-dialog','player-dialog','info-dialog','live-consent','search-review'];
 function el(id){if(!elements.has(id))elements.set(id,{id,value:'',textContent:'',innerHTML:'',open:false,disabled:false,dataset:{},classList:{add(){},remove(){},toggle(){}},listeners:{},addEventListener(k,f){this.listeners[k]=f},showModal(){this.open=true},close(){this.open=false;this.listeners.close?.()},replaceChildren(){},reset(){}});return elements.get(id)}
 class FakeEvents{constructor(){this.listeners={}}addEventListener(k,f){this.listeners[k]=f}close(){}}
 let reads=0;const storage={getItem(key){if(brokenRead&&reads++===0)throw Error('unavailable');return sharedData.storage.getItem(key)},setItem:(...x)=>sharedData.storage.setItem(...x)};
 let uuid=0;const context={window:{},document:{getElementById:el,querySelector:s=>s==='dialog[open]'?dialogs.map(el).find(d=>d.open)||null:null,querySelectorAll:s=>s==='dialog'?dialogs.map(el):[],createElement:()=>el('created')},localStorage:storage,navigator:noLocks?{}:{locks:sharedData.locks},EventSource:FakeEvents,fetch:sharedData.fetch,setTimeout:()=>1,clearTimeout(){},AbortController,URL,console,crypto:{randomUUID:()=>`id-${++uuid}`},confirm:()=>true};
 vm.runInNewContext(script,context);await tick();return el;
}
const submit={preventDefault(){}};
function draft(el,name){el('add-context').listeners.click();el('context-name').value=name;el('context-task').value='Synthetic work'}

test('stale tab cannot overwrite saved edits and retains its draft',async()=>{
 const data=shared();const a=await tab(data),b=await tab(data);draft(a,'A project');draft(b,'B project');
 await a('context-form').listeners.submit(submit);await b('context-form').listeners.submit(submit);
 assert.deepEqual(JSON.parse(data.raw).customContexts.map(x=>x.name),['A project']);
 assert.equal(b('context-dialog').open,true);assert.equal(b('context-name').value,'B project');assert.match(b('context-error').textContent,/changed|reload/i);
});

test('simultaneous edits serialize and busy tab cannot overwrite',async()=>{
 const data=shared();const a=await tab(data),b=await tab(data);draft(a,'A project');draft(b,'B project');
 await Promise.all([a('context-form').listeners.submit(submit),b('context-form').listeners.submit(submit)]);
 assert.deepEqual(JSON.parse(data.raw).customContexts.map(x=>x.name),['A project']);assert.equal(b('context-dialog').open,true);assert.match(b('context-error').textContent,/saving|changed|reload/i);
});

test('stale deletion is rejected before the server request',async()=>{
 const data=shared();const a=await tab(data),b=await tab(data);draft(a,'A project');await a('context-form').listeners.submit(submit);
 b('edit-context').listeners.click();await b('delete-context').listeners.click();
 assert.equal(data.deleteCalls,0);assert.equal(b('context-dialog').open,true);assert.match(b('context-error').textContent,/changed|reload/i);
});

test('deletion holds the lock and publishes a version marker before its server request',async()=>{
 const data=shared();const a=await tab(data),b=await tab(data),release=data.holdDelete();a('edit-context').listeners.click();
 const deletion=a('delete-context').listeners.click();assert.equal(data.deleteCalls,1);assert.ok(JSON.parse(data.raw).__yourtubePendingDeletion);
 draft(b,'B project');await b('context-form').listeners.submit(submit);assert.equal(b('context-dialog').open,true);assert.match(b('context-error').textContent,/saving/i);
 release();await deletion;await b('context-form').listeners.submit(submit);assert.equal(b('context-dialog').open,true);assert.match(b('context-error').textContent,/changed|reload/i);
});

test('deletion intent failure sends no server request',async()=>{
 const data=shared();data.storage.setItem=()=>{throw Error('quota')};const a=await tab(data);a('edit-context').listeners.click();await a('delete-context').listeners.click();
 assert.equal(data.deleteCalls,0);assert.match(a('context-error').textContent,/no delete request was sent/i);
});

test('unreadable, malformed, and unsupported initial state fail closed',async()=>{
 for(const config of [{initial:null,brokenRead:true},{initial:'{'},{initial:'{"saved":"bad"}'},{initial:null,noLocks:true}]){
  const data=shared(config.initial),a=await tab(data,config),original=data.raw;draft(a,'Do not lose this');await a('context-form').listeners.submit(submit);
  assert.equal(data.raw,original);assert.equal(a('context-dialog').open,true);assert.equal(a('context-name').value,'Do not lose this');assert.match(a('context-error').textContent,/cannot be safely accessed|reload/i);
 }
});

test('external changes during a pending server deletion are not overwritten',async()=>{
 const data=shared();const a=await tab(data),release=data.holdDelete();a('edit-context').listeners.click();const deletion=a('delete-context').listeners.click();
 const external=JSON.stringify({customContexts:[{id:'other',name:'External change',task:'Work'}]});data.raw=external;release();await deletion;
 assert.equal(data.raw,external);assert.match(a('toast').textContent,/browser.*could not be saved/i);
});

test('failed post-delete cleanup blocks stale tabs with prewritten version marker',async()=>{
 const data=shared();const a=await tab(data),b=await tab(data);data.failOnSecondWrite();a('edit-context').listeners.click();await a('delete-context').listeners.click();
 assert.equal(data.deleteCalls,1);assert.ok(JSON.parse(data.raw).__yourtubePendingDeletion);assert.match(a('toast').textContent,/browser.*could not be saved/i);
 draft(b,'B project');await b('context-form').listeners.submit(submit);assert.equal(b('context-dialog').open,true);assert.match(b('context-error').textContent,/changed|reload/i);
});

test('a tab opened during deletion is read-only until it reloads after resolution',async()=>{
 const data=shared();const a=await tab(data),release=data.holdDelete();a('edit-context').listeners.click();const deletion=a('delete-context').listeners.click();
 const b=await tab(data);draft(b,'Draft from new tab');await b('context-form').listeners.submit(submit);
 assert.equal(b('context-dialog').open,true);assert.match(b('context-error').textContent,/deletion is unresolved/i);assert.ok(JSON.parse(data.raw).__yourtubePendingDeletion);
 release();await deletion;assert.equal(JSON.parse(data.raw).__yourtubePendingDeletion,undefined);
 await b('context-form').listeners.submit(submit);assert.equal(b('context-dialog').open,true);assert.equal(b('context-name').value,'Draft from new tab');
 const c=await tab(data);draft(c,'Safe project');await c('context-form').listeners.submit(submit);assert.deepEqual(JSON.parse(data.raw).customContexts.map(x=>x.name),['Safe project']);
});

test('a durable pending marker survives reload and requires an explicit successful retry',async()=>{
 const data=shared();const a=await tab(data);data.failOnSecondWrite();a('edit-context').listeners.click();await a('delete-context').listeners.click();
 assert.ok(JSON.parse(data.raw).__yourtubePendingDeletion);assert.equal(data.deleteCalls,1);
 const b=await tab(data);assert.equal(b('storage-retry-delete').hidden,false);assert.match(b('storage-warning').textContent,/not fully resolved/i);
 draft(b,'Keep this draft');await b('context-form').listeners.submit(submit);assert.equal(b('context-dialog').open,true);assert.match(b('context-error').textContent,/deletion is unresolved/i);assert.equal(data.deleteCalls,1);
 b('context-dialog').close();await b('storage-retry-delete').listeners.click();assert.equal(data.deleteCalls,2);assert.equal(JSON.parse(data.raw).__yourtubePendingDeletion,undefined);assert.ok(JSON.parse(data.raw).deletedContexts.includes('project'));
 draft(b,'Restored work');await b('context-form').listeners.submit(submit);assert.deepEqual(JSON.parse(data.raw).customContexts.map(x=>x.name),['Restored work']);
});

test('a stale recovery request does not contact the server',async()=>{
 const marker=JSON.stringify({__yourtubePendingDeletion:{id:'project',token:'test-token'}}),data=shared(marker);const a=await tab(data),b=await tab(data);
 await a('storage-retry-delete').listeners.click();assert.equal(data.deleteCalls,1);await b('storage-retry-delete').listeners.click();assert.equal(data.deleteCalls,1);assert.match(b('storage-warning').textContent,/changed|reload/i);
});

test('a delayed context save does not close or replace a newer draft',async()=>{
 const data=shared();let release;const gate=new Promise(resolve=>{release=resolve});data.locks.request=async(_key,_opts,callback)=>{await gate;return callback({})};
 const a=await tab(data);draft(a,'First draft');const saving=a('context-form').listeners.submit(submit);assert.equal(a('context-name').disabled,true);
 a('context-dialog').close();draft(a,'Second draft');assert.equal(a('context-name').disabled,false);release();await saving;
 assert.equal(a('context-dialog').open,true);assert.equal(a('context-name').value,'Second draft');assert.deepEqual(JSON.parse(data.raw).customContexts.map(x=>x.name),['First draft']);
});

test('a delayed video save does not close or replace a newer video draft',async()=>{
 const data=shared();let release;const gate=new Promise(resolve=>{release=resolve});data.locks.request=async(_key,_opts,callback)=>{await gate;return callback({})};
 const a=await tab(data);a('add-video').listeners.click();a('video-url').value='https://youtu.be/abc123def45';a('video-title').value='First video';a('video-context').value='project';const saving=a('video-form').listeners.submit(submit);assert.equal(a('video-title').disabled,true);
 a('video-dialog').close();a('add-video').listeners.click();a('video-title').value='Second video';assert.equal(a('video-title').disabled,false);release();await saving;
 assert.equal(a('video-dialog').open,true);assert.equal(a('video-title').value,'Second video');assert.deepEqual(JSON.parse(data.raw).customVideos.map(x=>x.title),['First video']);
});


test('successful deletion recovery reports a failed feed refresh',async()=>{
 const marker=JSON.stringify({__yourtubePendingDeletion:{id:'project',token:'test-token'}}),data=shared(marker);const a=await tab(data);data.failRefresh();
 await a('storage-retry-delete').listeners.click();assert.equal(data.deleteCalls,1);assert.equal(JSON.parse(data.raw).__yourtubePendingDeletion,undefined);
 assert.match(a('toast').textContent,/deletion resolved.*feed could not be refreshed/i);
});
