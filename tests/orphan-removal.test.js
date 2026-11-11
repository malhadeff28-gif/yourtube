'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {setImmediate:tick}=require('node:timers/promises');

const id='abc123def45';
const feed=()=>({contexts:[{id:'a',name:'A',task:'A'}],videos:[],focusContext:'a',contextSource:'Synthetic'});
async function setup(initial={}){
 const elements=new Map(),store={raw:JSON.stringify(initial),fail:false};let confirmation=true,question='',lockGate=null;
 const el=id=>{if(!elements.has(id))elements.set(id,{id,disabled:false,value:'',textContent:'',innerHTML:'',open:false,dataset:{},classList:{add(){},remove(){},toggle(){}},listeners:{},addEventListener(k,f){this.listeners[k]=f},showModal(){this.open=true},close(){this.open=false;this.listeners.close?.()},replaceChildren(){},reset(){},focus(){},querySelectorAll(){return []}});return elements.get(id)};
 const dialogs=['removed-dialog','context-dialog','video-dialog','player-dialog','info-dialog','live-consent','search-review'];
 class FakeEvents{addEventListener(){}close(){}}
 const ctx={window:{},document:{getElementById:el,querySelector:s=>s==='dialog[open]'?dialogs.map(el).find(d=>d.open)||null:null,querySelectorAll:s=>s==='dialog'?dialogs.map(el):[],createElement:()=>el('created')},localStorage:{getItem:()=>store.raw,setItem:(_k,v)=>{if(store.fail)throw Error('quota');store.raw=v}},navigator:{locks:{request:async(_k,_o,fn)=>{if(lockGate)await lockGate;return fn({})}}},EventSource:FakeEvents,fetch:async()=>({ok:true,json:async()=>feed()}),setTimeout,clearTimeout,AbortController,URL,console,crypto:{randomUUID:()=> 'test'},confirm:message=>{question=message;return confirmation}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','dist','app.js'),'utf8'),ctx);await tick();
 const button={dataset:{allowVideo:id},disabled:false,setAttribute(){},removeAttribute(){}};
 const click=()=>el('removed-list').listeners.click({target:{closest:s=>s==='[data-allow-video]'?button:null}});
 return {el,store,ctx,button,click,open:()=>el('show-removed').listeners.click(),setConfirm:x=>{confirmation=x},question:()=>question,hold:()=>{let release;lockGate=new Promise(r=>release=r);return release}};
}
const state=(record)=>({hiddenVideos:[id],saved:[],removedVideos:record===undefined?[]:[{id,saved:record}],projectHiddenVideos:[{id,context:'a'}]});

test('an orphan can be allowed again with accurate watch-later history',async()=>{
 for(const recorded of [true,false,undefined]){
  const app=await setup(state(recorded));app.open();assert.match(app.el('removed-list').innerHTML,/Allow adding again/);await app.click();const out=JSON.parse(app.store.raw);
  assert.deepEqual(out.hiddenVideos,[]);assert.deepEqual(out.removedVideos,[]);assert.deepEqual(out.projectHiddenVideos,[{id,context:'a'}]);assert.deepEqual(out.saved,recorded===true?[id]:[]);
  assert.match(app.question(),/future project associations may reappear/i);assert.match(app.question(),/Individual project removals remain/i);
  assert.match(app.question(),recorded===true?/prior Watch later status will be restored/i:recorded===false?/not previously in Watch later/i:/status was not recorded/i);
 }
});

test('cancel, stale browser data and storage failure leave the removal intact',async()=>{
 const canceled=await setup(state(true)),before=canceled.store.raw;canceled.open();canceled.setConfirm(false);await canceled.click();assert.equal(canceled.store.raw,before);
 const stale=await setup(state(true));stale.open();stale.store.raw=JSON.stringify({...state(true),watched:[id]});const newer=stale.store.raw;await stale.click();assert.equal(stale.store.raw,newer);assert.match(stale.el('removed-error').textContent,/changed|reload/i);
 const failed=await setup(state(true));failed.open();failed.store.fail=true;const original=failed.store.raw;await failed.click();assert.equal(failed.store.raw,original);assert.match(failed.el('removed-error').textContent,/could not save/i);
});

test('a newly available association while acquiring the lock prevents clearing',async()=>{
 const app=await setup(state(true));app.open();const release=app.hold(),operation=app.click();app.ctx.window.SEED={...feed(),videos:[{id,context:'a',title:'New result'}]};release();await operation;
 assert.deepEqual(JSON.parse(app.store.raw).hiddenVideos,[id]);assert.match(app.el('removed-error').textContent,/changed|unresolved/i);assert.match(app.el('removed-list').innerHTML,/data-restore-video/);
});

test('a pending deletion is never classified as an orphan',async()=>{
 const app=await setup({...state(true),__yourtubePendingDeletion:{id:'a',token:'test'}});app.open();assert.match(app.el('removed-list').innerHTML,/Resolve the pending project deletion/i);assert.match(app.el('removed-list').innerHTML,/data-allow-video[^>]*disabled/);const before=app.store.raw;await app.click();assert.equal(app.store.raw,before);assert.match(app.el('removed-error').textContent,/unresolved/i);
});
