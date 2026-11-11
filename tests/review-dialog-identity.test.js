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
    constructor(){source=this;this.listeners={}}
    addEventListener(type,fn){this.listeners[type]=fn}
    status(value){this.listeners.status({data:JSON.stringify(value)})}
    close(){}
  }
  const requests=[];
  let rejectFirst;
  const fetch=async(url,options)=>{
    if(url==='feed.json')return {ok:true,json:async()=>({contexts:[],videos:[],focusContext:'',contextSource:'Empty starter feed'})};
    if(url==='/api/search-review'){
      requests.push(JSON.parse(options.body));
      if(requests.length===1)return new Promise((resolve,reject)=>{rejectFirst=reject});
      return {ok:true};
    }
    throw Error(`unexpected request ${url}`);
  };
  const context={window:{},document:{getElementById:element,querySelectorAll:()=>[],createElement:()=>element('new')},localStorage:{getItem:()=>null,setItem(){}},EventSource:FakeEvents,fetch,setTimeout,clearTimeout,AbortController,URL,console};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','dist','app.js'),'utf8'),context);
  await tick();
  const status=(id,query)=>source.status({mode:'awaiting-review',enabled:true,requestId:id,pendingQuery:query,message:'Review'});
  const dialog=element('search-review'), input=element('search-review-query'), error=element('search-review-error');
  status('first','first suggested topic');
  assert.equal(dialog.open,true);
  input.value='first edited topic';
  status('first','first suggested topic');
  assert.equal(input.value,'first edited topic','same request must preserve edits');
  const first=element('search-review-form').listeners.submit({preventDefault(){}});
  assert.equal(requests[0].requestId,'first');
  element('search-review-form').listeners.submit({preventDefault(){}});
  assert.equal(requests.length,1,'duplicate submissions for the same request must be ignored');
  status('second','second suggested topic');
  assert.equal(input.value,'second suggested topic','a new request must replace the old draft');
  assert.match(error.textContent,/new/i);
  rejectFirst(Error('first request failed'));
  await first; await tick();
  assert.doesNotMatch(error.textContent,/Could not process/,'an old response must not set an error for the new request');
  element('search-review-form').listeners.submit({preventDefault(){}});
  await tick();
  assert.equal(requests[1].requestId,'second');
  assert.equal(requests[1].query,'second suggested topic');
});
