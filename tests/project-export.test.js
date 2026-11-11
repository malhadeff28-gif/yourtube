'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {setImmediate:tick}=require('node:timers/promises');

test('project export previews only the chosen visible videos and downloads that snapshot locally',async()=>{
 const elements=new Map(),downloads=[],objects=new Map(),requests=[];
 function element(id){if(!elements.has(id))elements.set(id,{id,value:'',textContent:'',innerHTML:'',disabled:false,open:false,dataset:{},classList:{add(){},remove(){},toggle(){}},listeners:{},addEventListener(type,fn){this.listeners[type]=fn},showModal(){this.open=true},close(){this.open=false},replaceChildren(){},contains(){return false},querySelectorAll(){return []}});return elements.get(id)}
 const document={activeElement:null,getElementById:element,querySelectorAll:()=>[],querySelector:()=>null,body:{appendChild(){}},createElement:()=>({click(){downloads.push({href:this.href,filename:this.download})},remove(){}})};
 class FakeURL extends URL{static createObjectURL(blob){const id='blob:synthetic-'+objects.size;objects.set(id,blob);return id}static revokeObjectURL(){}}
 class Events{addEventListener(){}close(){}}
 const feed={contexts:[{id:'a',name:'Project A',task:'PRIVATE TASK',note:'PRIVATE NOTE'},{id:'b',name:'Project B',task:'Other task'}],videos:[{id:'abc123def45',context:'a',title:'Visible video',channel:'Channel A',reason:'PRIVATE REASON',source:'Fixture'},{id:'hid123def45',context:'a',title:'Hidden video',channel:'Hidden channel',reason:'Example',source:'Fixture'},{id:'prj123abc45',context:'a',title:'Project hidden video',channel:'Hidden channel',reason:'Example',source:'Fixture'},{id:'prj123abc45',context:'b',title:'Visible in B',channel:'Hidden channel',reason:'Example',source:'Fixture'},{id:'xyz123abc45',context:'b',title:'Other project video',channel:'Channel B',reason:'Example',source:'Fixture'},{id:'not-valid',context:'a',title:'Invalid video',channel:'Example',reason:'Example',source:'Fixture'}],focusContext:'a',contextSource:'Synthetic'};
 const ctx={window:{},document,localStorage:{getItem:()=>JSON.stringify({hiddenVideos:['hid123def45'],projectHiddenVideos:[{id:'prj123abc45',context:'a'}]}),setItem(){}},navigator:{locks:{request:async(_k,_o,fn)=>fn({})}},EventSource:Events,fetch:async url=>{requests.push(url);return {ok:true,json:async()=>feed}},setTimeout,clearTimeout,AbortController,URL:FakeURL,Blob,console};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/app.js'),'utf8'),ctx);await tick();
 element('search').value='no matching video';element('search').listeners.input();assert.doesNotMatch(element('grid').innerHTML,/Visible video/,'fixture must filter the current view');
 element('project-export-open').listeners.click();assert.equal(element('project-export-dialog').open,true);const preview=element('project-export-preview').value;
 assert.match(preview,/Project A/);assert.match(preview,/Visible video — Channel A/);assert.match(preview,/youtube\.com\/watch\?v=abc123def45/);
 assert.doesNotMatch(preview,/PRIVATE TASK|PRIVATE NOTE|PRIVATE REASON|Hidden video|Project hidden video|Visible in B|Other project video|Invalid video/);assert.match(element('project-export-status').textContent,/1 with invalid IDs omitted/);
 element('project-export-download').listeners.click();assert.equal(downloads.length,1);assert.equal(downloads[0].filename,'yourtube-project.txt');assert.equal(await objects.get(downloads[0].href).text(),preview);assert.deepEqual(requests,['feed.json'],'export must not make a network request');
 element('project-export-select').value='b';element('project-export-select').listeners.change();assert.match(element('project-export-preview').value,/Other project video/);assert.match(element('project-export-preview').value,/Visible in B/);assert.doesNotMatch(element('project-export-preview').value,/Visible video/);
});
