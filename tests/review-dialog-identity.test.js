'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {setImmediate:tick}=require('node:timers/promises');

test('search review binds the displayed draft and responses to the request ID', async()=>{
  const elements=new Map();
  function element(id){
    if(!elements.has(id))elements.set(id,{id,disabled:false,value:'',textContent:'',innerHTML:'',open:false,dataset:{},classList:{add(){},remove(){},toggle(){}},listeners:{},addEventListener(type,fn){this.listeners[type]=fn},showModal(){this.open=true},close(){this.open=false},replaceChildren(){}});
    return elements.get(id);
  }
  let source;
  class FakeEvents{
    constructor(){source=this;this.listeners={};this.closed=false}
    addEventListener(type,fn){this.listeners[type]=fn}
    status(value){this.listeners.status({data:JSON.stringify(value)})}
    disconnect(){this.onerror()}
    close(){this.closed=true}
  }
  const requests=[];
  let rejectFirst;
  const fetch=async(url,options)=>{
    if(url==='feed.json')return {ok:true,json:async()=>({contexts:[],videos:[],focusContext:'',contextSource:'Empty starter feed'})};
    if(url==='/api/search-review'){
      requests.push(JSON.parse(options.body));
      if(requests.length===1)return new Promise((resolve,reject)=>{rejectFirst=reject});
      if(requests.length===2)return new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(Error('aborted')))});
      return {ok:true};
    }
    throw Error(`unexpected request ${url}`);
  };
  let timerId=0;const timers=new Map();
  const fakeSetTimeout=(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id};
  const context={window:{},document:{getElementById:element,querySelectorAll:()=>[],createElement:()=>element('new')},localStorage:{getItem:()=>null,setItem(){}},EventSource:FakeEvents,fetch,setTimeout:fakeSetTimeout,clearTimeout:id=>timers.delete(id),AbortController,URL,console};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','dist','app.js'),'utf8'),context);
  await tick();
  const status=(id,query)=>source.status({mode:'awaiting-review',enabled:true,requestId:id,pendingQuery:query,pendingProject:{id:'p',name:'Suggested project',task:'Suggested task'},projectOptions:[{id:'p',name:'Example project'}],message:'Review'});
  const dialog=element('search-review'), input=element('search-review-query'), error=element('search-review-error');
  status('first','first suggested topic');
  assert.equal(dialog.open,true);
  input.value='first edited topic';
  element('search-review-name').value='My reviewed project';element('search-review-task').value='My reviewed task';element('search-review-project').value='p';
  status('first','first suggested topic');
  assert.equal(input.value,'first edited topic','same request must preserve edits');
  assert.equal(element('search-review-name').value,'My reviewed project','same request must preserve project edits');
  const first=element('search-review-form').listeners.submit({preventDefault(){}});
  assert.equal(requests[0].requestId,'first');
  assert.equal(requests[0].projectId,'p');assert.equal(requests[0].projectName,'My reviewed project');assert.equal(requests[0].projectTask,'My reviewed task');
  element('search-review-form').listeners.submit({preventDefault(){}});
  assert.equal(requests.length,1,'duplicate submissions for the same request must be ignored');
  status('second','second suggested topic');
  assert.equal(input.value,'second suggested topic','a new request must replace the old draft');
  assert.equal(element('search-review-name').value,'Suggested project','a new review must reset the project draft');
  assert.match(error.textContent,/new/i);
  rejectFirst(Error('first request failed'));
  await first; await tick();
  assert.doesNotMatch(error.textContent,/Could not process/,'an old response must not set an error for the new request');
  element('search-review-form').listeners.submit({preventDefault(){}});
  await tick();
  assert.equal(requests[1].requestId,'second');
  assert.equal(requests[1].query,'second suggested topic');
  assert.equal(input.disabled,true,'the submitted phrase must not be editable while in flight');
  assert.equal(element('search-review-approve').disabled,true);
  assert.equal(element('search-review-cancel').textContent,'Dismiss locally');
  let prevented=false;
  dialog.listeners.cancel({preventDefault(){prevented=true}});
  assert.equal(prevented,true);
  assert.equal(dialog.open,false,'Escape must dismiss locally while a request is pending');
  assert.equal(requests.length,2,'local dismissal must not send a cancel request');
  assert.match(element('toast').textContent,/pending|processed/);
  status('second','second suggested topic');
  assert.equal(dialog.open,true,'a fresh status can reopen the pending review');
  assert.equal(input.disabled,true);
  const beforeReconnect=source;
  const deadline=[...timers.values()].find(timer=>timer.ms===10000);
  assert.ok(deadline,'a pending review request must have a bounded timeout');
  deadline.fn();await tick();
  assert.equal(beforeReconnect.closed,true,'a failed request must refresh status');
  assert.match(error.textContent,/may have been processed/);
  assert.equal(element('search-review-cancel').textContent,'Dismiss locally');
  element('search-review-cancel').listeners.click();
  assert.equal(requests.length,2,'do not retry before an authoritative status');
  assert.equal(dialog.open,false);
  status('second','second suggested topic');
  assert.equal(dialog.open,true);
  assert.equal(input.disabled,false);
  assert.equal(error.textContent,'','fresh status clears the prior connection warning');
  element('search-review-cancel').listeners.click();await tick();
  assert.equal(requests[2].requestId,'second');
  assert.equal(requests[2].action,'cancel');
  status('third','third suggested topic');
  source.disconnect();
  assert.equal(input.disabled,true);
  assert.equal(element('search-review-cancel').textContent,'Dismiss locally');
  assert.match(error.textContent,/pending|processed/);
  dialog.listeners.cancel({preventDefault(){}});
  assert.equal(dialog.open,false,'Escape must dismiss locally while offline');
  assert.equal(requests.length,3,'offline dismissal must not send a cancel request');
  status('third','third suggested topic');
  assert.equal(dialog.open,true,'pending review must reopen after reconnect');
  assert.equal(input.value,'third suggested topic');
  assert.equal(error.textContent,'','a reconnected pending review must not still say connection lost');
});
