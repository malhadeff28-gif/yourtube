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
 let sequence=0;const timers=new Map();const setTimer=(fn,ms)=>{const token=++sequence;timers.set(token,{fn,ms});return token};let locked=false;
 const locks={request:async(_key,_opts,fn)=>{if(locked)return fn(null);locked=true;try{return await fn({})}finally{locked=false}}};
 const context={window:{},document:{getElementById:el,querySelectorAll:()=>[],createElement:()=>el('new')},localStorage:{getItem:()=>raw,setItem:(_key,value)=>{raw=value}},navigator:{locks},EventSource:FakeEvents,fetch,crypto:{randomUUID:()=>id},setTimeout:setTimer,clearTimeout:key=>timers.delete(key),AbortController,URL,console};
 vm.runInNewContext(fs.readFileSync(path.join(root,'dist/app.js'),'utf8'),context);await tick();
 return {el,events,calls,timers,getRaw:()=>raw,setRaw:value=>{raw=value},startResolve:value=>startResolve(value),cancelResolve:value=>cancelResolve(value),timeout(){const timer=[...timers.values()].find(x=>x.ms===10000);assert.ok(timer,'bounded request timeout');timer.fn()}};
}
function paused(a,manualSearch){a.events.status({mode:'paused',enabled:false,message:'Paused',...(manualSearch?{manualSearch}:{})})}
function open(a,project='a'){a.el('manual-search-open').listeners.click();a.el('manual-search-project').value=project;a.el('manual-search-query').value='public topic'}
function submit(a){return a.el('manual-search-form').listeners.submit({preventDefault(){}})}
test('explicit search reveals verified results and saves them locally only after user action',async()=>{
 const html=fs.readFileSync(path.join(root,'dist/index.html'),'utf8');assert.match(html,/does not read chats or send your project details/);assert.match(html,/Codex.*web search providers/);
 const a=await app(JSON.stringify({customContexts:[{id:'b',name:'Browser project',task:'Synthetic'}]}));open(a);assert.equal(a.el('manual-search-submit').disabled,true);assert.equal(a.calls.length,0);a.el('manual-search-close').listeners.click();
 a.events.status({mode:'listening',enabled:true,message:'Live'});open(a);assert.equal(a.el('manual-search-submit').disabled,true);a.el('manual-search-close').listeners.click();paused(a);open(a,'b');assert.equal(a.calls.length,0,'opening disclosure never sends a search');
 const pending=submit(a);assert.equal(a.calls.length,1);assert.deepEqual(a.calls[0].body,{id,query:'public topic'},'project details never go to the server');submit(a);assert.equal(a.calls.length,1,'duplicate submit blocked');a.startResolve({ok:true});await pending;
 paused(a,{id,state:'ready',videos:[video]});assert.equal(a.el('manual-search-save').hidden,false);assert.equal(JSON.parse(a.getRaw()).customVideos,undefined,'results are not automatically saved');await a.el('manual-search-save').listeners.click();const saved=JSON.parse(a.getRaw());assert.equal(saved.customVideos.length,1);assert.equal(saved.customVideos[0].context,'b');assert.equal(saved.customVideos[0].title,'Synthetic <title>');assert.match(a.el('manual-search-status').textContent,/Added 1 video/);
});
test('unresolved deletion or stale cross-tab marker blocks search and result saving',async()=>{
 const pending=JSON.stringify({__yourtubePendingDeletion:{id:'a',token:'marker'}}),blocked=await app(pending);paused(blocked);open(blocked);assert.equal(blocked.el('manual-search-submit').disabled,true);await submit(blocked);assert.equal(blocked.calls.length,0);assert.equal(blocked.getRaw(),pending);
 const a=await app();paused(a);open(a);const started=submit(a);a.startResolve({ok:true});await started;paused(a,{id,state:'ready',videos:[video]});const marker=JSON.stringify({__yourtubePendingDeletion:{id:'a',token:'other-tab'}});a.setRaw(marker);await a.el('manual-search-save').listeners.click();assert.equal(a.getRaw(),marker,'stale tab cannot overwrite durable deletion intent');assert.match(a.el('manual-search-status').textContent,/changed|safely accessed/i);
});
test('start timeout and hung cancel remain uncertain and allow local dismissal and later recovery',async()=>{
 const a=await app();paused(a);open(a);const pending=submit(a);a.timeout();await pending;assert.match(a.el('manual-search-status').textContent,/Could not confirm/);paused(a);assert.match(a.el('manual-search-status').textContent,/may still start or finish/);let prevented=false;a.el('manual-search-dialog').listeners.cancel({preventDefault(){prevented=true}});assert.equal(prevented,true);assert.equal(a.el('manual-search-dialog').open,false,'Escape dismisses locally without claiming cancellation');
 paused(a,{id,state:'searching'});open(a);const cancel=a.el('manual-search-stop').listeners.click();assert.equal(a.calls.at(-1).url,'/api/manual-search/cancel');a.timeout();await cancel;assert.match(a.el('manual-search-status').textContent,/Could not confirm cancellation/);a.el('manual-search-close').listeners.click();assert.equal(a.el('manual-search-dialog').open,false);
 paused(a,{id,state:'ready',videos:[video]});open(a);assert.equal(a.el('manual-search-save').hidden,false,'completed results can be recovered after local dismissal');await a.el('manual-search-save').listeners.click();assert.equal(JSON.parse(a.getRaw()).customVideos[0].id,'testVideo01');
});

test('ready status reconciles a lost start response without losing results',async()=>{
 const a=await app();paused(a);open(a);const pending=submit(a);paused(a,{id,state:'ready',videos:[video]});assert.equal(a.el('manual-search-save').disabled,true,'wait until the start lock is released');a.timeout();await pending;assert.equal(a.el('manual-search-save').disabled,false);assert.match(a.el('manual-search-status').textContent,/Review the results/);await a.el('manual-search-save').listeners.click();assert.equal(JSON.parse(a.getRaw()).customVideos[0].id,'testVideo01');
});
test('manual search does not silently re-add a video removed from that project',async()=>{
 const initial=JSON.stringify({projectHiddenVideos:[{id:video.id,context:'a'}]}),a=await app(initial);paused(a);open(a);const pending=submit(a);a.startResolve({ok:true});await pending;paused(a,{id,state:'ready',videos:[video]});await a.el('manual-search-save').listeners.click();const state=JSON.parse(a.getRaw());assert.deepEqual(state.projectHiddenVideos,[{id:video.id,context:'a'}]);assert.equal(state.customVideos,undefined);assert.match(a.el('manual-search-status').textContent,/removed from this project/i);
});
