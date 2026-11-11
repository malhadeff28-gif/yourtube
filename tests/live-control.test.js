'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setImmediate: tick } = require('node:timers/promises');

// Exercise the real frontend with a minimal local DOM and EventSource; no network or chats.
test('Live control waits for authoritative status and prevents concurrent changes', async () => {
  const root = path.resolve(__dirname, '..');
  assert.match(fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8'), /id="live-toggle"[^>]*\bdisabled\b/);
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      id, disabled: id === 'live-toggle', value:'', textContent:'', innerHTML:'', open:false,
      dataset:{}, classList:{add(){},remove(){},toggle(){}}, listeners:{},
      addEventListener(type, fn) { this.listeners[type] = fn; },
      showModal(){this.open=true}, close(){this.open=false}, replaceChildren(){},
    });
    return elements.get(id);
  }
  let source;
  class FakeEvents {
    constructor() { source=this; this.listeners={}; }
    addEventListener(type, fn) { this.listeners[type]=fn; }
    status(value) { this.listeners.status({data:typeof value==='string'?value:JSON.stringify(value)}); }
    disconnect() { this.onerror(); }
  }
  const requests=[];
  let resolveRequest;
  const fetch = async (url, options) => {
    if (url === 'feed.json') return {ok:true,json:async()=>({contexts:[],videos:[],focusContext:'',contextSource:'Empty starter feed'})};
    if (url === '/api/live') {requests.push(JSON.parse(options.body));return new Promise(resolve=>{resolveRequest=resolve});}
    throw Error(`unexpected request ${url}`);
  };
  const context={window:{},document:{getElementById:element,querySelectorAll:()=>[],createElement:()=>element('new')},localStorage:{getItem:()=>null,setItem(){}},EventSource:FakeEvents,fetch,setTimeout,clearTimeout,URL,console};
  vm.runInNewContext(fs.readFileSync(path.join(root,'dist/app.js'),'utf8'),context);
  await tick();
  const toggle=element('live-toggle');
  assert.equal(toggle.disabled,true,'connecting must start disabled');
  await toggle.listeners.click();
  assert.equal(requests.length,0,'connecting must not enable Live');
  source.status({mode:'paused',enabled:false,message:'Paused'});
  assert.equal(toggle.disabled,false);
  const first=toggle.listeners.click();
  assert.deepEqual(requests,[{enabled:true}]);
  assert.equal(toggle.disabled,true,'pending request must disable the control');
  await toggle.listeners.click();
  assert.equal(requests.length,1,'rapid clicks must not send duplicate requests');
  source.status({mode:'listening',enabled:true,message:'Live'});
  assert.equal(toggle.disabled,true,'status arriving before the response must not permit overlapping requests');
  resolveRequest({ok:true}); await first;
  assert.equal(toggle.disabled,false);
  const second=toggle.listeners.click();
  assert.deepEqual(requests,[{enabled:true},{enabled:false}]);
  source.status({mode:'listening',enabled:true,message:'Stale status'});
  resolveRequest({ok:true}); await second;
  assert.equal(toggle.disabled,true,'a stale status must not authorize another action after a request');
  source.status({mode:'paused',enabled:false,message:'Paused'});
  assert.equal(toggle.disabled,false);
  source.disconnect();
  assert.equal(toggle.disabled,true);
  await toggle.listeners.click();
  assert.equal(requests.length,2,'disconnect must not be treated as consent to enable Live');
  source.status({mode:'paused',message:'Missing enabled'});
  assert.equal(toggle.disabled,true,'invalid status must not authorize a control action');
  source.status({mode:'paused',enabled:false,message:'Reconnected'});
  assert.equal(toggle.disabled,false,'a fresh status after reconnection restores the control');
});
