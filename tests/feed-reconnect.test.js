'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setImmediate: tick } = require('node:timers/promises');

// Real frontend, synthetic feed requests and EventSource; no network or personal data.
test('resynchronizes on reconnect without stale responses or losing navigation', async () => {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      id, disabled: id==='live-toggle', value:'', textContent:'', innerHTML:'', open:false,
      dataset:{}, classList:{add(){},remove(){},toggle(){}}, listeners:{},
      addEventListener(type, fn){this.listeners[type]=fn;},
      showModal(){this.open=true}, close(){this.open=false}, replaceChildren(){},
    });
    return elements.get(id);
  }
  let source;
  class FakeEvents {
    constructor(){source=this;this.listeners={};}
    addEventListener(type,fn){this.listeners[type]=fn;}
    emit(type){if(type==='error')this.onerror?.();else this.listeners[type]?.({data:'{}'});}
    close(){}
  }
  const feed = version => ({contexts:[{id:'a',name:'Project A',task:'task'},{id:'b',name:'Project B',task:'task'}],videos:[],focusContext:'a',contextSource:version,updatedAt:'2026-01-01T00:00:00Z'});
  const pending=[];
  let calls=0;
  const fetch=async url=>{
    assert.equal(url,'feed.json');
    if(calls++===0)return {ok:true,json:async()=>feed('initial')};
    return new Promise(resolve=>pending.push(value=>resolve({ok:true,json:async()=>value})));
  };
  const context={window:{},document:{getElementById:element,querySelectorAll:()=>[],createElement:()=>element('new')},localStorage:{getItem:()=>null,setItem(){}},EventSource:FakeEvents,fetch,setTimeout:()=>1,clearTimeout(){},AbortController,URL,console};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','dist','app.js'),'utf8'),context);
  await tick();
  element('context-nav').listeners.click({target:{closest:()=>({dataset:{context:'b'}})}});
  assert.equal(element('feed-title').textContent,'For Project B');
  source.emit('error');
  source.emit('open');
  assert.equal(pending.length,1,'reconnection must fetch the current feed');
  source.emit('feed');
  assert.equal(pending.length,2,'updates during resync must trigger another fetch');
  pending[1](feed('newer')); await tick();
  pending[0](feed('older')); await tick();
  assert.equal(context.window.SEED.contextSource,'newer','late older response must not replace current feed');
  assert.equal(element('feed-title').textContent,'For Project B','feed resync must preserve active project');
  pending.length=0;
  source.emit('feed');
  pending.shift()({contexts:[null],videos:[],contextSource:'malformed'});await tick();
  assert.equal(context.window.SEED.contextSource,'newer','malformed refresh must keep the last good feed');
  assert.equal(element('feed-title').textContent,'For Project B');
  source.emit('feed');
  pending.shift()({contexts:[],videos:[null],contextSource:'malformed video'});await tick();
  assert.equal(context.window.SEED.contextSource,'newer','malformed video refresh must keep the last good feed');
});
