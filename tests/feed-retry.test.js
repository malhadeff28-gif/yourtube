'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setImmediate: tick } = require('node:timers/promises');

test('retries the latest failed feed refresh with bounded, cancelable backoff', async () => {
  const elements = new Map(), timers = new Map(); let nextTimer = 0, source, calls = 0;
  function element(id) {
    if (!elements.has(id)) elements.set(id, { id, disabled:false, value:'', textContent:'', innerHTML:'', open:false,
      dataset:{}, classList:{add(){},remove(){},toggle(){}}, listeners:{},
      addEventListener(type,fn){this.listeners[type]=fn}, showModal(){this.open=true}, close(){this.open=false}, replaceChildren(){} });
    return elements.get(id);
  }
  class FakeEvents { constructor(){source=this;this.listeners={}} addEventListener(type,fn){this.listeners[type]=fn} emit(type){if(type==='error')this.onerror?.();else this.listeners[type]?.({data:'{}'})} close(){} }
  const feed = version => ({contexts:[],videos:[],focusContext:'',contextSource:version,updatedAt:'2026-01-01T00:00:00Z'});
  const pending=[];
  const fetch=async url=>{assert.equal(url,'feed.json');if(calls++===0)return {ok:true,json:async()=>feed('initial')};return new Promise((resolve,reject)=>pending.push({resolve:value=>resolve({ok:true,json:async()=>value}),reject}))};
  const setTimer=(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,ms});return id}, clearTimer=id=>timers.delete(id);
  const context={window:{},document:{getElementById:element,querySelectorAll:()=>[],createElement:()=>element('new')},localStorage:{getItem:()=>null,setItem(){}},EventSource:FakeEvents,fetch,setTimeout:setTimer,clearTimeout:clearTimer,AbortController,URL,console};
  vm.runInNewContext(fs.readFileSync(process.env.YOURTUBE_TEST_APP || path.join(__dirname,'..','dist','app.js'),'utf8'),context);
  await tick();
  const runRetry = expected => {const entry=[...timers].find(([,value])=>value.ms===expected);assert.ok(entry,`expected ${expected}ms retry`);timers.delete(entry[0]);entry[1].fn()};
  source.emit('open');
  pending.shift().reject(Error('temporary failure')); await tick();
  runRetry(1000); pending.shift().reject(Error('temporary failure')); await tick();
  runRetry(2000); pending.shift().resolve(feed('recovered')); await tick();
  assert.equal(context.window.SEED.contextSource,'recovered');
  assert.equal([...timers.values()].some(timer=>timer.ms===4000),false,'success cancels further attempts');

  source.emit('feed'); pending.shift().reject(Error('another outage')); await tick();
  assert.ok([...timers.values()].some(timer=>timer.ms===1000));
  source.emit('feed');
  assert.equal([...timers.values()].some(timer=>timer.ms===1000),false,'new feed events cancel older retries');
  const old=pending.shift(); source.emit('feed'); const current=pending.shift();
  current.resolve(feed('newest')); await tick(); old.resolve(feed('stale')); await tick();
  assert.equal(context.window.SEED.contextSource,'newest','late older response must not replace current feed');

  source.emit('feed'); pending.shift().reject(Error('disconnect')); await tick();
  source.emit('error');
  assert.equal([...timers.values()].some(timer=>timer.ms===1000),false,'disconnect cancels scheduled retry');
  const before=calls; for(const timer of timers.values())if(timer.ms===1000)timer.fn(); assert.equal(calls,before);

  source.emit('open'); pending.shift().reject(Error('persistent')); await tick();
  for(const ms of [1000,2000,4000]){runRetry(ms);pending.shift().reject(Error('persistent'));await tick()}
  assert.equal([...timers.values()].some(timer=>[1000,2000,4000].includes(timer.ms)),false,'retries must stop after three attempts');
  assert.match(element('toast').textContent,/Could not load the updated feed/);
});
