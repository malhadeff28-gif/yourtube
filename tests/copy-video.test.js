'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {setImmediate:tick}=require('node:timers/promises');
const code=fs.readFileSync(path.join(__dirname,'../dist/app.js'),'utf8');
const shared='testVideo01',live='testVideo02';
async function setup(initial={}){
 const els=new Map(),dialogs=['copy-video-dialog','edit-video-dialog','context-dialog','video-dialog','removed-dialog','manual-search-dialog','player-dialog','info-dialog','live-consent','search-review'];
 const el=id=>{if(!els.has(id))els.set(id,{id,value:'',textContent:'',innerHTML:'',open:false,disabled:false,dataset:{},classList:{add(){},remove(){},toggle(){}},listeners:{},addEventListener(k,f){this.listeners[k]=f},showModal(){this.open=true},close(){this.open=false;this.listeners.close?.()},replaceChildren(){},reset(){},setAttribute(){},removeAttribute(){},querySelectorAll(){return []},contains(){return false}});return els.get(id)};
 let raw=JSON.stringify({customVideos:[{id:shared,context:'a',title:'Manual title',channel:'One',reason:'My reason',source:'Added by you'},{id:shared,context:'b',title:'Other project',channel:'Two',reason:'Other reason',source:'Added by you'}],saved:[live],watched:[live],...initial}),fail=false,locked=false,gate=null,requests=[];
 const feed={contexts:[{id:'a',name:'Alpha',task:'A'},{id:'b',name:'Beta',task:'B'},{id:'c',name:'Gamma',task:'C'}],videos:[{id:shared,context:'a',title:'Live title',channel:'Live',reason:'Live reason',source:'Live'},{id:live,context:'a',title:'Live only',channel:'Live channel',reason:'Live reason',source:'Live'}],focusContext:'a',contextSource:'Synthetic'};
 const localStorage={getItem:()=>raw,setItem:(_k,v)=>{if(fail)throw Error('quota');raw=v}};
 const locks={request:async(_key,_opts,fn)=>{if(locked)return fn(null);locked=true;try{if(gate)await gate;return await fn({})}finally{locked=false}}};
 class Events{addEventListener(){}close(){}}
 const document={getElementById:el,querySelector:s=>s==='dialog[open]'?dialogs.map(el).find(d=>d.open)||null:null,querySelectorAll:s=>s==='dialog'?dialogs.map(el):[],createElement:()=>el('new')};
 const context={window:{},document,localStorage,navigator:{locks},EventSource:Events,fetch:async url=>{requests.push(url);return {ok:true,json:async()=>feed}},setTimeout,clearTimeout,AbortController,URL,console,crypto:{randomUUID:()=> 'new'},confirm:()=>true};
 vm.runInNewContext(code,context);await tick();
 const open=(id=live,project='a')=>el('grid').listeners.click({target:{closest:s=>s==='[data-copy-video]'?{dataset:{copyVideo:id,copyContext:project}}:null}});
 const submit=()=>el('copy-video-form').listeners.submit({preventDefault(){}});
 return {el,feed,open,submit,requests,state:()=>JSON.parse(raw),fail:v=>{fail=v},stale:()=>{raw=JSON.stringify({...JSON.parse(raw),saved:[]})},hold:()=>{let release;gate=new Promise(r=>{release=r});return()=>{gate=null;release()}}};
}

test('copy creates a browser-local association without changing Live, other projects or saved state',async()=>{
 const a=await setup();await a.open();assert.equal(a.el('copy-video-dialog').open,true);assert.match(a.el('copy-video-source').textContent,/Live only/);a.el('copy-video-project').value='c';await a.submit();
 const s=a.state();assert.equal(a.el('copy-video-dialog').open,false);assert.deepEqual(s.saved,[live]);assert.deepEqual(s.watched,[live]);assert.deepEqual(s.customVideos.at(-1),{id:live,context:'c',title:'Live only',channel:'Live channel',reason:'Live reason',source:'Copied in this browser'});assert.equal(a.feed.videos.length,2);assert.deepEqual(a.requests,['feed.json']);
 await a.open(shared,'a');a.el('copy-video-project').value='c';await a.submit();assert.equal(a.state().customVideos.at(-1).title,'Manual title');assert.equal(a.state().customVideos.find(v=>v.id===shared&&v.context==='b').title,'Other project');
});

test('copy refuses duplicates and project-hidden or unavailable destinations without changing the draft',async()=>{
 const a=await setup({projectHiddenVideos:[{id:live,context:'c'}]});await a.open(shared);a.el('copy-video-project').value='b';const before=a.state();await a.submit();assert.match(a.el('copy-video-error').textContent,/already in that project/i);assert.deepEqual(a.state(),before);assert.equal(a.el('copy-video-dialog').open,true);
 a.el('copy-video-dialog').close();await a.open(live);a.el('copy-video-project').value='c';await a.submit();assert.match(a.el('copy-video-error').textContent,/removed.*restore/i);assert.deepEqual(a.state(),before);
 a.el('copy-video-project').value='missing';await a.submit();assert.match(a.el('copy-video-error').textContent,/unavailable/i);assert.deepEqual(a.state(),before);
});

test('stale and failed writes retain the selected destination and never create a copy',async()=>{
 for(const mode of ['stale','failure']){const a=await setup();await a.open();a.el('copy-video-project').value='c';if(mode==='stale')a.stale();else a.fail(true);const before=a.state();await a.submit();assert.deepEqual(a.state(),before);assert.equal(a.el('copy-video-dialog').open,true);assert.equal(a.el('copy-video-project').value,'c');assert.match(a.el('copy-video-error').textContent,/changed|could not save|cannot be safely accessed/i)}
});

test('copy rejects a source changed during an asynchronous lock and does not close a newer dialog',async()=>{
 const a=await setup();await a.open(live);a.el('copy-video-project').value='c';const release=a.hold(),pending=a.submit();await tick();a.feed.videos.find(v=>v.id===live).title='Changed title';release();await pending;assert.match(a.el('copy-video-error').textContent,/source video changed/i);assert.equal(a.el('copy-video-dialog').open,true);assert.equal(a.state().customVideos.length,2);
 a.el('copy-video-dialog').close();await a.open(shared);a.el('copy-video-project').value='c';const release2=a.hold(),first=a.submit();await tick();a.el('copy-video-dialog').close();await a.open(live);a.el('copy-video-project').value='b';release2();await first;assert.equal(a.el('copy-video-dialog').open,true);assert.equal(a.el('copy-video-project').value,'b');
});


test('globally hidden videos and deleted projects cannot be copied',async()=>{
 const hidden=await setup({hiddenVideos:[live]});await hidden.open(live);assert.equal(hidden.el('copy-video-dialog').open,false);assert.equal(hidden.state().customVideos.length,2);
 const deleted=await setup({deletedContexts:['c']});await deleted.open(live);deleted.el('copy-video-project').value='c';const before=deleted.state();await deleted.submit();assert.match(deleted.el('copy-video-error').textContent,/unavailable/i);assert.deepEqual(deleted.state(),before);assert.equal(deleted.el('copy-video-dialog').open,true);
});
