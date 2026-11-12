'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),net=require('node:net');
const {spawn}=require('node:child_process'),{setTimeout:delay}=require('node:timers/promises');
const EXT='chrome-extension://anbgckjkfioebbbhigpolefmhhllkdhh',root=path.resolve(__dirname,'..');
async function status(base){return new Promise((resolve,reject)=>{const r=http.get(base+'/events',res=>{let text='';res.on('data',chunk=>{text+=chunk;const m=text.match(/event: status\ndata: ([^\n]+)\n\n/);if(m){res.destroy();resolve(JSON.parse(m[1]))}});res.on('error',reject)});r.on('error',reject);r.setTimeout(3000,()=>r.destroy(Error('timeout')))})}
test('local bridge requires pairing, exact origin, and fences every enable against pause and restart',{timeout:20000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yourtube-bridge-')),sessions=path.join(dir,'sessions'),feed=path.join(dir,'feed.json'),tokenFile=path.join(dir,'pair','token');fs.mkdirSync(sessions);fs.writeFileSync(feed,JSON.stringify({contexts:[{id:'p',name:'PRIVATE NAME',task:'PRIVATE TASK'}],videos:[{id:'testVideo01',context:'p',title:'PRIVATE TITLE',channel:'Synthetic'}]}));
 const sock=http.createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));const base=`http://127.0.0.1:${port}`;let child;
 async function stop(){if(child&&child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await done}}
 async function start(){child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,YOURTUBE_PORT:String(port),YOURTUBE_FEED:feed,YOURTUBE_SESSIONS_DIR:sessions,YOURTUBE_PAIRING_FILE:tokenFile},stdio:'ignore'});for(let i=0;i<150;i++){try{if((await fetch(base+'/')).ok)return}catch{}await delay(20)}throw Error('server failed to start')}
 t.after(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true})});await start();
 const request=(p,opts={})=>fetch(base+p,opts),pair=(origin,extra={})=>request('/api/extension/pair',{method:'POST',headers:{origin,'content-type':'application/json','x-yourtube-pair':'reveal',...extra},body:'{}'});
 assert.equal((await pair('https://www.youtube.com')).status,403);assert.equal(fs.existsSync(tokenFile),false);
 assert.equal((await pair(base,{'content-type':'text/plain'})).status,403);
 const paired=await pair(base),{token}=await paired.json();assert.match(token,/^[a-f0-9]{64}$/);assert.equal(fs.statSync(tokenFile).mode&0o777,0o600);
 const auth={origin:EXT,authorization:`Bearer ${token}`};
 const extStatus=(headers=auth,body='{}')=>request('/api/extension/status',{method:'POST',headers:{...headers,'content-type':'application/json'},body});
 assert.equal((await extStatus({})).status,403);assert.equal((await extStatus({...auth,origin:'https://www.youtube.com'})).status,403);
 assert.equal((await extStatus({...auth,origin:undefined})).status,403);assert.equal((await extStatus({...auth,authorization:'Bearer '+'0'.repeat(64)})).status,403);
 assert.equal((await request('/api/extension/status',{headers:auth})).status,403,'GET must not bypass origin checks');
 assert.equal((await extStatus(auth,'{"extra":true}')).status,400);assert.equal((await extStatus(auth,'{invalid')).status,400);
 const preflight=await request('/api/extension/status',{method:'OPTIONS',headers:{origin:EXT,'access-control-request-method':'POST','access-control-request-headers':'authorization,content-type'}});assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),EXT);
 assert.equal((await request('/api/extension/feed',{headers:auth})).status,404,'no unfiltered feed route exists');
 const v=await (await extStatus()).json();assert.deepEqual(Object.keys(v).sort(),['enabled','mode','watcherReady']);assert.doesNotMatch(JSON.stringify(v),/PRIVATE/);
 for(const p of ['/','/extension-setup.html','/extension-setup.html/','/extension-setup.html%2f','/./extension-setup.html','/%2e/extension-setup.html','/index.html%2f']){const r=await request(p);assert.equal(r.status,200);assert.equal(r.headers.get('x-frame-options'),'DENY');assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/)}
 assert.equal((await request('/extension-projection.html')).headers.get('x-frame-options'),null,'the protected projector must be frameable by the extension');
 const post=(body)=>request('/api/live',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify(body)}),startState=await status(base),fence={controlInstance:startState.controlInstance,expectedGeneration:startState.controlGeneration};
 assert.equal((await post({enabled:true})).status,409,'older tabs cannot enable without a fence');
 assert.equal((await post({enabled:true,automatic:true,...fence})).status,200);
 const extensionPause=()=>request('/api/extension/live',{method:'POST',headers:{...auth,'content-type':'application/json'},body:'{"enabled":false}'});
 assert.equal((await extensionPause()).status,200);assert.equal((await status(base)).enabled,false);
 assert.equal((await post({enabled:true,automatic:true,...fence})).status,409,'delayed enable cannot undo pause');
 assert.equal((await request('/api/extension/live',{method:'POST',headers:{...auth,'content-type':'application/json'},body:'{"enabled":true}'})).status,400,'extension cannot enable Live');
 const delayedState=await status(base),delayedBody=JSON.stringify({enabled:true,automatic:true,controlInstance:delayedState.controlInstance,expectedGeneration:delayedState.controlGeneration}),socket=net.connect(port,'127.0.0.1');
 await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject)});socket.setTimeout(3000,()=>socket.destroy(Error('timeout')));
 const responseText=new Promise((resolve,reject)=>{let text='';socket.on('data',chunk=>text+=chunk);socket.on('end',()=>resolve(text));socket.on('error',reject)});
 socket.write(`POST /api/live HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: ${base}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(delayedBody)}\r\nConnection: close\r\n\r\n${delayedBody.slice(0,-1)}`);
 await delay(30);assert.equal((await extensionPause()).status,200);socket.end(delayedBody.slice(-1));assert.match(await responseText,/^HTTP\/1\.1 409 /,'an in-flight delayed Enable must be fenced after Pause');assert.equal((await status(base)).enabled,false);
 const next=await status(base);assert.equal((await post({enabled:true,automatic:true,controlInstance:next.controlInstance,expectedGeneration:next.controlGeneration})).status,200);await extensionPause();
 const old=await status(base);await stop();await start();assert.equal((await status(base)).enabled,false);assert.equal((await post({enabled:true,controlInstance:old.controlInstance,expectedGeneration:old.controlGeneration})).status,409,'a prior process fence cannot enable after restart');
 assert.equal((await extStatus()).status,200,'explicit pairing survives service restart');
 const revoke=origin=>request('/api/extension/revoke',{method:'POST',headers:{origin,'content-type':'application/json','x-yourtube-pair':'revoke'},body:'{}'});
 assert.equal((await revoke('https://www.youtube.com')).status,403);assert.equal((await extStatus()).status,200);
 assert.equal((await revoke(base)).status,200);assert.equal((await extStatus()).status,403,'revocation invalidates all copies of the old key');
 const nextToken=(await (await pair(base)).json()).token;assert.notEqual(nextToken,token,'re-pairing after revocation produces a new key');
});
