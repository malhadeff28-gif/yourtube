'use strict';
const { fencedBody } = require('./support/live-control');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process');
const {setTimeout:delay}=require('node:timers/promises');
async function waitFor(check,message){const end=Date.now()+10000;while(Date.now()<end){const value=await check();if(value)return value;await delay(30)}throw Error(message)}
function status(base){return new Promise((resolve,reject)=>{const req=http.get(base+'/events',res=>{let text='';res.on('data',chunk=>{text+=chunk;const m=text.match(/event: status\ndata: ([^\n]+)\n\n/);if(m){res.destroy();resolve(JSON.parse(m[1]))}});res.on('error',reject)});req.on('error',reject);req.setTimeout(3000,()=>req.destroy(Error('status timeout')))})}
test('manual search is explicit, paused, single-flight, read-only and cancelable', {timeout:30000}, async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yourtube-manual-search-')),sessions=path.join(dir,'sessions'),feed=path.join(dir,'feed.json');fs.mkdirSync(sessions);
 const original={contexts:[{id:'a',name:'Project A',task:'Study A'},{id:'b',name:'Project B',task:'Study B'}],videos:[{id:'testVideo01',context:'b',title:'Existing',channel:'Example',reason:'Existing',source:'Synthetic'}],focusContext:'a',contextSource:'Synthetic',updatedAt:'2026-01-01T00:00:00Z'};fs.writeFileSync(feed,JSON.stringify(original));
 const fake=path.join(dir,'fake-codex');fs.writeFileSync(fake,`#!/usr/bin/env node
const fs=require('node:fs');process.stdin.setEncoding('utf8');let prompt='';process.stdin.on('data',x=>prompt+=x);process.stdin.on('end',()=>{const n=fs.existsSync(process.env.CALLS)?Number(fs.readFileSync(process.env.CALLS,'utf8'))+1:1;fs.writeFileSync(process.env.CALLS,String(n));fs.writeFileSync(process.env.CALLS+'-'+n,JSON.stringify({search:process.argv.includes('--search'),prompt}));const tick=setInterval(()=>{if(fs.existsSync(process.env.RELEASE+'-'+n)){clearInterval(tick);fs.writeFileSync(process.argv[process.argv.indexOf('-o')+1],JSON.stringify({videos:[{id:'testVideo01',reason:'Synthetic reason'},{id:'testVideo01',reason:'Duplicate'}]}))}},20)});\n`,{mode:0o755});
 fs.writeFileSync(path.join(dir,'curl'),`#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({title:'Synthetic title',author_name:'Example'}));\n`,{mode:0o755});
 const socket=http.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));const base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,TMPDIR:dir,PATH:`${dir}${path.delimiter}${process.env.PATH}`,YOURTUBE_PORT:String(port),YOURTUBE_SESSIONS_DIR:sessions,YOURTUBE_FEED:feed,YOURTUBE_CODEX:fake,CALLS:path.join(dir,'calls'),RELEASE:path.join(dir,'release')},stdio:'ignore'});
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await done}fs.rmSync(dir,{recursive:true,force:true})});
 const post=async(url,body)=>fetch(base+url,{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify(await fencedBody(base,body))});
 await waitFor(async()=>{try{return (await fetch(base+'/feed.json')).ok}catch{return false}},'server failed to start');
 const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
 assert.equal((await post('/api/manual-search',{id:a,query:'https://example.com'})).status,400);
 assert.equal(fs.existsSync(path.join(dir,'calls')),false,'no model call before explicit valid search');
 assert.equal((await post('/api/manual-search',{id:a,query:'synthetic project topic'})).status,202);
 await waitFor(()=>fs.existsSync(path.join(dir,'calls-1')),'fake search did not start');
 const call=JSON.parse(fs.readFileSync(path.join(dir,'calls-1'),'utf8'));assert.equal(call.search,true);assert.match(call.prompt,/synthetic project topic/);assert.doesNotMatch(call.prompt,/Project A|Study A|Project B|Study B/,'stored project details must not be sent');
 assert.equal((await post('/api/manual-search',{id:b,query:'second topic'})).status,409);
 assert.equal((await post('/api/context/sync',{id:'a',name:'Changed',task:'Changed task',expected:original.contexts[0]})).status,409,'manual search must block copying context while shared worker is active');
 assert.equal((await post('/api/live',{enabled:true,expectedEnabled:false})).status,409);
 fs.writeFileSync(path.join(dir,'release-1'),'');const ready=await waitFor(async()=>{const s=await status(base);return s.manualSearch?.id===a&&s.manualSearch.state==='ready'&&s.manualSearch},'manual search did not finish');
 assert.equal(ready.videos.length,1,'duplicates are removed');assert.equal(ready.videos[0].id,'testVideo01');assert.deepEqual(JSON.parse(fs.readFileSync(feed,'utf8')),original,'manual search must not write project or feed data');assert.equal((await status(base)).enabled,false);
 assert.equal((await post('/api/live',{enabled:true,expectedEnabled:false})).status,200);
 assert.equal((await post('/api/manual-search/cancel',{id:a})).status,202);const discarded=await status(base);assert.equal(discarded.manualSearch.state,'canceled','ready results can be explicitly discarded');assert.equal(discarded.enabled,true);assert.equal(discarded.mode,'listening','discarding old results must not disturb Live');
 assert.equal((await post('/api/live',{enabled:false,expectedEnabled:true})).status,200);
 assert.equal((await post('/api/manual-search',{id:b,query:'second topic'})).status,202);await waitFor(()=>fs.existsSync(path.join(dir,'calls-2')),'second search did not start');
 assert.equal((await post('/api/manual-search/cancel',{id:a})).status,409);assert.equal((await post('/api/manual-search/cancel',{id:b})).status,202);
 await waitFor(async()=>{const s=await status(base);return s.manualSearch?.id===b&&s.manualSearch.state==='canceled'},'cancel was not confirmed');assert.deepEqual(JSON.parse(fs.readFileSync(feed,'utf8')),original,'canceled work must not change feed');
 const c='33333333-3333-4333-8333-333333333333',d='44444444-4444-4444-8444-444444444444';
 assert.equal((await post('/api/manual-search',{id:c,query:'third topic'})).status,202);await waitFor(()=>fs.existsSync(path.join(dir,'calls-3')),'third search did not start');
 assert.equal((await post('/api/live',{enabled:false,expectedEnabled:false})).status,200);await waitFor(async()=>{const s=await status(base);return s.manualSearch?.id===c&&s.manualSearch.state==='canceled'},'pause did not cancel manual search');assert.deepEqual(JSON.parse(fs.readFileSync(feed,'utf8')),original);
 assert.equal((await post('/api/manual-search',{id:d,query:'fourth topic'})).status,202);await waitFor(()=>fs.existsSync(path.join(dir,'calls-4')),'fourth search did not start');
 assert.equal((await post('/api/context/delete',{id:'a'})).status,503);assert.deepEqual(JSON.parse(fs.readFileSync(feed,'utf8')),original,'blocked deletion must not mutate the feed');assert.equal((await post('/api/manual-search/cancel',{id:d})).status,202);await waitFor(async()=>{const s=await status(base);return s.manualSearch?.id===d&&s.manualSearch.state==='canceled'},'explicit cancel was not confirmed');
 assert.equal((await post('/api/live',{enabled:true,expectedEnabled:false})).status,200);assert.equal((await post('/api/manual-search',{id:a,query:'synthetic project topic'})).status,409);assert.equal((await post('/api/live',{enabled:false,expectedEnabled:true})).status,200);
});
