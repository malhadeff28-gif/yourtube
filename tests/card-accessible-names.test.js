'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {setImmediate:tick}=require('node:timers/promises');

test('video action names identify the correct video and escape its title',async()=>{
 const elements=new Map();
 function element(id){if(!elements.has(id))elements.set(id,{id,innerHTML:'',value:'',textContent:'',disabled:false,open:false,dataset:{},listeners:{},classList:{add(){},remove(){},toggle(){}},addEventListener(type,fn){this.listeners[type]=fn},showModal(){this.open=true},close(){this.open=false},contains(){return false},querySelectorAll(){return []},replaceChildren(){}});return elements.get(id)}
 class Events{addEventListener(){} close(){}}
 const feed={contexts:[{id:'a',name:'Project',task:'Study'}],videos:[{id:'testVideo01',context:'a',title:'A & "quoted" <topic>',channel:'Example',reason:'Synthetic',source:'Test'},{id:'testVideo02',context:'a',title:'Second video',channel:'Example',reason:'Synthetic',source:'Test'}],focusContext:'a',contextSource:'Synthetic',updatedAt:'2026-01-01T00:00:00Z'};
 const context={window:{},document:{activeElement:null,getElementById:element,querySelectorAll:()=>[],querySelector:()=>null,createElement:()=>element('new')},localStorage:{getItem:()=>JSON.stringify({saved:['testVideo02']}),setItem(){}},navigator:{locks:{request:async(_key,_options,fn)=>fn({})}},EventSource:Events,fetch:async()=>({ok:true,json:async()=>feed}),setTimeout,clearTimeout,AbortController,URL,console};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','dist','app.js'),'utf8'),context);await tick();
 const html=element('grid').innerHTML;
 assert.match(html,/data-save="testVideo01" aria-label="Add to watch later: A &amp; &quot;quoted&quot; &lt;topic&gt;" aria-pressed="false"/);
 assert.match(html,/data-hide="testVideo01" aria-label="Remove from feed: A &amp; &quot;quoted&quot; &lt;topic&gt;"/);
 assert.match(html,/data-save="testVideo02" aria-label="Remove from watch later: Second video" aria-pressed="true"/);
 assert.match(html,/data-hide="testVideo02" aria-label="Remove from feed: Second video"/);
});
