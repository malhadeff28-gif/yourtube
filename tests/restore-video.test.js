'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {setImmediate:tick}=require('node:timers/promises');

const id='abc123def45';
const feed=()=>({contexts:[{id:'a',name:'A',task:'Learn A'},{id:'b',name:'B',task:'Learn B'}],videos:[{id,context:'a',title:'A shared video',channel:'Example',reason:'First',source:'Synthetic'},{id,context:'b',title:'A shared video',channel:'Example',reason:'Second',source:'Synthetic'}],focusContext:'a',contextSource:'Synthetic'});
async function tab(storage,data=feed()){
 const elements=new Map();
 const el=id=>{if(!elements.has(id))elements.set(id,{id,disabled:false,value:'',textContent:'',innerHTML:'',open:false,dataset:{},classList:{add(){},remove(){},toggle(){}},listeners:{},addEventListener(k,f){this.listeners[k]=f},showModal(){this.open=true},close(){this.open=false;this.listeners.close?.()},replaceChildren(){},reset(){}});return elements.get(id)};
 const dialogs=['removed-dialog','context-dialog','video-dialog','player-dialog','info-dialog','live-consent','search-review'];
 class FakeEvents{constructor(){this.listeners={}}addEventListener(k,f){this.listeners[k]=f}close(){}}
 const context={window:{},document:{getElementById:el,querySelector:s=>s==='dialog[open]'?dialogs.map(el).find(d=>d.open)||null:null,querySelectorAll:s=>s==='dialog'?dialogs.map(el):[],createElement:()=>el('created')},localStorage:{getItem:()=>storage.raw,setItem:(_k,v)=>{if(storage.fail)throw Error('quota');storage.raw=v}},navigator:{locks:{request:async(_k,_o,fn)=>fn({})}},EventSource:FakeEvents,fetch:async()=>({ok:true,json:async()=>data}),setTimeout,clearTimeout,AbortController,URL,console,crypto:{randomUUID:()=> 'test'},confirm:()=>true};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','dist','app.js'),'utf8'),context);await tick();
 return {el,feed:data};
}
const click=(selector,key,value)=>({target:{closest:s=>s===selector?{dataset:{[key]:value},disabled:false,setAttribute(){},removeAttribute(){}}:null}});
const hide=app=>app.el('grid').listeners.click(click('[data-hide]','hide',id));
const restore=app=>app.el('removed-list').listeners.click(click('[data-restore-video]','restoreVideo',id));

test('removed video survives reload and restores its prior Watch later status across projects',async()=>{
 const store={raw:JSON.stringify({saved:[id],watched:[id]})},first=await tab(store);await hide(first);assert.deepEqual(JSON.parse(store.raw).watched,[id],'removal must preserve the watched mark');
 assert.deepEqual(JSON.parse(store.raw).saved,[]);assert.deepEqual(JSON.parse(store.raw).removedVideos,[{id,saved:true}]);
 const second=await tab(store);second.el('show-removed').listeners.click();assert.match(second.el('removed-list').innerHTML,/A shared video/);await restore(second);
 const s=JSON.parse(store.raw);assert.deepEqual(s.hiddenVideos,[]);assert.deepEqual(s.saved,[id]);assert.deepEqual(s.removedVideos,[]);assert.deepEqual(s.watched,[id],'restoration must preserve the watched mark');
 assert.match(second.el('grid').innerHTML,/A shared video/);
 await hide(second);second.el('show-removed').listeners.click();await restore(second);assert.deepEqual(JSON.parse(store.raw).saved,[id]);
});

test('failed or stale writes cannot lose a removal or claim it restored',async()=>{
 const store={raw:JSON.stringify({saved:[]})},a=await tab(store),b=await tab(store);store.fail=true;await hide(a);assert.deepEqual(JSON.parse(store.raw).hiddenVideos||[],[]);
 store.fail=false;await hide(a);const afterHide=store.raw;await hide(b);assert.equal(store.raw,afterHide,'stale tab may not overwrite a newer change');
 a.el('show-removed').listeners.click();store.fail=true;await restore(a);assert.equal(store.raw,afterHide);assert.match(a.el('removed-error').textContent,/could not save/i);
 store.fail=false;await restore(a);assert.deepEqual(JSON.parse(store.raw).hiddenVideos,[]);
});

test('unavailable and legacy removed records are handled without inventing save history',async()=>{
 const legacy={raw:JSON.stringify({hiddenVideos:[id],saved:[]})},app=await tab(legacy);app.el('show-removed').listeners.click();assert.match(app.el('removed-list').innerHTML,/status not recorded/i);await restore(app);assert.deepEqual(JSON.parse(legacy.raw).saved,[]);
 const absent={raw:JSON.stringify({hiddenVideos:[id],saved:[],removedVideos:[{id,saved:true}]})},empty=await tab(absent,{contexts:[],videos:[],focusContext:'',contextSource:'Synthetic'});empty.el('show-removed').listeners.click();assert.match(empty.el('removed-list').innerHTML,/Unavailable/);await restore(empty);assert.deepEqual(JSON.parse(absent.raw).hiddenVideos,[id]);assert.deepEqual(JSON.parse(absent.raw).saved,[]);
});
