'use strict';
let startupFailed=false, activeStartupEvents=null;
function showStartupFailure(reloadPage=false){
 startupFailed=true;if(activeStartupEvents){activeStartupEvents.close();activeStartupEvents=null}
 const grid=document.getElementById('grid'),warning=document.createElement('p'),retry=document.createElement('button'),pause=document.createElement('button');
 document.getElementById('live-toggle').disabled=true;
 warning.setAttribute('role','alert');warning.textContent='Could not load the local feed. Live may still be on. Pause Live, retry the feed, or stop the service.';
 retry.type='button';retry.textContent='Retry loading the feed';retry.addEventListener('click',()=>{retry.disabled=true;if(reloadPage){window.location.reload();return}grid.textContent='Retrying…';start().catch(()=>showStartupFailure(true))});
 pause.type='button';pause.textContent='Pause Live';pause.addEventListener('click',async()=>{if(pause.disabled)return;pause.disabled=true;const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);try{const response=await fetch('/api/live',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:false}),signal:controller.signal});if(!response.ok)throw Error();const result=await response.json();if(result.enabled!==false||result.mode!=='paused')throw Error();warning.textContent='Server confirmed Live is paused. Retry loading the feed.'}catch{warning.textContent='Could not confirm Live is paused. Retry, or stop the service to pause it.'}finally{clearTimeout(timeout);pause.disabled=false}});
 grid.replaceChildren(warning,retry,pause);
}
function validFeed(data){
 const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x), optionalText=(x,key)=>x[key]===undefined||typeof x[key]==='string';
 return record(data)&&Array.isArray(data.contexts)&&Array.isArray(data.videos)
  &&data.contexts.every(c=>record(c)&&typeof c.id==='string'&&typeof c.name==='string'&&typeof c.task==='string'&&optionalText(c,'note'))
  &&data.videos.every(v=>record(v)&&typeof v.id==='string'&&typeof v.context==='string'&&['title','channel','reason','source'].every(key=>optionalText(v,key)))
  &&['focusContext','contextSource','updatedAt'].every(key=>optionalText(data,key));
}
function initializeBrowserStateExport(){
 const $=id=>document.getElementById(id),KEY='yourtube.state.v1';
// This export is an explicit opaque snapshot of one browser key. It does not
// parse, repair, write, or send the stored data and is available when blocked.
const BROWSER_EXPORT_MAX_BYTES=2*1024*1024;
let browserExportSnapshot=null;
function clearBrowserExport(){browserExportSnapshot=null;$('browser-state-export-preview').value='';$('browser-state-export-status').textContent='';$('browser-state-export-download').disabled=true;$('browser-state-export-reveal').disabled=false}
$('browser-state-export-open').addEventListener('click',()=>{if($('browser-state-export-dialog').open)return;clearBrowserExport();$('browser-state-export-dialog').showModal()});
$('browser-state-export-dialog').addEventListener('close',clearBrowserExport);
$('browser-state-export-reveal').addEventListener('click',()=>{
 if(!$('browser-state-export-dialog').open||browserExportSnapshot!==null)return;
 let raw;try{raw=localStorage.getItem(KEY)}catch{$('browser-state-export-status').textContent='Browser data could not be read. No snapshot was created.';return}
 if(raw===null){$('browser-state-export-status').textContent='No browser data is stored under this key. No snapshot was created.';return}
 if(raw.length>BROWSER_EXPORT_MAX_BYTES){$('browser-state-export-status').textContent='Browser data exceeds the 2 MiB export limit. Nothing was truncated or exported.';return}
 const snapshot=JSON.stringify({format:'yourtube-browser-state-snapshot',version:1,storageKey:KEY,raw});
 let byteLength;try{byteLength=new Blob([snapshot],{type:'application/json;charset=utf-8'}).size}catch{$('browser-state-export-status').textContent='Could not prepare the snapshot. No data was exported.';return}
 if(byteLength>BROWSER_EXPORT_MAX_BYTES){$('browser-state-export-status').textContent='Browser data exceeds the 2 MiB export limit. Nothing was truncated or exported.';return}
 browserExportSnapshot=snapshot;$('browser-state-export-preview').value=snapshot;$('browser-state-export-download').disabled=false;$('browser-state-export-reveal').disabled=true;$('browser-state-export-status').textContent='Snapshot captured in this tab. It does not update if browser data changes. Review it before sharing.';
});
$('browser-state-export-download').addEventListener('click',()=>{
 if(!$('browser-state-export-dialog').open||browserExportSnapshot===null||$('browser-state-export-download').disabled)return;
 if($('browser-state-export-preview').value!==browserExportSnapshot){$('browser-state-export-status').textContent='Preview changed. Close and reveal a new snapshot before downloading.';return}
 let url;try{url=URL.createObjectURL(new Blob([browserExportSnapshot],{type:'application/json;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='yourtube-browser-state-snapshot.json';document.body.appendChild(link);link.click();link.remove();$('browser-state-export-status').textContent='Download started. The file is unencrypted; review it before sharing.'}catch{$('browser-state-export-status').textContent='Could not start download. You can copy the preview instead.'}finally{if(url)setTimeout(()=>URL.revokeObjectURL(url),1000)}
});
 $('browser-state-export-close').addEventListener('click',()=>$('browser-state-export-dialog').close());
 $('browser-state-export-close-action').addEventListener('click',()=>$('browser-state-export-dialog').close());
}
initializeBrowserStateExport();
async function start(){
 startupFailed=false;
 const loadFeed = async signal => {const response = await fetch('feed.json', {cache:'no-store',signal}); if(!response.ok) throw new Error('Feed unavailable'); const data=await response.json();if(!validFeed(data))throw new Error('Invalid feed');return data;};
 const initialController=new AbortController(),initialTimeout=setTimeout(()=>initialController.abort(),10000);
 try{window.SEED=await loadFeed(initialController.signal)}catch{showStartupFailure();return}finally{clearTimeout(initialTimeout)}
 let feedVersion=JSON.stringify(window.SEED),feedRequest=0;
const $ = id => document.getElementById(id), KEY = 'yourtube.state.v1';
const blank = () => ({contextEdits:{},customContexts:[],deletedContexts:[],customVideos:[],hiddenVideos:[],saved:[],watched:[],removedVideos:[],projectHiddenVideos:[],videoNotes:[]});
let state, stateRaw, storageBlocked=false, pendingRecovery=null, stateUntrusted=false;
// Keep every unresolved ID masked until reload, even if another tab changes the marker.
const maskedProjects=new Set();
try {
 stateRaw=localStorage.getItem(KEY);
 const parsed=JSON.parse(stateRaw===null?'{}':stateRaw);
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('Invalid state');
 for(const key of ['customContexts','deletedContexts','customVideos','hiddenVideos','saved','watched','removedVideos','projectHiddenVideos','videoNotes'])if(key in parsed&&!Array.isArray(parsed[key]))throw Error('Invalid state');
 if('contextEdits' in parsed&&(!parsed.contextEdits||typeof parsed.contextEdits!=='object'||Array.isArray(parsed.contextEdits)))throw Error('Invalid state');
 for(const key of ['deletedContexts','hiddenVideos','saved','watched'])if(key in parsed&&!parsed[key].every(x=>typeof x==='string'))throw Error('Invalid state');
 if('customContexts' in parsed&&!parsed.customContexts.every(x=>x&&typeof x==='object'&&typeof x.id==='string'))throw Error('Invalid state');
 if('customVideos' in parsed&&!parsed.customVideos.every(x=>x&&typeof x==='object'&&typeof x.id==='string'&&typeof x.context==='string'))throw Error('Invalid state');
 if('removedVideos' in parsed&&(!parsed.removedVideos.every(x=>x&&typeof x==='object'&&!Array.isArray(x)&&typeof x.id==='string'&&typeof x.saved==='boolean')||new Set(parsed.removedVideos.map(x=>x.id)).size!==parsed.removedVideos.length))throw Error('Invalid state');
 if('projectHiddenVideos' in parsed&&(!parsed.projectHiddenVideos.every(x=>x&&typeof x==='object'&&!Array.isArray(x)&&typeof x.id==='string'&&typeof x.context==='string')||new Set(parsed.projectHiddenVideos.map(x=>JSON.stringify([x.id,x.context]))).size!==parsed.projectHiddenVideos.length))throw Error('Invalid state');
 if('videoNotes' in parsed&&(!parsed.videoNotes.every(x=>x&&typeof x==='object'&&!Array.isArray(x)&&typeof x.id==='string'&&typeof x.context==='string'&&typeof x.text==='string'&&x.text.trim()&&x.text.length<=2000)||new Set(parsed.videoNotes.map(x=>JSON.stringify([x.id,x.context]))).size!==parsed.videoNotes.length))throw Error('Invalid state');
 if('contextEdits' in parsed&&!Object.values(parsed.contextEdits).every(x=>x&&typeof x==='object'&&!Array.isArray(x)))throw Error('Invalid state');
 if('__yourtubePendingDeletion' in parsed){const marker=parsed.__yourtubePendingDeletion;if(!marker||typeof marker!=='object'||Array.isArray(marker)||typeof marker.id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(marker.id)||typeof marker.token!=='string'||!marker.token)throw Error('Invalid pending deletion');pendingRecovery=marker;maskedProjects.add(marker.id);storageBlocked=true}
 state={...blank(),...parsed};
} catch { state=blank();storageBlocked=true;stateUntrusted=true; }
function showStorageWarning(message){$('storage-warning').textContent=message||'';$('storage-retry-delete').hidden=true;$('storage-retry-delete').disabled=true}
if(storageBlocked||typeof navigator==='undefined'||!navigator.locks?.request)showStorageWarning(pendingRecovery?'A previous project deletion is unresolved. That project is hidden; editing, manual search, Live review and retry are temporarily unavailable. Enabling Live is unavailable. Live may still be on; you can still pause it. Keep your browser data and copy any drafts.':stateUntrusted?'Browser data could not be safely accessed. Project data is hidden because its state cannot be verified. Editing is disabled; manual search and Live review are unavailable. Enabling Live is unavailable. Live may still be on; you can still pause it. Copy any drafts, then update or reopen this browser in the same profile.':'Browser data cannot be safely coordinated. Editing is disabled; copy any drafts, then update or reopen this browser in the same profile.');
// A separate preference avoids changing project data or deletion recovery state.
// Default closed: never request a remote image without an explicit saved opt-in.
const THUMBNAIL_KEY='yourtube.thumbnails.v1';let thumbnailsEnabled=false;
try{thumbnailsEnabled=localStorage.getItem(THUMBNAIL_KEY)==='enabled'}catch{$('thumbnail-status').textContent='Thumbnail preference could not be read. Thumbnails are off in this tab.'}
$('thumbnail-toggle').checked=thumbnailsEnabled;
$('thumbnail-toggle').addEventListener('change',()=>{
 const wanted=$('thumbnail-toggle').checked;
 // Hide immediately, even if persistence fails. Never enable on an unconfirmed write.
 thumbnailsEnabled=false;
 try{
  const value=wanted?'enabled':'disabled';localStorage.setItem(THUMBNAIL_KEY,value);
  if(localStorage.getItem(THUMBNAIL_KEY)!==value)throw Error('Preference not saved');
  thumbnailsEnabled=wanted;$('thumbnail-status').textContent='';
 }catch{
  // setItem can succeed even when verification fails; try to fail closed on reload too.
  try{localStorage.setItem(THUMBNAIL_KEY,'disabled')}catch{}
  $('thumbnail-status').textContent='Could not save the thumbnail preference. Thumbnails are off in this tab, but may load again after reloading. Check browser storage and this setting.';
 }
 $('thumbnail-toggle').checked=thumbnailsEnabled;render();
});
// Cooperating tabs receive preference changes without touching the project-state lock.
window.addEventListener?.('storage',event=>{
 // A clear can affect both keys: mask project data before rerendering images.
 if(event.key===KEY||event.key===null)handlePendingStateStorage(event);
 if(event.key!==THUMBNAIL_KEY&&event.key!==null)return;
 try{thumbnailsEnabled=localStorage.getItem(THUMBNAIL_KEY)==='enabled';$('thumbnail-status').textContent=''}
 catch{thumbnailsEnabled=false;$('thumbnail-status').textContent='Thumbnail preference could not be read. Thumbnails are off in this tab.'}
 $('thumbnail-toggle').checked=thumbnailsEnabled;render();
});
let active = window.SEED.focusContext || 'all', view = 'all', liveState = {mode:'connecting', message:'Connecting to local live service.'};
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function projectMasked(id){return stateUntrusted||maskedProjects.has(id)}
function contexts(){ return [...window.SEED.contexts.filter(c=>!projectMasked(c.id)).map(c=>({...c,...state.contextEdits[c.id]})),...state.customContexts.filter(c=>!projectMasked(c.id))].filter(c=>!state.deletedContexts.includes(c.id)); }
// Prefer a user's manual details where the same video has multiple records.
// Keep separate project associations so each project's filter remains useful.
function collapseVideos(items,key,rank=()=>0){const manual=new Set(state.customVideos),result=[],positions=new Map();for(const video of items){const k=key(video);if(!positions.has(k)){positions.set(k,result.length);result.push(video)}else{const current=result[positions.get(k)],difference=rank(video)-rank(current);if(difference>0||(difference===0&&manual.has(video)&&!manual.has(current)))result[positions.get(k)]=video}}return result}
function videos(){ const valid = new Set(contexts().map(c=>c.id)); return collapseVideos([...window.SEED.videos,...state.customVideos].filter(v=>valid.has(v.context)&&!state.hiddenVideos.includes(v.id)&&!state.projectHiddenVideos.some(x=>x.id===v.id&&x.context===v.context)),v=>JSON.stringify([v.id,v.context])); }
function visibleVideos(all=videos()){
 const q=$('search').value.trim().toLowerCase();
 // Match and prefer a note's project before collapsing shared videos, even if
 // another project has manually entered metadata that also matches the query.
 const notes=q?new Map(state.videoNotes.map(n=>[JSON.stringify([n.id,n.context]),n.text.toLowerCase()])):null;
 const noteMatches=v=>Boolean(q&&(notes.get(JSON.stringify([v.id,v.context]))||'').includes(q));
 return collapseVideos(all.filter(v=>(active==='all'||v.context===active)&&(view!=='saved'||state.saved.includes(v.id))&&(view!=='watched'||state.watched.includes(v.id))&&(!q||[v.title,v.channel,v.reason].some(s=>String(s||'').toLowerCase().includes(q))||noteMatches(v))),v=>v.id,v=>Number(noteMatches(v)));
}
const conflictMessage='YourTube browser data changed or cannot be safely accessed. Copy any drafts and reload before editing.';
// All updated tabs serialize writes with Web Locks. This cannot coordinate older
// app versions or unrelated scripts that do not use the same lock.
async function withStorageLock(work,allowRecovery=false){
 let expected=stateRaw;
 if(storageBlocked&&pendingRecovery&&!allowRecovery)return {error:'A project deletion is unresolved. Editing and deletion retry are temporarily unavailable. Keep your browser data and copy this draft.'};
 if((storageBlocked&&!(allowRecovery&&pendingRecovery))||typeof navigator==='undefined'||!navigator.locks?.request)return {error:conflictMessage};
 try{return await navigator.locks.request(KEY,{ifAvailable:true},async lock=>{
  if(!lock)return {error:'Another YourTube tab is saving. Keep your draft and try again.'};
  if((storageBlocked&&!(allowRecovery&&pendingRecovery))||stateRaw!==expected||localStorage.getItem(KEY)!==expected)return {error:conflictMessage};
  return await work(next=>{try{if(stateRaw!==expected||localStorage.getItem(KEY)!==expected)return false;const raw=JSON.stringify(next);localStorage.setItem(KEY,raw);state=next;stateRaw=raw;expected=raw;return true}catch{return false}});
 })}catch{return {error:conflictMessage}}
}
async function persist(next){return withStorageLock(commit=>commit(next)?{ok:true}:{error:'Could not save to this browser. Your draft is still here; try again.'})}
let toastTimer;function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2800)}
function selectContext(id){active=id;render()}
function render(){
 const cs=contexts(), all=videos(), current=cs.find(c=>c.id===active); if(active!=='all'&&!current){active='all';return render()}
 // Rebuilding navigation detaches its buttons. Restore only a control that was
 // already focused; never move focus from a search field or an open dialog.
 const focus=document.activeElement,root=focus&&$('context-nav').contains(focus)?'context-nav':focus&&$('filters').contains(focus)?'filters':null;
 const focusKey=root&&(focus.hasAttribute('data-context')?'context':focus.hasAttribute('data-view')?'view':focus.hasAttribute('data-new-context')?'new-context':null),focusValue=focusKey&&focus.dataset[focusKey==='new-context'?'newContext':focusKey];
 // Keep the focused card control through rerenders, including background refreshes.
 const gridKey=focus&&$('grid').contains(focus)?['save','hide','play','watched','hide-project','edit-video','note-video','copy-video'].find(key=>focus.hasAttribute(`data-${key}`)):null;
 const gridSelector=gridKey?`[data-${gridKey}]`:null,gridBefore=gridKey?[...$('grid').querySelectorAll(gridSelector)]:[],gridIndex=gridBefore.indexOf(focus),gridDataKey=gridKey==='hide-project'?'hideProject':gridKey==='edit-video'?'editVideo':gridKey==='note-video'?'noteVideo':gridKey==='copy-video'?'copyVideo':gridKey,gridId=gridKey&&focus.dataset[gridDataKey],gridOccurrence=gridKey?gridBefore.filter(button=>button.dataset[gridDataKey]===gridId).indexOf(focus):-1;
 $('context-nav').innerHTML=cs.map(c=>`<button class="context-nav ${active===c.id?'selected':''}" data-context="${esc(c.id)}" aria-pressed="${active===c.id}"><span></span>${esc(c.name)}</button>`).join('');
 document.querySelectorAll('.nav').forEach(n=>{const selected=n.dataset.view===view&&(view!=='all'||active==='all');n.classList.toggle('selected',selected);n.setAttribute('aria-pressed',String(selected))});
 $('save-count').textContent=state.saved.filter(id=>all.some(v=>v.id===id)).length||'';
 $('focus-kicker').textContent=current?'CURRENT FOCUS':'YOUR CONTEXT'; $('focus-title').textContent=current?current.name:'A feed that follows your work.'; $('focus-task').textContent=current?current.task:'Choose a project to focus your feed, or explore everything below.';
 $('feed-title').textContent=view==='saved'?(current?`Watch later · ${current.name}`:'Your watch later list'):view==='watched'?(current?`Watched · ${current.name}`:'Your watched videos'):current?`For ${current.name}`:'Picked for what you’re working on';
 $('feed-subtitle').textContent=view==='saved'?(current?'Videos saved in this browser for this project.':'Videos you saved in this browser.'):view==='watched'?(current?'Videos marked watched in this browser for this project.':'Videos you marked watched in this browser.'):(window.SEED.contextSource==='Empty starter feed'?'No feed updates yet.':`Curated from recent work · ${window.SEED.updatedAt ? 'Updated '+new Date(window.SEED.updatedAt).toLocaleString() : 'Update time unavailable'}`);
 $('filters').innerHTML='<div class="filter-group" role="group" aria-label="Project">'+[{id:'all',name:'All projects'},...cs].map(c=>`<button class="chip ${active===c.id?'active':''}" data-context="${esc(c.id)}" aria-pressed="${active===c.id}">${esc(c.name)}</button>`).join('')+'<button class="chip" data-new-context>+ Project</button></div>'+`<div class="filter-group" role="group" aria-label="Video status"><button class="chip ${view==='all'?'active':''}" data-view="all" aria-pressed="${view==='all'}">All videos</button><button class="chip ${view==='saved'?'active':''}" data-view="saved" aria-pressed="${view==='saved'}">♡ Watch later</button><button class="chip ${view==='watched'?'active':''}" data-view="watched" aria-pressed="${view==='watched'}">✓ Watched</button></div>`;
 const q=$('search').value.trim().toLowerCase();const found=visibleVideos(all);
 $('grid').innerHTML=found.length?found.map(v=>{const c=cs.find(c=>c.id===v.context);const saved=state.saved.includes(v.id),watched=state.watched.includes(v.id),note=state.videoNotes.find(n=>n.id===v.id&&n.context===v.context);return `<article class="card"><button class="thumb" data-play="${esc(v.id)}" aria-label="Play ${esc(v.title)}">${thumbnailsEnabled?`<img loading="lazy" referrerpolicy="no-referrer" src="https://i.ytimg.com/vi/${esc(v.id)}/hqdefault.jpg" alt="">`:""}<span class="play" aria-hidden="true">▶</span></button><div class="card-top"><button class="card-title" data-play="${esc(v.id)}">${esc(v.title)}</button><button class="save ${saved?'is-saved':''}" data-save="${esc(v.id)}" aria-label="${esc(`${saved?'Remove from':'Add to'} watch later: ${v.title||v.id}`)}" aria-pressed="${saved}">${saved?'♥':'♡'}</button></div><div class="meta">${esc(v.channel)} · ${esc(c?.name)}</div><div class="reason"><strong>WHY IT'S HERE</strong>${esc(v.reason||'Added to this project by you.')}</div><div class="card-tools"><span>${esc(v.source)}</span>${state.customVideos.some(item=>item.id===v.id&&item.context===v.context)?`<button data-edit-video="${esc(v.id)}" data-edit-context="${esc(v.context)}" aria-label="${esc(`Edit details: ${v.title||v.id}`)}">Edit details</button>`:''}<button data-note-video="${esc(v.id)}" data-note-context="${esc(v.context)}" aria-label="${esc(`${note?'Edit note':'Add note'}: ${v.title||v.id} — ${c?.name||'project'}`)}">${note?'Edit note':'Add note'}</button><button data-copy-video="${esc(v.id)}" data-copy-context="${esc(v.context)}" aria-label="${esc(`Copy to project: ${v.title||v.id}`)}">Copy to project</button><button data-watched="${esc(v.id)}" aria-pressed="${watched}" aria-label="${esc(`Watched: ${v.title||v.id}`)}">Watched</button>${active!=='all'?`<button data-hide-project="${esc(v.id)}" data-project="${esc(v.context)}" aria-label="${esc(`Remove from this project: ${v.title||v.id}`)}">Remove from this project</button>`:''}<button data-hide="${esc(v.id)}" aria-label="${esc(`Remove from feed: ${v.title||v.id}`)}">Remove from feed</button></div></article>`}).join(''):(!q&&view==='all'&&!cs.length?(pendingRecovery||stateUntrusted?`<div class="empty"><h3>Projects are unavailable.</h3><p>Some project data is hidden because browser state cannot be safely resolved. Keep your browser data and see the warning above.</p></div>`:`<div class="empty"><h3>Start with a project.</h3><p>Add a project and a video manually, or explore a sample feed. Live chat reading starts paused; review How this works before enabling it.</p><a class="text-button" href="/demo.html">Try a sample feed ↗</a></div>`):`<div class="empty"><h3>Nothing here yet.</h3><p>${q?'Try a different search.':view==='saved'?(current?'No saved videos in this project yet. Save a video to come back to it later.':'Save a video to come back to it later.'):view==='watched'?(current?'No watched videos in this project yet. Mark videos watched to see them here.':'Mark videos watched to see them here.'):'Add a video or ask Codex to update this collection.'}</p></div>`);
 if(focusKey){const target=[...$(root).querySelectorAll(`[data-${focusKey}]`)].find(item=>focusKey==='new-context'||item.dataset[focusKey]===focusValue);(target||(focusKey==='context'?[...$('filters').querySelectorAll('[data-context]')].find(item=>item.dataset.context==='all'):null))?.focus()}
 if(gridKey){const controls=[...$('grid').querySelectorAll(gridSelector)],same=controls.filter(button=>button.dataset[gridDataKey]===gridId),target=same[gridOccurrence]||controls[Math.min(gridIndex,controls.length-1)]||$('search');target.focus()}
}
async function refreshFeed(announce=false){const request=++feedRequest,controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);try{const next=await loadFeed(controller.signal);if(request!==feedRequest)return;const version=JSON.stringify(next);if(version!==feedVersion){window.SEED=next;feedVersion=version;render();if($('manual-search-dialog').open)showManualProjectDetails();if(announce)toast('YourTube updated for your latest work.')}}catch(err){if(request===feedRequest)throw err}finally{clearTimeout(timeout)}}
$('context-nav').addEventListener('click',e=>{const btn=e.target.closest('[data-context]');if(btn)selectContext(btn.dataset.context)});
$('filters').addEventListener('click',e=>{const btn=e.target.closest('[data-context]');if(btn)selectContext(btn.dataset.context);else if(e.target.closest('[data-view]')){view=e.target.closest('[data-view]').dataset.view;render()}else if(e.target.closest('[data-new-context]'))openContext(true)});
$('search').addEventListener('input',render);
document.querySelectorAll('.nav').forEach(button=>button.addEventListener('click',()=>{view=button.dataset.view;if(view==='all')active='all';render()}));
$('grid').addEventListener('click',async e=>{
 const play=e.target.closest('[data-play]'),save=e.target.closest('[data-save]'),hide=e.target.closest('[data-hide]'),hideProject=e.target.closest('[data-hide-project]'),watched=e.target.closest('[data-watched]'),edit=e.target.closest('[data-edit-video]'),note=e.target.closest('[data-note-video]'),copy=e.target.closest('[data-copy-video]');
 if(copy)openVideoCopy(copy.dataset.copyVideo,copy.dataset.copyContext,copy);
 if(edit)openVideoEdit(edit.dataset.editVideo,edit.dataset.editContext,edit);
 if(note)openVideoNote(note.dataset.noteVideo,note.dataset.noteContext,note);
 if(play){const video=visibleVideos().find(v=>v.id===play.dataset.play);if(!video)return;$('player-title').textContent=video.title;$('open-youtube').href=`https://www.youtube.com/watch?v=${video.id}`;const frame=document.createElement('iframe');frame.title=video.title;frame.src=`https://www.youtube-nocookie.com/embed/${video.id}?rel=0`;frame.allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';frame.referrerPolicy='strict-origin-when-cross-origin';frame.allowFullscreen=true;$('player').replaceChildren(frame);$('player-dialog').showModal()}
 if(save){const id=save.dataset.save,saved=state.saved.includes(id)?state.saved.filter(x=>x!==id):[...state.saved,id],result=await persist({...state,saved});if(result.ok)render();else reportDeletion(result.error)}
 if(watched){const id=watched.dataset.watched,items=state.watched.includes(id)?state.watched.filter(x=>x!==id):[...state.watched,id],result=await persist({...state,watched:items});if(result.ok)render();else reportDeletion(result.error)}
 if(hideProject){const id=hideProject.dataset.hideProject,project=hideProject.dataset.project;if(active!==project||!videos().some(v=>v.id===id&&v.context===project)||contextSaveBlock(project)){reportDeletion('This project or video is no longer available.');return}if(!confirm('Remove this video from this project in this browser? It remains in other projects.'))return;const next={...state,projectHiddenVideos:[...state.projectHiddenVideos.filter(x=>x.id!==id||x.context!==project),{id,context:project}]},result=await persist(next);if(result.ok){render();reportDeletion('Removed from this project. Use Recently removed to restore it.')}else reportDeletion(result.error)}
 if(hide&&confirm('Remove this video from your feed?')){const id=hide.dataset.hide,next={...state,hiddenVideos:[...state.hiddenVideos.filter(x=>x!==id),id],saved:state.saved.filter(x=>x!==id),removedVideos:[...state.removedVideos.filter(x=>x.id!==id),{id,saved:state.saved.includes(id)}]},result=await persist(next);if(result.ok){render();reportDeletion('Video removed. Use Recently removed to restore it.')}else reportDeletion(result.error)}
});
$('player-dialog').addEventListener('close',()=>$('player').replaceChildren());
document.querySelectorAll('[data-close]').forEach(button=>{if(button.dataset.close!=='browser-state-export-dialog')button.addEventListener('click',()=>$(button.dataset.close).close())});
let contextDialogGeneration=0;const deferredDeletionNotices=[],pendingDeletions=new Set(),uncertainDeletions=new Set();
function contextSaveBlock(id){if(stateUntrusted)return 'Browser data cannot be safely accessed. Copy your draft and reload before editing.';if(projectMasked(id))return 'This project is hidden while browser data cannot be safely resolved.';if(pendingDeletions.has(id))return 'Deletion is in progress. Your draft is still here; wait for the result.';if(uncertainDeletions.has(id))return 'Could not confirm project deletion. Copy your draft and reload to check before saving.';if(state.deletedContexts.includes(id))return 'This project was deleted. Copy your draft, then add a new project to save it.';return ''}
function reportDeletion(message){if(document.querySelector('dialog[open]'))deferredDeletionNotices.push(message);else toast([...deferredDeletionNotices.splice(0),message].join(' '))}
// Removed IDs are global across projects. Reuse the current feed or manual
// entries instead of saving a second copy of potentially private metadata.
function restorableVideos(id){const valid=new Set(contexts().filter(c=>!pendingDeletions.has(c.id)&&!uncertainDeletions.has(c.id)).map(c=>c.id));return [...state.customVideos,...window.SEED.videos].filter(v=>v.id===id&&valid.has(v.context))}
// An unresolved project deletion can temporarily hide an association. Do not
// treat any removal as orphaned until deletion has been resolved.
function removalStatus(id){if(pendingRecovery||pendingDeletions.size||uncertainDeletions.size)return 'deletion-pending';return restorableVideos(id).length?'restorable':'orphan'}
function renderRemoved(){
 // An orphan ID could belong solely to the masked project; do not surface it while unresolved.
 const ids=[...new Set(state.hiddenVideos)].filter(id=>!(pendingRecovery||stateUntrusted)||restorableVideos(id).length);
 $('removed-list').innerHTML=ids.length?ids.map(id=>{const video=restorableVideos(id)[0],record=state.removedVideos.find(x=>x.id===id),name=video?.title||id,status=removalStatus(id);const details=video?(record?(record.saved?'Previously in Watch later':'Not previously in Watch later'):'Previous Watch later status not recorded'):(status==='deletion-pending'?'A previous project deletion is unresolved. Editing and retry are temporarily unavailable; keep your browser data.':'No video remains in an available project. You can allow adding this ID again.');const action=video?`<button type="button" data-restore-video="${esc(id)}" aria-label="${esc(`Restore ${name}`)}">Restore</button>`:`<button type="button" data-allow-video="${esc(id)}" aria-label="${esc(`Allow adding ${id} again`)}" ${status==='orphan'?'':'disabled'}>Allow adding again</button>`;return `<li><strong>${esc(name)}</strong><span>${details}</span>${action}</li>`}).join(''):'<li>No removed videos.</li>';
 const projects=contexts(),visibleProjectRemovals=state.projectHiddenVideos.filter(item=>!projectMasked(item.context));$('removed-project-list').innerHTML=visibleProjectRemovals.length?visibleProjectRemovals.map(item=>{const project=projects.find(c=>c.id===item.context),video=restorableVideos(item.id).find(v=>v.context===item.context),available=project&&video,name=video?.title||item.id;return `<li><strong>${esc(name)}</strong><span>${available?`Removed from ${esc(project.name)}${state.hiddenVideos.includes(item.id)?'; still removed from the whole feed':''}`:'Unavailable: the video or project is no longer available.'}</span><button type="button" data-restore-project-video="${esc(item.id)}" data-project="${esc(item.context)}" aria-label="${esc(`Restore to project: ${name} — ${project?.name||'project'}`)}" ${available?'':'disabled'}>Restore to project</button></li>`}).join(''):'<li>No videos removed from individual projects.</li>';
}
$('show-removed').addEventListener('click',()=>{renderRemoved();$('removed-error').textContent='';$('removed-dialog').showModal()});
$('removed-list').addEventListener('click',async e=>{
 const allow=e.target.closest('[data-allow-video]');
 if(allow){
  if(allow.disabled||allow.dataset.allowing==='true')return;
  const id=allow.dataset.allowVideo,record=state.removedVideos.find(x=>x.id===id);
  if(!state.hiddenVideos.includes(id)||removalStatus(id)!=='orphan'){renderRemoved();$('removed-error').textContent='This removal is no longer unavailable, or a project deletion is unresolved. Review the current list.';return}
  const history=record?.saved?'Its prior Watch later status will be restored.':record?'It was not previously in Watch later.':'Its previous Watch later status was not recorded.';
  if(!confirm(`Allow adding this video ID again? This clears the feed-wide removal. Existing or future project associations may reappear. ${history} Individual project removals remain in place.`))return;
  allow.dataset.allowing='true';allow.setAttribute('aria-disabled','true');
  const result=await withStorageLock(commit=>{
   if(!state.hiddenVideos.includes(id)||removalStatus(id)!=='orphan')return {error:'This removal changed or a project deletion is unresolved. Review the current list.'};
   const current=state.removedVideos.find(x=>x.id===id),saved=current?.saved&&!state.saved.includes(id)?[...state.saved,id]:state.saved;
   return commit({...state,hiddenVideos:state.hiddenVideos.filter(x=>x!==id),removedVideos:state.removedVideos.filter(x=>x.id!==id),saved})?{ok:true}:{error:'Could not save to this browser. Try again.'};
  });
  if(!result.ok){delete allow.dataset.allowing;allow.removeAttribute('aria-disabled');if($('removed-dialog').open){renderRemoved();$('removed-error').textContent=result.error}else reportDeletion(result.error);return}
  const focused=document.activeElement===allow;render();renderRemoved();const message='Feed-wide removal cleared. You can add the video again; individual project removals remain.';if($('removed-dialog').open)$('removed-error').textContent=message;else reportDeletion(message);if(focused)$('close-removed').focus();return;
 }
 const button=e.target.closest('[data-restore-video]');if(!button||button.disabled||button.dataset.restoring==='true')return;
 const id=button.dataset.restoreVideo;
 if(!state.hiddenVideos.includes(id)||!restorableVideos(id).length){renderRemoved();$('removed-error').textContent='This video is no longer available in an existing project.';return}
 const record=state.removedVideos.find(x=>x.id===id),saved=record?.saved&&!state.saved.includes(id)?[...state.saved,id]:state.saved;
 button.dataset.restoring='true';button.setAttribute('aria-disabled','true');const result=await persist({...state,hiddenVideos:state.hiddenVideos.filter(x=>x!==id),removedVideos:state.removedVideos.filter(x=>x.id!==id),saved});
 if(!result.ok){delete button.dataset.restoring;button.removeAttribute('aria-disabled');if($('removed-dialog').open)$('removed-error').textContent=result.error;else reportDeletion(result.error);return}
 const focused=document.activeElement===button,previous=focused?[...$('removed-list').querySelectorAll('[data-restore-video]:not(:disabled)')]:[],index=previous.indexOf(button);
 render();renderRemoved();const stillHidden=restorableVideos(id).every(v=>state.projectHiddenVideos.some(x=>x.id===id&&x.context===v.context)),message=stillHidden?'Restored from the feed-wide removal, but still removed from its available projects.':'Video restored.';if($('removed-dialog').open)$('removed-error').textContent=message;else reportDeletion(message);
 if(focused){const available=[...$('removed-list').querySelectorAll('[data-restore-video]:not(:disabled)')];(available[Math.min(index,available.length-1)]||$('close-removed')).focus()}
});

$('removed-project-list').addEventListener('click',async e=>{const button=e.target.closest('[data-restore-project-video]');if(!button||button.disabled||button.dataset.restoring==='true')return;const id=button.dataset.restoreProjectVideo,project=button.dataset.project;if(contextSaveBlock(project)||!state.projectHiddenVideos.some(x=>x.id===id&&x.context===project)||!restorableVideos(id).some(v=>v.context===project)){renderRemoved();$('removed-error').textContent='This video or project is no longer available.';return}button.dataset.restoring='true';button.setAttribute('aria-disabled','true');const result=await persist({...state,projectHiddenVideos:state.projectHiddenVideos.filter(x=>x.id!==id||x.context!==project)});if(!result.ok){delete button.dataset.restoring;button.removeAttribute('aria-disabled');if($('removed-dialog').open)$('removed-error').textContent=result.error;else reportDeletion(result.error);return}const focused=document.activeElement===button,previous=focused?[...$('removed-project-list').querySelectorAll('[data-restore-project-video]:not(:disabled)')]:[],index=previous.indexOf(button);render();renderRemoved();const message=state.hiddenVideos.includes(id)?'Restored to this project, but still removed from the whole feed.':'Restored to this project.';if($('removed-dialog').open)$('removed-error').textContent=message;else reportDeletion(message);if(focused){const available=[...$('removed-project-list').querySelectorAll('[data-restore-project-video]:not(:disabled)')];(available[Math.min(index,available.length-1)]||$('close-removed')).focus()}});

document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('close',()=>{if(!document.querySelector('dialog[open]')&&deferredDeletionNotices.length)toast(deferredDeletionNotices.splice(0).join(' '))}));
function contextFormBusy(value){for(const id of ['context-name','context-task','context-note','context-save','context-sync'])$(id).disabled=value;$('delete-context').disabled=true}
function videoFormBusy(value){for(const id of ['video-url','video-title','video-channel','video-context','video-reason','video-save'])$(id).disabled=value}
let contextDialogMode='create',contextDialogSnapshot=null,contextDialogLiveSnapshot=null;
function openContext(isNew=false,selectedId=null){
 const cs=contexts();
 if(!isNew&&!selectedId&&active==='all'&&cs.length){contextDialogGeneration++;contextDialogMode='choose';$('context-id').value='';$('context-choose-select').innerHTML='<option value="">Choose a project</option>'+cs.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');$('context-choose-select').value='';$('context-choose-error').textContent='';$('context-choose-dialog').showModal();return}
 const id=selectedId||active,context=!isNew?cs.find(c=>c.id===id):null;
 if(!isNew&&!context&&cs.length){toast('This project is no longer available. Choose a project to edit.');return}
 contextDialogGeneration++;contextFormBusy(false);contextDialogMode=context?'edit':'create';contextDialogSnapshot=context?JSON.stringify(context):null;const liveProject=context&&window.SEED.contexts.find(c=>c.id===context.id);contextDialogLiveSnapshot=liveProject?JSON.stringify(liveProject):null;$('context-error').textContent='';$('context-dialog-title').textContent=context?'Edit your context':'Add a project';$('context-id').value=context?.id||'';$('context-name').value=context?.name||'';$('context-task').value=context?.task||'';$('context-note').value=context?.note||'';$('delete-context').hidden=!context;$('context-error').textContent=context?contextSaveBlock(context.id):'';$('context-dialog').showModal()
}
$('context-choose-form').addEventListener('submit',e=>{e.preventDefault();const id=$('context-choose-select').value,project=contexts().find(c=>c.id===id);if(!id||!project){$('context-choose-error').textContent='Choose an available project.';return}const blocked=contextSaveBlock(id);if(blocked){$('context-choose-error').textContent=blocked;return}$('context-choose-dialog').close();openContext(false,id)});
// Export exactly the visible preview on explicit request. This is not a backup.
function refreshProjectExport(){const id=$('project-export-select').value,project=contexts().find(c=>c.id===id);if(!project||pendingDeletions.has(id)||uncertainDeletions.has(id)||storageBlocked){$('project-export-preview').value='';$('project-export-status').textContent='This project is unavailable. Close and reopen the export.';$('project-export-download').disabled=true;return}const items=videos().filter(v=>v.context===id),valid=items.filter(v=>/^[A-Za-z0-9_-]{11}$/.test(v.id));const line=value=>String(value||'').replace(/[\r\n]+/g,' ').trim();$('project-export-preview').value=['YourTube project: '+line(project.name),'',...valid.flatMap(v=>{const note=$('project-export-notes').checked&&state.videoNotes.find(n=>n.id===v.id&&n.context===id);return ['- '+(line(v.title)||v.id)+(line(v.channel)?' — '+line(v.channel):''),'  https://www.youtube.com/watch?v='+v.id,...(note?['  Personal note:',...note.text.split('\n').map(part=>'    '+part)]:[])]})].join('\n')+'\n';$('project-export-status').textContent=valid.length+' video'+(valid.length===1?'':'s')+(valid.length!==items.length?'; '+(items.length-valid.length)+' with invalid IDs omitted.':'.');$('project-export-download').disabled=false}
$('project-export-open').addEventListener('click',()=>{if(storageBlocked){toast('Browser data is unavailable or unresolved. Resolve it before exporting.');return}const projects=contexts();if(!projects.length){toast('Add a project before exporting.');return}$('project-export-select').innerHTML=projects.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');$('project-export-select').value=projects.some(c=>c.id===active)?active:projects[0].id;$('project-export-notes').checked=false;refreshProjectExport();$('project-export-dialog').showModal()});
$('project-export-select').addEventListener('change',()=>{$('project-export-notes').checked=false;refreshProjectExport()});
$('project-export-notes').addEventListener('change',refreshProjectExport);
$('project-export-download').addEventListener('click',()=>{if(!$('project-export-dialog').open||$('project-export-download').disabled)return;const id=$('project-export-select').value;if(storageBlocked||pendingDeletions.has(id)||uncertainDeletions.has(id)||!contexts().some(c=>c.id===id)){$('project-export-status').textContent='This project is unavailable or unresolved. Close and reopen the export.';return}let url;try{url=URL.createObjectURL(new Blob([$('project-export-preview').value],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='yourtube-project.txt';document.body.appendChild(link);link.click();link.remove();$('project-export-status').textContent='Download started. Review the file before sharing.'}catch{$('project-export-status').textContent='Could not start download. You can copy the preview instead.'}finally{if(url)setTimeout(()=>URL.revokeObjectURL(url),1000)}});
$('add-context').addEventListener('click',()=>openContext(true));$('edit-context').addEventListener('click',()=>openContext(false));$('focus-edit').addEventListener('click',()=>openContext(false));$('how-it-works').addEventListener('click',()=>{$('context-source').textContent=pendingRecovery||stateUntrusted?'Context details are hidden while browser data is unresolved.':'Context used for this collection: '+(window.SEED.contextSource||'Not specified')+'.';$('live-detail').textContent=liveState.message+(!(pendingRecovery||stateUntrusted)&&liveState.lastSearch?' Last general search: '+liveState.lastSearch:'');$('info-dialog').showModal()});
$('context-form').addEventListener('submit',async e=>{const generation=contextDialogGeneration;e.preventDefault();const previousError=$('context-error').textContent;$('context-error').textContent='';if(contextDialogMode==='choose')return;const existingId=$('context-id').value;if(contextDialogMode==='edit'&&(!existingId||!contexts().some(c=>c.id===existingId))){$('context-error').textContent='This project was deleted or is unavailable. Copy your draft and choose another project.'+(previousError.includes('Browser changes could not be saved')?' Browser changes could not be saved and may reappear after reload.':'');return}const id=existingId||crypto.randomUUID();const item={id,name:$('context-name').value.trim(),task:$('context-task').value.trim(),note:$('context-note').value.trim()};if(!item.name||!item.task)return;const blocked=contextSaveBlock(id);if(blocked){const partial=previousError.includes('Browser changes could not be saved')?' Browser changes could not be saved and may reappear after reload.':'';$('context-error').textContent=blocked+partial;return}const editing=contextDialogMode==='edit',snapshot=contextDialogSnapshot;contextFormBusy(true);const result=await withStorageLock(commit=>{if(editing){const current=contexts().find(c=>c.id===id);if(!current||JSON.stringify(current)!==snapshot||contextSaveBlock(id))return {error:'This project changed or is unavailable. Copy your draft and reload before saving.'}}const next=window.SEED.contexts.some(c=>c.id===id)?{...state,contextEdits:{...state.contextEdits,[id]:item}}:{...state,customContexts:[...state.customContexts.filter(c=>c.id!==id),item]};return commit(next)?{ok:true}:{error:'Could not save to this browser. Your draft is still here; try again.'}});const sameDialog=$('context-dialog').open&&generation===contextDialogGeneration;if(sameDialog)contextFormBusy(false);if(!result.ok){if(sameDialog)$('context-error').textContent=result.error;else reportDeletion(result.error);return}if(sameDialog){$('context-dialog').close();active=id;view='all'}render();reportDeletion('Context saved in this browser.')});
$('context-sync').addEventListener('click',async()=>{
 const id=$('context-id').value,generation=contextDialogGeneration,sameDialog=()=>$('context-dialog').open&&generation===contextDialogGeneration&&$('context-id').value===id;
 $('context-error').textContent='';const saved=contexts().find(c=>c.id===id),blocked=contextSaveBlock(id);
 if(!id||!saved){$('context-error').textContent='Save this project in this browser before copying it to Live.';return}
 const storedProject=window.SEED.contexts.find(c=>c.id===id);if(!storedProject&&!contextDialogLiveSnapshot){$('context-error').textContent='Browser-only projects cannot yet be copied to Live. No stored project was changed.';return}const expectedSnapshot=contextDialogLiveSnapshot;if(!storedProject||!expectedSnapshot||JSON.stringify(storedProject)!==expectedSnapshot){$('context-error').textContent='The stored project changed or is no longer available. Refresh and reopen this project before copying.';return}
 if(blocked){$('context-error').textContent=blocked;return}
 if($('context-name').value.trim()!==saved.name||$('context-task').value.trim()!==saved.task){$('context-error').textContent='Save your name and task edits in this browser first, then reopen this project.';return}
 if(!confirm('Copy this saved project name and task to the local Live feed? When Live is enabled or resumed, these stored details may be sent to Codex after best-effort redaction, including immediately if Live is already enabled. Notes stay in this browser. This does not start Live.'))return;
 contextFormBusy(true);
 const outcome=await withStorageLock(async()=>{
  const current=contexts().find(c=>c.id===id);if(!current||contextSaveBlock(id)||current.name!==saved.name||current.task!==saved.task)return {error:'The browser project changed. Reload and review before copying.'};
  const storedNow=window.SEED.contexts.find(c=>c.id===id);if(!storedNow||JSON.stringify(storedNow)!==expectedSnapshot)return {error:'The stored project changed or is no longer available. Refresh and review before retrying.'};const expected=JSON.parse(expectedSnapshot),controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);let response;
  try{response=await fetch('/api/context/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,name:saved.name,task:saved.task,expected}),signal:controller.signal})}catch{return {error:'Could not confirm whether the project was copied. Refresh and check the stored project before retrying.'}}finally{clearTimeout(timeout)}
  if(response.status===409)return {error:'Live is updating or the stored project changed. Refresh and review it before retrying.'};
  if(!response.ok)return {error:'Could not confirm whether the project was copied. Refresh and check the stored project before retrying.'};
  try{await refreshFeed();return {ok:true}}catch{return {ok:true,warning:'Project copied to the local Live feed, but refresh failed. Reload to check it.'}}
 });
 if(sameDialog())contextFormBusy(false);
 if(outcome.error){if(sameDialog())$('context-error').textContent=outcome.error;else reportDeletion(outcome.error);return}
 const message=outcome.warning||'Project name and task copied to the local Live feed.';if(sameDialog())$('context-error').textContent=message;else reportDeletion(message);
});
$('delete-context').addEventListener('click',()=>{$('context-error').textContent='Project deletion is temporarily unavailable. No project data was changed.'});
let noteGeneration=0,noteTarget=null,noteOpener=null;
function noteBusy(value){$('video-note-text').disabled=value;$('video-note-save').disabled=value}
function openVideoNote(id,project,opener){
 const item=videos().find(v=>v.id===id&&v.context===project),context=contexts().find(c=>c.id===project);
 if(!item||!context||contextSaveBlock(project)){reportDeletion('This video or project is no longer available.');return}
 noteGeneration++;noteTarget={id,project};noteOpener=opener;noteBusy(false);$('video-note-error').textContent='';$('video-note-project').textContent=context.name+' — '+(item.title||item.id);$('video-note-text').value=state.videoNotes.find(n=>n.id===id&&n.context===project)?.text||'';$('video-note-dialog').showModal();
}
$('video-note-form').addEventListener('submit',async e=>{
 e.preventDefault();$('video-note-error').textContent='';const generation=noteGeneration,target=noteTarget,opener=noteOpener;if(!target)return;const text=$('video-note-text').value;
 if(text.length>2000){$('video-note-error').textContent='Notes can be up to 2,000 characters.';return}
 noteBusy(true);const result=await withStorageLock(commit=>{
  const block=contextSaveBlock(target.project);if(block)return {error:block};
  if(!videos().some(v=>v.id===target.id&&v.context===target.project))return {error:'This video or project is no longer available. Copy your draft before closing.'};
  const videoNotes=state.videoNotes.filter(n=>n.id!==target.id||n.context!==target.project);if(text.trim())videoNotes.push({id:target.id,context:target.project,text});
  return commit({...state,videoNotes})?{ok:true}:{error:'Could not save to this browser. Your draft is still here; try again.'};
 });
 const same=$('video-note-dialog').open&&generation===noteGeneration;if(same)noteBusy(false);
 if(!result.ok){if(same)$('video-note-error').textContent=result.error;else reportDeletion(result.error);return}
 if(same)$('video-note-dialog').close();const refocus=same&&document.activeElement===opener;render();
 if(refocus){const button=[...$('grid').querySelectorAll('[data-note-video]')].find(item=>item.dataset.noteVideo===target.id&&item.dataset.noteContext===target.project);button?.focus()}
 reportDeletion(text.trim()?'Note saved in this browser.':'Note removed from this browser.');
});
let copyVideoGeneration=0,copyVideoTarget=null,copyVideoOpener=null,copyVideoPending=false;
function copyVideoBusy(value){copyVideoPending=value;for(const id of ['copy-video-project','copy-video-save'])$(id).disabled=value}
function openVideoCopy(id,project,opener){
 const item=videos().find(v=>v.id===id&&v.context===project),source=contexts().find(c=>c.id===project);
 if(!item||!source||contextSaveBlock(project)){reportDeletion('This video or project is no longer available to copy.');return}
 const destinations=contexts().filter(c=>c.id!==project&&!contextSaveBlock(c.id));if(!destinations.length){reportDeletion('Add another available project before copying this video.');return}
 const title=typeof item.title==='string'?item.title.trim():'',channel=typeof item.channel==='string'?item.channel.trim():'',reason=typeof item.reason==='string'?item.reason.trim():'';
 if(!/^[A-Za-z0-9_-]{11}$/.test(id)||!title||title.length>200||channel.length>100||reason.length>300){reportDeletion('This video has invalid details and cannot be copied.');return}
 copyVideoGeneration++;copyVideoTarget={id,project,title,channel,reason};copyVideoOpener=opener;copyVideoBusy(false);$('copy-video-error').textContent='';$('copy-video-source').textContent='Video: '+title+' · From: '+source.name;
 $('copy-video-project').innerHTML=destinations.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');$('copy-video-project').value=destinations[0].id;$('copy-video-dialog').showModal();
}
$('copy-video-form').addEventListener('submit',async e=>{
 e.preventDefault();if(copyVideoPending||!copyVideoTarget)return;$('copy-video-error').textContent='';const generation=copyVideoGeneration,target=copyVideoTarget,opener=copyVideoOpener,destination=$('copy-video-project').value;
 copyVideoBusy(true);const result=await withStorageLock(commit=>{
  if(destination===target.project||!contexts().some(c=>c.id===destination)||contextSaveBlock(destination)||contextSaveBlock(target.project))return {error:'This project is unavailable or being deleted. Choose another project.'};
  if(state.hiddenVideos.includes(target.id)||state.projectHiddenVideos.some(x=>x.id===target.id&&(x.context===destination||x.context===target.project)))return {error:'This video is removed from the source or destination. Restore it before copying.'};
  const current=videos().find(v=>v.id===target.id&&v.context===target.project);if(!current||String(current.title||'').trim()!==target.title||String(current.channel||'').trim()!==target.channel||String(current.reason||'').trim()!==target.reason)return {error:'The source video changed or is unavailable. Close and review it before copying.'};
  if([...window.SEED.videos,...state.customVideos].some(v=>v.id===target.id&&v.context===destination))return {error:'This video is already in that project.'};
  const item={id:target.id,context:destination,title:target.title,channel:target.channel||'YouTube',reason:target.reason,source:'Copied in this browser'};
  return commit({...state,customVideos:[...state.customVideos,item]})?{ok:true}:{error:'Could not save to this browser. Your selection is still here; try again.'};
 });
 const same=$('copy-video-dialog').open&&generation===copyVideoGeneration;if(same)copyVideoBusy(false);
 if(!result.ok){if(same)$('copy-video-error').textContent=result.error;else reportDeletion(result.error);return}
 if(same)$('copy-video-dialog').close();const refocus=same&&document.activeElement===opener;render();if(refocus){const button=[...$('grid').querySelectorAll('[data-copy-video]')].find(item=>item.dataset.copyVideo===target.id&&item.dataset.copyContext===target.project);button?.focus()}reportDeletion('Video copied to the selected project in this browser.');
});
let videoDialogGeneration=0,videoFormPending=false,videoProjectSnapshots=new Map();
function videoProjectIdentity(project){return JSON.stringify({visible:contexts().filter(c=>c.id===project),live:window.SEED.contexts.filter(c=>c.id===project),local:state.customContexts.filter(c=>c.id===project)})}
let editVideoGeneration=0,editVideoTarget=null,editVideoOpener=null;
function editVideoBusy(value){for(const id of ['edit-video-name','edit-video-channel','edit-video-reason','edit-video-save'])$(id).disabled=value}
function openVideoEdit(id,project,opener){
 const item=state.customVideos.find(v=>v.id===id&&v.context===project),context=contexts().find(c=>c.id===project);
 if(!item||!context||state.hiddenVideos.includes(id)||state.projectHiddenVideos.some(x=>x.id===id&&x.context===project)||contextSaveBlock(project)){reportDeletion('This video or project is no longer available for editing.');return}
 editVideoGeneration++;editVideoTarget={id,project};editVideoOpener=opener;editVideoBusy(false);$('edit-video-error').textContent='';$('edit-video-project').textContent='Project: '+context.name;$('edit-video-name').value=item.title||'';$('edit-video-channel').value=item.channel||'';$('edit-video-reason').value=item.reason||'';$('edit-video-dialog').showModal();
}
$('edit-video-form').addEventListener('submit',async e=>{
 e.preventDefault();$('edit-video-error').textContent='';const generation=editVideoGeneration,target=editVideoTarget,opener=editVideoOpener;if(!target)return;
 const name=$('edit-video-name').value.trim(),channel=$('edit-video-channel').value.trim()||'YouTube',reason=$('edit-video-reason').value.trim();
 if(!name||name.length>200||channel.length>100||reason.length>300){$('edit-video-error').textContent='Check the title, channel and reason lengths.';return}
 editVideoBusy(true);const result=await withStorageLock(commit=>{
  const block=contextSaveBlock(target.project);if(block)return {error:block};
  if(!contexts().some(c=>c.id===target.project)||state.hiddenVideos.includes(target.id)||state.projectHiddenVideos.some(x=>x.id===target.id&&x.context===target.project))return {error:'This video or project is no longer available. Copy your draft before closing.'};
  const index=state.customVideos.findIndex(v=>v.id===target.id&&v.context===target.project);if(index<0)return {error:'This video is no longer available. Copy your draft before closing.'};
  const customVideos=state.customVideos.slice();customVideos[index]={...customVideos[index],title:name,channel,reason};
  return commit({...state,customVideos})?{ok:true}:{error:'Could not save to this browser. Your draft is still here; try again.'};
 });
 const same=$('edit-video-dialog').open&&generation===editVideoGeneration;if(same)editVideoBusy(false);
 if(!result.ok){if(same)$('edit-video-error').textContent=result.error;else reportDeletion(result.error);return}
 if(same)$('edit-video-dialog').close();const refocus=same&&document.activeElement===opener;render();
 if(refocus){const button=[...$('grid').querySelectorAll('[data-edit-video]')].find(item=>item.dataset.editVideo===target.id&&item.dataset.editContext===target.project);button?.focus()}
 reportDeletion('Video details saved in this browser.');
});
$('add-video').addEventListener('click',()=>{videoDialogGeneration++;videoFormBusy(false);$('video-save').disabled=videoFormPending;const cs=contexts();if(!cs.length){toast('Add a project first.');return}videoProjectSnapshots=new Map(cs.map(c=>[c.id,videoProjectIdentity(c.id)]));$('video-form').reset();$('video-error').textContent='';$('video-context').innerHTML='<option value="">Choose a project</option>'+cs.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');$('video-context').value=active!=='all'&&cs.some(c=>c.id===active)?active:'';$('video-dialog').showModal()});
function parseVideoId(value){try{const u=new URL(value);let id='';if(u.hostname==='youtu.be')id=u.pathname.split('/')[1];else if(['youtube.com','www.youtube.com','m.youtube.com'].includes(u.hostname))id=u.pathname==='/watch'?u.searchParams.get('v'):(u.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)||[])[1];return /^[a-zA-Z0-9_-]{11}$/.test(id||'')?id:null}catch{return null}}
$('video-form').addEventListener('submit',async e=>{
 e.preventDefault();if(videoFormPending)return;const generation=videoDialogGeneration;$('video-error').textContent='';
 const project=$('video-context').value,block=contextSaveBlock(project),target=contexts().find(c=>c.id===project);
 if(!project){$('video-error').textContent='Choose a project for this video.';return}
 if(block){$('video-error').textContent=block;return}
 if(!target){$('video-error').textContent='This project is deleted or unavailable. Choose another project to save your video draft.';return}
 // The selector may predate a feed refresh; never silently retarget a draft.
 const projectSnapshot=videoProjectSnapshots.get(project);if(!projectSnapshot||videoProjectIdentity(project)!==projectSnapshot){$('video-error').textContent='This project changed or is unavailable. Copy your draft and reopen Add video to choose again.';return}
 const id=parseVideoId($('video-url').value.trim());
 if(!id){$('video-error').textContent='Enter a valid YouTube video link.';return}
 const removedMessage=()=>removalStatus(id)==='deletion-pending'?'This video was removed from your feed and a project deletion is unresolved. Editing and retry are temporarily unavailable. Keep your browser data; your draft has not been saved.':restorableVideos(id).length?'This video was removed from your feed. Use Recently removed to restore it before adding; it may also be removed from individual projects. Your draft has not been saved.':'This video was removed from your feed, but no available project contains it. Copy your draft, close this dialog, and use Allow adding again in Recently removed. Your draft has not been saved.';
 if(state.hiddenVideos.includes(id)){$('video-error').textContent=removedMessage();return}
 const hiddenHere=state.projectHiddenVideos.some(x=>x.id===id&&x.context===project),existingHere=[...window.SEED.videos,...state.customVideos].some(v=>v.id===id&&v.context===project);
 if(hiddenHere&&existingHere){$('video-error').textContent='This video was removed from this project. Use Recently removed to restore it.';return}
 if(existingHere){$('video-error').textContent='This video is already in this project.';return}
 if(hiddenHere&&!confirm('This video was removed from this project. Restore it here and add these details?'))return;
 const item={id,title:$('video-title').value.trim(),channel:$('video-channel').value.trim()||'YouTube',context:project,reason:$('video-reason').value.trim(),source:'Added by you'};if(!item.title)return;
 videoFormPending=true;videoFormBusy(true);
 const result=await withStorageLock(commit=>{
  const currentBlock=contextSaveBlock(project);if(currentBlock)return {error:currentBlock};
  if(!contexts().some(c=>c.id===project)||videoProjectIdentity(project)!==projectSnapshot)return {error:'This project changed or is unavailable. Choose a project again; your video draft is still here.'};
  if(state.hiddenVideos.includes(id))return {error:removedMessage()};
  const currentlyHidden=state.projectHiddenVideos.some(x=>x.id===id&&x.context===project),exists=[...window.SEED.videos,...state.customVideos].some(v=>v.id===id&&v.context===project);
  if(currentlyHidden!==hiddenHere)return {error:'This video’s removal state changed. Review it before adding; your draft is still here.'};
  if(exists)return {error:currentlyHidden?'This video was removed from this project. Use Recently removed to restore it.':'This video is already in this project.'};
  const next={...state,projectHiddenVideos:state.projectHiddenVideos.filter(x=>x.id!==id||x.context!==project),customVideos:[...state.customVideos,item]};
  return commit(next)?{ok:true}:{error:'Could not save to this browser. Your draft is still here; try again.'};
 });
 videoFormPending=false;const sameDialog=$('video-dialog').open&&generation===videoDialogGeneration;if($('video-dialog').open)videoFormBusy(false);
 if(!result.ok){if(sameDialog)$('video-error').textContent=result.error;else reportDeletion(result.error);return}
 if(sameDialog){$('video-dialog').close();active=item.context;view='all'}render();reportDeletion('Video added to your feed.');
});
$('storage-retry-delete').addEventListener('click',()=>{showStorageWarning('A previous project deletion is unresolved. Editing and retry are temporarily unavailable. Keep your browser data and copy any drafts.')});
render();

 let statusReady=false,liveRequestPending=false,events,reviewRequestId=null,feedRetry=null,feedSyncGeneration=0;
 let manualId=null,manualStartPending=false,manualCancelPending=false,manualCancelAwaiting=false,manualSavePending=false,manualMode='idle',manualResults=null,manualUncertain=false,manualServiceMismatch=false;
 let manualSelection=new Set(),manualSelectionJob=null,manualResultsKey='',manualEpoch=0,manualSaveToken=null,manualProjectSnapshots=new Map();
 function manualProjectIdentity(project){
  const visible=contexts().filter(c=>c.id===project),live=window.SEED.contexts.filter(c=>c.id===project),local=state.customContexts.filter(c=>c.id===project);
  if(visible.length!==1||live.length+local.length!==1)return null;
  return JSON.stringify({visible,live,local,edit:state.contextEdits[project]??null});
 }
 function manualBlocked(project){if(!project)return 'Choose a project first.';if(storageBlocked||pendingRecovery)return 'Browser editing is blocked by a storage issue or unresolved deletion. Deletion retry is temporarily unavailable; keep your browser data.';if(pendingDeletions.has(project)||uncertainDeletions.has(project)||state.deletedContexts.includes(project))return 'This project is being deleted or its deletion is unresolved.';if(!contexts().some(c=>c.id===project))return 'This project is no longer available.';if(!manualProjectIdentity(project))return 'This project is ambiguous. Refresh projects or choose another project.';return ''}
 function manualProjectIssue(project,snapshot=manualProjectSnapshots.get(project)){
  const blocked=manualBlocked(project);if(blocked)return blocked;
  if(!snapshot||manualProjectIdentity(project)!==snapshot)return 'This project changed. Refresh projects and choose it again; your search and selections are still here.';
  return '';
 }
 function refreshManualProjects(preselect=''){
  const projects=contexts().filter(c=>!pendingDeletions.has(c.id)&&!uncertainDeletions.has(c.id)),seen=new Set();manualProjectSnapshots=new Map();
  const options=[];for(const c of projects){if(seen.has(c.id))continue;seen.add(c.id);const snapshot=manualProjectIdentity(c.id),live=window.SEED.contexts.find(item=>item.id===c.id);if(snapshot)manualProjectSnapshots.set(c.id,snapshot);const liveLabel=live&&snapshot?` — stored Live: ${live.name} — ${live.task}`:'';options.push(`<option value="${esc(c.id)}"${snapshot?'':' disabled'}>${esc(c.name+liveLabel)}${snapshot?'':' (ambiguous)'}</option>`)}
  $('manual-search-project').innerHTML='<option value="">Choose a project</option>'+options.join('');$('manual-search-project').value=manualProjectSnapshots.has(preselect)?preselect:'';showManualProjectDetails();
 }
 function showManualProjectDetails(){
  const project=$('manual-search-project').value,snapshot=manualProjectSnapshots.get(project);
  if(!snapshot||manualProjectIdentity(project)!==snapshot){$('manual-search-project-details').textContent='';return}
  const selected=JSON.parse(snapshot),visible=selected.visible[0],live=selected.live[0];
  $('manual-search-project-details').textContent=live?`Selected browser project: ${visible.name} — ${visible.task}. Stored Live project: ${live.name} — ${live.task}.`:`Selected browser-only project: ${visible.name} — ${visible.task}.`;
 }

 function validManualVideos(videos){return Array.isArray(videos)&&videos.length>0&&videos.length<=4&&videos.every(v=>v&&typeof v==='object'&&typeof v.id==='string'&&/^[A-Za-z0-9_-]{11}$/.test(v.id)&&['title','channel','reason'].every(k=>typeof v[k]==='string'&&v[k].trim()&&v[k].length<=({title:200,channel:100,reason:300}[k])))&&new Set(videos.map(v=>v.id)).size===videos.length}
 function clearManualResults(){manualEpoch++;manualResults=null;manualSelection.clear();manualSelectionJob=null;manualResultsKey='';$('manual-search-options').innerHTML='';$('manual-search-results').hidden=true;$('manual-search-count').textContent=''}
 function manualControls(){
  const busy=manualMode!=='idle',ready=manualMode==='ready'&&manualId&&manualSelectionJob===manualId&&liveState.manualSearch?.id===manualId&&liveState.manualSearch.state==='ready';
  const project=$('manual-search-project').value,projectBlocked=!project||Boolean(manualBlocked(project));
  $('manual-search-project').disabled=manualMode==='searching'||manualSavePending;$('manual-search-refresh-projects').disabled=manualMode==='searching'||manualSavePending;$('manual-search-query').disabled=busy;
  $('manual-search-submit').hidden=busy;$('manual-search-submit').disabled=projectBlocked||!statusReady||liveState.enabled!==false;$('manual-search-stop').hidden=!busy;$('manual-search-stop').disabled=manualStartPending||manualCancelPending||manualSavePending||manualServiceMismatch;
  $('manual-search-stop').textContent=manualMode==='ready'?'Discard results':'Cancel search';$('manual-search-save').hidden=manualMode!=='ready';
  $('manual-search-save').disabled=!ready||!statusReady||projectBlocked||manualSelection.size===0||manualStartPending||manualCancelPending||manualSavePending||storageBlocked||Boolean(pendingRecovery);
  $('manual-search-results').disabled=manualSavePending;$('manual-search-close').textContent=busy?'Dismiss locally':'Close';
  $('manual-search-count').textContent=manualResults?`${manualSelection.size} of ${manualResults.length} selected`:'';
 }
 function syncManual(next){
  const job=next.manualSearch;if(!manualId)return;
  if(!job||job.id!==manualId){
   if(manualResults)clearManualResults();manualMode='searching';manualUncertain=true;manualServiceMismatch=true;
   $('manual-search-status').textContent=job?'The service reports a different search. These results are unavailable here; dismiss locally and reopen to check.':'The service is not reporting this search. It may still start or finish; dismiss locally or reconnect to check.';
   manualControls();return
  }
  manualServiceMismatch=false;
  if(job.state==='searching'){if(manualResults)clearManualResults();manualMode='searching';$('manual-search-status').textContent=manualCancelAwaiting?'Waiting for cancellation confirmation. You can dismiss locally and reopen to check.':'Searching. Cancel to stop it, or dismiss locally while it continues.';manualControls();return}
  if(job.state==='ready'){
   if(manualCancelAwaiting){if(manualResults)clearManualResults();manualMode='searching';$('manual-search-status').textContent='Waiting for cancellation confirmation. You can dismiss locally and reopen to check.';manualControls();return}
   if(!validManualVideos(job.videos)){manualId=null;manualMode='idle';clearManualResults();$('manual-search-status').textContent='Search returned invalid results; nothing was saved.'}
   else{const key=JSON.stringify(job.videos);if(manualSelectionJob!==manualId||manualResultsKey!==key){manualEpoch++;manualSelection.clear();manualSelectionJob=manualId;manualResultsKey=key;manualResults=job.videos;$('manual-search-options').innerHTML=job.videos.map(v=>`<div class="manual-result"><label><input type="checkbox" data-manual-id="${esc(v.id)}" data-manual-job="${esc(manualId)}"><span><strong>${esc(v.title)}</strong> — ${esc(v.channel)}<small>${esc(v.reason)}</small></span></label><a href="https://www.youtube.com/watch?v=${v.id}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(v.title)} on YouTube (opens in a new tab)">Open on YouTube (new tab)</a></div>`).join('');$('manual-search-results').hidden=false}else manualResults=job.videos;manualMode='ready';$('manual-search-status').textContent='Choose the videos to save and select a project.'}
   manualUncertain=false;manualControls();return
  }
  if(['error','canceled','expired'].includes(job.state)){manualId=null;manualMode='idle';clearManualResults();manualUncertain=false;manualStartPending=false;manualCancelAwaiting=false;$('manual-search-status').textContent=job.state==='canceled'?'Search canceled or results discarded.':job.state==='expired'?'Search results expired.':'Search failed. Your existing feed was kept.';manualControls();return}
  if(manualResults)clearManualResults();manualMode='searching';manualUncertain=true;manualServiceMismatch=true;$('manual-search-status').textContent='The service returned an unknown search status. These results are unavailable; dismiss locally or reconnect to check.';manualControls();
 }
 $('manual-search-options').addEventListener('change',e=>{const input=e.target,id=input?.dataset?.manualId;if(manualSavePending||manualMode!=='ready'||input?.type!=='checkbox'||input.dataset.manualJob!==manualId||manualSelectionJob!==manualId||!manualResults?.some(v=>v.id===id))return;if(input.checked)manualSelection.add(id);else manualSelection.delete(id);manualControls()});
 function dismissManual(){const wasBusy=Boolean(manualId);manualId=null;manualMode='idle';clearManualResults();manualUncertain=false;manualServiceMismatch=false;manualStartPending=false;manualCancelPending=false;manualCancelAwaiting=false;manualSavePending=false;manualSaveToken=null;manualControls();$('manual-search-dialog').close();if(wasBusy)toast('Dismissed locally. The search or its results may still be available; this did not cancel it.')}
 $('manual-search-open').addEventListener('click',()=>{if(pendingRecovery||stateUntrusted){toast('Search is unavailable while browser data is unresolved. Keep your browser data.');return}if($('manual-search-dialog').open)return;const projects=contexts().filter(c=>!pendingDeletions.has(c.id)&&!uncertainDeletions.has(c.id));refreshManualProjects(active!=='all'?active:'');$('manual-search-query').value='';clearManualResults();const existing=liveState.manualSearch;if(existing&&['searching','ready'].includes(existing.state)&&typeof existing.id==='string'){manualId=existing.id;syncManual(liveState)}else{manualId=null;manualMode='idle';manualResults=null;manualControls();$('manual-search-status').textContent=storageBlocked||pendingRecovery?'Browser editing is blocked by a storage issue or unresolved deletion. Deletion retry is temporarily unavailable; keep your browser data.':!projects.length?'Add an available project first.':!statusReady?'The service status is unavailable. Reconnect and try again.':liveState.enabled?'Pause Live before starting a manual search.':''}$('manual-search-dialog').showModal()});
 $('manual-search-project').addEventListener('change',()=>{showManualProjectDetails();const issue=manualProjectIssue($('manual-search-project').value);if(issue&&$('manual-search-project').value)$('manual-search-status').textContent=issue;manualControls()});
 $('manual-search-refresh-projects').addEventListener('click',()=>{if(manualMode==='searching'||manualSavePending)return;refreshManualProjects();$('manual-search-status').textContent='Projects refreshed. Choose a project; your search and selections are still here.';manualControls()});
 $('manual-search-dialog').addEventListener('cancel',e=>{if(manualId||manualStartPending){e.preventDefault();dismissManual()}});
 $('manual-search-close').addEventListener('click',dismissManual);
 $('manual-search-stop').addEventListener('click',async()=>{if(!manualId||manualStartPending||manualCancelPending)return;const id=manualId;manualCancelPending=true;manualCancelAwaiting=true;if(manualResults)clearManualResults();manualMode='searching';$('manual-search-status').textContent='Requesting cancellation. You can dismiss locally and reopen to check.';manualControls();const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);try{const response=await fetch('/api/manual-search/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id}),signal:controller.signal});if(!response.ok)throw Error();if(manualId===id)$('manual-search-status').textContent='Cancel requested; waiting for confirmation.'}catch{if(manualId===id){manualUncertain=true;$('manual-search-status').textContent='Could not confirm cancellation. Dismiss locally, reconnect, or stop the service; the search may still be running.'}}finally{clearTimeout(timeout);if(manualId===id){manualCancelPending=false;manualControls()}}});
 $('manual-search-form').addEventListener('submit',async e=>{e.preventDefault();if(manualId||manualStartPending||manualSavePending||!statusReady||liveState.enabled!==false)return;const id=crypto.randomUUID(),projectId=$('manual-search-project').value,query=$('manual-search-query').value.trim(),projectSnapshot=manualProjectSnapshots.get(projectId),blocked=manualProjectIssue(projectId,projectSnapshot);if(blocked){$('manual-search-status').textContent=blocked;return}manualId=id;manualMode='searching';manualStartPending=true;manualUncertain=false;manualServiceMismatch=false;manualControls();$('manual-search-status').textContent='Starting search…';const outcome=await withStorageLock(async()=>{const reason=manualProjectIssue(projectId,projectSnapshot);if(reason)return {error:reason};const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);try{const response=await fetch('/api/manual-search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,query}),signal:controller.signal});if(response.ok)return {ok:true};if(response.status>=400&&response.status<500)return {error:response.status===409?'Pause Live and wait for current work to finish.':'Could not start the search. Use a general public phrase.'};return {uncertain:true}}catch{return {uncertain:true}}finally{clearTimeout(timeout)}});if(manualId!==id)return;manualStartPending=false;if(outcome.error){manualId=null;manualMode='idle';$('manual-search-status').textContent=outcome.error}else if(outcome.uncertain&&manualMode!=='ready'){manualUncertain=true;$('manual-search-status').textContent='Could not confirm whether the search started. You can dismiss locally, reconnect, or stop the service.'}else if(manualMode==='searching'&&!manualServiceMismatch)$('manual-search-status').textContent='Searching. You can cancel or dismiss locally.';manualControls()});
 $('manual-search-save').addEventListener('click',async()=>{
  if(!manualId||manualMode!=='ready'||!validManualVideos(manualResults)||manualStartPending||manualCancelPending||manualSavePending||!statusReady)return;
  if(manualSelectionJob!==manualId||manualSelection.size===0){$('manual-search-status').textContent='Choose at least one video to save.';return}
  const id=manualId,project=$('manual-search-project').value,projectSnapshot=manualProjectSnapshots.get(project),key=manualResultsKey,selected=[...manualSelection],epoch=manualEpoch,token={};const initialIssue=manualProjectIssue(project,projectSnapshot);if(initialIssue){$('manual-search-status').textContent=initialIssue;manualControls();return}manualSaveToken=token;manualSavePending=true;manualControls();
  const outcome=await withStorageLock(async commit=>{
   if(manualId!==id||manualEpoch!==epoch||manualMode!=='ready'||manualSelectionJob!==id||manualResultsKey!==key||liveState.manualSearch?.id!==id||liveState.manualSearch.state!=='ready'||!statusReady||!validManualVideos(manualResults)||selected.some(chosen=>!manualResults.some(v=>v.id===chosen)))return {error:'Search results changed or expired. Review them again before saving.'};
   if($('manual-search-project').value!==project)return {error:'The destination changed. Choose a project before saving.'};const blocked=manualProjectIssue(project,projectSnapshot);if(blocked)return {error:blocked};
   const existing=[...window.SEED.videos,...state.customVideos],newVideos=[];
   for(const v of manualResults){if(!selected.includes(v.id)||state.hiddenVideos.includes(v.id)||state.projectHiddenVideos.some(x=>x.id===v.id&&x.context===project)||existing.some(x=>x.id===v.id&&x.context===project))continue;newVideos.push({id:v.id,context:project,title:v.title,channel:v.channel,reason:v.reason,source:'Manual Codex search · YouTube metadata'})}
   const skipped=selected.length-newVideos.length;if(!newVideos.length)return {ok:true,added:0,skipped};
   return commit({...state,customVideos:[...state.customVideos,...newVideos]})?{ok:true,added:newVideos.length,skipped}:{error:'Could not save results in this browser. Your results are still here; try again.'}
  });
  if(manualSaveToken===token){manualSaveToken=null;manualSavePending=false;manualControls()}if(manualId!==id||manualEpoch!==epoch||manualResultsKey!==key)return;
  if(outcome.error){$('manual-search-status').textContent=outcome.error;return}
  active=project;view='all';render();$('manual-search-status').textContent=outcome.added?`Added ${outcome.added} video${outcome.added===1?'':'s'} to this project in this browser.${outcome.skipped?` ${outcome.skipped} selected video${outcome.skipped===1?' was':'s were'} already in or removed from this project, or removed from the feed.`:''}`:'No new videos added; the selected videos are already in or removed from this project, or removed from the feed.'
 });
 const reviewsInFlight=new Set();let reviewProjects=[],reviewDrafts=new Map(),reviewProjectId='',reviewNewDraft={name:'',task:''};
 function showReviewCurrent(){const project=reviewProjects.find(p=>p.id===reviewProjectId);$('search-review-current').textContent=project?'Currently stored: '+project.name+' — '+project.task:'A new stored project will be created.'}
 $('search-review-project').addEventListener('change',()=>{reviewDrafts.set(reviewProjectId,{name:$('search-review-name').value,task:$('search-review-task').value});reviewProjectId=$('search-review-project').value;const existing=reviewProjects.find(p=>p.id===reviewProjectId);const draft=reviewDrafts.get(reviewProjectId)||(existing?{name:existing.name,task:existing.task}:reviewNewDraft);$('search-review-name').value=draft.name;$('search-review-task').value=draft.task;showReviewCurrent()});
 function updateReviewControls(){const pending=reviewRequestId&&reviewsInFlight.has(reviewRequestId);for(const id of ['search-review-query','search-review-project','search-review-name','search-review-task','search-review-approve'])$(id).disabled=!statusReady||Boolean(pending);$('search-review-cancel').textContent=!statusReady||pending?'Dismiss locally':'Cancel search'}
 function cancelFeedRetry(){feedSyncGeneration++;if(feedRetry!==null){clearTimeout(feedRetry);feedRetry=null}}
 function connectEvents(){
  if(events)events.close();cancelFeedRetry();feedRequest++;statusReady=false;if(manualResults)clearManualResults();manualControls();$('live-toggle').disabled=true;updateReviewControls();
  const current=events=activeStartupEvents=new EventSource('/events');
  current.addEventListener('status',e=>{if(startupFailed||events!==current)return;try{const next=JSON.parse(e.data);if(typeof next.enabled!=='boolean'||typeof next.mode!=='string')throw Error('Invalid status');liveState=next;statusReady=true;syncManual(next);manualControls();$('watcher-warning').hidden=!liveState.enabled||liveState.activityMayBeMissed!==true;statusReady=true;$('live-toggle').disabled=liveRequestPending;if(liveState.enabled!==false&&$('live-consent').open)$('live-consent').close();$('live-label').textContent=(pendingRecovery||stateUntrusted)&&liveState.mode==='awaiting-review'?'Review unavailable':liveState.mode==='paused'?'Paused':liveState.mode==='error'&&!liveState.watcherReady?'Retry':liveState.mode==='error'?'Live issue':liveState.mode==='awaiting-review'?'Review search':liveState.mode==='curating'||liveState.mode==='searching'||liveState.mode==='waiting'?'Updating…':'Live';$('live-toggle').title=(pendingRecovery||stateUntrusted)?'Live may still be on. Enabling Live and search review are unavailable while browser data is unresolved; you can still pause it.':liveState.message;$('live-toggle').classList.toggle('paused',liveState.mode==='paused'||liveState.mode==='error');if($('info-dialog').open)$('live-detail').textContent=liveState.message+(!(pendingRecovery||stateUntrusted)&&liveState.lastSearch?' Last general search: '+liveState.lastSearch:'');if(liveState.mode==='awaiting-review'&&liveState.requestId&&!pendingRecovery&&!stateUntrusted){if(reviewRequestId===liveState.requestId&&/^(?:Connection lost\.|Could not confirm the result;)/.test($('search-review-error').textContent))$('search-review-error').textContent='';if(reviewRequestId!==liveState.requestId){const replacing=$('search-review').open;reviewRequestId=liveState.requestId;$('search-review-query').value=liveState.pendingQuery||'';reviewProjects=Array.isArray(liveState.projectOptions)?liveState.projectOptions:[];$('search-review-project').innerHTML='<option value="">Create a new project</option>'+reviewProjects.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');const proposal=liveState.pendingProject||{};reviewProjectId=proposal.id||'';reviewNewDraft={name:proposal.name||'',task:proposal.task||''};reviewDrafts=new Map();$('search-review-project').value=reviewProjectId;$('search-review-name').value=reviewNewDraft.name;$('search-review-task').value=reviewNewDraft.task;showReviewCurrent();$('search-review-error').textContent=replacing?'A new search is ready. Review its phrase before continuing.':''}if(!$('search-review').open)$('search-review').showModal()}else{reviewRequestId=null;if($('search-review').open)$('search-review').close()}updateReviewControls()}catch{statusReady=false;if(manualResults)clearManualResults();manualControls();$('live-toggle').disabled=true;updateReviewControls()}});
  const syncFeed=()=>{if(startupFailed||events!==current)return;cancelFeedRetry();const generation=feedSyncGeneration;const attempt=number=>{if(events!==current||generation!==feedSyncGeneration)return;refreshFeed(true).catch(()=>{if(events!==current||generation!==feedSyncGeneration)return;if(number<3){feedRetry=setTimeout(()=>{feedRetry=null;attempt(number+1)},1000*2**number)}else toast('Could not load the updated feed. Reconnect or reload to try again.')})};attempt(0)};
  current.addEventListener('open',syncFeed);
  current.addEventListener('feed',syncFeed);
  current.onerror=()=>{if(startupFailed||events!==current)return;if(manualId){manualUncertain=true;$('manual-search-status').textContent='Connection lost. The search may still be running; you can dismiss locally or stop the service.'}cancelFeedRetry();feedRequest++;statusReady=false;if(manualResults)clearManualResults();manualControls();if($('live-consent').open)$('live-consent').close();liveState={mode:'disconnected',message:'Live service disconnected. Restart YourTube.'};$('live-label').textContent='Offline';$('live-toggle').disabled=true;$('live-toggle').classList.add('paused');if($('search-review').open)$('search-review-error').textContent='Connection lost. The review may still be pending or the request may have been processed. Dismiss locally or wait for reconnection.';updateReviewControls()};
 }
 connectEvents();
 // A different tab may have written an unresolved marker before its storage
 // event reaches this tab. Check the exact snapshot at every enable boundary;
 // this is deliberately not used for Pause, which must remain available.
 function canEnableLive(){
  if(pendingRecovery||stateUntrusted){toast('Live cannot be enabled while browser data is unresolved. Live may still be on; pause it if needed.');return false}
  try{
   const current=localStorage.getItem(KEY);
   if(current!==stateRaw){handlePendingStateStorage({key:KEY,oldValue:stateRaw,newValue:current});toast('Browser data changed. Reload before enabling Live; Live may still be on.');return false}
   return true;
  }catch{handlePendingStateStorage({key:KEY,oldValue:stateRaw,newValue:null});toast('Browser data cannot be verified. No enable request was sent; Live may still be on.');return false}
 }
 async function setLive(enabled){if(liveRequestPending||!statusReady||typeof liveState.enabled!=='boolean')return;if(enabled&&!canEnableLive())return;const expectedEnabled=liveState.enabled;statusReady=false;liveRequestPending=true;$('live-toggle').disabled=true;const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);try{const response=await fetch('/api/live',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled,expectedEnabled}),signal:controller.signal});if(!response.ok)throw Error()}catch{toast('Could not change Live. Reconnecting to check its status.')}finally{clearTimeout(timeout);liveRequestPending=false;connectEvents()}}
 $('live-toggle').addEventListener('click',()=>{if(!statusReady||liveRequestPending||typeof liveState.enabled!=='boolean')return;if(liveState.enabled)setLive(false);else if(canEnableLive()&&!$('live-consent').open)$('live-consent').showModal()});
 $('live-consent-cancel').addEventListener('click',()=>$('live-consent').close());
 $('live-consent-form').addEventListener('submit',e=>{e.preventDefault();if(!$('live-consent').open)return;$('live-consent').close();if(statusReady&&liveState.enabled===false&&canEnableLive())setLive(true)});
 async function reviewSearch(action){if(pendingRecovery||stateUntrusted)return;const requestId=reviewRequestId;if(action==='cancel'&&(!statusReady||reviewsInFlight.has(requestId))){$('search-review').close();toast('Dismissed locally. The review may still be pending or already processed.');return}if(!statusReady||!requestId||liveState.mode!=='awaiting-review'||liveState.requestId!==requestId||reviewsInFlight.has(requestId))return;const query=$('search-review-query').value,controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);reviewsInFlight.add(requestId);updateReviewControls();try{const response=await fetch('/api/search-review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId,action,query,projectId:$('search-review-project').value,projectName:$('search-review-name').value,projectTask:$('search-review-task').value}),signal:controller.signal});if(!response.ok)throw Error();}catch{if(reviewRequestId===requestId){const message='Could not confirm the result; the request may have been processed. Reconnecting to check its status.';if($('search-review').open)$('search-review-error').textContent=message;else toast(message);connectEvents()}}finally{clearTimeout(timeout);reviewsInFlight.delete(requestId);updateReviewControls()}}
 $('search-review-form').addEventListener('submit',e=>{e.preventDefault();reviewSearch('approve')});
 $('search-review-cancel').addEventListener('click',()=>reviewSearch('cancel'));
 $('search-review').addEventListener('cancel',e=>{e.preventDefault();reviewSearch('cancel')});
 // Old tabs may write an unresolved intent after this tab loaded. Mask it here
 // without modifying storage; masks stay in place until reload, even if another
 // tab later removes or replaces the marker.
 $('pending-drafts-clear').addEventListener('click',()=>{$('pending-drafts-text').value='';$('pending-drafts').hidden=true});
 function handlePendingStateStorage(event){
  if(event.key!==KEY&&event.key!==null)return;
  let detected=false;
  try{
   // A storage event may be delivered after later writes have already replaced
   // its value. Inspect both event snapshots as well as current storage so a
   // short-lived pending intent cannot escape the sticky mask.
   if(event.key===null)throw Error('Browser data cleared by another tab');
   const values=[event.oldValue,event.newValue,localStorage.getItem(KEY)];
   for(const raw of values){
    if(raw===null||raw===undefined)continue;
    const parsed=JSON.parse(raw);
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('Invalid state');
    if('__yourtubePendingDeletion' in parsed){
     const marker=parsed.__yourtubePendingDeletion;
     if(!marker||typeof marker!=='object'||Array.isArray(marker)||typeof marker.id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(marker.id)||typeof marker.token!=='string'||!marker.token)throw Error('Invalid pending deletion');
     pendingRecovery=marker;maskedProjects.add(marker.id);detected=true;
    }
   }
  }catch{stateUntrusted=true;detected=true}
  if(!detected)return;
  storageBlocked=true;showStorageWarning(stateUntrusted?'Browser data could not be safely verified. Project data is hidden and editing is disabled; manual search and Live review are unavailable. Enabling Live is unavailable. Live may still be on; you can still pause it. Keep your browser data and copy any drafts.':'A previous project deletion is unresolved. That project is hidden; editing, manual search, Live review and retry are temporarily unavailable. Enabling Live is unavailable. Live may still be on; you can still pause it. Keep your browser data and copy any drafts.');
  if(liveState.mode==='awaiting-review')$('live-label').textContent='Review unavailable';
  $('live-toggle').title='Live may still be on. Enabling Live and search review are unavailable while browser data is unresolved; you can still pause it.';
  // Preserve unsaved text from affected dialogs without attributing it to a
  // potentially recreated project. This copy stays in memory until reload.
  const drafts=[],capture=(dialogId,condition,label,fields)=>{
   if(!condition||!$(dialogId).open)return;
   const lines=fields.map(([name,id])=>[name,String($(id).value||'')]).filter(([,value])=>value.trim()).map(([name,value])=>name+':\n'+value);
   if(lines.length)drafts.push(label+'\n'+lines.join('\n\n'));
  };
  capture('context-dialog',projectMasked($('context-id').value),'Project draft',[['Name','context-name'],['Task','context-task'],['Note','context-note']]);
  capture('video-note-dialog',!noteTarget||projectMasked(noteTarget.project),'Video note draft',[['Note','video-note-text']]);
  capture('edit-video-dialog',!editVideoTarget||projectMasked(editVideoTarget.project),'Video details draft',[['Title','edit-video-name'],['Channel','edit-video-channel'],['Reason','edit-video-reason']]);
  capture('project-export-dialog',true,'Project export preview',[['Preview','project-export-preview']]);
  capture('manual-search-dialog',true,'Manual search draft',[['Search','manual-search-query']]);
  capture('search-review',true,'Live review draft',[['Name','search-review-name'],['Task','search-review-task'],['Search','search-review-query']]);
  if(drafts.length){const previous=$('pending-drafts-text').value;$('pending-drafts-text').value=[previous,...drafts].filter(Boolean).join('\n\n---\n\n');$('pending-drafts').hidden=false}
  const closeIf=(id,condition)=>{const dialog=$(id);if(condition&&dialog.open)dialog.close()};
  closeIf('context-dialog',projectMasked($('context-id').value));
  closeIf('video-note-dialog',!noteTarget||projectMasked(noteTarget.project));
  closeIf('edit-video-dialog',!editVideoTarget||projectMasked(editVideoTarget.project));
  closeIf('copy-video-dialog',!copyVideoTarget||projectMasked(copyVideoTarget.project)||projectMasked($('copy-video-project').value));
  closeIf('player-dialog',true);closeIf('context-choose-dialog',true);closeIf('project-export-dialog',true);closeIf('search-review',true);closeIf('live-consent',true);
  if($('manual-search-dialog').open)dismissManual();
  const projects=contexts(),options='<option value="">Choose a project</option>'+projects.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  for(const id of ['video-context','manual-search-project']){const select=$(id),selected=select.value;select.innerHTML=options;select.value=projects.some(c=>c.id===selected)?selected:''}
  if($('removed-dialog').open)renderRemoved();
  if($('info-dialog').open){$('context-source').textContent='Context details are hidden while browser data is unresolved.';$('live-detail').textContent=liveState.message}
  if($('manual-search-dialog').open)manualControls();
  render();
 }
}
start().catch(()=>showStartupFailure(true));
