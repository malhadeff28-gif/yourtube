'use strict';

// The hard timer starts with the first pending item and is never extended by
// subsequent arrivals. Node's relative timers use a monotonic clock.
function createBoundedBatchScheduler({quietMs,maxMs,onDue,setTimer=setTimeout,clearTimer=clearTimeout}){
 let quiet=null,deadline=null,active=false,due=false,generation=0;
 function clearTimers(){if(quiet!==null)clearTimer(quiet);if(deadline!==null)clearTimer(deadline);quiet=deadline=null}
 function reset(){generation++;clearTimers();active=false;due=false}
 function fire(mine){if(mine!==generation||!active||due)return;clearTimers();due=true;onDue()}
 function enqueue(){
  if(!active){active=true;const mine=++generation;deadline=setTimer(()=>fire(mine),maxMs)}
  if(due)return;
  if(quiet!==null)clearTimer(quiet);
  const mine=generation;quiet=setTimer(()=>fire(mine),quietMs);
 }
 function afterDequeue(hasPending){if(!hasPending)reset()}
 function workerIdle(){if(active&&due)onDue()}
 return {enqueue,afterDequeue,workerIdle,reset};
}
module.exports={createBoundedBatchScheduler};
