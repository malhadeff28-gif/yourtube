'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setImmediate: tick } = require('node:timers/promises');

// Exercise the real frontend with a minimal local DOM and EventSource; no network or chats.
test('Live control uses fresh status and recovers after errors and timeouts', async () => {
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
    constructor() { source=this; this.listeners={}; this.closed=false; }
    addEventListener(type, fn) { this.listeners[type]=fn; }
    status(value) { this.listeners.status({data:typeof value==='string'?value:JSON.stringify(value)}); }
    disconnect() { this.onerror(); }
    close() { this.closed=true; }
  }
  const requests=[];
  let resolveRequest, rejectRequest;
  const fetch = async (url, options) => {
    if (url === 'feed.json') return {ok:true,json:async()=>({contexts:[],videos:[],focusContext:'',contextSource:'Empty starter feed'})};
    if (url === '/api/live') {requests.push(JSON.parse(options.body));return new Promise((resolve,reject)=>{resolveRequest=resolve;rejectRequest=reject;options.signal.addEventListener('abort',()=>reject(Error('aborted')));});}
    throw Error(`unexpected request ${url}`);
  };
  let timerId=0; const timers=new Map();
  const fakeSetTimeout=(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;};
  const context={window:{},document:{getElementById:element,querySelectorAll:()=>[],createElement:()=>element('new')},localStorage:{getItem:()=>null,setItem(){}},EventSource:FakeEvents,fetch,setTimeout:fakeSetTimeout,clearTimeout:id=>timers.delete(id),AbortController,URL,console};
  vm.runInNewContext(fs.readFileSync(path.join(root,'dist/app.js'),'utf8'),context);
  await tick();
  const toggle=element('live-toggle');
  assert.equal(toggle.disabled,true,'connecting must start disabled');
  await toggle.listeners.click();
  assert.equal(requests.length,0,'connecting must not enable Live');
  source.status({mode:'paused',enabled:false,message:'Paused'});
  assert.equal(toggle.disabled,false);
  const first=toggle.listeners.click();
  assert.deepEqual(requests,[{enabled:true,expectedEnabled:false}]);
  assert.equal(toggle.disabled,true);
  await toggle.listeners.click();
  assert.equal(requests.length,1,'rapid clicks must not send duplicate requests');
  const oldSource=source;
  source.status({mode:'listening',enabled:true,message:'Live'});
  assert.equal(toggle.disabled,true,'pending POST must keep the control disabled');
  resolveRequest({ok:true}); await first;
  assert.equal(oldSource.closed,true,'a toggle reconnects for fresh status');
  oldSource.status({mode:'paused',enabled:false,message:'Late old status'});
  assert.equal(toggle.disabled,true,'an old connection must not unlock the control');
  source.status({mode:'listening',enabled:true,message:'Live'});
  assert.equal(toggle.disabled,false);
  const failed=toggle.listeners.click();
  assert.deepEqual(requests[1],{enabled:false,expectedEnabled:true});
  rejectRequest(Error('network failed')); await failed;
  assert.equal(toggle.disabled,true);
  source.status({mode:'listening',enabled:true,message:'Reconnected'});
  assert.equal(toggle.disabled,false,'a failed request must recover after a fresh status');
  const timedOut=toggle.listeners.click();
  const deadline=[...timers.values()].find(timer=>timer.ms===10000);
  assert.ok(deadline,'request must have a bounded timeout');
  deadline.fn(); await timedOut;
  assert.equal(toggle.disabled,true);
  source.status({mode:'paused',enabled:false,message:'Reconnected'});
  assert.equal(toggle.disabled,false,'a timed-out request must recover after a fresh status');
  source.disconnect();
  await toggle.listeners.click();
  assert.equal(requests.length,3,'disconnect must not be treated as consent to enable Live');
  source.status({mode:'paused',message:'Missing enabled'});
  assert.equal(toggle.disabled,true);
  source.status({mode:'paused',enabled:false,message:'Reconnected'});
  assert.equal(toggle.disabled,false);
});
