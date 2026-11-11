'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {setImmediate:tick}=require('node:timers/promises');
const job='11111111-1111-4111-8111-111111111111';
const candidate={id:'testVideo01',title:'Synthetic title',channel:'Example',reason:'Synthetic reason'};
const project=id=>({id,name:'Project '+id,task:'Synthetic task'});
async function setup(projects,focus=''){
 const elements=new Map(),store=new Map(),calls=[];let events;
 const el=id=>{if(!elements.has(id))elements.set(id,{id,value:'',textContent:'',innerHTML:'',disabled:false,hidden:false,open:false,dataset:{},classList:{add(){},remove(){},toggle(){}},listeners:{},addEventListener(type,fn){this.listeners[type]=fn},showModal(){this.open=true},close(){this.open=false;this.listeners.close?.()},replaceChildren(){},reset(){}});return elements.get(id)};
 const feed={contexts:projects,videos:[],focusContext:focus,contextSource:'Synthetic'};
 class FakeEvents{constructor(){events=this;this.listeners={}}addEventListener(type,fn){this.listeners[type]=fn}status(x){this.listeners.status({data:JSON.stringify(x)})}close(){}}
 const fetch=async(url,opts)=>{if(url==='feed.json')return {ok:true,json:async()=>feed};calls.push({url,body:JSON.parse(opts.body)});return {ok:true,json:async()=>({})}};
 const context={window:{},document:{getElementById:el,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>el('created')},localStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,v)},navigator:{locks:{request:async(_k,_o,fn)=>fn({})}},EventSource:FakeEvents,fetch,crypto:{randomUUID:()=>job},setTimeout,clearTimeout,AbortController,URL,console};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','dist','app.js'),'utf8'),context);await tick();
 const paused=manualSearch=>events.status({mode:'paused',enabled:false,message:'Paused',...(manualSearch?{manualSearch}:{})});paused();
 return {el,store,calls,feed,paused,disconnect(){events.onerror()},openAdd(){el('add-video').listeners.click()},openSearch(){el('manual-search-open').listeners.click()},chooseProject(id){el('manual-search-project').value=id;el('manual-search-project').listeners.change()},submitAdd(){return el('video-form').listeners.submit({preventDefault(){}})},submitSearch(){return el('manual-search-form').listeners.submit({preventDefault(){}})},chooseVideo(){el('manual-search-options').listeners.change({target:{type:'checkbox',checked:true,dataset:{manualId:candidate.id,manualJob:job}}})}};
}
test('adding a video requires an explicit destination in All projects and preserves the draft',async()=>{
 for(const projects of [[project('a')],[project('a'),project('b')]]){
  const a=await setup(projects);a.openAdd();assert.match(a.el('video-context').innerHTML,/option value="">Choose a project/);assert.equal(a.el('video-context').value,'');
  a.el('video-url').value='https://youtu.be/testVideo01';a.el('video-title').value='Draft';await a.submitAdd();
  assert.match(a.el('video-error').textContent,/choose a project/i);assert.equal(a.el('video-title').value,'Draft');assert.equal(a.el('video-dialog').open,true);assert.equal(a.store.get('yourtube.state.v1'),undefined);
  a.el('video-context').value='a';await a.submitAdd();assert.equal(JSON.parse(a.store.get('yourtube.state.v1')).customVideos[0].context,'a');
 }
 const none=await setup([]);none.openAdd();assert.equal(none.el('video-dialog').open,false);assert.match(none.el('toast').textContent,/Add a project/);
 const selected=await setup([project('a'),project('b')],'b');selected.openAdd();assert.equal(selected.el('video-context').value,'b');
});
test('manual search starts only after choosing a destination in All projects',async()=>{
 for(const projects of [[project('a')],[project('a'),project('b')]]){
  const a=await setup(projects);a.openSearch();assert.match(a.el('manual-search-project').innerHTML,/option value="">Choose a project/);assert.equal(a.el('manual-search-project').value,'');assert.equal(a.el('manual-search-submit').disabled,true);
  a.el('manual-search-query').value='public topic';await a.submitSearch();assert.equal(a.calls.length,0);assert.match(a.el('manual-search-status').textContent,/choose a project/i);assert.equal(a.el('manual-search-query').value,'public topic');
  a.chooseProject('a');assert.equal(a.el('manual-search-submit').disabled,false);await a.submitSearch();assert.equal(a.calls.length,1);
 }
 const none=await setup([]);none.openSearch();assert.equal(none.el('manual-search-submit').disabled,true);assert.match(none.el('manual-search-status').textContent,/Add an available project/);
 const selected=await setup([project('a'),project('b')],'b');selected.openSearch();assert.equal(selected.el('manual-search-project').value,'b');assert.equal(selected.el('manual-search-submit').disabled,false);
});
test('resumed results need an explicit available destination and retain selected results on error',async()=>{
 const a=await setup([project('a'),project('b')]);a.paused({id:job,state:'ready',videos:[candidate]});a.openSearch();a.chooseVideo();assert.equal(a.el('manual-search-project').value,'');assert.equal(a.el('manual-search-save').disabled,true);
 await a.el('manual-search-save').listeners.click();assert.equal(a.store.get('yourtube.state.v1'),undefined);assert.match(a.el('manual-search-status').textContent,/choose a project/i);
 a.chooseProject('b');assert.equal(a.el('manual-search-save').disabled,false);a.feed.contexts.splice(1,1);a.el('manual-search-project').value='b';await a.el('manual-search-save').listeners.click();assert.equal(a.store.get('yourtube.state.v1'),undefined);assert.match(a.el('manual-search-status').textContent,/no longer available/i);assert.match(a.el('manual-search-count').textContent,/1 of 1 selected/);
 a.chooseProject('a');await a.el('manual-search-save').listeners.click();assert.equal(JSON.parse(a.store.get('yourtube.state.v1')).customVideos[0].context,'a');
});

test('manual search becomes available after status reconnects without changing the destination',async()=>{
 const a=await setup([project('a')],'a');a.openSearch();a.el('manual-search-query').value='public topic';assert.equal(a.el('manual-search-submit').disabled,false);
 a.disconnect();assert.equal(a.el('manual-search-submit').disabled,true);a.paused();assert.equal(a.el('manual-search-project').value,'a');assert.equal(a.el('manual-search-submit').disabled,false,'a valid idle status restores the control');
 await a.submitSearch();assert.equal(a.calls.length,1);
});
