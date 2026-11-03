import {spawn} from 'node:child_process';
import type {Result} from './protectedTemporaryDatabase';

export type WorkerOutcome =
 | {state:'SUCCESS'|'FAILURE'; status:number; stdout:string; stderr:string}
 | {state:'UNKNOWN'};

/** The caller supplies the reviewed, fixed docker invocation. Never prints
 * captured output. A deadline marks uncertainty; it does not terminate a child.
 * UNKNOWN must retain the fixture, including its database and evidence. */
export async function consumeCandidateWorker(command:string,args:readonly string[],input?:string,deadlineMs=30000):Promise<WorkerOutcome>{
 if(!Number.isSafeInteger(deadlineMs)||deadlineMs<1||deadlineMs>480000)return {state:'UNKNOWN'};
 return new Promise(resolve=>{
  let unknown=false,bytes=0,stdout='',stderr='';
  const child=spawn(command,[...args],{stdio:[input===undefined?'ignore':'pipe','pipe','pipe'],windowsHide:true});
  const timer=setTimeout(()=>{unknown=true;},deadlineMs);
  const capture=(destination:'stdout'|'stderr')=>(chunk:Buffer)=>{
   bytes+=chunk.length;
   if(bytes>1024*1024){unknown=true;return;}
   if(destination==='stdout')stdout+=chunk.toString('utf8');else stderr+=chunk.toString('utf8');
  };
  if(!child.stdout||!child.stderr)unknown=true;
  else{child.stdout.on('data',capture('stdout'));child.stderr.on('data',capture('stderr'));}
  if(child.stdin){child.stdin.on('error',()=>{unknown=true;});child.stdin.end(input);}
  child.on('error',()=>{unknown=true;});
  child.on('close',(status,signal)=>{
   clearTimeout(timer);
   if(unknown||signal!==null||status===null||`${stdout}\n${stderr}`.includes('CANDIDATE_CLI_WORKER_OUTCOME_UNKNOWN')){
    resolve({state:'UNKNOWN'});return;
   }
   resolve({state:status===0?'SUCCESS':'FAILURE',status,stdout,stderr});
  });
 });
}

/** Used as the lifecycle exercise only after the real private fixture has
 * provisioned its owner and its before/after observer. An outcome other than
 * the exact expected refusal, including a changed snapshot, retains the DB. */
export function negativeCandidateExercise(
 invoke:(name:string,identity:string)=>Promise<WorkerOutcome>,
 observe:(name:string,identity:string)=>Promise<Result<string>>,
 expectedCode:'CANDIDATE_SOURCE_PROJECTION_UNPROVEN'|'CANDIDATE_EXECUTOR_CATALOG_UNQUALIFIED',
):(name:string,identity:string)=>Promise<Result<void>>{
 return async(name,identity)=>{
  try{
   const before=await observe(name,identity);if(before.state!=='SUCCESS')return {state:'UNKNOWN'};
   const run=await invoke(name,identity);
   if(run.state!=='FAILURE'||!`${run.stdout}\n${run.stderr}`.split(/\r?\n/).some(line=>{
    try{const value=JSON.parse(line);return value?.ok===false&&value.code===expectedCode;}catch{return false;}
   }))return {state:'UNKNOWN'};
   const after=await observe(name,identity);
   if(after.state!=='SUCCESS'||after.value!==before.value)return {state:'UNKNOWN'};
   return {state:'SUCCESS',value:undefined};
  }catch{return {state:'UNKNOWN'};}
 };
}
