'use strict';

// This worker is the only extension component that reads the pairing token or
// contacts the service. Never proxy arbitrary URLs or page-provided messages.
const BASE = 'http://127.0.0.1:8765';
const TOKEN = /^[0-9a-f]{64}$/;
const PAIRING = /^([0-9a-f]{64})\.([0-9a-f]{64})$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const ports = new Set(), panelPorts = new Set();
let opening=null, projectionEpoch=0, flight=null;
let storageReady = Promise.resolve().then(() => chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}));

function isYoutubeUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && (u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com') && !u.username && !u.password && !u.port; }
  catch { return false; }
}
function isPopup(sender) { return sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('popup.html'); }
function isPanel(sender) { return sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('panel.html') && !!sender.tab && isYoutubeUrl(sender.tab.url) && sender.frameId > 0; }
function isContent(sender) { return sender.id === chrome.runtime.id && sender.frameId === 0 && !!sender.tab && isYoutubeUrl(sender.url) && isYoutubeUrl(sender.tab.url); }
async function preferences() { await storageReady; return chrome.storage.local.get({panelEnabled:false, pairingToken:'', partitionMarker:''}); }
async function broadcast() {
  const {panelEnabled} = await preferences();
  for (const port of ports) { try { port.postMessage({enabled:panelEnabled === true}); } catch { ports.delete(port); } }
}
function invalidatePanels(){
  projectionEpoch++;
  for(const port of panelPorts){try{port.postMessage({invalidate:true})}catch{panelPorts.delete(port)}}
}
chrome.runtime.onConnect.addListener(port => {
  if(port.name==='yourtube-panel' && isPanel(port.sender || {})) {
    panelPorts.add(port);port.onDisconnect.addListener(()=>panelPorts.delete(port));return;
  }
  if (port.name !== 'yourtube-visibility' || !isContent(port.sender || {})) { port.disconnect(); return; }
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  preferences().then(v => port.postMessage({enabled:v.panelEnabled === true})).catch(() => { try { port.postMessage({enabled:false}); } catch {} });
});

async function ensureOffscreen(){
  const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[chrome.runtime.getURL('offscreen.html')]});
  if(contexts.length)return;
  if(!opening)opening=chrome.offscreen.createDocument({url:'offscreen.html',reasons:['IFRAME_SCRIPTING'],justification:'Apply your local video visibility settings without exposing them to YouTube.'}).finally(()=>{opening=null});
  await opening;
}
function cleanVideos(value){
  if(!value||!Array.isArray(value.videos)||value.videos.length>30)throw Error('Invalid projection');
  return value.videos.map(v=>{
    if(!v||typeof v.id!=='string'||!VIDEO_ID.test(v.id)||typeof v.title!=='string'||!v.title.trim()||v.title.length>200||typeof v.channel!=='string'||!v.channel.trim()||v.channel.length>100)throw Error('Invalid projection');
    return {id:v.id,title:v.title,channel:v.channel};
  });
}
async function project(marker,epoch){
  await ensureOffscreen();
  if(epoch!==projectionEpoch)throw Error('Projection changed');
  if(flight){if(flight.marker!==marker||flight.epoch!==epoch)throw Error('Projection changed');return flight.promise}
  if(!flight){
    const current={marker,epoch};
    let timer;
    current.promise=Promise.race([chrome.runtime.sendMessage({type:'yourtube:offscreen-project',partitionMarker:marker}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Projection timeout')),8000)})]).finally(()=>{clearTimeout(timer);if(flight===current)flight=null});
    flight=current;
  }
  return flight.promise;
}

async function service(path, method='GET') {
  const pref = await preferences();
  if (!TOKEN.test(pref.pairingToken)) return {error:'unpaired'};
  const options = {method, cache:'no-store', credentials:'omit', redirect:'error', referrerPolicy:'no-referrer', headers:{Authorization:`Bearer ${pref.pairingToken}`}, signal:AbortSignal.timeout(8000)};
  if (method === 'POST') { options.headers['Content-Type']='application/json'; options.body=path==='/api/extension/status'?'{}':JSON.stringify({enabled:false}); }
  try {
    const response=await fetch(BASE+path, options);
    if (response.status === 401 || response.status === 403) return {error:'unpaired'};
    if (!response.ok) return {error:'unavailable'};
    return {value:await response.json()};
  } catch { return {error:'unavailable'}; }
}
function sanitizeStatus(value) {
  if (!value || typeof value.enabled !== 'boolean' || typeof value.watcherReady !== 'boolean' || typeof value.mode !== 'string') throw new Error('Invalid response');
  return {enabled:value.enabled,watcherReady:value.watcherReady};
}
async function handle(message, sender) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return {error:'unauthorized'};
  const popup=isPopup(sender), panel=isPanel(sender);
  const offscreen=sender.id===chrome.runtime.id && sender.url===chrome.runtime.getURL('offscreen.html') && !sender.tab;
  if(offscreen && message.type==='yourtube:projection-invalidated'){
    invalidatePanels();
    return {ok:true};
  }
  if (popup && message.type === 'preferences') {
    const p=await preferences(); return {enabled:p.panelEnabled === true, paired:TOKEN.test(p.pairingToken) && TOKEN.test(p.partitionMarker)};
  }
  if (popup && message.type === 'pair') {
    const pair=typeof message.token === 'string' ? PAIRING.exec(message.token) : null;
    if (!pair) return {error:'invalid-token'};
    await preferences(); await chrome.storage.local.set({pairingToken:pair[1],partitionMarker:pair[2]}); invalidatePanels(); return {ok:true};
  }
  if (popup && message.type === 'unpair') {
    await preferences(); await chrome.storage.local.set({pairingToken:'',partitionMarker:'',panelEnabled:false}); invalidatePanels(); await broadcast(); return {ok:true};
  }
  if (popup && message.type === 'set-panel') {
    if (typeof message.enabled !== 'boolean') return {error:'invalid-request'};
    const p=await preferences(); if (message.enabled && (!TOKEN.test(p.pairingToken) || !TOKEN.test(p.partitionMarker))) return {error:'unpaired'};
    await chrome.storage.local.set({panelEnabled:message.enabled}); if(!message.enabled)invalidatePanels(); await broadcast(); return {ok:true};
  }
  if (panel && message.type === 'feed') {
    const p=await preferences(); if (p.panelEnabled !== true) return {error:'disabled'};
    if (!TOKEN.test(p.partitionMarker)) return {error:'unpaired'};
    const result=await service('/api/extension/status','POST'); if (result.error) return result;
    sanitizeStatus(result.value);
    const epoch=projectionEpoch, projected=await project(p.partitionMarker,epoch);
    const after=await preferences();
    if (after.panelEnabled !== true || after.pairingToken !== p.pairingToken || after.partitionMarker !== p.partitionMarker || epoch!==projectionEpoch) return {error:'disabled'};
    return {videos:cleanVideos(projected)};
  }
  if (popup && (message.type === 'status' || message.type === 'pause')) {
    const result=await service(message.type === 'pause' ? '/api/extension/live' : '/api/extension/status','POST');
    if (result.error) return result;
    return {status:sanitizeStatus(result.value)};
  }
  return {error:'unauthorized'};
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse) => {
  Promise.resolve().then(() => handle(message,sender)).then(sendResponse,() => sendResponse({error:'unavailable'}));
  return true;
});
