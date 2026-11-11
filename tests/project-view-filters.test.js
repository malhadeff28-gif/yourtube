'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {setImmediate:tick}=require('node:timers/promises');

test('project and saved/watched filters compose and reset independently',async()=>{
 const elements=new Map(),nav=['all','saved','watched'].map(view=>({dataset:{view},attributes:{},listeners:{},classList:{toggle(){}},setAttribute(k,v){this.attributes[k]=v},addEventListener(type,fn){this.listeners[type]=fn}}));
 function el(id){if(!elements.has(id))elements.set(id,{id,value:'',textContent:'',innerHTML:'',open:false,dataset:{},classList:{add(){},remove(){},toggle(){}},listeners:{},addEventListener(type,fn){this.listeners[type]=fn},showModal(){this.open=true},close(){this.open=false},replaceChildren(){},querySelectorAll(){return []},contains(){return false}});return elements.get(id)}
 let source;class Events{constructor(){source=this;this.listeners={}}addEventListener(type,fn){this.listeners[type]=fn}close(){}}
 const feed={contexts:[{id:'a',name:'Alpha project',task:'Study A'},{id:'b',name:'Beta project',task:'Study B'}],videos:[{id:'testVideo01',context:'a',title:'Alpha only',channel:'Channel',reason:'A',source:'Fixture'},{id:'testVideo02',context:'b',title:'Beta only',channel:'Channel',reason:'B',source:'Fixture'},{id:'testVideo03',context:'a',title:'Shared in Alpha',channel:'Channel',reason:'A',source:'Fixture'},{id:'testVideo03',context:'b',title:'Shared in Beta',channel:'Channel',reason:'B',source:'Fixture'}],focusContext:'a',contextSource:'Synthetic'};let next=feed;
 const state={saved:['testVideo01','testVideo03'],watched:['testVideo02','testVideo03']};
 const context={window:{},document:{activeElement:null,getElementById:el,querySelectorAll:s=>s==='.nav'?nav:[],querySelector:()=>null,createElement:()=>({})},localStorage:{getItem:()=>JSON.stringify(state),setItem(){}},navigator:{locks:{request:async(_k,_o,fn)=>fn({})}},EventSource:Events,fetch:async()=>({ok:true,json:async()=>next}),setTimeout,clearTimeout,AbortController,URL,console};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/app.js'),'utf8'),context);await tick();
 const click=(key,id)=>el('filters').listeners.click({target:{closest:s=>s===`[data-${key}]`?{dataset:{[key]:id}}:null}});
 const pressed=(key,id)=>{const match=el('filters').innerHTML.match(new RegExp(`<button[^>]*data-${key}="${id}"[^>]*aria-pressed="(true|false)"`));assert.ok(match,`${key} ${id} missing`);return match[1]};
 const grid=()=>el('grid').innerHTML;
 assert.match(el('filters').innerHTML,/role="group" aria-label="Project"/);assert.match(el('filters').innerHTML,/role="group" aria-label="Video status"/);
 assert.match(grid(),/Alpha only/);assert.doesNotMatch(grid(),/Beta only/);
 click('view','saved');assert.match(el('feed-title').textContent,/Watch later.*Alpha/);assert.equal(pressed('context','a'),'true');assert.equal(pressed('view','saved'),'true');assert.equal(nav[1].attributes['aria-pressed'],'true');assert.match(grid(),/Alpha only/);assert.doesNotMatch(grid(),/Beta only/);
 click('context','b');assert.match(el('feed-title').textContent,/Watch later.*Beta/);assert.equal(pressed('context','b'),'true');assert.equal(pressed('view','saved'),'true');assert.match(grid(),/Shared in Beta/);assert.doesNotMatch(grid(),/Alpha only|Beta only/);
 click('context','all');assert.equal(pressed('context','all'),'true');assert.equal(pressed('view','saved'),'true');assert.match(grid(),/Alpha only/);assert.doesNotMatch(grid(),/Beta only/);
 click('view','watched');assert.match(grid(),/Beta only/);assert.doesNotMatch(grid(),/Alpha only/);click('context','a');assert.match(el('feed-title').textContent,/Watched.*Alpha/);assert.match(grid(),/Shared in Alpha/);assert.doesNotMatch(grid(),/Beta only|Alpha only/);
 click('view','all');assert.equal(pressed('view','all'),'true');assert.equal(pressed('context','a'),'true');assert.match(grid(),/Alpha only/);assert.match(grid(),/Shared in Alpha/);
 click('context','b');click('view','saved');assert.match(grid(),/Shared in Beta/);nav[0].listeners.click();assert.equal(pressed('context','all'),'true');assert.equal(pressed('view','all'),'true');assert.match(grid(),/Alpha only/);assert.match(grid(),/Beta only/);
 // A disappearing selected project falls back to all projects while keeping the chosen status.
 click('context','b');click('view','watched');next={...feed,contexts:[feed.contexts[0]],videos:feed.videos.filter(v=>v.context==='a')};source.listeners.feed({data:'{}'});await tick();assert.equal(pressed('context','all'),'true');assert.equal(pressed('view','watched'),'true');assert.equal(nav[2].attributes['aria-pressed'],'true');assert.match(grid(),/Shared in Alpha/);assert.doesNotMatch(grid(),/Beta only/);
 next={...feed,contexts:[],videos:[]};source.listeners.feed({data:'{}'});await tick();assert.match(grid(),/Mark videos watched/);assert.doesNotMatch(grid(),/Start with a project/);
});
