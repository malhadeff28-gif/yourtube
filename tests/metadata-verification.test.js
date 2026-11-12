'use strict';
const { fencedBody } = require('./support/live-control');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process'),{setTimeout:delay}=require('node:timers/promises');
const root=path.resolve(__dirname,'..');
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yourtube-verification-test-')),sessions=path.join(dir,'sessions'),feed=path.join(dir,'feed.json'),mode=path.join(dir,'mode'),attempts=path.join(dir,'attempts');fs.mkdirSync(sessions);const session=path.join(sessions,'synthetic.jsonl');fs.writeFileSync(session,JSON.stringify({type:'session_meta',payload:{originator:'Codex Desktop',source:'vscode',thread_source:'user'}})+'\n');fs.writeFileSync(mode,'zero');const initial={contexts:[{id:'p',name:'Synthetic',task:'Synthetic'}],videos:[],focusContext:'p'};fs.writeFileSync(feed,JSON.stringify(initial));
 const codex=path.join(dir,'codex');fs.writeFileSync(codex,`#!/usr/bin/env node
const fs=require('node:fs');process.stdin.resume();process.stdin.on('end',()=>{const mode=fs.readFileSync(process.env.TEST_MODE,'utf8').trim(),out=process.argv[process.argv.indexOf('-o')+1];const v=(id,reason='Synthetic reason')=>({id,reason});const choices={zero:[v('bad'),v('testVideo01',null)],mixed:[v('testVideo01'),v('testVideo01'),v('testVideo02'),v('bad')],all:[v('testVideo02'),v('testVideo03'),v('testVideo04'),v('testVideo05')],cancel:[v('testVideo05')],shape1:[v('testVideo06'),v('testVideo07'),v('testVideo08'),v('testVideo09')],shape2:[v('testVideo10'),v('testVideo11'),v('testVideo12'),v('testVideo13')],shape3:[v('testVideo16'),v('testVideo17'),v('testVideo18'),v('testVideo19')],shapeMixed:[v('testVideo01'),v('testVideo06'),v('testVideo14')],shapeUnicode:[v('testVideo14'),v('testVideo15'),v('testVideo20')]};fs.writeFileSync(out,JSON.stringify(process.argv.includes('--search')?{videos:choices[mode]}:{relevant:true,project:'Synthetic',task:'Synthetic',context_id:'p',public_search:'synthetic public topic'}))});`,{mode:0o755});
 const curl=path.join(dir,'curl');fs.writeFileSync(curl,`#!/usr/bin/env node
const fs=require('node:fs');const url=decodeURIComponent(process.argv.at(-1)),id=(url.match(/v=(testVideo\\d\\d)/)||[])[1];fs.appendFileSync(process.env.TEST_ATTEMPTS,id+'\\n');if(id==='testVideo01')process.stdout.write(JSON.stringify({title:'Verified title',author_name:'Verified channel'}));else if(id==='testVideo02'){process.stderr.write('SYNTHETIC_PRIVATE_NETWORK_ERROR');process.exitCode=22}else if(id==='testVideo03')process.stdout.write('{broken');else if(id==='testVideo04')process.stdout.write(JSON.stringify({title:'missing author'}));else if(id==='testVideo05'){if(fs.readFileSync(process.env.TEST_MODE,'utf8').trim()==='cancel')setInterval(()=>{},1000);else process.exitCode=28}else {
 const values={
  testVideo06:{title:{bad:'SYNTHETIC_PRIVATE_METADATA'},author_name:'Channel'},
  testVideo07:{title:['bad'],author_name:'Channel'},
  testVideo08:{title:7,author_name:'Channel'},
  testVideo09:{title:true,author_name:'Channel'},
  testVideo10:{title:null,author_name:'Channel'},
  testVideo11:{title:'  \\t  ',author_name:'Channel'},
  testVideo12:{title:'Title',author_name:{bad:'SYNTHETIC_PRIVATE_METADATA'}},
  testVideo13:{title:'Title',author_name:['bad']},
  testVideo14:{title:'  Café 🚀  ',author_name:'  频道 🐟  '},
  testVideo15:{title:'A'.repeat(199)+'🚀',author_name:'B'.repeat(99)+'🐟'},
  testVideo16:{title:'Title',author_name:7},
  testVideo17:{title:'Title',author_name:true},
  testVideo18:{title:'Title',author_name:null},
  testVideo19:{title:'Title',author_name:'  \\t  '},
  testVideo20:{title:' '.repeat(201)+'🐝',author_name:' '.repeat(101)+'🎵'}
 };process.stdout.write(JSON.stringify(values[id]))
}`,{mode:0o755});
 const hook=path.join(dir,'watch.cjs');fs.writeFileSync(hook,`if(process.argv[1]&&process.argv[1].endsWith('/server.js')){const fs=require('node:fs'),{EventEmitter}=require('node:events'),old=fs.watch;fs.watch=function(dir,opts,cb){if(String(dir)!==process.env.YOURTUBE_SESSIONS_DIR)return old.apply(this,arguments);const w=new EventEmitter();w.close=()=>{};process.on('message',m=>{if(m?.kind==='watch'){cb('change','synthetic.jsonl');process.send({ack:m.id})}});return w}}`);
 const sock=http.createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));const base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,TMPDIR:dir,YOURTUBE_PORT:String(port),YOURTUBE_SESSIONS_DIR:sessions,YOURTUBE_FEED:feed,YOURTUBE_CODEX:codex,TEST_MODE:mode,TEST_ATTEMPTS:attempts,YOURTUBE_DEBOUNCE_MS:'20',NODE_OPTIONS:`${process.env.NODE_OPTIONS||''} --require=${JSON.stringify(hook)}`,PATH:`${dir}${path.delimiter}${process.env.PATH}`},stdio:['ignore','ignore','ignore','ipc']});
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const done=new Promise(r=>child.once('exit',r));if(child.connected)child.disconnect();child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),3000);await done;clearTimeout(timer)}fs.rmSync(dir,{recursive:true,force:true})});
 async function waitFor(fn){for(let i=0;i<600;i++){try{const v=await fn();if(v)return v}catch{}await delay(20)}throw Error('synthetic wait timed out')}
 await waitFor(async()=>(await fetch(base+'/feed.json')).ok);
 const post=async(url,body)=>fetch(base+url,{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify(await fencedBody(base,body))});
 const status=()=>new Promise((resolve,reject)=>{const req=http.get(base+'/events',res=>{let txt='';res.on('data',c=>{txt+=c;const m=txt.match(/event: status\ndata: ([^\n]+)\n\n/);if(m){res.destroy();resolve(JSON.parse(m[1]))}});res.on('error',reject)});req.on('error',reject)});
 const setMode=x=>{fs.writeFileSync(mode,x);fs.writeFileSync(attempts,'')};const attemptsRead=()=>fs.existsSync(attempts)?fs.readFileSync(attempts,'utf8').trim().split('\n').filter(Boolean):[];
 let sequence=0;const append=async text=>{fs.appendFileSync(session,JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}})+'\n');await new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>reject(Error('watch timeout')),3000),listener=m=>{if(m?.ack===id){clearTimeout(timer);child.off('message',listener);resolve()}};child.on('message',listener);child.send({kind:'watch',id})})};
 return {post,status,waitFor,setMode,attemptsRead,feed,initial,append};
}
test('manual verification reports no candidates, partial and all-unverified distinctly without leaking failures',{timeout:20000},async t=>{
 const f=await fixture(t);let sequence=0;const run=async mode=>{f.setMode(mode);const id=`${String(++sequence).padStart(8,'0')}-1111-4111-8111-111111111111`;assert.equal((await f.post('/api/manual-search',{id,query:'synthetic public topic'})).status,202);return f.waitFor(async()=>{const s=await f.status();return s.manualSearch?.id===id&&s.manualSearch.state!=='searching'&&s})};
 let s=await run('zero');assert.equal(s.manualSearch.reason,'no-candidates');assert.equal(f.attemptsRead().length,0);assert.match(s.message,/No video candidates/);
 s=await run('mixed');assert.equal(s.manualSearch.state,'ready',JSON.stringify({status:s,attempts:f.attemptsRead()}));assert.equal(s.manualSearch.verificationIncomplete,true);assert.deepEqual(s.manualSearch.videos.map(v=>v.id),['testVideo01']);assert.deepEqual(f.attemptsRead(),['testVideo01','testVideo02']);assert.match(s.message,/Some candidates could not be verified/);assert.doesNotMatch(JSON.stringify(s),/SYNTHETIC_PRIVATE_NETWORK_ERROR|testVideo02/);
 s=await run('all');assert.equal(s.manualSearch.reason,'verification-incomplete');assert.match(s.message,/Could not verify candidates/);assert.equal(f.attemptsRead().length,4);assert.doesNotMatch(JSON.stringify(s),/SYNTHETIC_PRIVATE_NETWORK_ERROR|testVideo0[2345]/);assert.deepEqual(JSON.parse(fs.readFileSync(f.feed,'utf8')),f.initial);
});
test('cancel during metadata verification never exposes verification warnings or results',{timeout:15000},async t=>{
 const f=await fixture(t),id='11111111-1111-4111-8111-111111111111';f.setMode('cancel');assert.equal((await f.post('/api/manual-search',{id,query:'synthetic public topic'})).status,202);await f.waitFor(()=>f.attemptsRead().length===1);assert.equal((await f.post('/api/manual-search/cancel',{id})).status,202);const s=await f.waitFor(async()=>{const x=await f.status();return x.manualSearch?.state==='canceled'&&x});assert.doesNotMatch(JSON.stringify(s),/could not be verified|verificationIncomplete/i);assert.deepEqual(JSON.parse(fs.readFileSync(f.feed,'utf8')),f.initial);
});

test('Live reports partial and all-unverified without mutating feed on total verification failure',{timeout:20000},async t=>{
 const f=await fixture(t);assert.equal((await f.post('/api/live',{enabled:true})).status,200);
 async function approveAndWait(mode){f.setMode(mode);await f.append('Synthetic task for verification');const review=await f.waitFor(async()=>{const s=await f.status();return s.mode==='awaiting-review'&&s});assert.equal((await f.post('/api/search-review',{requestId:review.requestId,action:'approve',query:review.pendingQuery,projectId:review.pendingProject.id,projectName:review.pendingProject.name,projectTask:review.pendingProject.task})).status,200);return f.waitFor(async()=>{const s=await f.status();return s.mode==='listening'&&(/could not be verified|Could not verify candidates|No video candidates/.test(s.message))&&s})}
 let s=await approveAndWait('mixed');assert.match(s.message,/Some candidates could not be verified/);assert.equal(s.verificationMayBeIncomplete,true);assert.doesNotMatch(JSON.stringify(s),/SYNTHETIC_PRIVATE_NETWORK_ERROR|testVideo02/);let feed=JSON.parse(fs.readFileSync(f.feed,'utf8'));assert.deepEqual(feed.videos.map(v=>v.id),['testVideo01']);const saved=fs.readFileSync(f.feed,'utf8');
 s=await approveAndWait('all');assert.match(s.message,/Could not verify candidates/);assert.equal(s.verificationMayBeIncomplete,true);assert.equal(fs.readFileSync(f.feed,'utf8'),saved,'unverified candidates never mutate the feed');
 s=await approveAndWait('zero');assert.match(s.message,/No video candidates/);assert.equal(s.verificationMayBeIncomplete,true,'warning persists across later work');assert.equal((await f.post('/api/live',{enabled:false})).status,200);assert.equal((await f.status()).verificationMayBeIncomplete,false,'pause clears the warning');
});

test('pausing Live during verification does not publish a stale warning or mutate the feed',{timeout:15000},async t=>{
 const f=await fixture(t);f.setMode('cancel');assert.equal((await f.post('/api/live',{enabled:true})).status,200);await f.append('Synthetic work paused during verification');const review=await f.waitFor(async()=>{const s=await f.status();return s.mode==='awaiting-review'&&s});assert.equal((await f.post('/api/search-review',{requestId:review.requestId,action:'approve',query:review.pendingQuery,projectId:review.pendingProject.id,projectName:review.pendingProject.name,projectTask:review.pendingProject.task})).status,200);await f.waitFor(()=>f.attemptsRead().length===1);assert.equal((await f.post('/api/live',{enabled:false})).status,200);await delay(100);const s=await f.status();assert.equal(s.enabled,false);assert.equal(s.verificationMayBeIncomplete,false);assert.doesNotMatch(s.message,/verify candidates|could not be verified/i);assert.deepEqual(JSON.parse(fs.readFileSync(f.feed,'utf8')),f.initial);
});

test('metadata requires nonblank strings and preserves bounded Unicode in manual results',{timeout:25000},async t=>{
 const f=await fixture(t);let sequence=0;const run=async mode=>{f.setMode(mode);const id=`${String(++sequence).padStart(8,'0')}-2222-4222-8222-222222222222`;assert.equal((await f.post('/api/manual-search',{id,query:'synthetic public topic'})).status,202);return f.waitFor(async()=>{const s=await f.status();return s.manualSearch?.id===id&&s.manualSearch.state!=='searching'&&s})};
 for(const mode of ['shape1','shape2','shape3']){const s=await run(mode);assert.equal(s.manualSearch.reason,'verification-incomplete');assert.match(s.message,/Could not verify candidates/);assert.equal(f.attemptsRead().length,4);assert.doesNotMatch(JSON.stringify(s),/SYNTHETIC_PRIVATE_METADATA|\[object Object\]/);assert.deepEqual(JSON.parse(fs.readFileSync(f.feed,'utf8')),f.initial)}
 let s=await run('shapeMixed');assert.equal(s.manualSearch.state,'ready');assert.equal(s.manualSearch.verificationIncomplete,true);assert.deepEqual(s.manualSearch.videos.map(v=>v.id),['testVideo01','testVideo14']);assert.match(s.message,/Some candidates could not be verified/);assert.doesNotMatch(JSON.stringify(s),/SYNTHETIC_PRIVATE_METADATA|\[object Object\]/);
 s=await run('shapeUnicode');assert.equal(s.manualSearch.state,'ready');assert.equal(s.manualSearch.verificationIncomplete,false);const byId=Object.fromEntries(s.manualSearch.videos.map(v=>[v.id,v]));assert.equal(byId.testVideo14.title,'Café 🚀');assert.equal(byId.testVideo14.channel,'频道 🐟');assert.equal(byId.testVideo15.title,'A'.repeat(199));assert.equal(byId.testVideo15.channel,'B'.repeat(99));assert.equal(byId.testVideo20.title,'🐝');assert.equal(byId.testVideo20.channel,'🎵');
});

test('Live rejects malformed metadata while retaining valid Unicode candidates',{timeout:20000},async t=>{
 const f=await fixture(t);assert.equal((await f.post('/api/live',{enabled:true})).status,200);
 async function run(mode){f.setMode(mode);await f.append('Synthetic metadata-shape task');const review=await f.waitFor(async()=>{const s=await f.status();return s.mode==='awaiting-review'&&s});assert.equal((await f.post('/api/search-review',{requestId:review.requestId,action:'approve',query:review.pendingQuery,projectId:review.pendingProject.id,projectName:review.pendingProject.name,projectTask:review.pendingProject.task})).status,200);return f.waitFor(async()=>{const s=await f.status();return s.mode==='listening'&&(/could not be verified|Could not verify candidates/.test(s.message))&&s})}
 let s=await run('shapeMixed');assert.equal(s.verificationMayBeIncomplete,true);assert.match(s.message,/Some candidates could not be verified/);let feed=JSON.parse(fs.readFileSync(f.feed,'utf8'));assert.deepEqual(feed.videos.map(v=>v.id),['testVideo01','testVideo14']);assert.equal(feed.videos.find(v=>v.id==='testVideo14').title,'Café 🚀');const saved=fs.readFileSync(f.feed,'utf8');
 s=await run('shape2');assert.match(s.message,/Could not verify candidates/);assert.doesNotMatch(JSON.stringify(s),/SYNTHETIC_PRIVATE_METADATA|\[object Object\]/);assert.equal(fs.readFileSync(f.feed,'utf8'),saved);
});
