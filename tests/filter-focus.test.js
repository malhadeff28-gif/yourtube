'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {setImmediate:tick}=require('node:timers/promises');

test('filter activation retains keyboard focus without stealing it on refresh',async()=>{
  const elements=new Map(),body={id:'body'};
  const document={activeElement:body,querySelectorAll:()=>[],createElement:()=>element('new'),getElementById:element};
  function element(id){
    if(elements.has(id))return elements.get(id);
    const el={id,disabled:false,value:'',textContent:'',open:false,dataset:{},listeners:{},classList:{add(){},remove(){},toggle(){}},addEventListener(type,fn){this.listeners[type]=fn},showModal(){this.open=true},close(){this.open=false},replaceChildren(){}};
    if(id==='filters'){
      let html='';el.buttons=[];
      Object.defineProperty(el,'innerHTML',{get(){return html},set(value){
        if(el.buttons.includes(document.activeElement))document.activeElement=body;
        html=value;el.buttons=[...value.matchAll(/<button[^>]*data-(context|view)="([^"]+)"[^>]*>/g)].map(([,key,val])=>({dataset:{[key]:val},focus(){document.activeElement=this},closest(selector){return selector===`[data-${key}]`?this:null}}));
      }});
      el.querySelectorAll=selector=>selector==='[data-context]'?el.buttons.filter(x=>'context' in x.dataset):[];
      el.querySelector=selector=>selector==='[data-view="saved"]'?el.buttons.find(x=>x.dataset.view==='saved'):null;
    }
    elements.set(id,el);return el;
  }
  let source;
  class Events{constructor(){source=this;this.listeners={}}addEventListener(type,fn){this.listeners[type]=fn}close(){}}
  const feed={contexts:[{id:'a',name:'Project A',task:'Study A'},{id:'b',name:'Project B',task:'Study B'}],videos:[],focusContext:'a',contextSource:'Synthetic',updatedAt:'2026-01-01T00:00:00Z'};
  let next=feed;
  const context={window:{},document,localStorage:{getItem:()=>null,setItem(){}},EventSource:Events,fetch:async()=>({ok:true,json:async()=>next}),setTimeout,clearTimeout,AbortController,URL,console};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','dist','app.js'),'utf8'),context);
  await tick();
  const filters=element('filters'),pick=id=>filters.buttons.find(x=>x.dataset.context===id),saved=()=>filters.buttons.find(x=>x.dataset.view==='saved');
  const activate=btn=>filters.listeners.click({target:btn});
  pick('b').focus();activate(document.activeElement);
  assert.equal(document.activeElement,pick('b'),'selected project retains focus after its button is replaced');
  assert.equal(element('feed-title').textContent,'For Project B');
  saved().focus();activate(document.activeElement);
  assert.equal(document.activeElement,saved(),'watch later retains focus after its button is replaced');
  assert.equal(element('feed-title').textContent,'Your watch later list');
  const search=element('search');document.activeElement=search;
  activate(pick('a'));
  assert.equal(document.activeElement,search,'an unfocused activation does not steal focus');
  next={...feed,contextSource:'Updated synthetic'};source.listeners.feed({data:'{}'});await tick();
  assert.equal(document.activeElement,search,'an asynchronous feed refresh does not steal focus');
  const stale=pick('b');stale.focus();context.window.SEED.contexts=[feed.contexts[0]];activate(stale);
  assert.equal(document.activeElement,pick('all'),'if the selected project disappeared focus falls back to All');
});
