'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setImmediate: tick } = require('node:timers/promises');

test('a stalled initial feed load offers a safe retry and restores the Live control', async () => {
  const elements = new Map(), timers = new Map(), calls = [];
  let timerId = 0, source, feedCalls = 0;
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
  const context={window:{},document:{getElementById:element,querySelectorAll:()=>[],createElement:tag=>element(`new-${tag}`)},localStorage:{getItem:()=>null,setItem(){}},EventSource:FakeEvents,fetch,setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id),AbortController,URL,console};
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
