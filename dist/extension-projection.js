'use strict';
// This document runs at the local app origin. It never sends the raw feed,
// projects, notes, chats or storage to the YouTube page or its content script.
(()=>{
 const EXT='chrome-extension://anbgckjkfioebbbhigpolefmhhllkdhh', KEY='yourtube.state.v1', MARKER='yourtube.extension.partition.v1';
 const names=['contextEdits','customContexts','deletedContexts','customVideos','hiddenVideos','saved','watched','removedVideos','projectHiddenVideos','videoNotes'];
 let generation=0,connected=false,permanentlyBlocked=false;
 const reply=(message)=>window.parent.postMessage(message,EXT);
 function readState(raw){
  const state=JSON.parse(raw===null?'{}':raw);
  if(!state||typeof state!=='object'||Array.isArray(state)||Object.keys(state).some(k=>!names.includes(k))||Object.prototype.hasOwnProperty.call(state,'__yourtubePendingDeletion'))throw Error();
  const arrays=['customContexts','deletedContexts','customVideos','hiddenVideos','saved','watched','removedVideos','projectHiddenVideos','videoNotes'];
  for(const key of arrays)if(key in state&&!Array.isArray(state[key]))throw Error();
  if('contextEdits' in state&&(!state.contextEdits||typeof state.contextEdits!=='object'||Array.isArray(state.contextEdits)))throw Error();
  for(const key of ['deletedContexts','hiddenVideos','saved','watched'])if(key in state&&!state[key].every(x=>typeof x==='string'))throw Error();
  if('customContexts' in state&&!state.customContexts.every(x=>x&&typeof x==='object'&&!Array.isArray(x)&&typeof x.id==='string'))throw Error();
  if('customVideos' in state&&!state.customVideos.every(x=>x&&typeof x==='object'&&!Array.isArray(x)&&typeof x.id==='string'&&typeof x.context==='string'))throw Error();
  if('removedVideos' in state&&(!state.removedVideos.every(x=>x&&typeof x==='object'&&!Array.isArray(x)&&typeof x.id==='string'&&typeof x.saved==='boolean')||new Set(state.removedVideos.map(x=>x.id)).size!==state.removedVideos.length))throw Error();
  if('projectHiddenVideos' in state&&(!state.projectHiddenVideos.every(x=>x&&typeof x==='object'&&!Array.isArray(x)&&typeof x.id==='string'&&typeof x.context==='string')||new Set(state.projectHiddenVideos.map(x=>JSON.stringify([x.id,x.context]))).size!==state.projectHiddenVideos.length))throw Error();
  if('videoNotes' in state&&(!state.videoNotes.every(x=>x&&typeof x==='object'&&!Array.isArray(x)&&typeof x.id==='string'&&typeof x.context==='string'&&typeof x.text==='string'&&x.text.trim()&&x.text.length<=2000)||new Set(state.videoNotes.map(x=>JSON.stringify([x.id,x.context]))).size!==state.videoNotes.length))throw Error();
  if('contextEdits' in state&&!Object.values(state.contextEdits).every(x=>x&&typeof x==='object'&&!Array.isArray(x)))throw Error();
  return {customContexts:state.customContexts||[],customVideos:state.customVideos||[],deletedContexts:state.deletedContexts||[],hiddenVideos:state.hiddenVideos||[],projectHiddenVideos:state.projectHiddenVideos||[]};
 }
 function cards(feed,state){
  const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x),optionalText=(x,k)=>x[k]===undefined||typeof x[k]==='string';
  if(!record(feed)||!Array.isArray(feed.contexts)||!Array.isArray(feed.videos)||!feed.contexts.every(c=>record(c)&&typeof c.id==='string'&&typeof c.name==='string'&&typeof c.task==='string'&&optionalText(c,'note'))||!feed.videos.every(v=>record(v)&&typeof v.id==='string'&&typeof v.context==='string'&&['title','channel','reason','source'].every(k=>optionalText(v,k)))||!['focusContext','contextSource','updatedAt'].every(k=>optionalText(feed,k)))throw Error();
  const contexts=[...feed.contexts,...state.customContexts];
  if(!contexts.every(c=>c&&typeof c==='object'&&!Array.isArray(c)&&typeof c.id==='string')||new Set(contexts.map(c=>c.id)).size!==contexts.length)throw Error();
  const valid=new Set(contexts.filter(c=>!state.deletedContexts.includes(c.id)).map(c=>c.id));
  const entries=new Map();
  const bounded=(value,max)=>{const s=value.trim().slice(0,max);return /[\uD800-\uDBFF]$/.test(s)?s.slice(0,-1):s};
  function add(v,manual){
   if(!v||typeof v!=='object'||Array.isArray(v)||typeof v.id!=='string'||!/^[A-Za-z0-9_-]{11}$/.test(v.id)||typeof v.context!=='string'||!valid.has(v.context)||state.hiddenVideos.includes(v.id)||state.projectHiddenVideos.some(x=>x.id===v.id&&x.context===v.context)||typeof v.title!=='string'||!v.title.trim()||typeof v.channel!=='string'||!v.channel.trim())return;
   const title=bounded(v.title,200),channel=bounded(v.channel,100);if(!title||!channel)return;
   if(!entries.has(v.id)||manual)entries.set(v.id,{id:v.id,title,channel});
  }
  for(const v of feed.videos)add(v,false);
  for(const v of state.customVideos)add(v,true);
  return [...entries.values()].slice(0,30);
 }
 window.addEventListener('message',async e=>{
  if(e.origin!==EXT||e.source!==window.parent||!e.data||e.data.type!=='yourtube:project'||typeof e.data.nonce!=='string'||!/^[a-f0-9]{32}$/.test(e.data.nonce)||typeof e.data.partitionMarker!=='string'||!/^[a-f0-9]{64}$/.test(e.data.partitionMarker))return;
  connected=true;const nonce=e.data.nonce,mine=++generation;
  try{
   if(permanentlyBlocked||localStorage.getItem(MARKER)!==e.data.partitionMarker)throw Error();
   const raw=localStorage.getItem(KEY),state=readState(raw),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
   let data;try{const r=await fetch('/feed.json',{cache:'no-store',signal:controller.signal});if(!r.ok)throw Error();data=await r.json()}finally{clearTimeout(timer)}
   if(mine!==generation||permanentlyBlocked||localStorage.getItem(MARKER)!==e.data.partitionMarker||localStorage.getItem(KEY)!==raw)throw Error();
   const videos=cards(data,state);reply({type:'yourtube:result',nonce,videos});
  }catch{if(mine===generation)reply({type:'yourtube:error',nonce})}
 });
 window.addEventListener('storage',e=>{
  if(e.key!==KEY&&e.key!==MARKER&&e.key!==null)return;
  generation++;
  // An unresolved or malformed intervening snapshot stays blocked until this
  // frame is reopened, even if another old tab later clears the marker.
  if(e.key===KEY||e.key===null)for(const raw of [e.oldValue,e.newValue])try{readState(raw)}catch{permanentlyBlocked=true}
  if(connected)reply({type:'yourtube:invalidate'});
 });
})();
