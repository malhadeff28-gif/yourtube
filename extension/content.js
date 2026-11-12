'use strict';

// The YouTube page can inspect its DOM. Only static labels and the iframe URL
// live here; recommendations and pairing data remain in extension contexts.
let enabled=false, expanded=true, container=null, pending=false;
function render() {
  pending=false;
  if (!enabled || location.pathname !== '/') { container?.remove(); container=null; return; }
  const anchor=document.querySelector('ytd-browse[page-subtype="home"] ytd-rich-grid-renderer') || document.querySelector('ytd-rich-grid-renderer');
  if (!anchor || !anchor.parentElement) return;
  if (!container) {
    container=document.createElement('section'); container.className='yourtube-extension'; container.setAttribute('aria-label','YourTube local recommendations');
    const header=document.createElement('div'); header.className='yourtube-extension-header';
    const label=document.createElement('strong'); label.textContent='YourTube · independent local extension';
    const toggle=document.createElement('button'); toggle.type='button'; toggle.className='yourtube-extension-toggle';
    const body=document.createElement('div'); body.className='yourtube-extension-body';
    const update=()=>{
      toggle.textContent=expanded?'Hide panel':'Show panel'; toggle.setAttribute('aria-expanded',String(expanded));
      body.replaceChildren();
      if (expanded) { const frame=document.createElement('iframe'); frame.src=chrome.runtime.getURL('panel.html'); frame.title='YourTube local recommendations'; frame.className='yourtube-extension-frame'; body.appendChild(frame); }
    };
    toggle.addEventListener('click',()=>{expanded=!expanded; update();});
    header.append(label,toggle); container.append(header,body); update();
  }
  if (!container.isConnected || container.nextElementSibling !== anchor) anchor.parentElement.insertBefore(container,anchor);
}
function schedule() { if (!pending) { pending=true; requestAnimationFrame(render); } }
let port, reconnectDelay=1000, reconnectTimer=null;
function reconnect() {
  if (reconnectTimer) return;
  // An idle MV3 worker can stop without the extension being disabled. Retry
  // with bounded backoff and show the panel only after enabled is confirmed.
  reconnectTimer=setTimeout(()=>{reconnectTimer=null;connect();},reconnectDelay);
  reconnectDelay=Math.min(reconnectDelay*2,30000);
}
function connect() {
  try {
    port=chrome.runtime.connect({name:'yourtube-visibility'});
    port.onMessage.addListener(value=>{reconnectDelay=1000;enabled=value?.enabled === true; schedule();});
    port.onDisconnect.addListener(()=>{enabled=false;schedule();try{if(!chrome.runtime.id)return}catch{return}reconnect();});
  } catch { enabled=false; schedule(); }
}
connect();
new MutationObserver(()=>{
  if(!enabled)return;
  if(location.pathname!=='/'){if(container)schedule();return;}
  // YouTube mutates its feed continuously. Once our section is attached to
  // the expected grid, unrelated mutations need no new query or DOM update.
  if(!container?.isConnected||container.nextElementSibling?.localName!=='ytd-rich-grid-renderer')schedule();
}).observe(document.documentElement,{childList:true,subtree:true});
document.addEventListener('yt-navigate-finish',schedule);
window.addEventListener('popstate',schedule);
