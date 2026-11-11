'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {setImmediate:tick}=require('node:timers/promises');
const id='abc123def45';
const seed=()=>({contexts:[{id:'a',name:'A',task:'Task A'},{id:'b',name:'B',task:'Task B'}],videos:[{id,context:'a',title:'From A',channel:'A channel',reason:'First',source:'Fixture'},{id,context:'b',title:'From B',channel:'B channel',reason:'Second',source:'Fixture'}],focusContext:'a',contextSource:'Synthetic'});
async function tab(storage,data=seed()){
 const elements=new Map();const el=id=>{if(!elements.has(id))elements.set(id,{id,disabled:false,value:'',textContent:'',innerHTML:'',open:false,dataset:{},classList:{add(){},remove(){},toggle(){}},listeners:{},addEventListener(k,f){this.listeners[k]=f},showModal(){this.open=true},close(){this.open=false;this.listeners.close?.()},replaceChildren(){},reset(){},setAttribute(){},removeAttribute(){}});return elements.get(id)};
 const dialogs=['removed-dialog','context-dialog','video-dialog','player-dialog','info-dialog','live-consent','search-review','manual-search-dialog'];let source;
 class Events{constructor(){source=this;this.listeners={}}addEventListener(k,f){this.listeners[k]=f}close(){}}
 const context={window:{},document:{getElementById:el,querySelector:s=>s==='dialog[open]'?dialogs.map(el).find(d=>d.open)||null:null,querySelectorAll:s=>s==='dialog'?dialogs.map(el):[],createElement:()=>el('created')},localStorage:{getItem:()=>storage.raw,setItem:(_k,v)=>{if(storage.fail)throw Error('quota');storage.raw=v}},navigator:{locks:{request:async(_k,_o,fn)=>fn({})}},EventSource:Events,fetch:async()=>({ok:true,json:async()=>data}),setTimeout,clearTimeout,AbortController,URL,console,crypto:{randomUUID:()=> 'test'},confirm:()=>true};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','dist','app.js'),'utf8'),context);await tick();
 const event=(selector,dataset)=>({target:{closest:s=>s===selector?{dataset,disabled:false,setAttribute(){},removeAttribute(){}}:null}});
 return {el,source,project:project=>el('context-nav').listeners.click(event('[data-context]',{context:project})),hide:project=>el('grid').listeners.click(event('[data-hide-project]',{hideProject:id,project})),hideAll:()=>el('grid').listeners.click(event('[data-hide]',{hide:id})),restore:project=>el('removed-project-list').listeners.click(event('[data-restore-project-video]',{restoreProjectVideo:id,project})),restoreAll:()=>el('removed-list').listeners.click(event('[data-restore-video]',{restoreVideo:id})),refresh:async()=>{source.listeners.feed();await tick();await tick()}};
}

test('project removal is reversible, persists across refresh and preserves other projects and global state',async()=>{
 const store={raw:JSON.stringify({saved:[id],watched:[id]})},feed=seed(),app=await tab(store,feed);
 assert.match(app.el('grid').innerHTML,/From A/);await app.hide('a');let state=JSON.parse(store.raw);assert.deepEqual(state.projectHiddenVideos,[{id,context:'a'}]);assert.deepEqual(state.saved,[id]);assert.deepEqual(state.watched,[id]);assert.doesNotMatch(app.el('grid').innerHTML,/From A/);
 app.project('b');assert.match(app.el('grid').innerHTML,/From B/);app.el('filters').listeners.click({target:{closest:s=>s==='[data-context]'?{dataset:{context:'all'}}:null}});assert.match(app.el('grid').innerHTML,/From B/,'all-project view still contains the other association');
 feed.videos[0].title='Updated by Live';feed.updatedAt='2026-01-02T00:00:00Z';await app.refresh();app.project('a');assert.doesNotMatch(app.el('grid').innerHTML,/Updated by Live/,'a later Live refresh does not undo the project preference');
 const reopened=await tab(store,feed);reopened.el('show-removed').listeners.click();assert.match(reopened.el('removed-project-list').innerHTML,/Updated by Live/);await reopened.restore('a');state=JSON.parse(store.raw);assert.deepEqual(state.projectHiddenVideos,[]);assert.deepEqual(state.saved,[id]);assert.deepEqual(state.watched,[id]);assert.match(reopened.el('grid').innerHTML,/Updated by Live/);
});

test('live and manually added copies in one project are both hidden and cannot be silently re-added',async()=>{
 const store={raw:JSON.stringify({customVideos:[{id,context:'a',title:'Manual A',channel:'Example',reason:'Personal',source:'Added by you'}]})},app=await tab(store);assert.match(app.el('grid').innerHTML,/Manual A/);await app.hide('a');assert.doesNotMatch(app.el('grid').innerHTML,/Manual A|From A/);app.el('add-video').listeners.click();app.el('video-url').value='https://youtu.be/'+id;app.el('video-title').value='Draft';app.el('video-context').value='a';const before=store.raw;await app.el('video-form').listeners.submit({preventDefault(){}});assert.equal(store.raw,before);assert.equal(app.el('video-dialog').open,true);assert.match(app.el('video-error').textContent,/Recently removed/);
});

test('global and project removals restore independently',async()=>{
 const store={raw:JSON.stringify({saved:[id],watched:[id]})},app=await tab(store);await app.hide('a');app.project('b');await app.hideAll();app.el('show-removed').listeners.click();assert.match(app.el('removed-project-list').innerHTML,/still removed from the whole feed/);await app.restore('a');assert.match(app.el('removed-error').textContent,/still removed from the whole feed/);assert.deepEqual(JSON.parse(store.raw).hiddenVideos,[id]);await app.restoreAll();const s=JSON.parse(store.raw);assert.deepEqual(s.hiddenVideos,[]);assert.deepEqual(s.projectHiddenVideos,[]);assert.deepEqual(s.saved,[id]);assert.deepEqual(s.watched,[id]);
});

test('global restore reports when all available project associations remain hidden',async()=>{
 const feed=seed();feed.contexts=feed.contexts.slice(0,1);feed.videos=feed.videos.slice(0,1);const store={raw:JSON.stringify({hiddenVideos:[id],removedVideos:[{id,saved:true}],projectHiddenVideos:[{id,context:'a'}]})},app=await tab(store,feed);app.el('show-removed').listeners.click();await app.restoreAll();assert.match(app.el('removed-error').textContent,/still removed from its available projects/i);assert.doesNotMatch(app.el('grid').innerHTML,/From A/);await app.restore('a');assert.match(app.el('grid').innerHTML,/From A/);
});

test('stale and failed writes cannot hide or restore, and missing associations stay unavailable',async()=>{
 const store={raw:null},a=await tab(store),b=await tab(store);store.fail=true;await a.hide('a');assert.equal(store.raw,null);store.fail=false;await a.hide('a');const hidden=store.raw;await b.hide('a');assert.equal(store.raw,hidden,'stale browser must not overwrite newer data');a.el('show-removed').listeners.click();store.fail=true;await a.restore('a');assert.equal(store.raw,hidden);assert.match(a.el('removed-error').textContent,/could not save/i);store.fail=false;
 const missing=await tab(store,{contexts:[{id:'b',name:'B',task:'Task B'}],videos:[],focusContext:'b',contextSource:'Synthetic'});missing.el('show-removed').listeners.click();assert.match(missing.el('removed-project-list').innerHTML,/Unavailable/);await missing.restore('a');assert.equal(store.raw,hidden,'unavailable association is not silently restored');
});

test('malformed project removal data fails closed',async()=>{const store={raw:JSON.stringify({projectHiddenVideos:[{id,context:'a'},{id,context:'a'}]})},app=await tab(store);assert.match(app.el('storage-warning').textContent,/editing is disabled/i);await app.hide('a');assert.equal(JSON.parse(store.raw).projectHiddenVideos.length,2)});
