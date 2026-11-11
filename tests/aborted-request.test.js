'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const net=require('node:net');
const {spawn}=require('node:child_process');
const {setTimeout:delay}=require('node:timers/promises');

test('aborted request bodies do not stop the service', {timeout:12000}, async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yourtube-aborted-'));
  const sessions=path.join(dir,'sessions');fs.mkdirSync(sessions);
  const feed=path.join(dir,'feed.json');
  const initial=JSON.stringify({contexts:[{id:'example',name:'Synthetic project',task:'Synthetic work'}],videos:[],focusContext:'example'});
  fs.writeFileSync(feed,initial);
  const socket=http.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
  const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  const base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,YOURTUBE_PORT:String(port),YOURTUBE_SESSIONS_DIR:sessions,YOURTUBE_FEED:feed,YOURTUBE_SETTINGS:path.join(dir,'settings.json')},stdio:['ignore','ignore','pipe']});
  let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await done}fs.rmSync(dir,{recursive:true,force:true})});
  let ready=false;for(let i=0;i<150;i++){if(child.exitCode!==null)throw Error(`server exited: ${stderr}`);try{if((await fetch(`${base}/feed.json`)).ok){ready=true;break}}catch{}await delay(20)}
  assert.ok(ready,'server did not start');
  const readStatus=()=>new Promise((resolve,reject)=>{const req=http.get(`${base}/events`,res=>{let text='';res.on('data',chunk=>{text+=chunk;const match=text.match(/event: status\ndata: ([^\n]+)\n\n/);if(match){res.destroy();resolve(JSON.parse(match[1]))}});res.on('error',reject)});req.on('error',reject);req.setTimeout(3000,()=>req.destroy(Error('status timed out')))});
  for(const [endpoint,body] of [['/api/live','{"enabled":true'],['/api/context/delete','{"id":"example"'],['/api/search-review','{"action":"approve"']]){
    const client=net.connect(port,'127.0.0.1');await new Promise((resolve,reject)=>{client.once('connect',resolve);client.once('error',reject)});
    client.write(`POST ${endpoint} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: ${base}\r\nContent-Type: application/json\r\nContent-Length: 200\r\n\r\n${body}`);
    await delay(100);client.destroy();
    await delay(100);
    assert.equal(child.exitCode,null,`${endpoint} aborted body stopped the server: ${stderr}`);
    assert.equal((await fetch(`${base}/feed.json`)).status,200,`${endpoint} aborted body left the server unhealthy`);
    assert.equal((await readStatus()).enabled,false,`${endpoint} aborted body must not enable Live`);
    assert.equal(fs.readFileSync(feed,'utf8'),initial,`${endpoint} aborted body must not mutate the feed`);
  }
});
