'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {setImmediate:tick}=require('node:timers/promises');

test('local note search respects each video-project association and existing filters',async()=>{
 const elements=new Map(),requests=[];
 const nav=['all','saved','watched'].map(view=>({dataset:{view},classList:{toggle(){}},setAttribute(){},addEventListener(){}}));
 function el(id){if(!elements.has(id))elements.set(id,{id,value:'',textContent:'',innerHTML:'',open:false,dataset:{},classList:{add(){},remove(){},toggle(){}},listeners:{},addEventListener(type,fn){this.listeners[type]=fn},showModal(){this.open=true},close(){this.open=false},replaceChildren(){},querySelectorAll(){return []},contains(){return false}});return elements.get(id)}
 class Events{addEventListener(){} close(){}}
 const feed={contexts:[{id:'a',name:'Alpha',task:'Synthetic'},{id:'b',name:'Beta',task:'Synthetic'}],videos:[{id:'testVideo01',context:'a',title:'Shared Alpha',channel:'Sample',reason:'Synthetic'},{id:'testVideo01',context:'b',title:'Shared Beta',channel:'Sample',reason:'Synthetic'},{id:'testVideo02',context:'b',title:'Saved Beta',channel:'Sample',reason:'Synthetic'},{id:'testVideo03',context:'b',title:'Removed Beta',channel:'Sample',reason:'Synthetic'},{id:'testVideo04',context:'b',title:'Hidden globally',channel:'Sample',reason:'Synthetic'}],focusContext:'all',contextSource:'Synthetic'};
 const state={saved:['testVideo01'],watched:['testVideo02'],hiddenVideos:['testVideo04'],projectHiddenVideos:[{id:'testVideo03',context:'b'}],customVideos:[{id:'testVideo01',context:'b',title:'Shared Beta Alpha unique',channel:'Sample',reason:'Synthetic'}],videoNotes:[{id:'testVideo01',context:'a',text:'Alpha unique'}, {id:'testVideo01',context:'b',text:'Private <BETA> phrase'}, {id:'testVideo02',context:'b',text:'Private <BETA> phrase'}, {id:'testVideo03',context:'b',text:'Private <BETA> phrase'}, {id:'testVideo04',context:'b',text:'Private <BETA> phrase'}]};
 const context={window:{},document:{activeElement:null,getElementById:el,querySelectorAll:s=>s==='.nav'?nav:[],querySelector:()=>null,createElement:()=>({})},localStorage:{getItem:()=>JSON.stringify(state),setItem(){throw Error('search must not write')}},navigator:{locks:{request:async(_k,_o,fn)=>fn({})}},EventSource:Events,fetch:async url=>{requests.push(url);return {ok:true,json:async()=>feed}},setTimeout,clearTimeout,AbortController,URL,console};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/app.js'),'utf8'),context);await tick();
 const click=(key,id)=>el('filters').listeners.click({target:{closest:s=>s===`[data-${key}]`?{dataset:{[key]:id}}:null}});
 const search=value=>{el('search').value=value;el('search').listeners.input()};
 const grid=()=>el('grid').innerHTML;
 search('alpha unique');assert.match(grid(),/Shared Alpha/,'a matching note wins over another project’s matching manual metadata');assert.doesNotMatch(grid(),/Shared Beta/);
 search('  PRIVATE <beta>  ');
 assert.match(grid(),/Shared Beta/,'match the note of the Beta association before collapsing shared IDs');
 assert.doesNotMatch(grid(),/Shared Alpha|Removed Beta|Hidden globally|Private/,'do not expose notes or removed videos');
 assert.match(grid(),/Saved Beta/);
 click('context','a');assert.doesNotMatch(grid(),/Shared Alpha|Shared Beta|Saved Beta/,'a note from Beta cannot match Alpha');
 click('context','b');click('view','saved');assert.match(grid(),/Shared Beta/);assert.doesNotMatch(grid(),/Saved Beta/);
 click('view','watched');assert.match(grid(),/Saved Beta/);assert.doesNotMatch(grid(),/Shared Beta/);
 click('view','all');search('CHANNEL THAT DOES NOT EXIST');assert.doesNotMatch(grid(),/Shared Beta|Saved Beta/);
 search('sample');assert.match(grid(),/Shared Beta/,'metadata search still works');
 search('  ');assert.match(grid(),/Shared Beta/);assert.match(grid(),/Saved Beta/);assert.doesNotMatch(grid(),/Removed Beta|Hidden globally/);
 assert.deepEqual(requests,['feed.json'],'search and local notes were never sent to a service');
});
