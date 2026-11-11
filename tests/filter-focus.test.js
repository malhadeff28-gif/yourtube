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
    if(id==='filters'||id==='context-nav'){
      let html='';el.buttons=[];
      Object.defineProperty(el,'innerHTML',{get(){return html},set(value){
        if(el.buttons.includes(document.activeElement))document.activeElement=body;
        html=value;el.buttons=[...value.matchAll(/<button[^>]*data-(context|view|new-context)(?:="([^"]+)")?[^>]*>/g)].map(([,key,val])=>({dataset:{[key==='new-context'?'newContext':key]:val??''},focus(){document.activeElement=this},hasAttribute(name){return name===`data-${key}`},closest(selector){return selector===`[data-${key}]`?this:null}}));
      }});
      el.contains=target=>el.buttons.includes(target);
      el.querySelectorAll=selector=>el.buttons.filter(x=>x.hasAttribute(selector.slice(1,-1)));
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
  const sidebar=element('context-nav'),sidebarPick=id=>sidebar.buttons.find(x=>x.dataset.context===id);
  sidebarPick('b').focus();sidebar.listeners.click({target:document.activeElement});
  assert.equal(document.activeElement,sidebarPick('b'),'sidebar selection retains focus after rerender');
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
  saved().focus();next={...feed,contextSource:'Another update'};source.listeners.feed({data:'{}'});await tick();
  assert.equal(document.activeElement,saved(),'a focused Watch later button survives an asynchronous refresh');
  const add=()=>filters.buttons.find(x=>'newContext' in x.dataset);
  add().focus();next={...feed,contextSource:'Another update again'};source.listeners.feed({data:'{}'});await tick();
  assert.equal(document.activeElement,add(),'a focused add-project button survives an asynchronous refresh');
  sidebarPick('b').focus();next={...feed,contextSource:'Sidebar refresh'};source.listeners.feed({data:'{}'});await tick();
  assert.equal(document.activeElement,sidebarPick('b'),'a focused sidebar button survives an asynchronous refresh');
  const stale=pick('b');stale.focus();context.window.SEED.contexts=[feed.contexts[0]];activate(stale);
  assert.equal(document.activeElement,pick('all'),'if the selected project disappeared focus falls back to All');
  context.window.SEED.contexts=feed.contexts;filters.listeners.click({target:pick('all')});
  const staleSidebar=sidebarPick('b');staleSidebar.focus();context.window.SEED.contexts=[feed.contexts[0]];sidebar.listeners.click({target:staleSidebar});
  assert.equal(document.activeElement,pick('all'),'if a sidebar project disappeared focus falls back to All');
});
