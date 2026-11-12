'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process'),{setTimeout:delay}=require('node:timers/promises');
function status(base){return new Promise((resolve,reject)=>{const r=http.get(base+'/events',res=>{let text='';res.on('data',chunk=>{text+=chunk;const m=text.match(/event: status\ndata: ([^\n]+)\n\n/);if(m){res.destroy();resolve(JSON.parse(m[1]))}});res.on('error',reject)});r.on('error',reject)})}
test('automatic search adds videos without overwriting an existing project', {timeout:20000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yourtube-auto-project-')),sessions=path.join(dir,'sessions');fs.mkdirSync(sessions);
 const session=path.join(sessions,'chat.jsonl'),feed=path.join(dir,'feed.json');fs.writeFileSync(session,JSON.stringify({type:'session_meta',payload:{originator:'Codex Desktop',source:'vscode',thread_source:'user'}})+'\n');
 const original={id:'existing',name:'User project',task:'Keep my task',note:'Keep my note'};fs.writeFileSync(feed,JSON.stringify({contexts:[original],videos:[],focusContext:'existing'}));
 const codex=path.join(dir,'codex'),curl=path.join(dir,'curl');fs.writeFileSync(codex,`#!/usr/bin/env node\nconst fs=require('fs');process.stdin.resume();process.stdin.on('end',()=>{const out=process.argv[process.argv.indexOf('-o')+1];fs.writeFileSync(out,JSON.stringify(process.argv.includes('--search')?{videos:[{id:'testVideo01',reason:'Synthetic reason'}]}:{relevant:true,context_id:'existing',project:'Do not overwrite',task:'Do not replace task',public_search:'synthetic tutorial'}))});\n`,{mode:0o755});fs.writeFileSync(curl,`#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({title:'Synthetic title',author_name:'Synthetic channel'}));\n`,{mode:0o755});
 const sock=http.createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));const base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,YOURTUBE_PORT:String(port),YOURTUBE_FEED:feed,YOURTUBE_SESSIONS_DIR:sessions,YOURTUBE_CODEX:codex,YOURTUBE_DEBOUNCE_MS:'40',PATH:dir+path.delimiter+process.env.PATH},stdio:'ignore'});
 t.after(async()=>{if(child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await done}fs.rmSync(dir,{recursive:true,force:true})});
 for(let i=0;i<200;i++){try{if((await fetch(base+'/')).ok)break}catch{}await delay(20)}
 const initial=await status(base),response=await fetch(base+'/api/live',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({enabled:true,automatic:true,controlInstance:initial.controlInstance,expectedGeneration:initial.controlGeneration})});assert.equal(response.status,200);
 fs.appendFileSync(session,JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'A sufficiently long synthetic topic to exercise automatic search.'}]}})+'\n');
 let result;for(let i=0;i<300;i++){result=JSON.parse(fs.readFileSync(feed,'utf8'));if(result.videos.length)break;await delay(25)}
 assert.deepEqual(result.contexts,[original]);assert.equal(result.videos[0].context,'existing');assert.equal(result.videos[0].id,'testVideo01');
});
