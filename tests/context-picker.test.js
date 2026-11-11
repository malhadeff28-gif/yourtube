'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {setImmediate:tick}=require('node:timers/promises');
const script=fs.readFileSync(path.join(__dirname,'..','dist','app.js'),'utf8');
async function setup({projects=[{id:'a',name:'Alpha',task:'Task A'},{id:'b',name:'Beta',task:'Task B'}],focus=''}={}){
 const elements=new Map();function el(id){if(!elements.has(id))elements.set(id,{id,value:'',textContent:'',innerHTML:'',open:false,disabled:false,dataset:{},classList:{add(){},remove(){},toggle(){}},listeners:{},addEventListener(k,f){this.listeners[k]=f},showModal(){this.open=true},close(){this.open=false;this.listeners.close?.()},replaceChildren(){},reset(){}});return elements.get(id)}
 let raw=null,confirmation='',requests=[],lockHold=null,releaseLock;const feed={contexts:projects,videos:[],focusContext:focus,contextSource:'Synthetic'};
 class FakeEvents{addEventListener(){}close(){}}
 const context={window:{},document:{getElementById:el,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>el('new')},localStorage:{getItem:()=>raw,setItem:(_k,v)=>{raw=v}},navigator:{locks:{request:async(_key,_opts,fn)=>{if(lockHold)await lockHold;return fn({})}}},EventSource:FakeEvents,fetch:async(url,options={})=>{if(url==='/api/context/delete'){requests.push(JSON.parse(options.body));return {ok:true}}if(url==='feed.json')return {ok:true,json:async()=>feed};throw Error('Unexpected request '+url)},setTimeout:()=>1,clearTimeout(){},AbortController,URL,console,crypto:{randomUUID:()=> 'new-id'},confirm:message=>{confirmation=message;return false}};
 vm.runInNewContext(script,context);await tick();return {el,context,feed,raw:()=>raw,confirmation:()=>confirmation,requests:()=>requests,holdLock:()=>{lockHold=new Promise(resolve=>{releaseLock=resolve});return ()=>{lockHold=null;releaseLock()}}};
}
const event={preventDefault(){}};
function choose(b,id){b.el('context-choose-select').value=id;b.el('context-choose-form').listeners.submit(event)}

test('all-project view requires explicit choice, including a single project',async()=>{
 for(const projects of [[{id:'a',name:'Alpha',task:'Task A'}],[{id:'a',name:'Alpha',task:'Task A'},{id:'b',name:'Beta',task:'Task B'}]]){
  const b=await setup({projects});b.el('edit-context').listeners.click();assert.equal(b.el('context-choose-dialog').open,true);assert.equal(b.el('context-dialog').open,false);assert.equal(b.el('context-choose-select').value,'');
  choose(b,'');assert.match(b.el('context-choose-error').textContent,/choose/i);await b.el('context-form').listeners.submit(event);await b.el('delete-context').listeners.click();await b.el('context-sync').listeners.click();assert.equal(b.raw(),null);assert.deepEqual(b.requests(),[]);
  choose(b,projects.at(-1).id);assert.equal(b.el('context-choose-dialog').open,false);assert.equal(b.el('context-dialog').open,true);assert.equal(b.el('context-id').value,projects.at(-1).id);assert.equal(b.el('context-name').value,projects.at(-1).name);
 }
});

test('selected projects edit directly; new and empty-project flows still create',async()=>{
 const selected=await setup({focus:'a'});selected.el('edit-context').listeners.click();assert.equal(selected.el('context-id').value,'a');assert.equal(selected.el('context-choose-dialog').open,false);
 selected.el('context-dialog').close();selected.el('add-context').listeners.click();assert.equal(selected.el('context-id').value,'');assert.equal(selected.el('context-dialog-title').textContent,'Add a project');
 const empty=await setup({projects:[]});empty.el('edit-context').listeners.click();assert.equal(empty.el('context-dialog').open,true);assert.equal(empty.el('context-dialog-title').textContent,'Add a project');
});

test('stale selections cannot be edited, deleted, copied or turned into new projects',async()=>{
 const b=await setup();b.el('edit-context').listeners.click();b.feed.contexts=b.feed.contexts.filter(c=>c.id!=='a');choose(b,'a');assert.match(b.el('context-choose-error').textContent,/available/i);assert.equal(b.el('context-dialog').open,false);
 choose(b,'b');b.feed.contexts=[];b.el('context-name').value='Draft';await b.el('context-form').listeners.submit(event);assert.match(b.el('context-error').textContent,/deleted|unavailable/i);await b.el('delete-context').listeners.click();assert.match(b.el('context-error').textContent,/no longer available/i);await b.el('context-sync').listeners.click();assert.deepEqual(b.requests(),[]);assert.equal(b.raw(),null);assert.equal(b.el('context-name').value,'Draft');
});

test('delete confirmation identifies the chosen project',async()=>{
 const b=await setup();b.el('edit-context').listeners.click();choose(b,'b');await b.el('delete-context').listeners.click();assert.match(b.confirmation(),/Beta/);assert.doesNotMatch(b.confirmation(),/Alpha/);assert.deepEqual(b.requests(),[]);
});

test('feed changes while save waits for the lock do not recreate a stale project',async()=>{
 const b=await setup({focus:'a'});b.el('edit-context').listeners.click();b.el('context-name').value='My draft';const release=b.holdLock();const pending=b.el('context-form').listeners.submit(event);b.context.window.SEED.contexts=b.context.window.SEED.contexts.filter(c=>c.id!=='a');release();await pending;assert.equal(b.raw(),null);assert.equal(b.el('context-dialog').open,true);assert.equal(b.el('context-name').value,'My draft');assert.match(b.el('context-error').textContent,/changed|unavailable/i);
});
