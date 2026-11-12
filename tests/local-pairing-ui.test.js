'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('revealing a connection again preserves the same browser profile marker',async()=>{
 const nodes=new Map(),store=new Map(),reads=[];
 function element(id){if(!nodes.has(id))nodes.set(id,{id,value:'',hidden:false,disabled:false,textContent:'',listeners:{},addEventListener(type,fn){this.listeners[type]=fn}});return nodes.get(id)}
 const sandbox={document:{getElementById:element},localStorage:{getItem:k=>{reads.push(k);return store.has(k)?store.get(k):null},setItem:(k,v)=>store.set(k,v)},crypto:{getRandomValues:a=>{a.fill(42);return a}},Uint8Array,fetch:async()=>({ok:true,json:async()=>({token:'a'.repeat(64)})}),navigator:{clipboard:{writeText:async()=>{}}},confirm:()=>true};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','dist','extension-setup.js'),'utf8'),sandbox);
 assert.deepEqual(reads,[],'the page must not read storage before explicit reveal');
 await element('reveal').listeners.click();const first=element('pair-key').value,marker=store.get('yourtube.extension.partition.v1');assert.match(first,/^[a-f0-9]{64}\.[a-f0-9]{64}$/);
 sandbox.crypto.getRandomValues=a=>{a.fill(43);return a};await element('reveal').listeners.click();assert.equal(store.get('yourtube.extension.partition.v1'),marker);assert.equal(element('pair-key').value,first);
});
