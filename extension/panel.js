'use strict';
const status=document.getElementById('status'), list=document.getElementById('videos');
const idPattern=/^[A-Za-z0-9_-]{11}$/;
let request=0, rendered='', port=null, reconnectTimer=null, reconnectDelay=1000;
function clearVideos(){list.replaceChildren();rendered='';}
function reconnect(){
 if(reconnectTimer)return;
 reconnectTimer=setTimeout(()=>{reconnectTimer=null;connect()},reconnectDelay);reconnectDelay=Math.min(reconnectDelay*2,30000);
}
function connect(){
 try{
  port=chrome.runtime.connect({name:'yourtube-panel'});
  port.onMessage.addListener(value=>{if(value?.invalidate){request++;clearVideos();refresh()}});
  port.onDisconnect.addListener(()=>{request++;clearVideos();status.textContent='Reconnecting to YourTube…';try{if(chrome.runtime.id)reconnect()}catch{}});
  reconnectDelay=1000;
 }catch{request++;clearVideos();status.textContent='YourTube is unavailable. Reload the page to reconnect.'}
}
async function refresh({preserve=false}={}) {
  const mine=++request;
  if(!preserve){clearVideos();status.textContent='Loading recommendations…';}
  try {
    const result=await chrome.runtime.sendMessage({type:'feed'}); if(mine!==request)return;
    if(result?.error||!Array.isArray(result?.videos)||result.videos.length>30){clearVideos();status.textContent=result?.error==='unpaired'?'Pair the extension using its Chrome toolbar button.':'Could not safely load local recommendations. Open the local pairing page and try again.';return;}
    const videos=result.videos.filter(v=>v&&typeof v.id==='string'&&idPattern.test(v.id)&&typeof v.title==='string'&&v.title.trim()&&v.title.length<=200&&typeof v.channel==='string'&&v.channel.trim()&&v.channel.length<=100).map(v=>({id:v.id,title:v.title,channel:v.channel}));
    const fingerprint=JSON.stringify(videos);
    if(fingerprint!==rendered){
      list.replaceChildren();
      for(const v of videos){
        const item=document.createElement('li'),link=document.createElement('a'),channel=document.createElement('span');
        link.href='https://www.youtube.com/watch?v='+encodeURIComponent(v.id);link.target='_top';link.rel='noreferrer noopener';link.textContent=v.title;
        channel.className='channel';channel.textContent=v.channel;item.append(link,channel);list.appendChild(item);
      }
      rendered=fingerprint;
    }
    status.textContent=list.childElementCount?'':'No recommendations yet. Enable Live in the local app to build your feed.';
  } catch { if(mine===request){clearVideos();status.textContent='YourTube is unavailable. Open the local app to check the service.';} }
}
document.getElementById('refresh').addEventListener('click',()=>refresh());
connect();
refresh();
// The service owns recommendation generation. Polling only reads its local feed.
setInterval(()=>{if(document.visibilityState==='visible')refresh({preserve:true});},30000);
