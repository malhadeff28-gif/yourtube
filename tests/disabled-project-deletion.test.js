'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process');
const {setTimeout:delay}=require('node:timers/promises');

test('old and new project-delete POSTs fail closed without changing the feed', {timeout:12000}, async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yourtube-delete-disabled-'));
 const sessions=path.join(dir,'sessions');fs.mkdirSync(sessions);
 const feed=path.join(dir,'feed.json');
 // Duplicate ID simulates an ambiguous feed; no user's data is read.
 const original=JSON.stringify({contexts:[{id:'shared',name:'One',task:'A'},{id:'shared',name:'Two',task:'B'}],videos:[{id:'testVideo01',context:'shared',title:'Synthetic'}],focusContext:'shared'});
 fs.writeFileSync(feed,original);
 const socket=http.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));const base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,YOURTUBE_PORT:String(port),YOURTUBE_SESSIONS_DIR:sessions,YOURTUBE_FEED:feed,YOURTUBE_SETTINGS:path.join(dir,'settings.json')},stdio:'ignore'});
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await done}fs.rmSync(dir,{recursive:true,force:true})});
 let ready=false;for(let n=0;n<150;n++){try{if((await fetch(base+'/feed.json')).ok){ready=true;break}}catch{}await delay(20)}assert.ok(ready,'synthetic server failed to start');
 for(const payload of [{id:'shared'},{id:'browser-only'},{id:'shared',expected:{project:null,videos:[]},instance:'old'},{},'not-json']){
  const response=await fetch(base+'/api/context/delete',{method:'POST',headers:{'content-type':'application/json',origin:base},body:typeof payload==='string'?payload:JSON.stringify(payload)});
  assert.equal(response.status,503);assert.match(await response.text(),/temporarily unavailable/i);assert.equal(fs.readFileSync(feed,'utf8'),original,'disabled deletion must leave exact feed bytes intact');
 }
 assert.equal((await fetch(base+'/feed.json')).status,200,'service remains available');
});
