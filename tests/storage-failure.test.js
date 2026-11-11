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

test('delete failure and post-deletion refresh failure are distinguished',async()=>{
  const failed=await setup();failed.allow();failed.failDelete();failed.el('edit-context').listeners.click();await failed.el('delete-context').listeners.click();
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
  const app=await setup();app.failAfterIntent();const {el}=app;el('edit-context').listeners.click();
  await el('delete-context').listeners.click();
  assert.match(el('toast').textContent,/browser.*(?:not|could not).*sav/i);
  assert.doesNotMatch(el('toast').textContent,/could not delete/i);
  assert.doesNotMatch(el('context-nav').innerHTML,/Project/);
});

test('a late deletion response never closes or labels a newer context draft',async()=>{
  for(const mode of ['success','failure','partial']){
    const app=await setup();if(mode==='partial')app.failAfterIntent();else app.allow();const release=app.holdDeletion();app.el('edit-context').listeners.click();
    const pending=app.el('delete-context').listeners.click();
    app.el('context-dialog').close();app.el('add-context').listeners.click();app.el('context-name').value='New draft';app.el('context-task').value='Still editing';
    if(mode==='failure')app.failDelete();release();await pending;
    assert.equal(app.el('context-dialog').open,true,'the new dialog must stay open');
    assert.equal(app.el('context-name').value,'New draft');assert.equal(app.el('context-task').value,'Still editing');
    assert.equal(app.el('context-error').textContent,'','old response must not label the new draft');
    app.el('context-dialog').close();
    if(mode==='failure')assert.match(app.el('toast').textContent,/could not confirm project deletion/i);
    else if(mode==='partial')assert.match(app.el('toast').textContent,/browser.*could not be saved/i);
    else assert.match(app.el('toast').textContent,/project.*deleted/i);
  }
});

test('a late deletion result preserves a reopened project or video dialog',async()=>{
  for(const kind of ['same-project','video']){
    const app=await setup();app.allow();const release=app.holdDeletion();app.el('edit-context').listeners.click();
    const pending=app.el('delete-context').listeners.click();app.el('context-dialog').close();
    if(kind==='same-project'){app.el('edit-context').listeners.click();app.el('context-name').value='Reopened draft'}
    else{app.el('add-video').listeners.click();app.el('video-title').value='Video draft'}
    release();await pending;
    const dialog=app.el(kind==='same-project'?'context-dialog':'video-dialog');
    assert.equal(dialog.open,true,'the newer dialog must stay open');
    assert.equal(app.el(kind==='same-project'?'context-name':'video-title').value,kind==='same-project'?'Reopened draft':'Video draft');
    dialog.close();assert.match(app.el('toast').textContent,/project.*deleted/i);
  }
});

test('same-project drafts cannot be falsely saved during or after deletion',async()=>{
  for(const mode of ['success','partial','uncertain']){
    const app=await setup();if(mode==='partial')app.failAfterIntent();else app.allow();const release=app.holdDeletion();app.el('edit-context').listeners.click();
    const pending=app.el('delete-context').listeners.click();app.el('context-dialog').close();app.el('edit-context').listeners.click();
    app.el('context-name').value='Reopened draft';app.el('context-task').value='Still editing';
    await app.el('context-form').listeners.submit(submit);
    assert.match(app.el('context-error').textContent,/deletion.*progress/i);assert.equal(app.el('context-dialog').open,true);
    app.el('delete-context').listeners.click();assert.equal(app.deleteCalls(),1,'the same project must not send duplicate deletes');
    if(mode==='uncertain')app.failDelete();release();await pending;
    assert.match(app.el('context-error').textContent,mode==='uncertain'?/could not confirm/i:/deleted/i);
    if(mode==='partial')assert.match(app.el('context-error').textContent,/browser changes could not be saved/i);
    assert.equal(app.el('context-dialog').open,true);assert.equal(app.el('context-name').value,'Reopened draft');
    await app.el('context-form').listeners.submit(submit);
    assert.equal(app.el('context-dialog').open,true,'unsafe save must leave draft open');
    assert.match(app.el('context-error').textContent,mode==='uncertain'?/could not confirm/i:/deleted/i);
    if(mode==='partial')assert.match(app.el('context-error').textContent,/browser changes could not be saved/i,'partial deletion warning must survive a blocked save');
    assert.doesNotMatch(app.el('toast').textContent,/context saved/i);
  }
});

test('a hung deletion times out into uncertainty without claiming it was canceled',async()=>{
  const app=await setup({fakeTimers:true});app.allow();app.holdDeletion();app.el('edit-context').listeners.click();
  const pending=app.el('delete-context').listeners.click();app.el('context-name').value='Preserved draft';
  const deadline=[...app.timers.values()].find(timer=>timer.ms===10000);assert.ok(deadline,'deletion request must be bounded');
  deadline.fn();await pending;
  assert.equal(app.el('context-dialog').open,true);assert.equal(app.el('context-name').value,'Preserved draft');
  assert.match(app.el('context-error').textContent,/could not confirm.*reload/i);
  await app.el('context-form').listeners.submit(submit);
  assert.equal(app.el('context-dialog').open,true);assert.match(app.el('context-error').textContent,/could not confirm/i);
  assert.doesNotMatch(app.el('context-error').textContent,/canceled|cancelled/i);
  assert.equal([...app.timers.values()].filter(timer=>timer.ms===10000).length,0,'request timer must be cleared');
});

test('video draft cannot be saved to a pending, deleted, uncertain or unavailable project',async()=>{
  for(const mode of ['success','uncertain']){
    const app=await setup({extraProject:true});app.allow();const release=app.holdDeletion();
    app.el('edit-context').listeners.click();const pending=app.el('delete-context').listeners.click();app.el('context-dialog').close();
    app.el('add-video').listeners.click();app.el('video-url').value='https://youtu.be/xyz123abc45';app.el('video-title').value='Preserved video draft';app.el('video-context').value='project';
    await app.el('video-form').listeners.submit(submit);
    assert.equal(app.el('video-dialog').open,true);assert.match(app.el('video-error').textContent,/deletion.*progress/i);assert.deepEqual(app.saved().customVideos,[]);
    if(mode==='uncertain')app.failDelete();release();await pending;
    await app.el('video-form').listeners.submit(submit);
    assert.equal(app.el('video-dialog').open,true);assert.equal(app.el('video-title').value,'Preserved video draft');
    assert.match(app.el('video-error').textContent,mode==='uncertain'?/could not confirm/i:/deleted|unavailable/i);assert.deepEqual(app.saved().customVideos,[]);
    app.el('video-context').value='missing';await app.el('video-form').listeners.submit(submit);
    assert.equal(app.el('video-dialog').open,true);assert.match(app.el('video-error').textContent,/unavailable/i);assert.deepEqual(app.saved().customVideos,[]);
    app.el('video-context').value='other';await app.el('video-form').listeners.submit(submit);
    if(mode==='uncertain'){assert.equal(app.el('video-dialog').open,true);assert.match(app.el('video-error').textContent,/deletion is unresolved/i);assert.deepEqual(app.saved().customVideos,[])}
    else{assert.equal(app.el('video-dialog').open,false);assert.equal(app.saved().customVideos[0].context,'other');assert.equal(app.saved().customVideos[0].title,'Preserved video draft')}
  }
});

test('a failed video save can retry the same open draft',async()=>{
  const app=await setup(),el=app.el;el('add-video').listeners.click();
  el('video-url').value='https://youtu.be/xyz123abc45';el('video-title').value='Original draft';el('video-context').value='project';
  await el('video-form').listeners.submit(submit);assert.equal(el('video-dialog').open,true);assert.match(el('video-error').textContent,/could not save/i);
  app.allow();await el('video-form').listeners.submit(submit);
  assert.equal(el('video-dialog').open,false);assert.equal(app.saved().customVideos[0].title,'Original draft');
});


test('manual video associations are scoped to projects and hidden details require confirmation to replace',async()=>{
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
  assert.equal(el('video-dialog').open,false);assert.equal(app.saved().customVideos.length,1);assert.equal(app.saved().customVideos[0].reason,'Replacement reason');assert.deepEqual(app.saved().hiddenVideos,[]);assert.match(el('grid').innerHTML,/Replacement title/);
  el('context-nav').listeners.click(click('[data-context]','project'));assert.match(el('grid').innerHTML,/Existing video/);
});
