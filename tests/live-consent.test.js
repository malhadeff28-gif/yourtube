'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {setImmediate:tick}=require('node:timers/promises');

test('enabling Live requires an explicit review and confirmation', async()=>{
 const elements=new Map();
 function el(id){if(!elements.has(id))elements.set(id,{id,disabled:false,open:false,value:'',textContent:'',innerHTML:'',dataset:{},listeners:{},classList:{add(){},remove(){},toggle(){}},addEventListener(type,fn){this.listeners[type]=fn},showModal(){this.open=true},close(){this.open=false},replaceChildren(){}});return elements.get(id)}
 let source;class FakeEvents{constructor(){source=this;this.listeners={}}addEventListener(type,fn){this.listeners[type]=fn}close(){}}
 const requests=[];
 const sandbox={window:{},document:{getElementById:el,querySelectorAll:()=>[],createElement:()=>el('new')},localStorage:{getItem:()=>null,setItem(){}},EventSource:FakeEvents,AbortController,fetch:async(url,options)=>{if(url==='feed.json')return {ok:true,json:async()=>({contexts:[],videos:[],focusContext:'',contextSource:'Empty starter feed'})};requests.push({url,body:JSON.parse(options.body)});return {ok:true}},setTimeout,clearTimeout,URL,console};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','dist','app.js'),'utf8'),sandbox);
 await tick();
 const click=id=>el(id).listeners.click();
 const submit=()=>el('live-consent-form').listeners.submit({preventDefault(){}});
 const status=enabled=>source.listeners.status({data:JSON.stringify({mode:enabled?'listening':'paused',enabled,message:'Synthetic status'})});
 click('live-toggle');assert.equal(el('live-consent').open,false,'unknown state must not enable');
 status(false);click('live-toggle');assert.equal(el('live-consent').open,true);assert.equal(requests.length,0);
 click('live-consent-cancel');submit();assert.equal(requests.length,0,'cancel must not enable');
 click('live-toggle');el('live-consent').close();submit();assert.equal(requests.length,0,'Escape/dismissal must not enable');
 click('live-toggle');status(true);assert.equal(el('live-consent').open,false,'external state change dismisses stale consent');submit();assert.equal(requests.length,0);
 status(false);click('live-toggle');source.onerror();submit();assert.equal(requests.length,0,'disconnect invalidates consent');
 status(false);click('live-toggle');submit();submit();await tick();assert.equal(requests.length,1);assert.equal(requests[0].url,'/api/live');assert.equal(requests[0].body.enabled,true);
 status(true);click('live-toggle');await tick();assert.equal(requests.length,2);assert.equal(requests[1].body.enabled,false,'pausing needs no confirmation');
 const html=fs.readFileSync(path.join(__dirname,'..','dist','index.html'),'utf8');
 assert.match(html,/Redaction can miss sensitive details; project IDs are sent unchanged/);
 assert.match(html,/Browser-only project edits are not included/);
 assert.match(html,/already been sent to Codex/);
 const consent=html.match(/<dialog id="live-consent"[\s\S]*?<\/dialog>/)[0];
 const info=html.match(/<dialog id="info-dialog"[\s\S]*?<\/dialog>/)[0];
 assert.match(consent,/aria-describedby="live-consent-data live-consent-limits live-consent-search"/);
 for(const id of ['live-consent-data','live-consent-limits','live-consent-search']) assert.match(consent,new RegExp(`id="${id}"`));
 assert.match(consent,/Live may miss the first message in a newly discovered chat/);
 assert.match(consent,/including messages sent while paused, may be read after Live is enabled/);
 assert.match(info,/including text written while paused, to be read after Live is enabled/);
});

test('a hung enable request times out and a fresh status permits pause', async()=>{
 const elements=new Map();
 function el(id){if(!elements.has(id))elements.set(id,{id,disabled:false,open:false,value:'',textContent:'',innerHTML:'',dataset:{},listeners:{},classList:{add(){},remove(){},toggle(){}},addEventListener(type,fn){this.listeners[type]=fn},showModal(){this.open=true},close(){this.open=false},replaceChildren(){}});return elements.get(id)}
 let source;class FakeEvents{constructor(){source=this;this.listeners={}}addEventListener(type,fn){this.listeners[type]=fn}close(){}}
 let timeout;const requests=[];
 const sandbox={window:{},document:{getElementById:el,querySelectorAll:()=>[],createElement:()=>el('new')},localStorage:{getItem:()=>null,setItem(){}},EventSource:FakeEvents,AbortController,fetch:async(url,options)=>{if(url==='feed.json')return {ok:true,json:async()=>({contexts:[],videos:[],focusContext:'',contextSource:'Empty starter feed'})};const body=JSON.parse(options.body);requests.push(body);if(body.enabled)return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted'))));return {ok:true}},setTimeout:(fn,ms)=>{if(ms===10000){timeout=fn;return 1}return 2},clearTimeout(){},URL,console};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','dist','app.js'),'utf8'),sandbox);await tick();
 const status=(eventSource,enabled)=>eventSource.listeners.status({data:JSON.stringify({mode:enabled?'listening':'paused',enabled,message:'Synthetic status'})});
 const click=id=>el(id).listeners.click();
 status(source,false);click('live-toggle');el('live-consent-form').listeners.submit({preventDefault(){}});assert.equal(requests.length,1);assert.equal(requests[0].expectedEnabled,false);
 const oldSource=source;status(oldSource,true);click('live-toggle');assert.equal(requests.length,1,'do not issue a concurrent toggle while the enable result is unknown');
 timeout();await tick();assert.notEqual(source,oldSource,'a timeout must reconnect to get fresh authoritative status');
 status(oldSource,false);click('live-toggle');assert.equal(requests.length,1,'old event source must not restore control');
 status(source,true);click('live-toggle');await tick();assert.equal(requests.length,2);assert.equal(requests[1].enabled,false);assert.equal(requests[1].expectedEnabled,true);
});
