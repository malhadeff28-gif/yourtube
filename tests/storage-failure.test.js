'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setImmediate: tick } = require('node:timers/promises');

async function setup() {
  const elements = new Map();
  function el(id){if(!elements.has(id))elements.set(id,{id,disabled:false,value:'',textContent:'',innerHTML:'',open:false,dataset:{},classList:{add(){},remove(){},toggle(){}},listeners:{},addEventListener(k,f){this.listeners[k]=f},showModal(){this.open=true},close(){this.open=false},replaceChildren(){},reset(){}});return elements.get(id)}
  let state=JSON.stringify({customVideos:[],customContexts:[],contextEdits:{},deletedContexts:[],hiddenVideos:[],saved:[]}), fail=true, deleteFail=false, refreshFail=false, initialLoaded=false;
  let feed={contexts:[{id:'project',name:'Project',task:'Task'}],videos:[{id:'abc123def45',context:'project',title:'Existing video',channel:'Sample',reason:'Example',source:'Fixture'}],focusContext:'project',contextSource:'Fixture'};
  class FakeEvents{constructor(){this.listeners={}}addEventListener(k,f){this.listeners[k]=f}close(){}}
  const context={window:{},document:{getElementById:el,querySelectorAll:()=>[],createElement:()=>el('created')},localStorage:{getItem:()=>state,setItem:(_k,v)=>{if(fail)throw Error('quota exceeded');state=v}},EventSource:FakeEvents,fetch:async(url)=>{if(url==='/api/context/delete'){if(deleteFail)return {ok:false};feed={...feed,contexts:[],videos:[]};return {ok:true}}if(refreshFail&&initialLoaded)return {ok:false};initialLoaded=true;return {ok:true,json:async()=>feed}},setTimeout,clearTimeout,AbortController,URL,console,crypto:{randomUUID:()=> 'new-project'},confirm:()=>true};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','dist','app.js'),'utf8'),context);await tick();
  return {el,saved:()=>JSON.parse(state),allow:()=>{fail=false},failDelete:()=>{deleteFail=true},failRefresh:()=>{refreshFail=true}};
}
const submit={preventDefault(){}};
const click=(selector,id)=>({target:{closest:s=>s===selector?{dataset:{[selector.slice(6,-1)]:id}}:null}});

test('failed browser writes keep context and video drafts open without mutating the feed',async()=>{
  const {el,saved,allow}=await setup();
  el('add-context').listeners.click();el('context-name').value='My draft';el('context-task').value='My work';
  el('context-form').listeners.submit(submit);
  assert.equal(el('context-dialog').open,true,'failed context save must retain its dialog');
  assert.equal(el('context-name').value,'My draft');assert.match(el('context-error').textContent,/could not save/i);
  assert.doesNotMatch(el('context-nav').innerHTML,/My draft/);assert.deepEqual(saved().customContexts,[]);
  allow();el('context-form').listeners.submit(submit);assert.equal(el('context-dialog').open,false);assert.equal(el('context-error').textContent,'');assert.match(el('context-nav').innerHTML,/My draft/);
});

test('failed video and list writes do not produce success or volatile state changes',async()=>{
  const {el,saved,allow}=await setup();
  el('add-video').listeners.click();el('video-url').value='https://youtu.be/xyz123abc45';el('video-title').value='A draft video';el('video-context').value='project';
  el('video-form').listeners.submit(submit);
  assert.equal(el('video-dialog').open,true);assert.equal(el('video-title').value,'A draft video');assert.match(el('video-error').textContent,/could not save/i);assert.doesNotMatch(el('grid').innerHTML,/A draft video/);assert.deepEqual(saved().customVideos,[]);
  el('grid').listeners.click(click('[data-save]','abc123def45'));assert.match(el('toast').textContent,/could not save/i);assert.doesNotMatch(el('grid').innerHTML,/aria-pressed="true"/);assert.deepEqual(saved().saved,[]);
  el('grid').listeners.click(click('[data-hide]','abc123def45'));assert.match(el('toast').textContent,/could not save/i);assert.match(el('grid').innerHTML,/Existing video/);assert.deepEqual(saved().hiddenVideos,[]);
  allow();el('video-form').listeners.submit(submit);assert.equal(el('video-dialog').open,false);assert.equal(el('video-error').textContent,'');assert.match(el('grid').innerHTML,/A draft video/);assert.equal(saved().customVideos.length,1);
  el('grid').listeners.click(click('[data-save]','abc123def45'));assert.deepEqual(saved().saved,['abc123def45']);
  el('grid').listeners.click(click('[data-hide]','abc123def45'));assert.deepEqual(saved().hiddenVideos,['abc123def45']);assert.deepEqual(saved().saved,[]);
});

test('delete failure and post-deletion refresh failure are distinguished',async()=>{
  const failed=await setup();failed.failDelete();failed.el('edit-context').listeners.click();await failed.el('delete-context').listeners.click();
  assert.match(failed.el('context-error').textContent,/could not confirm project deletion/i);assert.equal(failed.el('context-dialog').open,true);assert.match(failed.el('context-nav').innerHTML,/Project/);
  const refresh=await setup();refresh.allow();refresh.failRefresh();refresh.el('edit-context').listeners.click();await refresh.el('delete-context').listeners.click();
  assert.match(refresh.el('toast').textContent,/deleted.*could not be refreshed/i);assert.doesNotMatch(refresh.el('context-nav').innerHTML,/Project/);
});

test('modal errors use alert regions inside each form',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','dist','index.html'),'utf8');
  assert.match(html,/<dialog id="context-dialog">[\s\S]*?<p id="context-error" role="alert"><\/p>[\s\S]*?<\/dialog>/);
  assert.match(html,/<dialog id="video-dialog">[\s\S]*?<p id="video-error" role="alert"><\/p>[\s\S]*?<\/dialog>/);
});

test('server deletion plus failed local write is reported as partial success',async()=>{
  const {el}=await setup();el('edit-context').listeners.click();
  await el('delete-context').listeners.click();
  assert.match(el('toast').textContent,/browser.*(?:not|could not).*sav/i);
  assert.doesNotMatch(el('toast').textContent,/could not delete/i);
  assert.doesNotMatch(el('context-nav').innerHTML,/Project/);
});
