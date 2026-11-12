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







test('unreadable, malformed, and unsupported initial state fail closed',async()=>{
 for(const config of [{initial:null,brokenRead:true},{initial:'{'},{initial:'{"saved":"bad"}'},{initial:null,noLocks:true}]){
  const data=shared(config.initial),a=await tab(data,config),original=data.raw;draft(a,'Do not lose this');await a('context-form').listeners.submit(submit);
  assert.equal(data.raw,original);assert.equal(a('context-dialog').open,true);assert.equal(a('context-name').value,'Do not lose this');assert.match(a('context-error').textContent,/cannot be safely accessed|reload/i);
 }
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
 a('video-dialog').close();a('add-video').listeners.click();a('video-title').value='Second video';assert.equal(a('video-title').disabled,false);assert.equal(a('video-save').disabled,true);release();await saving;
 assert.equal(a('video-dialog').open,true);assert.equal(a('video-title').value,'Second video');assert.equal(a('video-save').disabled,false);assert.deepEqual(JSON.parse(data.raw).customVideos.map(x=>x.title),['First video']);
});






test('delayed card write reports conflicts, failures and removal after an open dialog closes',async()=>{
 for(const mode of ['busy','failure','remove']){
  const data=shared();let release;const gate=new Promise(resolve=>{release=resolve});data.locks.request=async(_key,_opts,callback)=>{await gate;return callback(mode==='busy'?null:{})};
  if(mode==='failure')data.storage.setItem=()=>{throw Error('quota')};
  const a=await tab(data);const attribute=mode==='remove'?'hide':'save';
  const saving=a('grid').listeners.click({target:{closest:selector=>selector===`[data-${attribute}]`?{dataset:{[attribute]:'abc123def45'}}:null}});
  draft(a,'Keep this draft');release();await saving;
  assert.equal(a('context-dialog').open,true);assert.equal(a('context-name').value,'Keep this draft');assert.equal(a('toast').textContent,'','notification must wait until the modal is closed');
  a('context-dialog').close();assert.match(a('toast').textContent,mode==='busy'?/another.*saving/i:mode==='failure'?/could not save/i:/video removed/i);
 }
});

// The previous deletion/retry race tests are inapplicable while deletion is
// disabled. Exercise the replacement containment boundary explicitly.
test('disabled deletion never writes or sends a request, even across tabs',async()=>{
 const raw=JSON.stringify({customContexts:[{id:'local',name:'Local',task:'Work'}],contextEdits:{project:{id:'project',name:'Edited',task:'Work'}},customVideos:[{id:'abc123def45',context:'project',title:'Saved'}],videoNotes:[{id:'abc123def45',context:'project',text:'Private'}]}),data=shared(raw),a=await tab(data),b=await tab(data);
 a('edit-context').listeners.click();assert.equal(a('delete-context').disabled,true);await a('delete-context').listeners.click();assert.match(a('context-error').textContent,/temporarily unavailable/i);assert.equal(data.raw,raw);assert.equal(data.deleteCalls,0);
 b('context-nav').listeners.click({target:{closest:selector=>selector==='[data-context]'?{dataset:{context:'local'}}:null}});b('edit-context').listeners.click();assert.equal(b('context-id').value,'local');assert.equal(b('delete-context').disabled,true);await b('delete-context').listeners.click();assert.equal(data.raw,raw);assert.equal(data.deleteCalls,0);
});
test('legacy pending intents stay blocked, retained and never replayed',async()=>{
 const raw=JSON.stringify({__yourtubePendingDeletion:{id:'project',token:'legacy'},customContexts:[{id:'local',name:'Local',task:'Work'}],videoNotes:[{id:'abc123def45',context:'project',text:'Private'}]}),data=shared(raw);
 for(const config of [{},{noLocks:true}]){const a=await tab(data,config);assert.equal(a('storage-retry-delete').hidden,true);assert.match(a('storage-warning').textContent,/unresolved|cannot be safely/i);await a('storage-retry-delete').listeners.click();assert.equal(data.raw,raw);assert.equal(data.deleteCalls,0);draft(a,'Kept draft');await a('context-form').listeners.submit(submit);assert.equal(a('context-dialog').open,true);assert.equal(a('context-name').value,'Kept draft');assert.equal(data.raw,raw)}
});

test('disabled deletion preserves an ambiguous Live and browser project ID',async()=>{
 const raw=JSON.stringify({customContexts:[{id:'project',name:'Browser project',task:'Private work'}],customVideos:[{id:'abc123def45',context:'project',title:'Local video'}],videoNotes:[{id:'abc123def45',context:'project',text:'Private note'}]}),data=shared(raw),a=await tab(data);
 a('edit-context').listeners.click();assert.equal(a('delete-context').disabled,true);await a('delete-context').listeners.click();assert.match(a('context-error').textContent,/temporarily unavailable/i);assert.equal(data.raw,raw);assert.equal(data.deleteCalls,0);
});
