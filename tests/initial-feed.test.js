'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setImmediate: tick } = require('node:timers/promises');

test('a stalled initial feed load offers a safe retry and restores the Live control', async () => {
  const elements = new Map(), timers = new Map(), calls = [];
  let timerId = 0, source, feedCalls = 0, elementId = 0;
  function element(id) {
    if (!elements.has(id)) elements.set(id, { id, disabled:id==='live-toggle', value:'', textContent:'', innerHTML:'', open:false,
      dataset:{}, classList:{add(){},remove(){},toggle(){}}, listeners:{}, children:[],
      addEventListener(type,fn){this.listeners[type]=fn}, setAttribute(){}, showModal(){this.open=true}, close(){this.open=false},
      replaceChildren(...children){this.children=children} });
    return elements.get(id);
  }
  class FakeEvents { constructor(){source=this;this.listeners={}} addEventListener(type,fn){this.listeners[type]=fn} close(){} }
  const fetch = async (url, options={}) => {
    calls.push(url);
    if (url==='feed.json' && feedCalls++===0) return new Promise((_,reject)=>options.signal?.addEventListener('abort',()=>reject(Error('aborted'))));
    if (url==='feed.json') return {ok:true,json:async()=>({contexts:[],videos:[],focusContext:'',contextSource:'Empty starter feed'})};
    if (url==='/api/live') return {ok:true};
    throw Error(`unexpected request ${url}`);
  };
  const context={window:{},document:{getElementById:element,querySelectorAll:()=>[],createElement:tag=>element(`new-${tag}-${++elementId}`)},localStorage:{getItem:()=>null,setItem(){}},EventSource:FakeEvents,fetch,setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id),AbortController,URL,console};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','dist','app.js'),'utf8'),context);
  await tick();
  const timeout=[...timers.values()].find(t=>t.ms===10000);
  assert.ok(timeout,'initial request must have a bounded timeout');
  timeout.fn(); await tick();
  const grid=element('grid');
  assert.match(grid.children[0].textContent,/Live may still be on/i);
  assert.match(grid.children[1].textContent,/retry/i);
  assert.equal(element('live-toggle').disabled,true);
  assert.deepEqual(calls,['feed.json'],'a failed startup must not enable or pause Live');
  grid.children[1].listeners.click(); await tick();
  assert.ok(source,'retry must start the regular status connection');
  assert.equal(element('live-toggle').disabled,true,'unknown Live state must remain disabled');
  source.listeners.status({data:JSON.stringify({mode:'listening',enabled:true,message:'Live'})});
  assert.equal(element('live-toggle').disabled,false,'a fresh status restores the pause control');
  await element('live-toggle').listeners.click();
  assert.deepEqual(calls,['feed.json','feed.json','/api/live']);
});

test('a corrupt feed still permits an explicit pause with honest failure feedback', async () => {
  const elements = new Map(), timers = new Map(), requests=[];
  let timerId=0, elementId=0, pauseMode='success';
  function element(id) {
    if(!elements.has(id))elements.set(id,{id,disabled:id==='live-toggle',value:'',textContent:'',innerHTML:'',open:false,
      dataset:{},classList:{add(){},remove(){},toggle(){}},listeners:{},children:[],
      addEventListener(type,fn){this.listeners[type]=fn},setAttribute(){},showModal(){this.open=true},close(){this.open=false},replaceChildren(...children){this.children=children}});
    return elements.get(id);
  }
  const fetch=async(url,options={})=>{
    if(url==='feed.json')return {ok:true,json:async()=>({invalid:true})};
    if(url==='/api/live'){
      requests.push(JSON.parse(options.body));
      if(pauseMode==='success')return {ok:true,json:async()=>({enabled:false,mode:'paused'})};
      if(pauseMode==='not-paused')return {ok:true,json:async()=>({enabled:true,mode:'listening'})};
      return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted'))));
    }
    throw Error('unexpected request');
  };
  const context={window:{},document:{getElementById:element,querySelectorAll:()=>[],createElement:tag=>element(`new-${tag}-${++elementId}`)},localStorage:{getItem:()=>null,setItem(){}},EventSource:class{},fetch,setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id),AbortController,URL,console};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','dist','app.js'),'utf8'),context);
  await tick();
  const [warning,,pause]=element('grid').children;
  assert.match(warning.textContent,/Live may still be on/);
  assert.equal(requests.length,0,'no pause or enable happens without a click');
  await pause.listeners.click();
  assert.deepEqual(requests,[{enabled:false}]);
  assert.match(warning.textContent,/confirmed Live is paused/);
  pauseMode='not-paused';await pause.listeners.click();
  assert.match(warning.textContent,/Could not confirm Live is paused/);
  pauseMode='hang';const pending=pause.listeners.click();
  assert.equal(pause.disabled,true,'prevent overlapping pause attempts');
  const deadline=[...timers.values()].find(t=>t.ms===10000);assert.ok(deadline);
  deadline.fn();await pending;
  assert.equal(pause.disabled,false);
  assert.match(warning.textContent,/Could not confirm Live is paused/);
  assert.deepEqual(requests,[{enabled:false},{enabled:false},{enabled:false}]);
});

for (const [label, badFeed] of [
  ['null context', {contexts:[null],videos:[]}],
  ['malformed context', {contexts:[{id:'a',name:{},task:'Study'}],videos:[]}],
  ['null video', {contexts:[],videos:[null]}],
  ['malformed video', {contexts:[],videos:[{id:'abc123def45',context:42}]}],
]) test(`${label} offers a pause-only fallback and retry`, async () => {
  const elements=new Map(),calls=[];let elementId=0;
  function element(id){if(!elements.has(id))elements.set(id,{id,disabled:false,value:'',textContent:'',innerHTML:'',open:false,dataset:{},classList:{add(){},remove(){},toggle(){}},listeners:{},children:[],addEventListener(type,fn){this.listeners[type]=fn},setAttribute(){},showModal(){this.open=true},close(){this.open=false},replaceChildren(...children){this.children=children}});return elements.get(id)}
  const fetch=async(url,options={})=>{if(url==='feed.json')return {ok:true,json:async()=>badFeed};if(url==='/api/live'){calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({enabled:false,mode:'paused'})}}throw Error('unexpected request')};
  const context={window:{},document:{getElementById:element,querySelectorAll:()=>[],createElement:tag=>element(`new-${tag}-${++elementId}`)},localStorage:{getItem:()=>null,setItem(){}},EventSource:class{},fetch,setTimeout,clearTimeout,AbortController,URL,console};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','dist','app.js'),'utf8'),context);await tick();
  const [warning,retry,pause]=element('grid').children;
  assert.match(warning.textContent,/Live may still be on/);
  assert.match(retry.textContent,/retry/i);
  assert.equal(element('live-toggle').disabled,true);
  assert.deepEqual(calls,[]);
  await pause.listeners.click();assert.deepEqual(calls,[{enabled:false}]);
});

test('unexpected initialization failure keeps a pause action and reloads on retry', async () => {
  const elements=new Map(),calls=[];let elementId=0,reloads=0;
  function element(id){if(!elements.has(id))elements.set(id,{id,disabled:false,value:'',textContent:'',innerHTML:'',open:false,dataset:{},classList:{add(){},remove(){},toggle(){}},listeners:{},children:[],addEventListener(type,fn){this.listeners[type]=fn},setAttribute(){},showModal(){this.open=true},close(){this.open=false},replaceChildren(...children){this.children=children}});return elements.get(id)}
  const fetch=async(url,options={})=>{if(url==='feed.json')return {ok:true,json:async()=>({contexts:[],videos:[]})};if(url==='/api/live'){calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({enabled:false,mode:'paused'})}}throw Error('unexpected request')};
  const context={window:{location:{reload(){reloads++}}},document:{getElementById:element,querySelectorAll(){throw Error('synthetic initialization failure')},createElement:tag=>element(`new-${tag}-${++elementId}`)},localStorage:{getItem:()=>null,setItem(){}},EventSource:class{},fetch,setTimeout,clearTimeout,AbortController,URL,console};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','dist','app.js'),'utf8'),context);await tick();
  const [warning,retry,pause]=element('grid').children;
  assert.match(warning.textContent,/Live may still be on/);
  assert.equal(element('live-toggle').disabled,true);
  await pause.listeners.click();assert.deepEqual(calls,[{enabled:false}]);
  retry.listeners.click();assert.equal(reloads,1,'partial initialization must reload instead of registering duplicate listeners');
});
