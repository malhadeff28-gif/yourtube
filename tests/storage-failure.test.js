'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setImmediate: tick } = require('node:timers/promises');

async function setup({fakeTimers=false,extraProject=false}={}) {
  const elements = new Map();
  function el(id){if(!elements.has(id))elements.set(id,{id,disabled:false,value:'',textContent:'',innerHTML:'',open:false,dataset:{},classList:{add(){},remove(){},toggle(){}},listeners:{},addEventListener(k,f){this.listeners[k]=f},showModal(){this.open=true},close(){this.open=false;this.listeners.close?.()},replaceChildren(){},reset(){}});return elements.get(id)}
  let confirmResult=true;
  let state=JSON.stringify({customVideos:[],customContexts:[],contextEdits:{},deletedContexts:[],hiddenVideos:[],saved:[]}), fail=true, failOnCall=null, writeCalls=0, deleteFail=false, refreshFail=false, initialLoaded=false, deletionGate=null, deleteCount=0, timerId=0;
  const timers=new Map();
  const schedule=fakeTimers?(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id}:setTimeout;
  const unschedule=fakeTimers?id=>timers.delete(id):clearTimeout;
  let feed={contexts:[{id:'project',name:'Project',task:'Task'},...(extraProject?[{id:'other',name:'Other',task:'Other task'}]:[])],videos:[{id:'abc123def45',context:'project',title:'Existing video',channel:'Sample',reason:'Example',source:'Fixture'}],focusContext:'project',contextSource:'Fixture'};
  class FakeEvents{constructor(){this.listeners={}}addEventListener(k,f){this.listeners[k]=f}close(){}}
  const dialogIds=['context-dialog','video-dialog','player-dialog','info-dialog','live-consent','search-review'];
  const context={window:{},document:{getElementById:el,querySelector:selector=>selector==='dialog[open]'?dialogIds.map(el).find(d=>d.open)||null:null,querySelectorAll:selector=>selector==='dialog'?dialogIds.map(el):[],createElement:()=>el('created')},localStorage:{getItem:()=>state,setItem:(_k,v)=>{writeCalls++;if(fail||writeCalls===failOnCall)throw Error('quota exceeded');state=v}},navigator:{locks:{request:async(_key,_opts,fn)=>fn({})}},EventSource:FakeEvents,fetch:async(url,options={})=>{if(url==='/api/context/delete'){deleteCount++;if(deletionGate)await Promise.race([deletionGate,new Promise((_,reject)=>options.signal?.addEventListener('abort',()=>reject(Error('aborted'))))]);if(deleteFail)return {ok:false};const id=JSON.parse(options.body).id;feed={...feed,contexts:feed.contexts.filter(c=>c.id!==id),videos:feed.videos.filter(v=>v.context!==id)};return {ok:true}}if(refreshFail&&initialLoaded)return {ok:false};initialLoaded=true;return {ok:true,json:async()=>feed}},setTimeout:schedule,clearTimeout:unschedule,AbortController,URL,console,crypto:{randomUUID:()=> 'new-project'},confirm:()=>confirmResult};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','dist','app.js'),'utf8'),context);await tick();
  return {el,timers,setConfirm:value=>{confirmResult=value},saved:()=>JSON.parse(state),deleteCalls:()=>deleteCount,allow:()=>{fail=false},failAfterIntent:()=>{fail=false;failOnCall=writeCalls+2},failDelete:()=>{deleteFail=true},failRefresh:()=>{refreshFail=true},holdDeletion:()=>{let release;deletionGate=new Promise(resolve=>{release=resolve});return release}};
}
const submit={preventDefault(){}};
const click=(selector,id)=>({target:{closest:s=>s===selector?{dataset:{[selector.slice(6,-1)]:id}}:null}});

test('failed browser writes keep context and video drafts open without mutating the feed',async()=>{
  const {el,saved,allow}=await setup();
  el('add-context').listeners.click();el('context-name').value='My draft';el('context-task').value='My work';
  await el('context-form').listeners.submit(submit);
  assert.equal(el('context-dialog').open,true,'failed context save must retain its dialog');
  assert.equal(el('context-name').value,'My draft');assert.match(el('context-error').textContent,/could not save/i);
  assert.doesNotMatch(el('context-nav').innerHTML,/My draft/);assert.deepEqual(saved().customContexts,[]);
  allow();await el('context-form').listeners.submit(submit);assert.equal(el('context-dialog').open,false);assert.equal(el('context-error').textContent,'');assert.match(el('context-nav').innerHTML,/My draft/);
});

test('failed video and list writes do not produce success or volatile state changes',async()=>{
  const {el,saved,allow}=await setup();
  el('add-video').listeners.click();el('video-url').value='https://youtu.be/xyz123abc45';el('video-title').value='A draft video';el('video-context').value='project';
  await el('video-form').listeners.submit(submit);
  assert.equal(el('video-dialog').open,true);assert.equal(el('video-title').value,'A draft video');assert.match(el('video-error').textContent,/could not save/i);assert.doesNotMatch(el('grid').innerHTML,/A draft video/);assert.deepEqual(saved().customVideos,[]);
  // A native modal makes the card controls inaccessible until it is closed.
  el('video-dialog').close();
  await el('grid').listeners.click(click('[data-save]','abc123def45'));assert.match(el('toast').textContent,/could not save/i);assert.doesNotMatch(el('grid').innerHTML,/aria-pressed="true"/);assert.deepEqual(saved().saved,[]);
  await el('grid').listeners.click(click('[data-hide]','abc123def45'));assert.match(el('toast').textContent,/could not save/i);assert.match(el('grid').innerHTML,/Existing video/);assert.deepEqual(saved().hiddenVideos,[]);
  allow();el('add-video').listeners.click();el('video-url').value='https://youtu.be/xyz123abc45';el('video-title').value='A draft video';el('video-context').value='project';await el('video-form').listeners.submit(submit);assert.equal(el('video-dialog').open,false);assert.equal(el('video-error').textContent,'');assert.match(el('grid').innerHTML,/A draft video/);assert.equal(saved().customVideos.length,1);
  await el('grid').listeners.click(click('[data-save]','abc123def45'));assert.deepEqual(saved().saved,['abc123def45']);
  await el('grid').listeners.click(click('[data-hide]','abc123def45'));assert.deepEqual(saved().hiddenVideos,['abc123def45']);assert.deepEqual(saved().saved,[]);
});



test('modal errors use alert regions inside each form',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','dist','index.html'),'utf8');
  assert.match(html,/<dialog id="context-dialog"(?:\s[^>]*)?>(?:(?!<\/dialog>)[\s\S])*?<p id="context-error" role="alert"><\/p>(?:(?!<\/dialog>)[\s\S])*?<\/dialog>/);
  assert.match(html,/<dialog id="video-dialog"(?:\s[^>]*)?>(?:(?!<\/dialog>)[\s\S])*?<p id="video-error" role="alert"><\/p>(?:(?!<\/dialog>)[\s\S])*?<\/dialog>/);
});













test('a failed video save can retry the same open draft',async()=>{
  const app=await setup(),el=app.el;el('add-video').listeners.click();
  el('video-url').value='https://youtu.be/xyz123abc45';el('video-title').value='Original draft';el('video-context').value='project';
  await el('video-form').listeners.submit(submit);assert.equal(el('video-dialog').open,true);assert.match(el('video-error').textContent,/could not save/i);
  app.allow();await el('video-form').listeners.submit(submit);
  assert.equal(el('video-dialog').open,false);assert.equal(app.saved().customVideos[0].title,'Original draft');
});


test('manual video associations are scoped to projects and removed videos require explicit restoration',async()=>{
  const app=await setup({extraProject:true});app.allow();const {el}=app;
  const fill=(project,title,reason='')=>{el('add-video').listeners.click();el('video-url').value='https://youtu.be/abc123def45';el('video-context').value=project;el('video-title').value=title;el('video-reason').value=reason};
  fill('project','Duplicate');await el('video-form').listeners.submit(submit);
  assert.equal(el('video-dialog').open,true);assert.match(el('video-error').textContent,/already in this project/i);assert.equal(el('video-title').value,'Duplicate');assert.equal(app.saved().customVideos.length,0);el('video-dialog').close();
  fill('other','My other project title','My original reason');await el('video-form').listeners.submit(submit);
  assert.equal(el('video-dialog').open,false);assert.equal(app.saved().customVideos.length,1);assert.equal(app.saved().customVideos[0].context,'other');assert.match(el('grid').innerHTML,/My other project title/);
  el('context-nav').listeners.click(click('[data-context]','project'));assert.match(el('grid').innerHTML,/Existing video/);
  el('context-nav').listeners.click(click('[data-context]','other'));assert.match(el('grid').innerHTML,/My original reason/);
  fill('other','Duplicate again');await el('video-form').listeners.submit(submit);assert.match(el('video-error').textContent,/already in this project/i);assert.equal(el('video-dialog').open,true);el('video-dialog').close();
  await el('grid').listeners.click(click('[data-hide]','abc123def45'));assert.deepEqual(app.saved().hiddenVideos,['abc123def45']);
  fill('other','Replacement title','Replacement reason');app.setConfirm(false);await el('video-form').listeners.submit(submit);
  assert.equal(el('video-dialog').open,true);assert.equal(el('video-title').value,'Replacement title');assert.equal(app.saved().customVideos[0].reason,'My original reason');assert.deepEqual(app.saved().hiddenVideos,['abc123def45']);
  app.setConfirm(true);await el('video-form').listeners.submit(submit);
  assert.equal(el('video-dialog').open,true);assert.match(el('video-error').textContent,/Recently removed/i);assert.equal(app.saved().customVideos.length,1);assert.equal(app.saved().customVideos[0].reason,'My original reason');assert.deepEqual(app.saved().hiddenVideos,['abc123def45']);
  el('video-dialog').close();el('show-removed').listeners.click();await el('removed-list').listeners.click({target:{closest:s=>s==='[data-restore-video]'?{dataset:{restoreVideo:'abc123def45'},disabled:false,setAttribute(){},removeAttribute(){}}:null}});assert.deepEqual(app.saved().hiddenVideos,[]);assert.match(el('grid').innerHTML,/My other project title/);
  el('context-nav').listeners.click(click('[data-context]','project'));assert.match(el('grid').innerHTML,/Existing video/);
});

test('disabled deletion does not send requests or mutate a project, even when storage fails',async()=>{
 for(const writable of [false,true]){const app=await setup();if(writable)app.allow();app.el('edit-context').listeners.click();const original=app.saved();await app.el('delete-context').listeners.click();assert.equal(app.deleteCalls(),0);assert.deepEqual(app.saved(),original);assert.equal(app.el('context-dialog').open,true);assert.match(app.el('context-error').textContent,/temporarily unavailable/i)}
});
