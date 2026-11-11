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
 let source;class FakeEvents{constructor(){source=this;this.listeners={}}addEventListener(type,fn){this.listeners[type]=fn}}
 const requests=[];
 const sandbox={window:{},document:{getElementById:el,querySelectorAll:()=>[],createElement:()=>el('new')},localStorage:{getItem:()=>null,setItem(){}},EventSource:FakeEvents,fetch:async(url,options)=>{if(url==='feed.json')return {ok:true,json:async()=>({contexts:[],videos:[],focusContext:'',contextSource:'Empty starter feed'})};requests.push({url,body:JSON.parse(options.body)});return {ok:true}},setTimeout,clearTimeout,URL,console};
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
});
