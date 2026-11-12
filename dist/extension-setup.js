'use strict';
const reveal=document.getElementById('reveal'),result=document.getElementById('pair-result'),key=document.getElementById('pair-key'),status=document.getElementById('status');
reveal.addEventListener('click',async()=>{
 reveal.disabled=true;status.textContent='';key.value='';result.hidden=true;
 try{
  const response=await fetch('/api/extension/pair',{method:'POST',headers:{'Content-Type':'application/json','X-YourTube-Pair':'reveal'},body:'{}',cache:'no-store'});
  if(!response.ok)throw Error();const value=await response.json();
  if(!/^[a-f0-9]{64}$/.test(value.token))throw Error();
  let marker=localStorage.getItem('yourtube.extension.partition.v1');
  if(!/^[a-f0-9]{64}$/.test(marker||'')){marker=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');localStorage.setItem('yourtube.extension.partition.v1',marker)}
  if(localStorage.getItem('yourtube.extension.partition.v1')!==marker)throw Error();
  key.value=value.token+'.'+marker;result.hidden=false;status.textContent='Key ready. Copy it into the extension.';
 }catch{status.textContent='Could not create or read the local connection key. Check the service and try again.'}
 finally{reveal.disabled=false}
});
document.getElementById('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(key.value);status.textContent='Copied. Paste the key into the extension.'}catch{key.focus();key.select();status.textContent='Select and copy the key shown above.'}});
document.getElementById('revoke').addEventListener('click',async()=>{
 if(!confirm('Revoke the connection key? Every connected copy will need a new key.'))return;
 try{
  const response=await fetch('/api/extension/revoke',{method:'POST',headers:{'Content-Type':'application/json','X-YourTube-Pair':'revoke'},body:'{}',cache:'no-store'});
  if(!response.ok)throw Error();key.value='';result.hidden=true;
  try{localStorage.removeItem('yourtube.extension.partition.v1');status.textContent='Connection key revoked. Open panels may briefly show already-loaded videos.'}
  catch{status.textContent='Connection key revoked. Close any open panels; the browser profile marker could not be removed.'}
 }catch{status.textContent='Could not revoke the key. Existing connected copies may still work.'}
});
