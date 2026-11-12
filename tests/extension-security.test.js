'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'../extension');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const EXT='chrome-extension://anbgckjkfioebbbhigpolefmhhllkdhh/';

function worker(){
 const data={}, requests=[],ports=[],listeners={},access=[],projections=[];let project=async()=>({videos:[{id:'abc123def45',title:'Synthetic',channel:'Synthetic channel',reason:'private reason',context:'private project'}]});
 const chrome={runtime:{id:'anbgckjkfioebbbhigpolefmhhllkdhh',getURL:p=>EXT+p,getContexts:async()=>[{}],sendMessage:async value=>{projections.push(value);return project(value)},onMessage:{addListener:f=>listeners.message=f},onConnect:{addListener:f=>listeners.connect=f}},offscreen:{createDocument:async()=>{}},storage:{local:{setAccessLevel:async v=>access.push(v),get:async defaults=>({...defaults,...data}),set:async values=>Object.assign(data,values)}}};
 const responses={
  '/api/extension/status':{enabled:true,mode:'listening',watcherReady:true,private:'must not return'},
  '/api/extension/live':{enabled:false,mode:'paused',watcherReady:true,private:'must not return'}
 };
 const fetch=async(url,options)=>{requests.push({url,options});const route=new URL(url).pathname;return {ok:true,status:200,json:async()=>responses[route]}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'worker.js'),'utf8'),{chrome,fetch,URL,AbortSignal,Promise,Set,Error,console,setTimeout,clearTimeout});
 const popup={id:chrome.runtime.id,url:EXT+'popup.html'};
 const panel={id:chrome.runtime.id,url:EXT+'panel.html',tab:{url:'https://www.youtube.com/'},frameId:3};
 const content={id:chrome.runtime.id,url:'https://www.youtube.com/',tab:{url:'https://www.youtube.com/'},frameId:0};
 const call=(message,sender)=>new Promise(resolve=>listeners.message(message,sender,resolve));
 function connect(sender,name='yourtube-visibility'){const p={name,sender,messages:[],onDisconnect:{addListener(f){p.disconnectHandler=f}},postMessage(v){p.messages.push(v)},disconnect(){p.disconnected=true}};ports.push(p);listeners.connect(p);return p}
 return {chrome,data,requests,access,popup,panel,content,call,connect,projections,setProject:f=>{project=f}};
}
test('extension manifest has narrow host permissions and a nonprivileged page surface',()=>{
 assert.deepEqual(manifest.permissions,['storage','offscreen']);
 assert.deepEqual(manifest.host_permissions,['http://127.0.0.1:8765/*','https://www.youtube.com/*','https://youtube.com/*']);
 assert.deepEqual(manifest.web_accessible_resources[0].resources,['panel.html']);
 assert.doesNotMatch(fs.readFileSync(path.join(root,'content.js'),'utf8'),/pairingToken|api\/extension\/feed|video\.title|postMessage\s*\(/);
});
test('content script mounts only on YouTube home and sends no feed to the shared page',async()=>{
 const events={},observers=[],ports=[],timers=[];
 function el(tag){return {tag,children:[],className:'',textContent:'',isConnected:false,attrs:{},listeners:{},setAttribute(k,v){this.attrs[k]=v},addEventListener(k,f){this.listeners[k]=f},append(...a){this.children.push(...a)},appendChild(v){this.children.push(v)},replaceChildren(...a){this.children=[...a]},remove(){this.isConnected=false}}}
 const anchor=el('anchor'),parent={insertBefore(e,a){assert.equal(a,anchor);e.isConnected=true;e.nextElementSibling=anchor;this.current=e}};anchor.parentElement=parent;anchor.localName='ytd-rich-grid-renderer';let queries=0;
 const document={documentElement:el('html'),createElement:el,querySelector:()=>{queries++;return anchor},addEventListener:(k,f)=>events[k]=f};
 const location={pathname:'/'};const window={addEventListener:(k,f)=>events[k]=f};
 const chrome={runtime:{id:'anbgckjkfioebbbhigpolefmhhllkdhh',getURL:p=>EXT+p,connect(){const p={onMessage:{addListener(f){p.message=f}},onDisconnect:{addListener(f){p.disconnect=f}}};ports.push(p);return p}}};
 class MutationObserver{constructor(f){observers.push(f)}observe(){}}
 vm.runInNewContext(fs.readFileSync(path.join(root,'content.js'),'utf8'),{document,window,location,chrome,MutationObserver,requestAnimationFrame:f=>f(),setTimeout:f=>{timers.push(f);return timers.length},Math});
 assert.equal(parent.current,undefined,'no panel before explicit enable');ports[0].message({enabled:true});
 const rootNode=parent.current;assert.equal(rootNode.tag,'section');assert.equal(rootNode.children[0].children[0].textContent,'YourTube · independent local extension');
 const mountedQueries=queries;for(let i=0;i<1000;i++)observers[0]();assert.equal(queries,mountedQueries,'unrelated page mutations do not repeatedly query the DOM');
 const toggle=rootNode.children[0].children[1],body=rootNode.children[1];assert.equal(body.children[0].src,EXT+'panel.html');assert.equal(body.children[0].tag,'iframe');
 toggle.listeners.click();assert.equal(body.children.length,0);assert.equal(toggle.textContent,'Show panel');toggle.listeners.click();assert.equal(body.children[0].src,EXT+'panel.html');
 location.pathname='/watch';events['yt-navigate-finish']();assert.equal(rootNode.isConnected,false,'watch page/player remains untouched');
 location.pathname='/';events['yt-navigate-finish']();assert.equal(parent.current.isConnected,true);
 ports[0].disconnect();assert.equal(parent.current.isConnected,false,'disconnect hides a potentially stale panel');assert.equal(timers.length,1,'an idle worker reconnects');timers[0]();assert.equal(ports.length,2);
 ports[1].message({enabled:true});assert.equal(parent.current.isConnected,true,'panel returns only after worker confirmation');ports[1].message({enabled:false});assert.equal(parent.current.isConnected,false);
});
test('only the popup can pair, change visibility or pause the service',async()=>{
 const w=worker(),token='a'.repeat(64),marker='c'.repeat(64),pair=token+'.'+marker;
 const contentPair=await w.call({type:'pair',token:pair},w.content);assert.equal(contentPair.error,'unauthorized');
 assert.equal((await w.call({type:'pause'},w.panel)).error,'unauthorized');
 assert.equal((await w.call({type:'pair',token:'not-a-token'},w.popup)).error,'invalid-token');
 assert.equal((await w.call({type:'pair',token:pair},w.popup)).ok,true);assert.equal(w.data.pairingToken,token);assert.equal(w.data.partitionMarker,marker);
 assert.equal(w.access[0].accessLevel,'TRUSTED_CONTEXTS');
 const port=w.connect(w.content);await new Promise(r=>setImmediate(r));assert.equal(port.messages[0].enabled,false);
 assert.equal((await w.call({type:'set-panel',enabled:true},w.popup)).ok,true);assert.equal(port.messages.at(-1).enabled,true);
 const pause=await w.call({type:'pause'},w.popup);assert.equal(pause.status.enabled,false);assert.equal(pause.status.private,undefined);
 assert.equal(w.requests.at(-1).url,'http://127.0.0.1:8765/api/extension/live');assert.equal(w.requests.at(-1).options.body,'{"enabled":false}');
 assert.equal(w.requests.at(-1).options.headers.Authorization,'Bearer '+token);assert.equal(w.requests.at(-1).options.credentials,'omit');
 assert.equal((await w.call({type:'set-panel',enabled:'true'},w.popup)).error,'invalid-request');
 assert.equal((await w.call({type:'unpair'},w.popup)).ok,true);assert.equal(w.data.panelEnabled,false);assert.equal(w.data.pairingToken,'');assert.equal(w.data.partitionMarker,'');assert.equal(port.messages.at(-1).enabled,false);
});
test('page content cannot request local data or invoke a proxy; panel receives only sanitized cards',async()=>{
 const w=worker(),token='b'.repeat(64),marker='d'.repeat(64);await w.call({type:'pair',token:token+'.'+marker},w.popup);
 assert.equal((await w.call({type:'feed'},w.panel)).error,'disabled');await w.call({type:'set-panel',enabled:true},w.popup);
 for(const sender of [w.content,{...w.panel,tab:{url:'https://attacker.example/'}},{...w.panel,url:EXT+'other.html'},{...w.panel,id:'another-extension'}])assert.equal((await w.call({type:'feed'},sender)).error,'unauthorized');
 assert.equal((await w.call({type:'fetch',url:'https://attacker.example/'},w.popup)).error,'unauthorized');
 const result=await w.call({type:'feed'},w.panel);assert.equal(result.videos.length,1);assert.equal(result.videos[0].reason,undefined);assert.equal(result.videos[0].context,undefined);assert.equal(result.partitionMarker,undefined);assert.equal(result.pairingToken,undefined);
 assert.equal(w.projections[0].partitionMarker,marker);assert.equal(w.projections[0].pairingToken,undefined);
 assert.equal(w.requests.at(-1).url,'http://127.0.0.1:8765/api/extension/status');
 assert.equal(w.requests.at(-1).options.method,'POST');assert.equal(w.requests.at(-1).options.body,'{}');
 const bad=w.connect({...w.content,url:'https://attacker.example/'});assert.equal(bad.disconnected,true);
});
test('concurrent panels share only matching projection and disabling or re-pairing rejects stale results',async()=>{
 const w=worker(),a='a'.repeat(64)+'.'+'b'.repeat(64),b='c'.repeat(64)+'.'+'d'.repeat(64);
 await w.call({type:'pair',token:a},w.popup);await w.call({type:'set-panel',enabled:true},w.popup);
 let release;w.setProject(()=>new Promise(r=>{release=r}));const first=w.call({type:'feed'},w.panel),second=w.call({type:'feed'},w.panel);await new Promise(r=>setImmediate(r));
 assert.equal(w.projections.length,1,'matching requests share one projection');
 const panelPort=w.connect(w.panel,'yourtube-panel');await w.call({type:'pair',token:b},w.popup);assert.equal(panelPort.messages.at(-1).invalidate,true);
 const third=await w.call({type:'feed'},w.panel);assert.equal(third.error,'unavailable','new marker cannot join old projection');
 release({videos:[{id:'abc123def45',title:'Synthetic',channel:'Synthetic'}]});assert.equal((await first).error,'disabled');assert.equal((await second).error,'disabled');
 let release2;w.setProject(()=>new Promise(r=>{release2=r}));const fourth=w.call({type:'feed'},w.panel);await new Promise(r=>setImmediate(r));await w.call({type:'set-panel',enabled:false},w.popup);release2({videos:[{id:'abc123def45',title:'Synthetic',channel:'Synthetic'}]});assert.equal((await fourth).error,'disabled');
});
test('offscreen projector accepts only worker requests and validates local origin, source and nonce',async()=>{
 const callbacks={},events={},sent=[],body={appendChild(v){this.frame=v}};
 const frame={listeners:{},contentWindow:{postMessage(value,origin){this.value=value;this.origin=origin}},addEventListener(k,f){this.listeners[k]=f}};
 const document={body,createElement(tag){assert.equal(tag,'iframe');return frame}};
 const chrome={runtime:{id:'anbgckjkfioebbbhigpolefmhhllkdhh',getURL:p=>EXT+p,onMessage:{addListener:f=>callbacks.message=f},sendMessage:async value=>{sent.push(value);return {ok:true}}}};
 const window={addEventListener:(k,f)=>events[k]=f},crypto={getRandomValues(a){a.fill(7)}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'offscreen.js'),'utf8'),{document,window,chrome,crypto,Uint8Array,Array,setTimeout,clearTimeout});
 assert.equal(frame.src,'http://127.0.0.1:8765/extension-projection.html');frame.listeners.load();
 let replies=[];const request={type:'yourtube:offscreen-project',partitionMarker:'a'.repeat(64)},worker={id:chrome.runtime.id,url:EXT+'worker.js'};
 callbacks.message(request,{...worker,url:EXT+'panel.html'},v=>replies.push(v));assert.equal(frame.contentWindow.value,undefined,'panel cannot invoke projection directly');
 assert.equal(callbacks.message(request,worker,v=>replies.push(v)),true);const nonce=frame.contentWindow.value.nonce;assert.equal(frame.contentWindow.origin,'http://127.0.0.1:8765');
 const result={type:'yourtube:result',nonce,videos:[{id:'abc123def45',title:'Synthetic',channel:'Synthetic'}]};
 events.message({origin:'https://www.youtube.com',source:frame.contentWindow,data:result});events.message({origin:'http://127.0.0.1:8765',source:{},data:result});events.message({origin:'http://127.0.0.1:8765',source:frame.contentWindow,data:{...result,nonce:'wrong'}});assert.equal(replies.length,0);
 events.message({origin:'http://127.0.0.1:8765',source:frame.contentWindow,data:result});assert.equal(replies.length,1);assert.equal(replies[0].videos[0].title,'Synthetic');
 callbacks.message(request,worker,v=>replies.push(v));events.message({origin:'http://127.0.0.1:8765',source:frame.contentWindow,data:{type:'yourtube:invalidate'}});await new Promise(r=>setImmediate(r));assert.equal(sent.at(-1).type,'yourtube:projection-invalidated');assert.equal(replies.at(-1).error,'invalidated');
});
test('iframe creates only fixed YouTube links and text nodes for hostile metadata',async()=>{
 const nodes={};function node(tag){return {tag,textContent:'',children:[],listeners:{},append(...v){this.children.push(...v)},appendChild(v){this.children.push(v)},replaceChildren(){this.children=[]},addEventListener(k,f){this.listeners[k]=f},get childElementCount(){return this.children.length}}}
 const body=node('body');const document={body,visibilityState:'visible',getElementById:id=>nodes[id]||=(node(id)),createElement:node};
 const videos=[{id:'abc123def45',title:'<img src=x onerror=alert(1)>',channel:'<script>bad</script>'},{id:'javascript:',title:'bad',channel:'bad'}];
 const chrome={runtime:{sendMessage:async()=>({videos}),connect(){return {onMessage:{addListener(){}},onDisconnect:{addListener(){}}}}}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'panel.js'),'utf8'),{document,chrome,setTimeout(){return 1},setInterval(){},Array,encodeURIComponent});await new Promise(r=>setImmediate(r));
 assert.equal(nodes.videos.children.length,1);const [link,channel]=nodes.videos.children[0].children;
 assert.equal(link.href,'https://www.youtube.com/watch?v=abc123def45');assert.equal(link.target,'_top');assert.equal(link.textContent,'<img src=x onerror=alert(1)>');assert.equal(channel.textContent,'<script>bad</script>');assert.equal(link.innerHTML,undefined);
});
