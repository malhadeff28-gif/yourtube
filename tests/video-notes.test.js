'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {setImmediate:tick}=require('node:timers/promises');
const code=fs.readFileSync(path.join(__dirname,'../dist/app.js'),'utf8');
const same='testVideo01',other='testVideo02';
async function setup(recovery=false){
 const els=new Map(),dialogs=['video-note-dialog','project-export-dialog','edit-video-dialog','context-dialog','video-dialog','removed-dialog','manual-search-dialog','player-dialog','info-dialog','live-consent','search-review'];
 const el=id=>{if(!els.has(id))els.set(id,{id,value:'',textContent:'',innerHTML:'',open:false,disabled:false,dataset:{},classList:{add(){},remove(){},toggle(){}},listeners:{},addEventListener(k,f){this.listeners[k]=f},showModal(){this.open=true},close(){this.open=false;this.listeners.close?.()},replaceChildren(){},reset(){},setAttribute(){},removeAttribute(){},querySelectorAll(){return []},contains(){return false}});return els.get(id)};
 const initial={customContexts:[],contextEdits:{},deletedContexts:[],customVideos:[{id:same,context:'a',title:'Original title',channel:'One',reason:'Original note',source:'Added by you',extra:'keep'},{id:same,context:'b',title:'Other project title',channel:'Two',reason:'Other note',source:'Added by you'}],hiddenVideos:[],saved:[same],watched:[same],removedVideos:[]};
 if(recovery){initial.videoNotes=[{id:other,context:'a',text:'delete me'},{id:other,context:'b',text:'keep me'}];initial.__yourtubePendingDeletion={id:'a',token:'synthetic'}}
 let raw=JSON.stringify(initial),fail=false,lockHeld=false,gate=null;const requests=[];let events;
 const feed={contexts:[{id:'a',name:'Alpha',task:'A'},{id:'b',name:'Beta',task:'B'}],videos:[{id:same,context:'a',title:'Live original',channel:'Live',reason:'Live reason',source:'Live'},{id:other,context:'a',title:'Live only',channel:'Live',reason:'Live reason',source:'Live'},{id:other,context:'b',title:'Live other project',channel:'Live',reason:'Live reason',source:'Live'}],focusContext:'a',contextSource:'Synthetic'};
 const localStorage={getItem:()=>raw,setItem:(_k,v)=>{if(fail)throw Error('quota');raw=v}};
 const locks={request:async(_key,_options,fn)=>{if(lockHeld)return fn(null);lockHeld=true;try{if(gate)await gate;return await fn({})}finally{lockHeld=false}}};
 class Events{constructor(){events=this;this.listeners={}}addEventListener(name,fn){this.listeners[name]=fn}close(){}}
 const document={getElementById:el,querySelector:s=>s==='dialog[open]'?dialogs.map(el).find(d=>d.open)||null:null,querySelectorAll:s=>s==='dialog'?dialogs.map(el):[],createElement:()=>el('new')};
 const context={window:{},document,localStorage,navigator:{locks},EventSource:Events,fetch:async(url,options)=>{requests.push({url,body:options?.body});return {ok:true,json:async()=>feed}},setTimeout,clearTimeout,AbortController,URL,console,crypto:{randomUUID:()=> 'new'},confirm:()=>true};
 vm.runInNewContext(code,context);await tick();
 const edit=(id=other,project='a')=>el('grid').listeners.click({target:{closest:s=>s==='[data-note-video]'?{dataset:{noteVideo:id,noteContext:project}}:null}});
 const submit=()=>el('video-note-form').listeners.submit({preventDefault(){}});
 const hide=()=>el('grid').listeners.click({target:{closest:s=>s==='[data-hide-project]'?{dataset:{hideProject:same,project:'a'}}:null}});
 return {el,feed,requests,edit,submit,hide,refresh:()=>events.listeners.feed(),state:()=>JSON.parse(raw),fail:v=>{fail=v},stale:()=>{raw=JSON.stringify({...JSON.parse(raw),saved:[]})},hold:()=>{let release;gate=new Promise(r=>{release=r});return()=>{gate=null;release()}}};
}


test('Live and manual notes are local and distinct for a video in different projects',async()=>{
 const a=await setup();assert.match(a.el('grid').innerHTML,/data-note-video="testVideo02"/);await a.edit();a.el('video-note-text').value='private Live note';await a.submit();assert.deepEqual(a.state().videoNotes,[{id:other,context:'a',text:'private Live note'}]);
 await a.edit(other,'b');assert.equal(a.el('video-note-text').value,'');a.el('video-note-text').value='another project';await a.submit();await a.edit(other,'a');assert.equal(a.el('video-note-text').value,'private Live note');a.el('video-note-dialog').close();
 await a.edit(same,'a');a.el('video-note-text').value='manual note';await a.submit();assert.equal(a.state().videoNotes.length,3);
 a.el('project-export-open').listeners.click();assert.doesNotMatch(a.el('project-export-preview').value,/private Live note|another project|manual note/);assert.ok(a.requests.every(r=>!String(r.body).includes('private Live note')&&!String(r.body).includes('manual note')));
 await a.edit(other,'a');a.el('video-note-text').value=' ';await a.submit();assert.equal(a.state().videoNotes.some(n=>n.id===other&&n.context==='a'),false);assert.equal(a.state().videoNotes.find(n=>n.context==='b').text,'another project');
});

test('failed and stale writes retain the draft',async()=>{
 for(const mode of ['failure','stale']){const a=await setup();await a.edit();a.el('video-note-text').value='unsaved';if(mode==='failure')a.fail(true);else a.stale();const before=a.state();await a.submit();assert.equal(a.el('video-note-dialog').open,true);assert.equal(a.el('video-note-text').value,'unsaved');assert.match(a.el('video-note-error').textContent,/could not save|changed|cannot be safely accessed/i);assert.deepEqual(a.state(),before)}
});

test('project-hidden association cannot be saved and disabled deletion preserves notes',async()=>{
 const a=await setup();await a.edit(same,'a');a.el('video-note-text').value='note A';await a.submit();await a.edit(same,'b');a.el('video-note-text').value='note B';await a.submit();
 await a.edit(same,'a');a.el('video-note-text').value='draft';a.el('context-nav').listeners.click({target:{closest:()=>({dataset:{context:'a'}})}});await a.hide();await a.submit();assert.equal(a.el('video-note-text').value,'draft');assert.match(a.el('video-note-error').textContent,/no longer available/i);a.el('video-note-dialog').close();
 a.el('context-id').value='a';await a.el('delete-context').listeners.click();assert.deepEqual(a.state().videoNotes,[{id:same,context:'a',text:'note A'},{id:same,context:'b',text:'note B'}]);assert.ok(a.requests.every(r=>!String(r.body).includes('note A')&&!String(r.body).includes('note B')));
});

test('a delayed save cannot replace a newer note draft',async()=>{
 const a=await setup();await a.edit(other,'a');a.el('video-note-text').value='first';const release=a.hold(),pending=a.submit();await tick();a.el('video-note-dialog').close();await a.edit(other,'b');a.el('video-note-text').value='new draft';release();await pending;assert.equal(a.el('video-note-dialog').open,true);assert.equal(a.el('video-note-text').value,'new draft');
});


test('Live feed refresh keeps notes bound to stable associations',async()=>{
 const a=await setup();await a.edit();a.el('video-note-text').value='Keep across refresh';await a.submit();a.feed.videos.find(v=>v.id===other&&v.context==='a').title='Updated by Live';a.refresh();await tick();await a.edit();assert.equal(a.el('video-note-text').value,'Keep across refresh');assert.equal(a.el('video-note-project').textContent,'Alpha — Updated by Live');
});

test('pending project deletion preserves all notes and is never retried',async()=>{
 const a=await setup(true),before=a.state().videoNotes;assert.equal(a.el('storage-retry-delete').hidden,true);await a.el('storage-retry-delete').listeners.click();assert.deepEqual(a.state().videoNotes,before);assert.ok(a.requests.every(r=>!String(r.body).includes('delete me')&&!String(r.body).includes('keep me')));
});
