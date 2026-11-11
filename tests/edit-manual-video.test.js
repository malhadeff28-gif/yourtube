'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {setImmediate:tick}=require('node:timers/promises');
const code=fs.readFileSync(path.join(__dirname,'../dist/app.js'),'utf8');
const same='testVideo01',other='testVideo02';
async function setup(){
 const els=new Map(),dialogs=['edit-video-dialog','context-dialog','video-dialog','removed-dialog','manual-search-dialog','player-dialog','info-dialog','live-consent','search-review'];
 const el=id=>{if(!els.has(id))els.set(id,{id,value:'',textContent:'',innerHTML:'',open:false,disabled:false,dataset:{},classList:{add(){},remove(){},toggle(){}},listeners:{},addEventListener(k,f){this.listeners[k]=f},showModal(){this.open=true},close(){this.open=false;this.listeners.close?.()},replaceChildren(){},reset(){},setAttribute(){},removeAttribute(){},querySelectorAll(){return []},contains(){return false}});return els.get(id)};
 const initial={customContexts:[],contextEdits:{},deletedContexts:[],customVideos:[{id:same,context:'a',title:'Original title',channel:'One',reason:'Original note',source:'Added by you',extra:'keep'},{id:same,context:'b',title:'Other project title',channel:'Two',reason:'Other note',source:'Added by you'}],hiddenVideos:[],saved:[same],watched:[same],removedVideos:[]};
 let raw=JSON.stringify(initial),fail=false,lockHeld=false,gate=null;
 const feed={contexts:[{id:'a',name:'Alpha',task:'A'},{id:'b',name:'Beta',task:'B'}],videos:[{id:same,context:'a',title:'Live original',channel:'Live',reason:'Live reason',source:'Live'},{id:other,context:'a',title:'Live only',channel:'Live',reason:'Live reason',source:'Live'}],focusContext:'a',contextSource:'Synthetic'};
 const localStorage={getItem:()=>raw,setItem:(_k,v)=>{if(fail)throw Error('quota');raw=v}};
 const locks={request:async(_key,_options,fn)=>{if(lockHeld)return fn(null);lockHeld=true;try{if(gate)await gate;return await fn({})}finally{lockHeld=false}}};
 class Events{addEventListener(){}close(){}}
 const document={getElementById:el,querySelector:s=>s==='dialog[open]'?dialogs.map(el).find(d=>d.open)||null:null,querySelectorAll:s=>s==='dialog'?dialogs.map(el):[],createElement:()=>el('new')};
 const context={window:{},document,localStorage,navigator:{locks},EventSource:Events,fetch:async()=>({ok:true,json:async()=>feed}),setTimeout,clearTimeout,AbortController,URL,console,crypto:{randomUUID:()=> 'new'},confirm:()=>true};
 vm.runInNewContext(code,context);await tick();
 const edit=(id=same,project='a')=>el('grid').listeners.click({target:{closest:s=>s==='[data-edit-video]'?{dataset:{editVideo:id,editContext:project}}:null}});
 const submit=()=>el('edit-video-form').listeners.submit({preventDefault(){}});
 return {el,feed,edit,submit,state:()=>JSON.parse(raw),fail:v=>{fail=v},stale:()=>{raw=JSON.stringify({...JSON.parse(raw),saved:[]})},hold:()=>{let release;gate=new Promise(r=>{release=r});return()=>{gate=null;release()}}};
}

test('edits only the browser-owned video in its project and preserves saved, watched and Live data',async()=>{
 const a=await setup();assert.match(a.el('grid').innerHTML,/data-edit-video="testVideo01" data-edit-context="a"/);assert.doesNotMatch(a.el('grid').innerHTML,/data-edit-video="testVideo02"/);
 await a.edit();assert.equal(a.el('edit-video-dialog').open,true);assert.equal(a.el('edit-video-project').textContent,'Project: Alpha');
 a.el('edit-video-name').value='Updated title';a.el('edit-video-channel').value='Updated channel';a.el('edit-video-reason').value='Updated reason';await a.submit();
 const state=a.state();assert.equal(a.el('edit-video-dialog').open,false);assert.deepEqual(state.saved,[same]);assert.deepEqual(state.watched,[same]);assert.deepEqual(state.hiddenVideos,[]);
 assert.deepEqual(state.customVideos[0],{id:same,context:'a',title:'Updated title',channel:'Updated channel',reason:'Updated reason',source:'Added by you',extra:'keep'});assert.equal(state.customVideos[1].title,'Other project title');assert.equal(a.feed.videos[0].title,'Live original');assert.match(a.el('grid').innerHTML,/Updated title/);
});

test('failed and stale writes keep the edit draft open without modifying saved data',async()=>{
 for(const mode of ['failure','stale']){const a=await setup();await a.edit();a.el('edit-video-name').value='Unsaved draft';if(mode==='failure')a.fail(true);else a.stale();const before=a.state();await a.submit();assert.equal(a.el('edit-video-dialog').open,true);assert.equal(a.el('edit-video-name').value,'Unsaved draft');assert.match(a.el('edit-video-error').textContent,/could not save|changed|cannot be safely accessed/i);assert.deepEqual(a.state(),before)}
});

test('editing unavailable, hidden or deleting projects cannot create or resurrect a video',async()=>{
 const a=await setup();await a.edit(other,'a');assert.equal(a.el('edit-video-dialog').open,false,'Live-only metadata cannot be edited');
 await a.edit(same,'missing');assert.equal(a.el('edit-video-dialog').open,false);
 await a.edit();a.el('edit-video-name').value='Draft';a.el('context-id').value='a';const release=a.hold();const pending=a.el('delete-context').listeners.click();await tick();await a.submit();assert.equal(a.el('edit-video-dialog').open,true);assert.equal(a.el('edit-video-name').value,'Draft');assert.match(a.el('edit-video-error').textContent,/another.*saving|deletion/i);release();await pending;
});

test('an old edit response does not close or replace a newer dialog draft',async()=>{
 const a=await setup();await a.edit();a.el('edit-video-name').value='First draft';const release=a.hold(),pending=a.submit();await tick();a.el('edit-video-dialog').close();await a.edit(same,'b');a.el('edit-video-name').value='Newer draft';release();await pending;assert.equal(a.el('edit-video-dialog').open,true);assert.equal(a.el('edit-video-name').value,'Newer draft');
});
