'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {setImmediate:tick}=require('node:timers/promises');

async function setup(mode){
 const elements=new Map(),requests=[],reads=[],writes=[],downloads=[],objects=new Map(),timers=new Map();
 const raw='{"note":"synthetic <img src=x>\\r\\n\\ud800","__yourtubePendingDeletion":{"id":"a","token":"synthetic"}}';
 let serial=0,timerId=0,feedAttempt=0,source;
 const document={activeElement:null,body:{appendChild(){}},querySelector(){return null},querySelectorAll(selector){return selector==='[data-close]'?[el('browser-state-export-close'),el('browser-state-export-close-action')]:[]},getElementById:el,createElement(tag){
   if(tag==='a')return {click(){downloads.push(this.href)},remove(){}};
   return el(`created-${tag}-${++serial}`);
 }};
 function el(id){if(!elements.has(id)){
  const listeners={};const node={id,dataset:{},value:'',textContent:'',innerHTML:'',disabled:false,hidden:false,open:false,children:[],classList:{add(){},remove(){},toggle(){}},listeners,
   addEventListener(type,fn){(listeners[type]??=[]).push(fn)},fire(type,...args){return Promise.all((listeners[type]||[]).map(fn=>fn(...args)))},setAttribute(){},replaceChildren(...children){this.children=children},contains(){return false},querySelectorAll(){return []},focus(){document.activeElement=this},
   showModal(){this.returnFocus=document.activeElement;this.open=true;document.activeElement=el('browser-state-export-close')},close(){this.open=false;document.activeElement=this.returnFocus;for(const fn of listeners.close||[])fn()}};
  if(id==='browser-state-export-close'||id==='browser-state-export-close-action')node.dataset.close='browser-state-export-dialog';
  elements.set(id,node);
 }return elements.get(id)}
 class FakeURL extends URL{static createObjectURL(blob){const u='blob:synthetic-'+objects.size;objects.set(u,blob);return u}static revokeObjectURL(){}}
 class Events{constructor(){source=this;this.listeners={}}addEventListener(type,fn){this.listeners[type]=fn}close(){}}
 const fetch=async(url,opts={})=>{requests.push(url);if(url==='/api/live')return {ok:true,json:async()=>({enabled:false,mode:'paused'})};if(url!=='feed.json')throw Error('unexpected synthetic request');
  feedAttempt++;if(feedAttempt>=3)return {ok:true,json:async()=>({contexts:[],videos:[],contextSource:'Synthetic'})};
  if(mode==='rejected')throw Error('synthetic network failure');
  if(mode==='malformed')return {ok:true,json:async()=>{throw Error('invalid JSON')}};
  if(mode==='schema')return {ok:true,json:async()=>({contexts:[],videos:[null]})};
  return new Promise((_,reject)=>opts.signal.addEventListener('abort',()=>reject(Error('aborted'))));
 };
 const context={window:{},document,localStorage:{getItem(key){reads.push(key);return key==='yourtube.state.v1'?raw:null},setItem(...args){writes.push(args)}},navigator:{locks:{request:async(_k,_o,fn)=>fn({})}},EventSource:Events,fetch,setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id),AbortController,URL:FakeURL,Blob,console};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/app.js'),'utf8'),context);await tick();
 const timeout=async()=>{const deadline=[...timers.values()].find(t=>t.ms===10000);assert.ok(deadline);deadline.fn();await tick()};
 const fail=async()=>{if(mode==='timeout')await timeout();else await tick()};
 return {el,document,requests,reads,writes,downloads,objects,raw,source:()=>source,fail,timeout};
}

for(const mode of ['rejected','malformed','schema','timeout'])test(`browser state export remains usable through ${mode} feed failures and retries`,async()=>{
 const a=await setup(mode);
 // During a stalled first request, handlers exist without reading or revealing state.
 assert.equal(a.reads.length,0);
 if(mode==='timeout'){
  a.el('browser-state-export-open').focus();await a.el('browser-state-export-open').fire('click');
  assert.equal(a.reads.length,0);assert.equal(a.el('browser-state-export-dialog').open,true);
  await a.el('browser-state-export-close').fire('click');assert.equal(a.document.activeElement,a.el('browser-state-export-open'));
 }
 await a.fail();
 for(let attempt=0;attempt<3;attempt++){
  const baselineReads=a.reads.length, baselineDownloads=a.downloads.length, baselineRequests=a.requests.length;
  a.el('browser-state-export-open').focus();await a.el('browser-state-export-open').fire('click');
  assert.equal(a.el('browser-state-export-dialog').open,true);assert.equal(a.reads.length,baselineReads,'disclosure must not read data');
  assert.equal(a.el('browser-state-export-preview').value,'');assert.equal(a.el('browser-state-export-download').disabled,true);
  await a.el('browser-state-export-reveal').fire('click');assert.equal(a.reads.length,baselineReads+1,'reveal reads once');
  const preview=a.el('browser-state-export-preview').value;assert.equal(JSON.parse(preview).raw,a.raw);assert.equal(a.el('browser-state-export-preview').innerHTML,'');
  await a.el('browser-state-export-download').fire('click');assert.equal(a.downloads.length,baselineDownloads+1,'download must run once');assert.equal(await a.objects.get(a.downloads.at(-1)).text(),preview);
  assert.equal(a.requests.length,baselineRequests,'export itself must not fetch');assert.deepEqual(a.writes,[]);
  await a.el(attempt%2?'browser-state-export-close-action':'browser-state-export-close').fire('click');assert.equal(a.el('browser-state-export-dialog').open,false);assert.equal(a.el('browser-state-export-preview').value,'');assert.equal(a.document.activeElement,a.el('browser-state-export-open'));
  if(attempt===0){const pause=a.el('grid').children[2];await pause.fire('click');assert.equal(a.requests.at(-1),'/api/live','explicit startup Pause remains usable')}
  if(attempt<2){const retry=a.el('grid').children[1];await retry.fire('click');if(attempt===0)await a.fail();else await tick()}
 }
 assert.equal(a.requests.filter(x=>x==='feed.json').length,3);assert.ok(a.source(),'successful retry installs normal status');
 for(const id of ['browser-state-export-open','browser-state-export-reveal','browser-state-export-download','browser-state-export-close','browser-state-export-close-action'])assert.equal((a.el(id).listeners.click||[]).length,1,`${id} must be wired once`);
});
