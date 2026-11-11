'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setImmediate: tick } = require('node:timers/promises');

test('manual and live copies show once overall while remaining in their projects', async () => {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      id, disabled:false, value:'', textContent:'', innerHTML:'', open:false,
      dataset:{}, classList:{add(){},remove(){},toggle(){}}, listeners:{},
      addEventListener(type,fn){this.listeners[type]=fn},
      showModal(){this.open=true}, close(){this.open=false}, replaceChildren(){},
    });
    return elements.get(id);
  }
  const seed={contexts:[{id:'live',name:'Live project',task:'Live work'},{id:'manual',name:'My project',task:'My work'}],videos:[{id:'abc123def45',context:'live',title:'Live title',channel:'Live channel',reason:'Live reason',source:'Live'}],focusContext:'',contextSource:'Test'};
  const state={customVideos:[{id:'abc123def45',context:'manual',title:'My manual title',channel:'My channel',reason:'My own notes',source:'Added by you'}],saved:['abc123def45']};
  let saved=JSON.stringify(state);
  let feed={...seed,videos:[]},source;
  class FakeEvents {constructor(){source=this;this.listeners={}} addEventListener(type,fn){this.listeners[type]=fn} close(){}}
  const context={window:{},document:{getElementById:element,querySelectorAll:()=>[],createElement:()=>element('new')},localStorage:{getItem:()=>saved,setItem:(_key,value)=>{saved=value}},EventSource:FakeEvents,fetch:async()=>({ok:true,json:async()=>feed}),setTimeout,clearTimeout,AbortController,URL,console};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','dist','app.js'),'utf8'),context);
  await tick();
  const grid=()=>element('grid').innerHTML;
  const cardCount=()=>[...grid().matchAll(/<article class="card">/g)].length;
  assert.equal(cardCount(),1,'the manually added video starts visible');
  feed=seed;
  await source.listeners.feed();
  assert.equal(cardCount(),1,'one video must not produce duplicate cards in the all-projects view');
  assert.match(grid(),/My manual title/);
  assert.match(grid(),/My own notes/);
  element('search').value='Live title';
  element('search').listeners.input();
  assert.match(grid(),/Live title/);
  element('grid').listeners.click({target:{closest:selector=>selector==='[data-play]'?{dataset:{play:'abc123def45'}}:null}});
  assert.equal(element('player-title').textContent,'Live title','playback must use the displayed matching card');
  element('search').value='';
  element('search').listeners.input();
  const choose=id=>element('context-nav').listeners.click({target:{closest:()=>({dataset:{context:id}})}});
  choose('live');
  assert.equal(cardCount(),1);
  assert.match(grid(),/Live title/,'live association stays visible in the live project');
  choose('manual');
  assert.equal(cardCount(),1);
  assert.match(grid(),/My manual title/);
  assert.match(grid(),/My own notes/);
  assert.equal(JSON.parse(saved).customVideos[0].reason,'My own notes','manual metadata must never be deleted');
  feed={...seed,videos:[{...seed.videos[0],context:'manual',title:'Live title in same project'}]};
  await source.listeners.feed();
  assert.equal(cardCount(),1,'a collision within one project must also show one card');
  assert.match(grid(),/My manual title/,'manual details take precedence for the same project');
  assert.match(grid(),/My own notes/);
  assert.equal(JSON.parse(saved).customVideos[0].reason,'My own notes','deduplication must not alter stored manual data');
});
