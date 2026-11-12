'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'..','dist','extension-projection.js'),'utf8');
const EXT='chrome-extension://anbgckjkfioebbbhigpolefmhhllkdhh',MARKER='a'.repeat(64),NONCE='b'.repeat(32);
function setup(raw=null,marker=MARKER){
 const map=new Map();if(raw!==null)map.set('yourtube.state.v1',raw);if(marker!==null)map.set('yourtube.extension.partition.v1',marker);
 const sent=[],listeners={},parent={postMessage:(data,origin)=>sent.push({data,origin})};let calls=0,resolveFetch;
 const feed={contexts:[{id:'a',name:'PRIVATE PROJECT',task:'private'},{id:'b',name:'OTHER',task:'other'}],videos:[{id:'testVideo01',context:'a',title:'Alpha',channel:'One',reason:'PRIVATE REASON'},{id:'testVideo02',context:'a',title:'Hidden',channel:'Two'},{id:'testVideo03',context:'b',title:'Other',channel:'Three'}]};
 const sandbox={window:{parent,addEventListener:(name,fn)=>listeners[name]=fn},localStorage:{getItem:key=>map.has(key)?map.get(key):null},fetch:async()=>{calls++;return {ok:true,json:async()=>feed}},setTimeout,clearTimeout,AbortController};
 vm.runInNewContext(script,sandbox);const send=(extra={})=>listeners.message({origin:EXT,source:parent,data:{type:'yourtube:project',nonce:NONCE,partitionMarker:MARKER,...extra}});
 return {map,sent,listeners,parent,feed,send,calls:()=>calls,setFetch:fn=>{sandbox.fetch=fn}};
}
test('projection requires exact extension sender and matching partition marker before fetching',async()=>{
 const a=setup(null,null);await a.send();assert.equal(a.calls(),0);assert.equal(a.sent[0].data.type,'yourtube:error');
 const b=setup(null,'f'.repeat(64));await b.send();assert.equal(b.calls(),0);assert.equal(b.sent[0].data.type,'yourtube:error');
 const c=setup();await c.listeners.message({origin:'https://www.youtube.com',source:c.parent,data:{type:'yourtube:project',nonce:NONCE,partitionMarker:MARKER}});assert.equal(c.calls(),0);assert.equal(c.sent.length,0);
 await c.listeners.message({origin:EXT,source:{},data:{type:'yourtube:project',nonce:NONCE,partitionMarker:MARKER}});assert.equal(c.calls(),0);
});
test('projection honors hidden videos and project associations without exposing private context',async()=>{
 const raw=JSON.stringify({contextEdits:{a:{note:'SECRET NOTE'}},customContexts:[],deletedContexts:[],hiddenVideos:['testVideo02'],projectHiddenVideos:[{id:'testVideo03',context:'b'}],customVideos:[{id:'testVideo04',context:'a',title:'Manual',channel:'Channel'}]});
 const a=setup(raw);await a.send();assert.equal(a.calls(),1);const result=a.sent[0];assert.equal(result.origin,EXT);assert.equal(result.data.type,'yourtube:result');assert.deepEqual(Array.from(result.data.videos,v=>v.id),['testVideo01','testVideo04']);assert.doesNotMatch(JSON.stringify(result),/SECRET|PRIVATE|reason|context/);
});
test('pending, malformed, unknown or changed state fails closed',async()=>{
 for(const raw of ['{bad',JSON.stringify({__yourtubePendingDeletion:{id:'a',token:'secret'}}),JSON.stringify({futurePrivacyField:true}),JSON.stringify({removedVideos:[{id:'testVideo01',saved:false},{id:'testVideo01',saved:true}]}),JSON.stringify({projectHiddenVideos:[{id:'testVideo01',context:'a'},{id:'testVideo01',context:'a'}]}),JSON.stringify({videoNotes:[{id:'testVideo01',context:'a',text:'private'},{id:'testVideo01',context:'a',text:'private'}]})]){const a=setup(raw);await a.send();assert.equal(a.calls(),0);assert.equal(a.sent[0].data.type,'yourtube:error')}
 const a=setup('{}');let finish;const waiting=new Promise(r=>finish=r);a.setFetch(async()=>{await waiting;return {ok:true,json:async()=>a.feed}});const p=a.send();a.map.set('yourtube.state.v1',JSON.stringify({hiddenVideos:['testVideo01']}));finish();await p;assert.equal(a.sent[0].data.type,'yourtube:error');
});
test('a transient pending marker invalidates and stays blocked until frame reload',async()=>{
 const a=setup('{}');await a.send();assert.equal(a.sent[0].data.type,'yourtube:result');a.listeners.storage({key:'yourtube.state.v1',oldValue:'{}',newValue:JSON.stringify({__yourtubePendingDeletion:{id:'a',token:'secret'}})});assert.equal(a.sent[1].data.type,'yourtube:invalidate');await a.send({nonce:'c'.repeat(32)});assert.equal(a.sent[2].data.type,'yourtube:error');assert.equal(a.calls(),1);
});
test('projection bounds cards and refuses ambiguous project identifiers',async()=>{
 const a=setup('{}');a.feed.videos=Array.from({length:45},(_,i)=>({id:`v${String(i).padStart(10,'0')}`,context:'a',title:'Video',channel:'Channel'}));await a.send();assert.equal(a.sent[0].data.videos.length,30);
 const b=setup(JSON.stringify({customContexts:[{id:'a'}]}));await b.send();assert.equal(b.sent[0].data.type,'yourtube:error');
});
