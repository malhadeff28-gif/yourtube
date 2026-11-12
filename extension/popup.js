'use strict';
const $=id=>document.getElementById(id);
async function send(value){try{return await chrome.runtime.sendMessage(value)}catch{return {error:'unavailable'}}}
function setText(id,value){$(id).textContent=value}
function stateText(value){
 if(value?.error==='unpaired')return 'Not connected. Pair the extension first.';
 if(value?.error||!value?.status)return 'Service status is unknown. Open the local app to check.';
 if(value.status.enabled)return value.status.watcherReady?'Live is on. New local Codex chat messages may be processed.':'Live is enabled, but the chat watcher is unavailable.';
 return 'Live is paused.';
}
async function load(){
 const p=await send({type:'preferences'});$('enabled').checked=p?.enabled===true;
 setText('pair-status',p?.paired?'Pairing code saved on this Mac.':'No pairing code saved.');
 setText('live-status',stateText(await send({type:'status'})));
}
$('pair').addEventListener('click',async()=>{
 const token=$('token').value.trim(); $('pair').disabled=true;const result=await send({type:'pair',token});$('token').value='';$('pair').disabled=false;
 setText('pair-status',result?.ok?'Code saved locally.':result?.error==='invalid-token'?'Enter the complete pairing code from the local app.':'Could not save the code.');
 if(result?.ok)setText('live-status',stateText(await send({type:'status'})));
});
$('forget').addEventListener('click',async()=>{const r=await send({type:'unpair'});$('token').value='';if(r?.ok){$('enabled').checked=false;setText('pair-status','Connection forgotten; panel turned off.');setText('live-status','Not connected. This does not pause chat reading.');}else setText('pair-status','Could not forget the connection.');});
$('enabled').addEventListener('change',async()=>{const desired=$('enabled').checked;const r=await send({type:'set-panel',enabled:desired});if(!r?.ok){$('enabled').checked=!desired;setText('pair-status',r?.error==='unpaired'?'Connect the extension before showing the panel.':'Could not change the panel setting.');}});
$('pause').addEventListener('click',async()=>{$('pause').disabled=true;setText('live-status','Requesting pause…');const r=await send({type:'pause'});$('pause').disabled=false;setText('live-status',r?.status?.enabled===false?'Pause confirmed at this moment. A pending or other-tab enable could turn it back on.':stateText(r));});
$('check').addEventListener('click',async()=>setText('live-status',stateText(await send({type:'status'}))));
load();
