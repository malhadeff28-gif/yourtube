'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {setImmediate:tick}=require('node:timers/promises');
const root=path.resolve(__dirname,'..'),id='11111111-1111-4111-8111-111111111111';
const video={id:'testVideo01',title:'Synthetic <title>',channel:'Example',reason:'Synthetic reason'};
async function app(initialRaw=null){
 const elements=new Map();function el(id){if(!elements.has(id))elements.set(id,{id,value:'',textContent:'',innerHTML:'',disabled:false,hidden:false,open:false,dataset:{},classList:{add(){},remove(){},toggle(){}},listeners:{},addEventListener(type,fn){this.listeners[type]=fn},showModal(){this.open=true},close(){this.open=false},replaceChildren(){}});return elements.get(id)}
 let events,raw=initialRaw;class FakeEvents{constructor(){events=this;this.listeners={}}addEventListener(type,fn){this.listeners[type]=fn}status(x){this.listeners.status({data:JSON.stringify(x)})}close(){}}
 const calls=[];let startResolve,cancelResolve;
 const fetch=async(url,opts)=>{if(url==='feed.json')return {ok:true,json:async()=>({contexts:[{id:'a',name:'Stored project',task:'Example'}],videos:[],focusContext:'a',contextSource:'Synthetic'})};calls.push({url,body:JSON.parse(opts.body)});return new Promise((resolve,reject)=>{if(url==='/api/manual-search')startResolve=resolve;else if(url==='/api/manual-search/cancel')cancelResolve=resolve;else throw Error('unexpected request');opts.signal.addEventListener('abort',()=>reject(Error('aborted')))})};
 let sequence=0;const timers=new Map();const setTimer=(fn,ms)=>{const token=++sequence;timers.set(token,{fn,ms});return token};let locked=false,blockedLock=null;
 const locks={request:async(_key,_opts,fn)=>{if(locked)return fn(null);locked=true;try{if(blockedLock){const gate=blockedLock;blockedLock=null;await gate}return await fn({})}finally{locked=false}}};
 const context={window:{},document:{getElementById:el,querySelectorAll:()=>[],createElement:()=>el('new')},localStorage:{getItem:()=>raw,setItem:(_key,value)=>{raw=value}},navigator:{locks},EventSource:FakeEvents,fetch,crypto:{randomUUID:()=>id},setTimeout:setTimer,clearTimeout:key=>timers.delete(key),AbortController,URL,console};
 vm.runInNewContext(fs.readFileSync(path.join(root,'dist/app.js'),'utf8'),context);await tick();
 return {el,events,calls,timers,deferLock(){let release;blockedLock=new Promise(resolve=>{release=resolve});return release},getRaw:()=>raw,setRaw:value=>{raw=value},startResolve:value=>startResolve(value),cancelResolve:value=>cancelResolve(value),timeout(){const timer=[...timers.values()].find(x=>x.ms===10000);assert.ok(timer,'bounded request timeout');timer.fn()}};
}
function paused(a,manualSearch){a.events.status({mode:'paused',enabled:false,message:'Paused',...(manualSearch?{manualSearch}:{})})}
function open(a,project='a'){a.el('manual-search-open').listeners.click();a.el('manual-search-project').value=project;a.el('manual-search-query').value='public topic'}
function submit(a){return a.el('manual-search-form').listeners.submit({preventDefault(){}})}
function choose(a,videoId,job=id,checked=true){a.el('manual-search-options').listeners.change({target:{type:'checkbox',checked,dataset:{manualId:videoId,manualJob:job}}})}
test('explicit search reveals verified results and saves them locally only after user action',async()=>{
 const html=fs.readFileSync(path.join(root,'dist/index.html'),'utf8');assert.match(html,/does not read chats or send your project details/);assert.match(html,/Codex.*web search providers/);
 const a=await app(JSON.stringify({customContexts:[{id:'b',name:'Browser project',task:'Synthetic'}]}));open(a);assert.equal(a.el('manual-search-submit').disabled,true);assert.equal(a.calls.length,0);a.el('manual-search-close').listeners.click();
 a.events.status({mode:'listening',enabled:true,message:'Live'});open(a);assert.equal(a.el('manual-search-submit').disabled,true);a.el('manual-search-close').listeners.click();paused(a);open(a,'b');assert.equal(a.calls.length,0,'opening disclosure never sends a search');
 const pending=submit(a);assert.equal(a.calls.length,1);assert.deepEqual(a.calls[0].body,{id,query:'public topic'},'project details never go to the server');submit(a);assert.equal(a.calls.length,1,'duplicate submit blocked');a.startResolve({ok:true});await pending;
 paused(a,{id,state:'ready',videos:[video]});assert.equal(a.el('manual-search-save').hidden,false);assert.equal(a.el('manual-search-save').disabled,true,'an explicit selection is required');assert.equal(JSON.parse(a.getRaw()).customVideos,undefined,'results are not automatically saved');choose(a,video.id);await a.el('manual-search-save').listeners.click();const saved=JSON.parse(a.getRaw());assert.equal(saved.customVideos.length,1);assert.equal(saved.customVideos[0].context,'b');assert.equal(saved.customVideos[0].title,'Synthetic <title>');assert.match(a.el('manual-search-status').textContent,/Added 1 video/);
});
test('unresolved deletion or stale cross-tab marker blocks search and result saving',async()=>{
 const pending=JSON.stringify({__yourtubePendingDeletion:{id:'a',token:'marker'}}),blocked=await app(pending);paused(blocked);open(blocked);assert.equal(blocked.el('manual-search-submit').disabled,true);await submit(blocked);assert.equal(blocked.calls.length,0);assert.equal(blocked.getRaw(),pending);
 const a=await app();paused(a);open(a);const started=submit(a);a.startResolve({ok:true});await started;paused(a,{id,state:'ready',videos:[video]});choose(a,video.id);const marker=JSON.stringify({__yourtubePendingDeletion:{id:'a',token:'other-tab'}});a.setRaw(marker);await a.el('manual-search-save').listeners.click();assert.equal(a.getRaw(),marker,'stale tab cannot overwrite durable deletion intent');assert.match(a.el('manual-search-status').textContent,/changed|safely accessed/i);
});
test('start timeout and hung cancel remain uncertain and allow local dismissal and later recovery',async()=>{
 const a=await app();paused(a);open(a);const pending=submit(a);a.timeout();await pending;assert.match(a.el('manual-search-status').textContent,/Could not confirm/);paused(a);assert.match(a.el('manual-search-status').textContent,/may still start or finish/);let prevented=false;a.el('manual-search-dialog').listeners.cancel({preventDefault(){prevented=true}});assert.equal(prevented,true);assert.equal(a.el('manual-search-dialog').open,false,'Escape dismisses locally without claiming cancellation');
 paused(a,{id,state:'searching'});open(a);const cancel=a.el('manual-search-stop').listeners.click();assert.equal(a.calls.at(-1).url,'/api/manual-search/cancel');a.timeout();await cancel;assert.match(a.el('manual-search-status').textContent,/Could not confirm cancellation/);a.el('manual-search-close').listeners.click();assert.equal(a.el('manual-search-dialog').open,false);
 paused(a,{id,state:'ready',videos:[video]});open(a);assert.equal(a.el('manual-search-save').hidden,false,'completed results can be recovered after local dismissal');choose(a,video.id);await a.el('manual-search-save').listeners.click();assert.equal(JSON.parse(a.getRaw()).customVideos[0].id,'testVideo01');
});

test('ready status reconciles a lost start response without losing results',async()=>{
 const a=await app();paused(a);open(a);const pending=submit(a);paused(a,{id,state:'ready',videos:[video]});choose(a,video.id);assert.equal(a.el('manual-search-save').disabled,true,'wait until the start lock is released');a.timeout();await pending;assert.equal(a.el('manual-search-save').disabled,false);assert.match(a.el('manual-search-status').textContent,/Choose the videos/);await a.el('manual-search-save').listeners.click();assert.equal(JSON.parse(a.getRaw()).customVideos[0].id,'testVideo01');
});

test('only explicitly selected results are saved and repeated status preserves choices',async()=>{
 const a=await app(),other={id:'testVideo02',title:'Other & "video"',channel:'Other channel',reason:'A different reason'};
 paused(a);open(a);const start=submit(a);a.startResolve({ok:true});await start;
 paused(a,{id,state:'ready',videos:[video,other]});assert.equal(a.el('manual-search-save').disabled,true);assert.match(a.el('manual-search-count').textContent,/0 of 2 selected/);
 assert.match(a.el('manual-search-options').innerHTML,/Synthetic &lt;title&gt;/,'result labels escape untrusted titles');assert.match(a.el('manual-search-options').innerHTML,/Other &amp; &quot;video&quot;/);
 choose(a,'not-present');assert.equal(a.el('manual-search-save').disabled,true,'unknown result IDs cannot be selected');
 choose(a,video.id,'stale-job');assert.equal(a.el('manual-search-save').disabled,true,'a checkbox from an old job cannot select results');
 choose(a,other.id);assert.match(a.el('manual-search-count').textContent,/1 of 2 selected/);const html=a.el('manual-search-options').innerHTML;
 paused(a,{id,state:'ready',videos:[video,other]});assert.equal(a.el('manual-search-options').innerHTML,html,'repeated status must not rebuild focused checkbox');assert.equal(a.el('manual-search-save').disabled,false,'selection survives repeated status');
 await a.el('manual-search-save').listeners.click();const saved=JSON.parse(a.getRaw());assert.deepEqual(saved.customVideos.map(v=>v.id),[other.id]);assert.match(a.el('manual-search-status').textContent,/Added 1 video/);
});

test('changed, expired or invalid results clear selection and cannot be saved',async()=>{
 const a=await app(),other={id:'testVideo02',title:'Other',channel:'Channel',reason:'Reason'};
 paused(a);open(a);const start=submit(a);a.startResolve({ok:true});await start;
 paused(a,{id,state:'ready',videos:[video]});choose(a,video.id);assert.equal(a.el('manual-search-save').disabled,false);
 paused(a,{id,state:'ready',videos:[other]});assert.equal(a.el('manual-search-save').disabled,true,'changed results need fresh consent');choose(a,video.id);assert.equal(a.el('manual-search-save').disabled,true,'a removed result cannot be selected');
 choose(a,other.id);paused(a,{id,state:'expired'});await a.el('manual-search-save').listeners.click();assert.equal(a.getRaw(),null,'expired results cannot be saved');
 a.el('manual-search-close').listeners.click();paused(a,{id,state:'ready',videos:[other,other]});open(a);assert.match(a.el('manual-search-status').textContent,/invalid results/);assert.equal(a.getRaw(),null,'duplicate IDs fail validation');
});

test('selected hidden and existing results are skipped with an honest partial result',async()=>{
 const existing={id:'testVideo02',context:'a',title:'Saved elsewhere',channel:'Channel',reason:'Saved',source:'Fixture'},other={id:'testVideo02',title:'Other',channel:'Channel',reason:'Reason'};
 const a=await app(JSON.stringify({customVideos:[existing],hiddenVideos:[video.id]}));paused(a);open(a);const start=submit(a);a.startResolve({ok:true});await start;
 const third={id:'testVideo03',title:'Fresh',channel:'Channel',reason:'Reason'};paused(a,{id,state:'ready',videos:[video,other,third]});for(const v of [video,other,third])choose(a,v.id);
 await a.el('manual-search-save').listeners.click();assert.deepEqual(JSON.parse(a.getRaw()).customVideos.map(v=>v.id),[other.id,third.id]);assert.match(a.el('manual-search-status').textContent,/Added 1 video.*2 selected videos were already/);
});

test('expired or replaced results cannot commit while waiting for the storage lock',async()=>{
 const a=await app(),other={id:'testVideo02',title:'Other',channel:'Channel',reason:'Reason'};
 paused(a);open(a);const start=submit(a);a.startResolve({ok:true});await start;paused(a,{id,state:'ready',videos:[video]});choose(a,video.id);
 let release=a.deferLock();const oldSave=a.el('manual-search-save').listeners.click();assert.equal(a.el('manual-search-results').disabled,true,'selection is disabled while saving');
 paused(a,{id,state:'ready',videos:[other]});release();await oldSave;assert.equal(a.getRaw(),null,'old selected result must not be saved after result replacement');assert.equal(a.el('manual-search-save').disabled,true,'new results require fresh selection');
 choose(a,other.id);release=a.deferLock();const expiringSave=a.el('manual-search-save').listeners.click();paused(a,{id,state:'expired'});release();await expiringSave;assert.equal(a.getRaw(),null,'expired results must not be saved');
});

test('a new job never inherits old selections or accepts an old checkbox event',async()=>{
 const a=await app(),otherId='22222222-2222-4222-8222-222222222222';paused(a);open(a);const start=submit(a);a.startResolve({ok:true});await start;paused(a,{id,state:'ready',videos:[video]});choose(a,video.id);assert.equal(a.el('manual-search-save').disabled,false);
 a.el('manual-search-close').listeners.click();paused(a,{id:otherId,state:'ready',videos:[video]});open(a);assert.equal(a.el('manual-search-save').disabled,true);choose(a,video.id,id);assert.equal(a.el('manual-search-save').disabled,true,'detached checkbox from earlier job is ignored');choose(a,video.id,otherId);assert.equal(a.el('manual-search-save').disabled,false);
});

test('a different authoritative job prevents saving the previous selection',async()=>{
 const a=await app(),otherId='22222222-2222-4222-8222-222222222222';paused(a);open(a);const start=submit(a);a.startResolve({ok:true});await start;paused(a,{id,state:'ready',videos:[video]});choose(a,video.id);assert.equal(a.el('manual-search-save').disabled,false);
 paused(a,{id:otherId,state:'ready',videos:[video]});assert.equal(a.el('manual-search-save').disabled,true);assert.equal(a.el('manual-search-results').hidden,true,'previous results must not appear current');assert.equal(a.el('manual-search-count').textContent,'');assert.match(a.el('manual-search-status').textContent,/different search.*dismiss locally/i);assert.equal(a.el('manual-search-stop').disabled,true,'do not cancel the other job');await a.el('manual-search-save').listeners.click();assert.equal(a.getRaw(),null,'selection from the previous job must not commit');a.el('manual-search-close').listeners.click();assert.match(a.el('toast').textContent,/did not cancel/i);
});

test('missing service job clears ready choices without claiming cancellation',async()=>{
 const a=await app();paused(a);open(a);const start=submit(a);a.startResolve({ok:true});await start;paused(a,{id,state:'ready',videos:[video]});choose(a,video.id);assert.equal(a.el('manual-search-save').disabled,false);
 paused(a);assert.equal(a.el('manual-search-results').hidden,true);assert.equal(a.el('manual-search-save').disabled,true);assert.match(a.el('manual-search-status').textContent,/not reporting.*may still start or finish/i);assert.equal(a.el('manual-search-stop').disabled,true);assert.equal(a.getRaw(),null);
 paused(a,{id,state:'ready',videos:[video]});assert.equal(a.el('manual-search-results').hidden,false);assert.equal(a.el('manual-search-save').disabled,true,'recovered results require a fresh choice');choose(a,video.id);assert.equal(a.el('manual-search-save').disabled,false);
});

test('a different status during an in-flight start remains locally dismissible',async()=>{
 const a=await app(),otherId='22222222-2222-4222-8222-222222222222';paused(a);open(a);const start=submit(a);
 paused(a,{id:otherId,state:'searching'});assert.match(a.el('manual-search-status').textContent,/different search/);assert.equal(a.el('manual-search-stop').disabled,true);assert.equal(a.el('manual-search-dialog').open,true);
 a.startResolve({ok:true});await start;assert.match(a.el('manual-search-status').textContent,/different search/,'a delayed start response must not hide the mismatch');paused(a,{id,state:'ready',videos:[video]});assert.equal(a.el('manual-search-results').hidden,false);choose(a,video.id);assert.equal(a.el('manual-search-save').disabled,false);
});
test('manual search does not silently re-add a video removed from that project',async()=>{
 const initial=JSON.stringify({projectHiddenVideos:[{id:video.id,context:'a'}]}),a=await app(initial);paused(a);open(a);const pending=submit(a);a.startResolve({ok:true});await pending;paused(a,{id,state:'ready',videos:[video]});choose(a,video.id);await a.el('manual-search-save').listeners.click();const state=JSON.parse(a.getRaw());assert.deepEqual(state.projectHiddenVideos,[{id:video.id,context:'a'}]);assert.equal(state.customVideos,undefined);assert.match(a.el('manual-search-status').textContent,/removed from this project/i);
});

test('candidate preview links are explicit, isolated from selection, and cleared when results go stale',async()=>{
 const a=await app(),other={id:'testVideo02',title:'Other & "video"',channel:'Channel',reason:'Reason'};
 const page=fs.readFileSync(path.join(root,'dist/index.html'),'utf8');assert.match(page,/Open on YouTube opens the video in a new tab and connects to YouTube/);
 paused(a);open(a);const start=submit(a);a.startResolve({ok:true});await start;paused(a,{id,state:'ready',videos:[video,other]});
 const options=a.el('manual-search-options').innerHTML;
 assert.match(options,/href="https:\/\/www\.youtube\.com\/watch\?v=testVideo01" target="_blank" rel="noopener noreferrer" aria-label="Open Synthetic &lt;title&gt; on YouTube \(opens in a new tab\)"/);
 assert.match(options,/<\/label><a href=/,'the independent link is outside the checkbox label');
 assert.match(options,/Open Other &amp; &quot;video&quot; on YouTube/,'accessible name escapes untrusted metadata');
 assert.doesNotMatch(options,/<iframe|<img/,'candidate rendering does not load embedded content');
 assert.equal(a.calls.length,1,'rendering candidates makes no preview request');assert.equal(a.el('manual-search-save').disabled,true);
 choose(a,video.id);paused(a,{id,state:'ready',videos:[video,other]});assert.equal(a.el('manual-search-options').innerHTML,options,'repeated status preserves the focused control');
 assert.equal(a.el('manual-search-save').disabled,false,'preview link markup does not change selection');
 a.events.onerror();assert.equal(a.el('manual-search-options').innerHTML,'','disconnection removes links from unconfirmed results');assert.equal(a.el('manual-search-results').hidden,true);assert.equal(a.el('manual-search-save').disabled,true);
 paused(a,{id,state:'ready',videos:[video]});assert.match(a.el('manual-search-options').innerHTML,/testVideo01/);assert.equal(a.el('manual-search-save').disabled,true,'recovered results need a fresh selection');
 paused(a,{id,state:'expired'});assert.equal(a.el('manual-search-options').innerHTML,'','expired links are removed');
});

test('unknown job state and invalid IDs never leave preview links actionable',async()=>{
 const a=await app();paused(a);open(a);const start=submit(a);a.startResolve({ok:true});await start;paused(a,{id,state:'ready',videos:[video]});choose(a,video.id);
 paused(a,{id,state:'unexpected',videos:[video]});assert.equal(a.el('manual-search-options').innerHTML,'');assert.equal(a.el('manual-search-results').hidden,true);assert.equal(a.el('manual-search-save').disabled,true);assert.match(a.el('manual-search-status').textContent,/unknown search status/);
 paused(a,{id,state:'ready',videos:[{...video,id:'evil" onmouseover="x'}]});assert.equal(a.el('manual-search-options').innerHTML,'','invalid ID cannot produce a URL or markup');assert.match(a.el('manual-search-status').textContent,/invalid results/);
});

test('discard removes preview links immediately and ignores ready events while cancellation is in flight',async()=>{
 const a=await app();paused(a);open(a);const start=submit(a);a.startResolve({ok:true});await start;paused(a,{id,state:'ready',videos:[video]});choose(a,video.id);
 const cancel=a.el('manual-search-stop').listeners.click();assert.equal(a.el('manual-search-options').innerHTML,'');assert.equal(a.el('manual-search-results').hidden,true);assert.equal(a.el('manual-search-save').disabled,true);
 paused(a,{id,state:'ready',videos:[video]});assert.equal(a.el('manual-search-options').innerHTML,'','old ready status cannot restore links during cancel');assert.equal(a.el('manual-search-results').hidden,true);
 a.cancelResolve({ok:true});await cancel;assert.equal(a.el('manual-search-options').innerHTML,'','accepted cancellation does not restore links');paused(a,{id,state:'ready',videos:[video]});assert.equal(a.el('manual-search-options').innerHTML,'','late ready status after the response cannot restore links before confirmation');assert.equal(a.el('manual-search-results').hidden,true);assert.match(a.el('manual-search-status').textContent,/Waiting for cancellation confirmation/);paused(a,{id,state:'canceled'});assert.equal(a.el('manual-search-options').innerHTML,'');assert.match(a.el('manual-search-status').textContent,/canceled|discarded/i);
});
