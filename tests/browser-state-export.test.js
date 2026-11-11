'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {setImmediate:tick}=require('node:timers/promises');

async function setup(initial){
 const elements=new Map(),downloads=[],objects=new Map(),requests=[],writes=[],reads=[];
 let raw=initial,fail=false;
 function el(id){if(!elements.has(id))elements.set(id,{id,value:'',textContent:'',innerHTML:'',disabled:false,hidden:false,open:false,dataset:{},classList:{add(){},remove(){},toggle(){}},listeners:{},addEventListener(type,fn){this.listeners[type]=fn},showModal(){this.open=true},close(){this.open=false;this.listeners.close?.()},replaceChildren(){},contains(){return false},querySelectorAll(){return []}});return elements.get(id)}
 const document={activeElement:null,getElementById:el,querySelectorAll:()=>[],querySelector:()=>null,body:{appendChild(){}},createElement:()=>({click(){downloads.push({href:this.href,filename:this.download})},remove(){}})};
 class FakeURL extends URL{static createObjectURL(blob){const id='blob:synthetic-'+objects.size;objects.set(id,blob);return id}static revokeObjectURL(){}}
 class Events{addEventListener(){}close(){}}
 const storage={getItem(k){reads.push(k);if(k==='yourtube.state.v1'){if(fail)throw Error('synthetic');return raw}return null},setItem(...args){writes.push(args)}};
 const feed={contexts:[{id:'a',name:'Example',task:'Synthetic'}],videos:[],focusContext:'a',contextSource:'Synthetic'};
 const ctx={window:{},document,localStorage:storage,navigator:{locks:{request:async(_k,_o,fn)=>fn({})}},EventSource:Events,fetch:async url=>{requests.push(url);return {ok:true,json:async()=>feed}},setTimeout,clearTimeout,AbortController,URL:FakeURL,Blob,console};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/app.js'),'utf8'),ctx);await tick();
 return {el,downloads,objects,requests,writes,reads,change:v=>raw=v,fail:()=>fail=true};
}

test('explicit reveal exports an immutable exact opaque snapshot without network or writes',async()=>{
 const raw=JSON.stringify({contextEdits:{a:{name:'Synthetic private task'}},videoNotes:[{id:'abc123def45',context:'a',text:'Synthetic <img src=x onerror=alert(1)>\r\nline'}],__yourtubePendingDeletion:{id:'a',token:'synthetic-token'}})+'\r\nmalformed lone surrogate: \ud800';
 const a=await setup(raw);const baselineReads=a.reads.length;
 a.el('browser-state-export-open').listeners.click();assert.equal(a.el('browser-state-export-dialog').open,true);
 assert.equal(a.reads.length,baselineReads,'opening disclosure must not read the key');assert.equal(a.el('browser-state-export-preview').value,'');assert.equal(a.el('browser-state-export-download').disabled,true);assert.equal(a.downloads.length,0);
 a.el('browser-state-export-reveal').listeners.click();const preview=a.el('browser-state-export-preview').value;
 assert.equal(a.reads.length,baselineReads+1);assert.equal(a.reads.at(-1),'yourtube.state.v1');assert.equal(JSON.parse(preview).raw,raw);assert.equal(JSON.parse(preview).version,1);assert.equal(a.el('browser-state-export-preview').innerHTML,'');
 a.change('{"different":"new tab"}');a.el('browser-state-export-reveal').listeners.click();assert.equal(a.el('browser-state-export-preview').value,preview,'second reveal must not replace displayed snapshot');
 a.el('browser-state-export-download').listeners.click();assert.equal(a.downloads.length,1);assert.equal(await a.objects.get(a.downloads[0].href).text(),preview);assert.deepEqual(a.requests,['feed.json']);assert.deepEqual(a.writes,[]);
 a.el('browser-state-export-preview').value='changed';a.el('browser-state-export-download').listeners.click();assert.equal(a.downloads.length,1,'changed preview must not download different text');
 a.el('browser-state-export-dialog').close();assert.equal(a.el('browser-state-export-preview').value,'');a.el('browser-state-export-open').listeners.click();assert.equal(a.el('browser-state-export-preview').value,'');assert.equal(a.el('browser-state-export-download').disabled,true);
 a.el('browser-state-export-reveal').listeners.click();assert.equal(JSON.parse(a.el('browser-state-export-preview').value).raw,'{"different":"new tab"}');
});

test('missing, unreadable and oversized values fail explicitly without truncation',async()=>{
 for(const kind of ['missing','unreadable','oversized','escaped-oversized']){
  const a=await setup(kind==='missing'?null:'{}');if(kind==='unreadable')a.fail();if(kind==='oversized')a.change('x'.repeat(2*1024*1024+1));if(kind==='escaped-oversized')a.change('\\'.repeat(1024*1024+1));
  a.el('browser-state-export-open').listeners.click();a.el('browser-state-export-reveal').listeners.click();
  assert.equal(a.el('browser-state-export-preview').value,'');assert.equal(a.el('browser-state-export-download').disabled,true);assert.equal(a.downloads.length,0);assert.deepEqual(a.writes,[]);assert.deepEqual(a.requests,['feed.json']);
  assert.match(a.el('browser-state-export-status').textContent,kind==='missing'?/No browser data/:kind==='unreadable'?/could not be read/:/exceeds.*limit/);
 }
});

test('export disclosure precedes reveal and identifies private unencrypted scope',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../dist/index.html'),'utf8');assert.match(html,/private notes, removal records and any pending deletion token/i);assert.match(html,/unencrypted and may be sensitive/i);assert.match(html,/excludes the Live server feed, chats, other browser storage and unsaved drafts/i);assert.match(html,/id="browser-state-export-download" disabled/);
});
