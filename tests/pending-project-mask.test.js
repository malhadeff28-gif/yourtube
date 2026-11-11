'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {setImmediate:tick}=require('node:timers/promises');
const code=fs.readFileSync(path.join(__dirname,'../dist/app.js'),'utf8');
const hidden='lostVid0001', other='okVideo0001', removedOther='hideVid0001';
const marker={id:'a',token:'synthetic-token'};
async function setup({pending=true,malformed=false,secondProject=true,hidePendingVideo=true,noLocks=false,holdEnable=false}={}){
 const elements=new Map(), listeners=new Map(),requests=[],writes=[];
 const dialogs=['context-dialog','context-choose-dialog','video-note-dialog','edit-video-dialog','copy-video-dialog','video-dialog','removed-dialog','project-export-dialog','manual-search-dialog','player-dialog','info-dialog','search-review','live-consent'];
 const el=id=>{if(!elements.has(id))elements.set(id,{id,value:'',textContent:'',innerHTML:'',open:false,disabled:false,hidden:false,checked:false,dataset:{},classList:{add(){},remove(){},toggle(){}},listeners:{},addEventListener(name,fn){this.listeners[name]=fn},showModal(){this.open=true},close(){this.open=false;this.listeners.close?.()},replaceChildren(){},reset(){},setAttribute(){},removeAttribute(){},querySelectorAll(){return []},contains(){return false},focus(){}});return elements.get(id)};
 const saved={contextEdits:{a:{id:'a',name:'Old private project',task:'Old secret task'}},customContexts:[],deletedContexts:[],customVideos:[{id:hidden,context:'a',title:'Old private video',channel:'Private creator',reason:'Private reason',source:'local'}],hiddenVideos:[hidden,removedOther],saved:[],watched:[],removedVideos:[{id:hidden,saved:true},{id:removedOther,saved:false}],projectHiddenVideos:[{id:hidden,context:'a'},{id:removedOther,context:'b'}],videoNotes:[{id:hidden,context:'a',text:'Old private note'}]};
 if(!hidePendingVideo){saved.hiddenVideos=saved.hiddenVideos.filter(id=>id!==hidden);saved.projectHiddenVideos=saved.projectHiddenVideos.filter(item=>item.context!=='a');saved.removedVideos=saved.removedVideos.filter(item=>item.id!==hidden)}
 if(pending)saved.__yourtubePendingDeletion=malformed?{id:7,token:'bad'}:marker;
 const storage=new Map([['yourtube.state.v1',JSON.stringify(saved)],['yourtube.thumbnails.v1','enabled']]);
 let failReads=false,resolveEnable;const localStorage={getItem:key=>{if(failReads&&key==='yourtube.state.v1')throw Error('synthetic read failure');return storage.has(key)?storage.get(key):null},setItem:(key,value)=>{writes.push([key,value]);storage.set(key,value)}};
 const feed={contexts:[{id:'a',name:'Recreated secret project',task:'Recreated secret task'},...(secondProject?[{id:'b',name:'Visible project',task:'Visible task'}]:[])],videos:[{id:hidden,context:'a',title:'Recreated private video',channel:'Secret channel',reason:'Secret reason',source:'Live'},...(secondProject?[{id:other,context:'b',title:'Visible video',channel:'Visible channel',reason:'Visible reason',source:'Live'},{id:removedOther,context:'b',title:'Other removed video',channel:'Visible channel',reason:'Visible',source:'Live'}]:[])],focusContext:'a',contextSource:'Private source'};
 let events;class Events{constructor(){events=this;this.listeners={}}addEvent(name,fn){this.listeners[name]=fn}addEventListener(name,fn){this.listeners[name]=fn}close(){}}
 el('pending-drafts').hidden=true;
 const document={getElementById:el,querySelector:s=>s==='dialog[open]'?dialogs.map(el).find(d=>d.open)||null:null,querySelectorAll:s=>s==='dialog'?dialogs.map(el):[],createElement:()=>el('new')};
 const window={addEventListener:(name,fn)=>{const all=listeners.get(name)||[];all.push(fn);listeners.set(name,all)}};
 const context={window,document,localStorage,navigator:{locks:noLocks?undefined:{request:async(_key,_options,fn)=>fn({})}},EventSource:Events,fetch:async(url,options)=>{requests.push({url,method:options?.method||'GET',body:options?.body});if(holdEnable&&url==='/api/live'&&JSON.parse(options.body).enabled)return new Promise(resolve=>{resolveEnable=()=>resolve({ok:true})});return {ok:true,json:async()=>feed}},setTimeout,clearTimeout,AbortController,URL,console,crypto:{randomUUID:()=> 'new'},confirm:()=>true};
 vm.runInNewContext(code,context);await tick();
 return {el,feed,requests,writes,storage,saved,failReads:()=>{failReads=true},resolveEnable:()=>resolveEnable(),emitStorage:(event={key:'yourtube.state.v1'})=>{for(const fn of listeners.get('storage')||[])fn(event)},refresh:async()=>{events.listeners.feed();await tick()},status:data=>events.listeners.status({data:JSON.stringify(data)}),click:(selector,dataset)=>({target:{closest:s=>s===selector?{dataset,disabled:false,setAttribute(){},removeAttribute(){}}:null}})};
}

test('unresolved project is hidden before overlays, notes, removals or thumbnails render',async()=>{
 const a=await setup(),initial=a.storage.get('yourtube.state.v1');
 assert.match(a.el('storage-warning').textContent,/project is hidden/i);
 assert.match(a.el('context-nav').innerHTML,/Visible project/);
 assert.doesNotMatch(a.el('context-nav').innerHTML,/Old private|Recreated secret/);
 assert.match(a.el('grid').innerHTML,/Visible video/);
 assert.doesNotMatch(a.el('grid').innerHTML,/Old private|Recreated private|lostVid0001/);
 assert.match(a.el('grid').innerHTML,/i\.ytimg\.com\/vi\/okVideo0001/);
 a.el('search').value='Old private note';a.el('search').listeners.input();assert.doesNotMatch(a.el('grid').innerHTML,/lostVid0001|Old private/);
 a.el('search').value='';a.el('search').listeners.input();
 await a.el('grid').listeners.click(a.click('[data-note-video]',{noteVideo:hidden,noteContext:'a'}));assert.equal(a.el('video-note-dialog').open,false);
 await a.el('grid').listeners.click(a.click('[data-edit-video]',{editVideo:hidden,editContext:'a'}));assert.equal(a.el('edit-video-dialog').open,false);
 await a.el('grid').listeners.click(a.click('[data-copy-video]',{copyVideo:hidden,copyContext:'a'}));assert.equal(a.el('copy-video-dialog').open,false);
 await a.el('grid').listeners.click(a.click('[data-play]',{play:hidden}));assert.equal(a.el('player-dialog').open,false);
 a.el('show-removed').listeners.click();assert.doesNotMatch(a.el('removed-list').innerHTML,/lostVid0001|Old private/);assert.doesNotMatch(a.el('removed-project-list').innerHTML,/lostVid0001|Old private/);assert.match(a.el('removed-project-list').innerHTML,/Other removed video/);
 a.el('project-export-open').listeners.click();assert.equal(a.el('project-export-dialog').open,false);
 a.el('manual-search-open').listeners.click();assert.equal(a.el('manual-search-dialog').open,false);
 a.status({enabled:true,mode:'awaiting-review',message:'Review',requestId:'synthetic',pendingQuery:'Old private note',pendingProject:{id:'a',name:'Old private project',task:'Old secret task'},projectOptions:[{id:'a',name:'Old private project',task:'Old secret task'}]});assert.equal(a.el('search-review').open,false);assert.equal(a.el('live-label').textContent,'Review unavailable');assert.match(a.el('storage-warning').textContent,/manual search, Live review.*unavailable/i);assert.match(a.el('storage-warning').textContent,/Live may still be on/i);await a.el('search-review-form').listeners.submit({preventDefault(){}});assert.ok(a.requests.every(r=>r.method==='GET')); 
 assert.equal(a.storage.get('yourtube.state.v1'),initial);assert.equal(a.writes.length,0);assert.ok(a.requests.every(r=>r.method==='GET'));
 a.feed.contexts[0].name='Updated secret project';a.feed.videos[0].title='Updated secret video';await a.refresh();assert.doesNotMatch(a.el('grid').innerHTML,/Updated secret|lostVid0001/);assert.doesNotMatch(a.el('context-nav').innerHTML,/Updated secret/);
});

test('malformed marker fails closed without mutating browser data or rendering thumbnails',async()=>{
 const a=await setup({malformed:true});const original=a.storage.get('yourtube.state.v1');assert.match(a.el('storage-warning').textContent,/could not be safely/i);assert.equal(a.el('context-nav').innerHTML,'');assert.doesNotMatch(a.el('grid').innerHTML,/secret|Visible video|ytimg/i);assert.match(a.el('grid').innerHTML,/unavailable/i);assert.equal(a.storage.get('yourtube.state.v1'),original);assert.equal(a.writes.length,0);
});

test('when only unresolved project remains, empty state explains it is hidden',async()=>{
 const a=await setup({secondProject:false});assert.match(a.el('grid').innerHTML,/Projects are unavailable/i);assert.doesNotMatch(a.el('grid').innerHTML,/Start with a project|ytimg|secret/i);
});

test('a pending marker written by an older tab immediately masks the project and closes stale views',async()=>{
 const a=await setup({pending:false,hidePendingVideo:false});a.el('search').value='';assert.match(a.el('grid').innerHTML,/Old private video/);
 await a.el('grid').listeners.click(a.click('[data-note-video]',{noteVideo:hidden,noteContext:'a'}));assert.equal(a.el('video-note-dialog').open,true);a.el('video-note-text').value='Unsaved note typed by user';
 // Both synthetic stale dialogs are open when an older tab writes the marker.
 a.el('context-nav').listeners.click(a.click('[data-context]',{context:'a'}));a.el('edit-context').listeners.click();assert.equal(a.el('context-dialog').open,true);a.el('context-name').value='Unsaved project draft';
 a.status({enabled:true,mode:'awaiting-review',message:'Review',requestId:'synthetic',pendingQuery:'A public draft',pendingProject:{id:'a',name:'Old private project',task:'Old secret task'},projectOptions:[{id:'a',name:'Old private project',task:'Old secret task'}]});assert.equal(a.el('live-label').textContent,'Review search');assert.equal(a.el('search-review').open,true);
 const data=JSON.parse(a.storage.get('yourtube.state.v1'));data.__yourtubePendingDeletion=marker;const updated=JSON.stringify(data);a.storage.set('yourtube.state.v1',updated);a.emitStorage();
 assert.equal(a.el('context-dialog').open,false);assert.equal(a.el('video-note-dialog').open,false);assert.equal(a.el('search-review').open,false);assert.equal(a.el('live-label').textContent,'Review unavailable');assert.match(a.el('live-toggle').title,/Live may still be on/i);assert.equal(a.el('pending-drafts').hidden,false);assert.match(a.el('pending-drafts-text').value,/Unsaved note typed by user/);assert.match(a.el('pending-drafts-text').value,/Unsaved project draft/);assert.doesNotMatch(a.el('context-nav').innerHTML,/Old private|Recreated secret/);assert.doesNotMatch(a.el('grid').innerHTML,/lostVid0001|Old private/);assert.match(a.el('storage-warning').textContent,/project is hidden/i);assert.equal(a.storage.get('yourtube.state.v1'),updated);assert.equal(a.writes.length,0);assert.ok(a.requests.every(r=>r.method==='GET'));
 // An uncooperative tab cannot unmask this tab merely by removing the marker.
 delete data.__yourtubePendingDeletion;a.storage.set('yourtube.state.v1',JSON.stringify(data));a.emitStorage();assert.doesNotMatch(a.el('context-nav').innerHTML,/Old private|Recreated secret/);assert.match(a.el('pending-drafts-text').value,/Unsaved note typed by user/);a.el('pending-drafts-clear').listeners.click();assert.equal(a.el('pending-drafts').hidden,true);assert.equal(a.el('pending-drafts-text').value,'');assert.equal(a.writes.length,0);
});


test('transient or replaced markers in queued storage events remain masked until reload',async()=>{
 const a=await setup({pending:false,hidePendingVideo:false});const original=a.storage.get('yourtube.state.v1');
 const first=JSON.parse(original);first.__yourtubePendingDeletion={id:'a',token:'first'};const firstRaw=JSON.stringify(first);
 const second=JSON.parse(original);second.__yourtubePendingDeletion={id:'b',token:'second'};const secondRaw=JSON.stringify(second);
 // The current value has already reverted when the old set events arrive.
 a.emitStorage({key:'yourtube.state.v1',oldValue:original,newValue:firstRaw});
 assert.doesNotMatch(a.el('context-nav').innerHTML,/Old private|Recreated secret/);assert.match(a.el('context-nav').innerHTML,/Visible project/);
 a.emitStorage({key:'yourtube.state.v1',oldValue:firstRaw,newValue:secondRaw});
 assert.equal(a.el('context-nav').innerHTML,'');assert.doesNotMatch(a.el('grid').innerHTML,/Visible video|Old private|Recreated private|ytimg/);
 assert.equal(a.storage.get('yourtube.state.v1'),original);assert.equal(a.writes.length,0);assert.ok(a.requests.every(r=>r.method==='GET'));
});

test('cross-tab storage clear and transient malformed marker fail closed',async()=>{
 for(const event of [{key:null},{key:'yourtube.state.v1',oldValue:null,newValue:'{'}]){
  const a=await setup({pending:false,hidePendingVideo:false});a.emitStorage(event);assert.equal(a.el('context-nav').innerHTML,'');assert.doesNotMatch(a.el('grid').innerHTML,/Visible video|Old private|Recreated private|ytimg/);assert.match(a.el('storage-warning').textContent,/could not be safely verified/i);assert.equal(a.writes.length,0);
 }
});


test('unavailable Web Locks alone does not falsely claim Live review is blocked',async()=>{
 const a=await setup({pending:false,hidePendingVideo:false,noLocks:true});assert.match(a.el('storage-warning').textContent,/Editing is disabled/i);assert.doesNotMatch(a.el('storage-warning').textContent,/Live review.*unavailable/i);assert.match(a.el('context-nav').innerHTML,/Old private project/);
 a.status({enabled:true,mode:'awaiting-review',message:'Review',requestId:'synthetic',pendingQuery:'General example',pendingProject:{id:'a',name:'A',task:'Task'},projectOptions:[{id:'a',name:'A',task:'Task'}]});assert.equal(a.el('search-review').open,true);assert.equal(a.el('live-label').textContent,'Review search');
});


test('unresolved or malformed browser state blocks enabling Live but still permits pause',async()=>{
 for(const options of [{pending:true},{pending:true,malformed:true}]){
  const a=await setup(options);a.status({enabled:false,mode:'paused',message:'Paused'});a.el('live-toggle').listeners.click();assert.equal(a.el('live-consent').open,false);
  a.el('live-consent').open=true;a.el('live-consent-form').listeners.submit({preventDefault(){}});await tick();assert.equal(a.requests.filter(r=>r.url==='/api/live').length,0);
  a.status({enabled:true,mode:'listening',message:'Live'});a.el('live-toggle').listeners.click();await tick();const posts=a.requests.filter(r=>r.url==='/api/live');assert.equal(posts.length,1);assert.equal(JSON.parse(posts[0].body).enabled,false);
 }
});

test('an unresolved marker closes an open consent and an undelivered event still blocks enable',async()=>{
 for(const deliver of [true,false]){
  const a=await setup({pending:false});a.status({enabled:false,mode:'paused',message:'Paused'});a.el('live-toggle').listeners.click();assert.equal(a.el('live-consent').open,true);
  const state=JSON.parse(a.storage.get('yourtube.state.v1'));state.__yourtubePendingDeletion=marker;a.storage.set('yourtube.state.v1',JSON.stringify(state));if(deliver){a.emitStorage();assert.equal(a.el('live-consent').open,false)}
  a.el('live-consent-form').listeners.submit({preventDefault(){}});await tick();assert.equal(a.requests.filter(r=>r.url==='/api/live').length,0);assert.match(a.el('storage-warning').textContent,/unresolved/i);assert.equal(a.el('live-consent').open,false);assert.equal(a.writes.length,0);
 }
});

test('changed or unreadable storage blocks enable without falsely requiring Web Locks',async()=>{
 for(const mode of ['changed','unreadable']){
  const a=await setup({pending:false,noLocks:true});a.status({enabled:false,mode:'paused',message:'Paused'});a.el('live-toggle').listeners.click();assert.equal(a.el('live-consent').open,true);
  if(mode==='changed')a.storage.set('yourtube.state.v1',JSON.stringify({...a.saved,saved:['newVideo001']}));else a.failReads();
  a.el('live-consent-form').listeners.submit({preventDefault(){}});await tick();assert.equal(a.requests.filter(r=>r.url==='/api/live').length,0);assert.equal(a.el('live-consent').open,false);
 }
 const a=await setup({pending:false,noLocks:true});a.status({enabled:false,mode:'paused',message:'Paused'});a.el('live-toggle').listeners.click();a.el('live-consent-form').listeners.submit({preventDefault(){}});await tick();assert.equal(JSON.parse(a.requests.find(r=>r.url==='/api/live').body).enabled,true);
});

test('a marker during an in-flight enable does not imply cancellation and allows pause after reconnect',async()=>{
 const a=await setup({pending:false,holdEnable:true});a.status({enabled:false,mode:'paused',message:'Paused'});a.el('live-toggle').listeners.click();a.el('live-consent-form').listeners.submit({preventDefault(){}});assert.equal(a.requests.filter(r=>r.url==='/api/live').length,1);
 const state=JSON.parse(a.storage.get('yourtube.state.v1'));state.__yourtubePendingDeletion=marker;a.storage.set('yourtube.state.v1',JSON.stringify(state));a.emitStorage();assert.match(a.el('storage-warning').textContent,/Live may still be on/i);a.el('live-toggle').listeners.click();assert.equal(a.requests.filter(r=>r.url==='/api/live').length,1);
 a.resolveEnable();await tick();a.status({enabled:true,mode:'listening',message:'Live'});a.el('live-toggle').listeners.click();await tick();const posts=a.requests.filter(r=>r.url==='/api/live');assert.equal(posts.length,2);assert.equal(JSON.parse(posts[1].body).enabled,false);
});
