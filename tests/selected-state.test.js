'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {setImmediate:tick}=require('node:timers/promises');

test('project and feed buttons expose their selected state across navigation and refresh',async()=>{
 const elements=new Map(), nav=['all','saved'].map(view=>({dataset:{view},attributes:{},listeners:{},classList:{toggle(){}},setAttribute(k,v){this.attributes[k]=v},addEventListener(type,fn){this.listeners[type]=fn}}));
 const document={activeElement:null,querySelectorAll:selector=>selector==='.nav'?nav:[],createElement:()=>element('new'),getElementById:element};
 function element(id){if(elements.has(id))return elements.get(id);const el={id,contains:()=>false,value:'',textContent:'',innerHTML:'',dataset:{},listeners:{},classList:{add(){},remove(){},toggle(){}},addEventListener(type,fn){this.listeners[type]=fn},showModal(){},close(){},replaceChildren(){},querySelectorAll(){return []}};elements.set(id,el);return el}
 let source;class Events{constructor(){source=this;this.listeners={}}addEventListener(type,fn){this.listeners[type]=fn}close(){}}
 const feed={contexts:[{id:'a',name:'A',task:'Study A'},{id:'b',name:'B',task:'Study B'}],videos:[],focusContext:'a',contextSource:'Synthetic',updatedAt:'2026-01-01T00:00:00Z'};let next=feed;
 const ctx={window:{},document,localStorage:{getItem:()=>null,setItem(){}},EventSource:Events,fetch:async()=>({ok:true,json:async()=>next}),setTimeout,clearTimeout,AbortController,URL,console};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/app.js'),'utf8'),ctx);await tick();
 const pressed=(container,key,id)=>{const html=element(container).innerHTML;const match=html.match(new RegExp(`<button[^>]*data-${key}="${id}"[^>]*aria-pressed="(true|false)"`));assert.ok(match,`${container} ${id} missing aria-pressed`);return match[1]};
 const click=(container,key,id)=>element(container).listeners.click({target:{closest:selector=>selector===`[data-${key}]`?{dataset:{[key]:id}}:null}});
 assert.equal(pressed('filters','context','a'),'true');assert.equal(pressed('filters','context','b'),'false');assert.equal(pressed('context-nav','context','a'),'true');assert.equal(nav[0].attributes['aria-pressed'],'false');assert.equal(nav[1].attributes['aria-pressed'],'false');
 click('filters','context','b');assert.equal(pressed('filters','context','a'),'false');assert.equal(pressed('filters','context','b'),'true');assert.equal(pressed('context-nav','context','b'),'true');
 nav[1].listeners.click();assert.equal(nav[1].attributes['aria-pressed'],'true');assert.equal(nav[0].attributes['aria-pressed'],'false');assert.equal(pressed('filters','view','saved'),'true');assert.equal(pressed('filters','context','all'),'false');assert.equal(pressed('context-nav','context','b'),'true');
 click('filters','context','b');next={...feed,contexts:[feed.contexts[0]],contextSource:'Updated'};source.listeners.feed({data:'{}'});await tick();assert.equal(pressed('filters','context','all'),'true');assert.equal(nav[0].attributes['aria-pressed'],'false');assert.equal(nav[1].attributes['aria-pressed'],'true');
});
