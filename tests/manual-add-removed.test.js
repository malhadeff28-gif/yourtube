'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {setImmediate:tick}=require('node:timers/promises');

const id='abc123def45';
const video=project=>({id,context:project,title:'Shared video',channel:'Example',reason:'Synthetic',source:'Synthetic'});
const feed=(videos=[video('a'),video('b')])=>({contexts:[{id:'a',name:'A',task:'Task A'},{id:'b',name:'B',task:'Task B'},{id:'c',name:'C',task:'Task C'}],videos,focusContext:'a',contextSource:'Synthetic'});
async function setup(store,data=feed()){
 const elements=new Map();
 const el=id=>{if(!elements.has(id))elements.set(id,{id,disabled:false,value:'',textContent:'',innerHTML:'',open:false,dataset:{},classList:{add(){},remove(){},toggle(){}},listeners:{},addEventListener(k,f){this.listeners[k]=f},showModal(){this.open=true},close(){this.open=false;this.listeners.close?.()},replaceChildren(){},reset(){}});return elements.get(id)};
 const dialogs=['removed-dialog','context-dialog','video-dialog','player-dialog','info-dialog','live-consent','search-review'];
 class FakeEvents{addEventListener(){}close(){}}
 let confirms=0;
 const context={window:{},document:{getElementById:el,querySelector:s=>s==='dialog[open]'?dialogs.map(el).find(d=>d.open)||null:null,querySelectorAll:s=>s==='dialog'?dialogs.map(el):[],createElement:()=>el('created')},localStorage:{getItem:()=>store.raw,setItem:(_k,v)=>{if(store.fail)throw Error('quota');store.raw=v}},navigator:{locks:{request:async(_k,_o,fn)=>fn({})}},EventSource:FakeEvents,fetch:async()=>({ok:true,json:async()=>data}),setTimeout,clearTimeout,AbortController,URL,console,crypto:{randomUUID:()=> 'test'},confirm:()=>{confirms++;return false}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','dist','app.js'),'utf8'),context);await tick();
 function open(project){el('add-video').listeners.click();el('video-context').value=project;el('video-url').value='https://www.youtube.com/watch?v='+id;el('video-title').value='My draft';el('video-channel').value='My channel';el('video-reason').value='My reason'}
 return {el,open,submit:()=>el('video-form').listeners.submit({preventDefault(){}}),confirms:()=>confirms};
}

test('manual add cannot undo a feed-wide removal or lose watch-later history',async()=>{
 for(const saved of [false,true])for(const project of ['a','c']){
  const store={raw:JSON.stringify({hiddenVideos:[id],saved:[],removedVideos:[{id,saved}],projectHiddenVideos:[{id,context:'a'}]})};
  const app=await setup(store),before=store.raw;app.open(project);await app.submit();
  assert.equal(store.raw,before,`no state changes for saved=${saved}, destination=${project}`);
  assert.equal(app.el('video-dialog').open,true);assert.equal(app.el('video-title').value,'My draft');assert.equal(app.el('video-url').value,'https://www.youtube.com/watch?v='+id);
  assert.match(app.el('video-error').textContent,/removed from your feed.*Recently removed/i);assert.equal(app.confirms(),0);
 }
});

test('an orphaned feed-wide removal is not silently revived',async()=>{
 const store={raw:JSON.stringify({hiddenVideos:[id],removedVideos:[{id,saved:true}]})},app=await setup(store,feed([])),before=store.raw;app.open('c');await app.submit();
 assert.equal(store.raw,before);assert.match(app.el('video-error').textContent,/no available project.*cannot currently be restored/i);assert.equal(app.el('video-dialog').open,true);assert.equal(app.el('video-title').value,'My draft');
});

test('a stale tab or failing storage cannot overwrite a removal while adding',async()=>{
 const store={raw:JSON.stringify({})},app=await setup(store,feed([]));app.open('a');
 store.raw=JSON.stringify({hiddenVideos:[id],removedVideos:[{id,saved:true}]});const removed=store.raw;await app.submit();assert.equal(store.raw,removed);assert.match(app.el('video-error').textContent,/changed|reload/i);assert.equal(app.el('video-dialog').open,true);
 const clean={raw:JSON.stringify({})},failed=await setup(clean,feed([]));failed.open('a');clean.fail=true;await failed.submit();assert.equal(clean.raw,'{}');assert.match(failed.el('video-error').textContent,/could not save/i);assert.equal(failed.el('video-title').value,'My draft');
});

test('adding a video that is not globally removed still works',async()=>{
 const store={raw:'{}'},app=await setup(store,feed([]));app.open('c');await app.submit();const state=JSON.parse(store.raw);
 assert.equal(state.customVideos.length,1);assert.equal(state.customVideos[0].id,id);assert.equal(state.customVideos[0].context,'c');assert.equal(app.el('video-dialog').open,false);
});
