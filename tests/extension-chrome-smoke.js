// Explicit opt-in integration check: run with `node tests/extension-chrome-smoke.js`.
// It launches a disposable Chrome profile, a fake YouTube page and an isolated
// service with synthetic feed/session files. A blocking proxy prevents external
// network access and routes 127.0.0.1:8765 to the temporary service instead of
// the user's actual running YourTube service. Set YOURTUBE_REAL_SITE=1 to test
// an anonymous real YouTube page with the same synthetic local service. No
// personal feed, browser profile or chats are read.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),http=require('node:http'),https=require('node:https');
const {spawn,execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'), temp=fs.mkdtempSync(path.join(os.tmpdir(),'yourtube-chrome-smoke-'));
const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', extension=path.join(root,'extension'), extId='anbgckjkfioebbbhigpolefmhhllkdhh',realSite=process.env.YOURTUBE_REAL_SITE==='1';
let browser,service,proxy,tlsServer;const observed=[];
const later=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){const s=net.createServer();await new Promise((r,j)=>s.once('error',j).listen(0,'127.0.0.1',r));const n=s.address().port;await new Promise(r=>s.close(r));return n;}
async function listen(server){await new Promise((r,j)=>server.once('error',j).listen(0,'127.0.0.1',r));return server.address().port;}
async function waitUntil(fn,description,ms=15000){const end=Date.now()+ms;let last;while(Date.now()<end){try{last=await fn();if(last)return last}catch{}await later(100)}throw Error('Timed out waiting for '+description);}
async function main(){
 if(!fs.existsSync(chrome))throw Error('Google Chrome is not installed at the expected path.');
 const sessions=path.join(temp,'sessions'),profile=path.join(temp,'profile'),feed=path.join(temp,'feed.json'),pairing=path.join(temp,'pairing');fs.mkdirSync(sessions);
 fs.writeFileSync(feed,JSON.stringify({contexts:[{id:'synthetic-project',name:'Synthetic project',task:'Synthetic task'}],videos:[{id:'abc123def45',context:'synthetic-project',title:'Synthetic visible title',channel:'Synthetic channel',reason:'Synthetic',source:'Synthetic'},{id:'hidden00001',context:'synthetic-project',title:'Synthetic hidden title',channel:'Synthetic channel',reason:'Synthetic',source:'Synthetic'},{id:'abc123def46',context:'synthetic-project',title:'Synthetic project-hidden title',channel:'Synthetic channel',reason:'Synthetic',source:'Synthetic'}],focusContext:'synthetic-project',updatedAt:'2026-01-01T00:00:00.000Z',contextSource:'Synthetic'}));
 const inner=await port();service=spawn(process.execPath,[path.join(root,'server.js')],{cwd:root,stdio:'ignore',env:{...process.env,YOURTUBE_PORT:String(inner),YOURTUBE_FEED:feed,YOURTUBE_SESSIONS_DIR:sessions,YOURTUBE_PAIRING_FILE:pairing,YOURTUBE_CODEX:'/usr/bin/false'}});
 await waitUntil(()=>new Promise(r=>{const q=http.get({host:'127.0.0.1',port:inner,path:'/'},res=>{res.resume();r(res.statusCode===200)});q.on('error',()=>r(false));}),'synthetic service');
 const cert=path.join(temp,'cert.pem'),key=path.join(temp,'key.pem');
 execFileSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=www.youtube.com'],{stdio:'ignore'});
 tlsServer=https.createServer({key:fs.readFileSync(key),cert:fs.readFileSync(cert)},(req,res)=>{
  if(req.url!=='/'){res.writeHead(404).end();return}
  res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'}).end('<!doctype html><html><body><ytd-browse page-subtype="home"><div id="primary"><ytd-rich-grid-renderer><p>Fake YouTube home</p></ytd-rich-grid-renderer></div></ytd-browse></body></html>');
 });const tlsPort=await listen(tlsServer);
 proxy=http.createServer((req,res)=>{
  req.on('error',()=>{});res.on('error',()=>{});
  let u;try{u=new URL(req.url)}catch{res.writeHead(403).end();return}
  if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.port!=='8765'){res.writeHead(403).end();return}
  observed.push({method:req.method,path:u.pathname,origin:req.headers.origin||null});
  const headers={...req.headers,host:'127.0.0.1:'+inner};
  if(headers.origin==='http://127.0.0.1:8765')headers.origin='http://127.0.0.1:'+inner;
  const out=http.request({hostname:'127.0.0.1',port:inner,path:u.pathname+u.search,method:req.method,headers},up=>{res.writeHead(up.statusCode,up.headers);up.pipe(res)});out.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end()});req.pipe(out);
 });
 proxy.on('connection',socket=>socket.on('error',()=>{}));
 proxy.on('connect',(req,socket,head)=>{
  const allowed=new Set(['www.youtube.com:443','youtube.com:443','consent.youtube.com:443','www.gstatic.com:443','s.ytimg.com:443','i.ytimg.com:443']);
  if((!realSite&&req.url!=='www.youtube.com:443')||(realSite&&!allowed.has(req.url))){socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return}
  const [host,remotePort]=req.url.split(':');const upstream=realSite?net.connect(Number(remotePort),host):net.connect(tlsPort,'127.0.0.1');
  upstream.once('connect',()=>{socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);socket.pipe(upstream);upstream.pipe(socket)});upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());
 });const proxyPort=await listen(proxy);
 browser=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--disable-component-update','--remote-debugging-pipe','--enable-unsafe-extension-debugging',...(!realSite?['--ignore-certificate-errors']:[]),'--proxy-server=http://127.0.0.1:'+proxyPort,'--proxy-bypass-list=<-loopback>','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','ignore','pipe','pipe']});
 let buffer='',sequence=0;const pending=new Map();browser.stdio[4].on('data',chunk=>{buffer+=chunk;let at;while((at=buffer.indexOf('\0'))>=0){const raw=buffer.slice(0,at);buffer=buffer.slice(at+1);try{const m=JSON.parse(raw);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}}catch{}}});
 function call(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timed out'))},15000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(Error(method+': '+e.message))}});browser.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0')})}
 const installed=await call('Extensions.loadUnpacked',{path:extension});assert.equal(installed.id,extId,'loaded extension ID');
 async function attach(id){return (await call('Target.attachToTarget',{targetId:id,flatten:true})).sessionId}
 async function evaluate(sessionId,expression){const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);if(result.exceptionDetails)throw Error('Synthetic browser evaluation failed');return result.result.value}
 const setupTarget=await call('Target.createTarget',{url:'http://127.0.0.1:8765/extension-setup.html'}), setup=await attach(setupTarget.targetId);
 await waitUntil(()=>evaluate(setup,"!!document.getElementById('reveal')"),'local setup page');
 await evaluate(setup,"document.getElementById('reveal').click(); true");
 const bundle=await waitUntil(()=>evaluate(setup,"document.getElementById('pair-key').value"),'synthetic pairing');assert.match(bundle,/^[a-f0-9]{64}\.[a-f0-9]{64}$/);
 await evaluate(setup,"localStorage.setItem('yourtube.state.v1', JSON.stringify({hiddenVideos:['hidden00001'],projectHiddenVideos:[{id:'abc123def46',context:'synthetic-project'}],customVideos:[{id:'custom00001',context:'synthetic-project',title:'Synthetic custom title',channel:'Synthetic channel'}]})); true");
 const popupTarget=await call('Target.createTarget',{url:'chrome-extension://'+extId+'/popup.html'}),popup=await attach(popupTarget.targetId);
 await waitUntil(()=>evaluate(popup,"!!document.getElementById('token')"),'extension settings');
 await evaluate(popup,`document.getElementById('token').value=${JSON.stringify(bundle)};document.getElementById('pair').click();true`);
 await waitUntil(()=>evaluate(popup,"/Code saved locally/.test(document.getElementById('pair-status').textContent)"),'pair extension');
 await evaluate(popup,"document.getElementById('enabled').click();true");
 await waitUntil(()=>evaluate(popup,"document.getElementById('enabled').checked"),'enable panel');
 const marker=bundle.split('.')[1],wrongMarker=(marker==='f'.repeat(64)?'e':'f').repeat(64);
 await evaluate(setup,`localStorage.setItem('yourtube.extension.partition.v1',${JSON.stringify(wrongMarker)});true`);
 const home=await call('Target.createTarget',{url:'https://www.youtube.com/'}),homeSession=await attach(home.targetId);
 await waitUntil(()=>evaluate(homeSession,"!!document.querySelector('.yourtube-extension iframe')"),'panel on synthetic YouTube home');
 const frameUrl='chrome-extension://'+extId+'/panel.html';
 const frame=await waitUntil(async()=>{const v=await call('Target.getTargets');return v.targetInfos.find(x=>x.url===frameUrl)},'extension iframe target');const frameSession=await attach(frame.targetId);
 await waitUntil(()=>evaluate(frameSession,"/safely load/.test(document.getElementById('status').textContent)"),'partition-mismatch failure');
 assert.equal(await evaluate(frameSession,"document.getElementById('videos').children.length"),0,'mismatched partition must not show raw feed');
 assert.equal(observed.some(x=>x.path==='/feed.json'),false,'projector must not request feed without matching partition');
 await evaluate(setup,`localStorage.setItem('yourtube.extension.partition.v1',${JSON.stringify(marker)});true`);
 try{await waitUntil(()=>evaluate(frameSession,"document.getElementById('videos').textContent.includes('Synthetic visible title')"),'visible synthetic recommendation');}
 catch(e){const diagnostic=await evaluate(frameSession,"({status:document.getElementById('status').textContent,projection:document.querySelector('iframe')?.getAttribute('src')||null})");let partition='not-observed';try{const targets=await call('Target.getTargets');const p=targets.targetInfos.find(x=>x.url==='http://127.0.0.1:8765/extension-projection.html');if(p){const session=await attach(p.targetId);partition=await evaluate(session,`(()=>{try{return {markerMatches:localStorage.getItem('yourtube.extension.partition.v1')===${JSON.stringify(bundle.split('.')[1])},hasState:localStorage.getItem('yourtube.state.v1')!==null}}catch(e){return {storageError:true}}})()`)} }catch{}console.error('Synthetic browser diagnostic:',JSON.stringify({diagnostic,partition,requests:observed}));throw e;}
 const visible=await evaluate(frameSession,"document.getElementById('videos').textContent");assert.match(visible,/Synthetic visible title/);assert.match(visible,/Synthetic custom title/);assert.doesNotMatch(visible,/Synthetic hidden title|Synthetic project-hidden title/);
 const link=await evaluate(frameSession,"(()=>{const a=document.querySelector('#videos a');return {href:a.href,target:a.target}})()");assert.equal(link.href,'https://www.youtube.com/watch?v=abc123def45');assert.equal(link.target,'_top');
 const pageExposure=await evaluate(homeSession,"(()=>{const f=document.querySelector('.yourtube-extension iframe'),body=document.body.innerText;return {leaked:body.includes('Synthetic visible title')||body.includes('Synthetic hidden title'),readable:!!f.contentDocument}})()");
 assert.equal(pageExposure.readable,false,'host cannot read extension iframe DOM');assert.equal(pageExposure.leaked,false,'host DOM contains no feed');
 await evaluate(setup,"localStorage.setItem('yourtube.state.v1', JSON.stringify({hiddenVideos:['hidden00001'],__yourtubePendingDeletion:{id:'synthetic-project',token:'synthetic'}})); true");
 await waitUntil(()=>evaluate(frameSession,"document.getElementById('videos').children.length===0 && /safely load/.test(document.getElementById('status').textContent)"),'pending marker clears panel');
 await evaluate(popup,"document.getElementById('enabled').click();true");await waitUntil(()=>evaluate(homeSession,"!document.querySelector('.yourtube-extension iframe')"),'panel disabled');
 console.log('PASS: loaded extension in disposable Chrome on '+(realSite?'anonymous real YouTube':'synthetic YouTube')+'; mismatched partition failed closed, browser-hidden videos filtered, host DOM isolated, pending deletion cleared recommendations and panel disabled.');
}
main().catch(e=>{console.error('FAIL:',e.message);process.exitCode=1}).finally(async()=>{if(browser)browser.kill('SIGTERM');if(service)service.kill('SIGTERM');proxy?.closeAllConnections?.();proxy?.close();tlsServer?.closeAllConnections?.();tlsServer?.close();await later(1000);try{fs.rmSync(temp,{recursive:true,force:true})}catch{}});
