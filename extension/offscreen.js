'use strict';
// This document is extension-origin and is never web-accessible. It hosts the
// localhost projection so Chrome uses the top-level extension storage context.
const LOCAL='http://127.0.0.1:8765', markerPattern=/^[0-9a-f]{64}$/;
const frame=document.createElement('iframe');frame.title='Local YourTube data filter';
let ready=false, active=null;
function finish(value){if(!active)return;const p=active;active=null;clearTimeout(p.timer);p.respond(value)}
function send(){
 if(!ready||!active||!frame.contentWindow)return;
 frame.contentWindow.postMessage({type:'yourtube:project',nonce:active.nonce,partitionMarker:active.marker},LOCAL);
}
frame.addEventListener('load',()=>{ready=true;send()});
window.addEventListener('message',event=>{
 if(event.origin!==LOCAL||event.source!==frame.contentWindow||!event.data||typeof event.data!=='object')return;
 if(event.data.type==='yourtube:invalidate'){
   const previous=active;active=null;if(previous)clearTimeout(previous.timer);
   chrome.runtime.sendMessage({type:'yourtube:projection-invalidated'}).then(()=>previous?.respond({error:'invalidated'}),()=>previous?.respond({error:'invalidated'}));return;
 }
 if(!active||event.data.nonce!==active.nonce)return;
 if(event.data.type==='yourtube:error'){finish({error:'unavailable'});return}
 if(event.data.type!=='yourtube:result'||!Array.isArray(event.data.videos)||event.data.videos.length>30){finish({error:'unavailable'});return}
 finish({videos:event.data.videos});
});
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(sender.id!==chrome.runtime.id||sender.url!==chrome.runtime.getURL('worker.js')||sender.tab||message?.type!=='yourtube:offscreen-project'||!markerPattern.test(message.partitionMarker||''))return;
 if(active){respond({error:'busy'});return}
 const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);
 const nonce=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
 active={nonce,marker:message.partitionMarker,respond,timer:setTimeout(()=>finish({error:'unavailable'}),7000)};send();return true;
});
frame.src=LOCAL+'/extension-projection.html';document.body.appendChild(frame);
