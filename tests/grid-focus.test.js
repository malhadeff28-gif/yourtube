'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {setImmediate:tick}=require('node:timers/promises');

test('card focus survives rerenders without stealing focus after an asynchronous save',async()=>{
 const elements=new Map(),body={id:'body'};
 const document={activeElement:body,querySelectorAll:()=>[],querySelector:()=>null,createElement:()=>element('new'),getElementById:element};
 function element(id){
  if(elements.has(id))return elements.get(id);
  const el={id,contains:()=>false,disabled:false,value:'',textContent:'',open:false,dataset:{},listeners:{},classList:{add(){},remove(){},toggle(){}},addEventListener(type,fn){this.listeners[type]=fn},showModal(){this.open=true},close(){this.open=false},replaceChildren(){},focus(){document.activeElement=this}};
  if(id==='grid'){
   let html='';el.buttons=[];
   Object.defineProperty(el,'innerHTML',{get(){return html},set(value){
    if(el.buttons.includes(document.activeElement))document.activeElement=body;
    html=value;el.buttons=[...value.matchAll(/<button[^>]*data-(save|hide|play)="([^"]+)"[^>]*>/g)].map(([,key,val])=>({dataset:{[key]:val},focus(){document.activeElement=this},hasAttribute(name){return name===`data-${key}`},closest(selector){return selector===`[data-${key}]`?this:null}}));
   }});
   el.contains=target=>el.buttons.includes(target);
   el.querySelectorAll=selector=>el.buttons.filter(x=>x.hasAttribute(selector.slice(1,-1)));
  }
  elements.set(id,el);return el;
 }
 let source,raw=null,gate=null;
 class Events{constructor(){source=this;this.listeners={}}addEventListener(type,fn){this.listeners[type]=fn}close(){}}
 const feed={contexts:[{id:'a',name:'Project A',task:'Study'}],videos:['testVideo01','testVideo02'].map(id=>({id,context:'a',title:id,channel:'Example',reason:'Synthetic',source:'Test'})),focusContext:'a',contextSource:'Synthetic',updatedAt:'2026-01-01T00:00:00Z'};
 let next=feed;
 const context={window:{},document,localStorage:{getItem:()=>raw,setItem:(_key,value)=>{raw=value}},navigator:{locks:{request:async(_key,_opts,fn)=>{if(gate)await gate;return fn({})}}},EventSource:Events,fetch:async()=>({ok:true,json:async()=>next}),setTimeout,clearTimeout,AbortController,URL,console,confirm:()=>true};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','dist','app.js'),'utf8'),context);await tick();
 const grid=element('grid'),button=(key,id)=>grid.buttons.find(x=>x.dataset[key]===id),activate=button=>grid.listeners.click({target:button});
 button('save','testVideo01').focus();await activate(document.activeElement);
 assert.equal(document.activeElement,button('save','testVideo01'),'saving retains focus on that video');
 const titleButton=grid.buttons.filter(x=>x.dataset.play==='testVideo01')[1];titleButton.focus();
 next={...feed,contextSource:'Updated fixture'};source.listeners.feed({data:'{}'});await tick();
 assert.equal(document.activeElement,grid.buttons.filter(x=>x.dataset.play==='testVideo01')[1],'background refresh preserves the same play control');
 button('save','testVideo02').focus();await activate(document.activeElement);
 document.activeElement=body;element('filters').listeners.click({target:{closest:selector=>selector==='[data-view]'?{dataset:{view:'saved'}}:null}});
 button('save','testVideo01').focus();await activate(document.activeElement);
 assert.equal(document.activeElement,button('save','testVideo02'),'unsaving in Watch later focuses the next saved card');
 document.activeElement=body;element('filters').listeners.click({target:{closest:selector=>selector==='[data-view]'?{dataset:{view:'all'}}:null}});
 button('hide','testVideo01').focus();await activate(document.activeElement);
 assert.equal(document.activeElement,button('hide','testVideo02'),'removal moves focus to a surviving card');
 button('save','testVideo02').focus();let release;gate=new Promise(resolve=>{release=resolve});const pending=activate(document.activeElement);
 element('search').focus();release();await pending;gate=null;
 assert.equal(document.activeElement,element('search'),'a save that finishes later does not steal focus');
 button('hide','testVideo02').focus();await activate(document.activeElement);
 assert.equal(document.activeElement,element('search'),'removing the last card focuses the search field');
 next={...feed,contextSource:'Refreshed'};source.listeners.feed({data:'{}'});await tick();
 assert.equal(document.activeElement,element('search'),'feed refresh does not steal focus from search');
});
