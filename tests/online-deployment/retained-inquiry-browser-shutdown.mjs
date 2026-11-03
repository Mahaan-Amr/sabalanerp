import assert from 'node:assert/strict';
/** QA lifecycle only: retain the browser until the original proxy is drained. */
const contextCloseAttempts=new WeakSet();
async function closeContext(context){assert.equal(contextCloseAttempts.has(context),false,'CONTEXT_CLOSURE_ALREADY_ATTEMPTED');contextCloseAttempts.add(context);await context.close();}

/** Partial HTML retirement only. The original proxy remains accepting; this
 * cannot certify stopped transport or replace the final full-drain boundary. */
export async function retireRetainedInquiryContexts({edge,journal,agent,tasks,contexts,retiring,assertObservations}){
 assert.ok(Array.isArray(contexts)&&Array.isArray(retiring)&&retiring.length>0);
 assert.equal(new Set(retiring).size,retiring.length);assert.ok(retiring.every(context=>contexts.includes(context)));
 assert.equal(agent.keepAlive,false);assert.equal(typeof assertObservations,'function');
 const generation=edge.status().generation;assert.ok(Number.isSafeInteger(generation)&&generation>=1);
 const sockets=()=>['sockets','requests','freeSockets'].reduce((total,key)=>total+Object.values(agent[key]).reduce((n,rows)=>{assert.ok(Array.isArray(rows));return n+rows.length;},0),0);
 const current=()=>{const state=edge.status();assert.equal(state.accepting,true);assert.equal(state.generation,generation,'CONTEXT_PUBLICATION_CHANGED');for(const key of ['active','unresolved','bodyBytes'])assert.ok(Number.isSafeInteger(state[key])&&state[key]>=0);assert.equal(state.unresolved,0,'CONTEXT_PROXY_OUTCOME_UNKNOWN');return state;};
 const quietNow=()=>{const state=current();return !state.active&&!state.bodyBytes&&!tasks.size&&!sockets();};
 async function requestsClosed(){
  for(;;){
   while(tasks.size)await Promise.allSettled([...tasks]);await assertObservations();
   const before=current(),beforeSockets=sockets(),beforeTasks=tasks.size,pending=await journal.pending(),after=current();assert.ok(Array.isArray(pending));await assertObservations();
   if(!before.active&&!after.active&&!before.bodyBytes&&!after.bodyBytes&&!beforeSockets&&!sockets()&&!pending.length&&!beforeTasks&&!tasks.size&&quietNow())return;
   assert.ok(before.active||after.active||!pending.length,'CONTEXT_JOURNAL_CLOSURE_UNPROVEN');
   await new Promise(resolve=>setTimeout(resolve,20));
  }
 }
 await requestsClosed();
 for(const context of retiring){await requestsClosed();while(!quietNow())await requestsClosed();const index=contexts.indexOf(context);assert.ok(index>=0,'CONTEXT_OWNERSHIP_CHANGED');await closeContext(context);assert.equal(contexts[index],context,'CONTEXT_OWNERSHIP_CHANGED');contexts.splice(index,1);}
 await requestsClosed();
 return{selectedContextsClosed:retiring.length,contextsRemaining:contexts.length,requestJournalQuiescent:true,proxyAdmissionStopped:false,productionAdmission:false};
}

export async function closeRetainedInquiryBrowser({edge,tasks,contexts,browser}){
 let failure;
 try{
  edge.beginDrain();
  await new Promise((resolve,reject)=>edge.server.close(error=>error?reject(error):resolve()));
  while(tasks.size)await Promise.allSettled([...tasks]);
  await edge.assertDrained();
 }catch(error){failure=error;}finally{
  for(const context of contexts)try{await closeContext(context);}catch(error){failure??=error;}
  if(browser)try{await browser.close();}catch(error){failure??=error;}
 }
 if(failure)throw failure;
}
