'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createBoundedBatchScheduler}=require('../lib/bounded-batch-scheduler');

function clock(){
 let now=0,next=0;const jobs=new Map(),all=new Map();
 const set=(fn,ms)=>{const id=++next,job={fn,at:now+ms};jobs.set(id,job);all.set(id,job);return id};
 const clear=id=>jobs.delete(id);
 function advance(ms){const end=now+ms;while(true){const entries=[...jobs].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0]);if(!entries.length)break;const [id,job]=entries[0];jobs.delete(id);now=job.at;job.fn()}now=end}
 return {set,clear,advance,now:()=>now,stale:()=>[...all.values()].map(x=>x.fn),pending:()=>jobs.size};
}
function fixture(){
 const c=clock(),calls=[];let working=false,queue=[],enabled=true,maxConcurrent=0;
 const scheduler=createBoundedBatchScheduler({quietMs:12,maxMs:60,setTimer:c.set,clearTimer:c.clear,onDue:()=>{
  if(!enabled||working||!queue.length)return;
  working=true;maxConcurrent=Math.max(maxConcurrent,1);calls.push({at:c.now(),entry:queue.shift()});scheduler.afterDequeue(queue.length>0);
 }});
 function add(file,value){queue=queue.filter(x=>x.file!==file);queue.push({file,value});scheduler.enqueue()}
 function finish(){assert.equal(working,true);working=false;if(enabled&&queue.length)scheduler.workerIdle()}
 function pause(){enabled=false;queue=[];scheduler.reset()}
 function resume(){enabled=true}
 function remove(file){queue=queue.filter(x=>x.file!==file);if(!queue.length)scheduler.reset()}
 return {c,calls,add,finish,pause,resume,remove,pending:()=>queue.slice(),working:()=>working,maxConcurrent:()=>maxConcurrent};
}

test('continuous multi-chat arrivals cannot extend the original batch deadline',()=>{
 const f=fixture();f.add('first','initial');
 for(let t=10;t<=50;t+=10){f.c.advance(10);f.add(t%20?'other':'third',String(t));assert.equal(f.calls.length,0)}
 f.c.advance(10);assert.equal(f.calls.length,1);assert.equal(f.calls[0].at,60);assert.equal(f.calls[0].entry.file,'first');
 f.finish();assert.equal(f.calls.length,2,'overdue remainder begins when the worker becomes idle');assert.equal(f.maxConcurrent(),1);
});
test('same-chat coalescing retains the latest item and does not move the deadline',()=>{
 const f=fixture();f.add('a','0');for(let i=1;i<=5;i++){f.c.advance(10);f.add('a',String(i))}
 f.c.advance(10);assert.deepEqual(f.calls.map(x=>x.entry),[{file:'a',value:'5'}]);
});
test('a deadline reached while busy waits without spin and runs immediately when idle',()=>{
 const f=fixture();f.add('active','x');f.c.advance(12);assert.equal(f.calls.length,1);
 f.add('pending','old');for(let i=1;i<=5;i++){f.c.advance(10);f.add('pending',String(i))}
 f.c.advance(10);assert.equal(f.calls.length,1);assert.equal(f.c.pending(),0,'no polling timer while worker is busy');
 f.finish();assert.equal(f.calls.length,2);assert.equal(f.calls[1].at,72);assert.equal(f.calls[1].entry.value,'5');
});
test('pause and empty queue invalidate stale timer callbacks',()=>{
 const f=fixture();f.add('a','old');const stale=f.c.stale();f.pause();f.resume();f.add('b','new');for(const cb of stale)cb();assert.equal(f.calls.length,0);
 f.remove('b');f.c.advance(100);assert.equal(f.calls.length,0);f.add('c','fresh');f.c.advance(12);assert.deepEqual(f.calls.map(x=>x.entry.file),['c']);
});
test('a quiet batch starts after debounce rather than waiting for the maximum',()=>{
 const f=fixture();f.add('a','x');f.c.advance(11);assert.equal(f.calls.length,0);f.c.advance(1);assert.equal(f.calls.length,1);assert.equal(f.calls[0].at,12);
});
