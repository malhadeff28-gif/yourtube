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
  let feed={...seed,contexts:[{...seed.contexts[0],name:'Before live update'},seed.contexts[1]],videos:[]},source;
  class FakeEvents {constructor(){source=this;this.listeners={}} addEventListener(type,fn){this.listeners[type]=fn} close(){}}
  const context={window:{},document:{getElementById:element,querySelectorAll:()=>[],createElement:()=>element('new')},localStorage:{getItem:()=>saved,setItem:(_key,value)=>{saved=value}},EventSource:FakeEvents,fetch:async()=>({ok:true,json:async()=>feed}),setTimeout,clearTimeout,AbortController,URL,console};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','dist','app.js'),'utf8'),context);
  await tick();
  const grid=()=>element('grid').innerHTML;
  const cardCount=()=>[...grid().matchAll(/<article class="card">/g)].length;
  const waitFor = async (check, message) => { for(let i=0;i<100;i++){if(check())return;await tick()}throw Error(message) };
  assert.equal(cardCount(),1,'the manually added video starts visible');
  feed=seed;
  source.listeners.feed();
  await waitFor(()=>element('context-nav').innerHTML.includes('Live project'),'the live update was not rendered');
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
  feed={...seed,contexts:[{...seed.contexts[0],name:'Updated live project'},seed.contexts[1]],videos:[{...seed.videos[0],context:'manual',title:'Live title in same project'}]};
  source.listeners.feed();
  await waitFor(()=>element('context-nav').innerHTML.includes('Updated live project'),'the same-project update was not rendered');
  assert.equal(cardCount(),1,'a collision within one project must also show one card');
  assert.match(grid(),/My manual title/,'manual details take precedence for the same project');
  assert.match(grid(),/My own notes/);
  assert.equal(JSON.parse(saved).customVideos[0].reason,'My own notes','deduplication must not alter stored manual data');
});

test('two Live associations retain project-specific reasons and one overall card', async () => {
  const elements=new Map();
  function element(id){if(!elements.has(id))elements.set(id,{id,disabled:false,value:'',textContent:'',innerHTML:'',open:false,dataset:{},classList:{add(){},remove(){},toggle(){}},listeners:{},addEventListener(type,fn){this.listeners[type]=fn},showModal(){this.open=true},close(){this.open=false},replaceChildren(){}});return elements.get(id)}
  const feed={contexts:[{id:'a',name:'Project A',task:'Work A'},{id:'b',name:'Project B',task:'Work B'}],videos:[{id:'abc123def45',context:'a',title:'Video',channel:'Channel',reason:'Reason for A',source:'Live'},{id:'abc123def45',context:'b',title:'Video',channel:'Channel',reason:'Reason for B',source:'Live'}],focusContext:'',contextSource:'Synthetic'};
  class FakeEvents{addEventListener(){} close(){}}
  const context={window:{},document:{getElementById:element,querySelectorAll:()=>[],createElement:()=>element('new')},localStorage:{getItem:()=>JSON.stringify({saved:['abc123def45']}),setItem(){}},EventSource:FakeEvents,fetch:async()=>({ok:true,json:async()=>feed}),setTimeout,clearTimeout,AbortController,URL,console};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','dist','app.js'),'utf8'),context);
  await tick();
  const grid=()=>element('grid').innerHTML;
  const cardCount=()=>[...grid().matchAll(/<article class="card">/g)].length;
  assert.equal(cardCount(),1,'all-project view must show one card');
  const choose=id=>element('context-nav').listeners.click({target:{closest:()=>({dataset:{context:id}})}});
  choose('a');assert.equal(cardCount(),1);assert.match(grid(),/Reason for A/);assert.doesNotMatch(grid(),/Reason for B/);
  choose('b');assert.equal(cardCount(),1);assert.match(grid(),/Reason for B/);assert.doesNotMatch(grid(),/Reason for A/);
  element('filters').listeners.click({target:{closest:selector=>selector==='[data-view]'?{}:null}});
  assert.equal(element('feed-title').textContent,'Your watch later list');
  assert.equal(cardCount(),1,'watch later must show one card for the shared ID');
});
