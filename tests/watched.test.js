'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {setImmediate:tick}=require('node:timers/promises');

const source=fs.readFileSync(path.join(__dirname,'../dist/app.js'),'utf8');
const feed={contexts:[{id:'a',name:'Project A',task:'Work A'},{id:'b',name:'Project B',task:'Work B'}],videos:[{id:'testVideo01',context:'a',title:'One',channel:'Channel',reason:'Synthetic A',source:'Fixture'},{id:'testVideo01',context:'b',title:'One',channel:'Channel',reason:'Synthetic B',source:'Fixture'},{id:'testVideo02',context:'a',title:'Two',channel:'Channel',reason:'Synthetic',source:'Fixture'}],focusContext:'a',contextSource:'Synthetic'};
async function tab(storage){
 const els=new Map();
 function el(id){if(!els.has(id))els.set(id,{id,value:'',textContent:'',innerHTML:'',open:false,dataset:{},classList:{add(){},remove(){},toggle(){}},listeners:{},addEventListener(type,fn){this.listeners[type]=fn},showModal(){this.open=true},close(){this.open=false},replaceChildren(){}});return els.get(id)}
 class Events{addEventListener(){}close(){}}
 const context={window:{},document:{getElementById:el,querySelectorAll:()=>[],querySelector:()=>null,createElement:()=>({})},localStorage:{getItem:()=>storage.raw,setItem:(_key,v)=>{if(storage.fail)throw Error('storage failed');storage.raw=v}},navigator:{locks:{request:async(_key,_options,fn)=>fn({})}},EventSource:Events,fetch:async()=>({ok:true,json:async()=>feed}),setTimeout,clearTimeout,AbortController,URL,console,confirm:()=>true};
 vm.runInNewContext(source,context);await tick();
 const action=(key,id)=>el('grid').listeners.click({target:{closest:selector=>selector===`[data-${key}]`?{dataset:{[key]:id}}:null}});
 const view=name=>el('filters').listeners.click({target:{closest:selector=>selector==='[data-view]'?{dataset:{view:name}}:null}});
 const project=id=>el('context-nav').listeners.click({target:{closest:selector=>selector==='[data-context]'?{dataset:{context:id}}:null}});
 return {el,action,view,project};
}

test('Watched is explicit, reversible, persistent and independent of Watch later',async()=>{
 const store={raw:JSON.stringify({saved:['testVideo02']})},app=await tab(store);
 assert.match(app.el('grid').innerHTML,/One/);assert.match(app.el('grid').innerHTML,/Two/);
 assert.match(app.el('filters').innerHTML,/data-view="watched"/);
 await app.action('play','testVideo01');assert.equal(JSON.parse(store.raw).watched,undefined,'playback does not mark watched');
 app.el('player-dialog').close();await app.action('watched','testVideo01');
 assert.deepEqual(JSON.parse(store.raw).watched,['testVideo01']);assert.deepEqual(JSON.parse(store.raw).saved,['testVideo02']);
 assert.match(app.el('grid').innerHTML,/data-watched="testVideo01" aria-pressed="true"/);
 app.project('b');assert.match(app.el('grid').innerHTML,/data-watched="testVideo01" aria-pressed="true"/,'same video is marked across projects');
 app.view('watched');assert.equal(app.el('feed-title').textContent,'Your watched videos');assert.match(app.el('grid').innerHTML,/One/);assert.doesNotMatch(app.el('grid').innerHTML,/>Two</);
 const reopened=await tab(store);reopened.view('watched');assert.match(reopened.el('grid').innerHTML,/One/);assert.doesNotMatch(reopened.el('grid').innerHTML,/>Two</);
 await reopened.action('watched','testVideo01');assert.deepEqual(JSON.parse(store.raw).watched,[]);assert.match(reopened.el('grid').innerHTML,/Mark videos watched/);assert.deepEqual(JSON.parse(store.raw).saved,['testVideo02']);
 reopened.view('saved');assert.match(reopened.el('grid').innerHTML,/>Two</);assert.doesNotMatch(reopened.el('grid').innerHTML,/>One</);
});

test('failed or stale writes do not change watched state',async()=>{
 const store={raw:null,fail:true},a=await tab(store);await a.action('watched','testVideo01');
 assert.equal(store.raw,null);assert.match(a.el('toast').textContent,/could not save/i);assert.match(a.el('grid').innerHTML,/data-watched="testVideo01" aria-pressed="false"/);
 store.fail=false;const b=await tab(store);await a.action('watched','testVideo01');assert.deepEqual(JSON.parse(store.raw).watched,['testVideo01']);
 await b.action('watched','testVideo02');assert.deepEqual(JSON.parse(store.raw).watched,['testVideo01']);assert.match(b.el('toast').textContent,/changed|cannot be safely accessed/i);
});

test('malformed stored watched data fails closed',async()=>{
 const store={raw:JSON.stringify({watched:[42]})},app=await tab(store);assert.match(app.el('storage-warning').textContent,/editing is disabled/i);
 await app.action('watched','testVideo01');assert.deepEqual(JSON.parse(store.raw).watched,[42]);
});
