'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {setImmediate:tick}=require('node:timers/promises');
const PREF='yourtube.thumbnails.v1';
const feed={contexts:[{id:'a',name:'Sample project',task:'Synthetic'}],videos:[{id:'testVideo01',context:'a',title:'Sample',channel:'Example',reason:'Synthetic'}],focusContext:'all',contextSource:'Synthetic'};
async function setup({initial,failRead=false,failWrite=false}={}){
 const elements=new Map(),requests=[],listeners={};let readFailure=failRead,writeFailure=failWrite;
 const storage=new Map(initial?[[PREF,initial]]:[]);
 function el(id){if(!elements.has(id))elements.set(id,{id,value:'',textContent:'',innerHTML:'',open:false,dataset:{},checked:false,classList:{add(){},remove(){},toggle(){}},listeners:{},addEventListener(type,fn){this.listeners[type]=fn},showModal(){this.open=true},close(){this.open=false},replaceChildren(){},querySelectorAll(){return []},contains(){return false}});return elements.get(id)}
 const localStorage={getItem(key){if(key===PREF&&readFailure)throw Error('blocked');return storage.get(key)??null},setItem(key,value){if(key===PREF&&writeFailure)throw Error('quota');storage.set(key,String(value))}};
 class Events{addEventListener(){} close(){}}
 const context={window:{addEventListener:(type,fn)=>{const previous=listeners[type];listeners[type]=previous?event=>{previous(event);fn(event)}:fn}},document:{activeElement:null,getElementById:el,querySelectorAll:()=>[],querySelector:()=>null,createElement:()=>({})},localStorage,navigator:{locks:{request:async(_k,_o,fn)=>fn({})}},EventSource:Events,fetch:async url=>{requests.push(url);return {ok:true,json:async()=>feed}},setTimeout,clearTimeout,AbortController,URL,console};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/app.js'),'utf8'),context);await tick();
 return {el,storage,requests,listeners,failRead(value){readFailure=value},failWrite(value){writeFailure=value},toggle(value){el('thumbnail-toggle').checked=value;el('thumbnail-toggle').listeners.change()}};
}
const hasImage=a=>/src="https:\/\/i\.ytimg\.com\/vi\/testVideo01\/hqdefault\.jpg"/.test(a.el('grid').innerHTML);
test('thumbnails are absent on first render and enabled only by an explicit saved preference',async()=>{
 const a=await setup();assert.equal(a.el('thumbnail-toggle').checked,false);assert.equal(hasImage(a),false);assert.match(a.el('grid').innerHTML,/data-play="testVideo01"/);
 a.toggle(true);assert.equal(a.storage.get(PREF),'enabled');assert.equal(a.el('thumbnail-toggle').checked,true);assert.equal(hasImage(a),true);
 const reloaded=await setup({initial:a.storage.get(PREF)});assert.equal(hasImage(reloaded),true);
 reloaded.toggle(false);assert.equal(reloaded.storage.get(PREF),'disabled');assert.equal(hasImage(reloaded),false);
 const off=await setup({initial:reloaded.storage.get(PREF)});assert.equal(hasImage(off),false);
 assert.deepEqual(a.requests,['feed.json']);
});
test('invalid and inaccessible preferences fail closed',async()=>{
 const malformed=await setup({initial:'true'});assert.equal(hasImage(malformed),false);
 const blocked=await setup({initial:'enabled',failRead:true});assert.equal(hasImage(blocked),false);assert.match(blocked.el('thumbnail-status').textContent,/could not be read/i);
 blocked.failRead(false);blocked.failWrite(true);blocked.toggle(true);assert.equal(hasImage(blocked),false);assert.equal(blocked.el('thumbnail-toggle').checked,false);assert.match(blocked.el('thumbnail-status').textContent,/may load again after reloading/i);
});
test('failed disable hides images immediately but warns that reload may restore the old preference',async()=>{
 const a=await setup({initial:'enabled'});assert.equal(hasImage(a),true);a.failWrite(true);a.toggle(false);
 assert.equal(hasImage(a),false);assert.equal(a.storage.get(PREF),'enabled');assert.match(a.el('thumbnail-status').textContent,/may load again after reloading/i);
});
test('cooperating tabs adopt preference changes and close on a read error',async()=>{
 const a=await setup({initial:'enabled'});a.storage.set(PREF,'disabled');a.listeners.storage({key:PREF});assert.equal(hasImage(a),false);
 a.storage.set(PREF,'enabled');a.listeners.storage({key:PREF});assert.equal(hasImage(a),true);
 a.failRead(true);a.listeners.storage({key:PREF});assert.equal(hasImage(a),false);assert.equal(a.el('thumbnail-toggle').checked,false);
});
