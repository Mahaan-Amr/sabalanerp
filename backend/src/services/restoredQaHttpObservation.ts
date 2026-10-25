/** Bounded original-child transport observation only. This class grants no
 * engine callback, endpoint, database, native or deployment authority. */
import fs from 'node:fs';
import{createHash}from'node:crypto';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
/** Preserve the first rejection, including JavaScript's falsy thrown values.
 * Cleanup is always awaited and cannot replace an earlier callback failure. */
export async function retainRestoredQaHttpWork<T>(work:()=>Promise<T>,cleanup:()=>Promise<void>):Promise<T>{
 let value!:T,failure:unknown,failureObserved=false;
 try{value=await work();}catch(error){failureObserved=true;failure=error;}
 try{await cleanup();}catch(error){if(!failureObserved){failureObserved=true;failure=error;}}
 if(failureObserved)throw failure;return value;
}
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
/** Data-only closure parser. Only the actual owner may join these records to
 * its still-retained original child handle and fresh SQL observation. */
export function parseRestoredQaBGuardianClosure(activeRaw:Buffer,finalRaw:Buffer,expected:{role?:'standalone'|'control';pid:number;startTicks:string;commandSha256:string;database:{name:string;oid:string;systemIdentifier:string}}){
 const need=(v:unknown)=>{if(!v)throw Error('RESTORED_QA_B_GUARDIAN_CLOSURE_UNPROVEN');};
 need(Buffer.isBuffer(activeRaw)&&Buffer.isBuffer(finalRaw)&&activeRaw.length>0&&finalRaw.length>0&&activeRaw.length<=16384&&finalRaw.length<=16384);
 const role=expected.role??'standalone';need(role==='standalone'||role==='control');
 const a=JSON.parse(activeRaw.toString()),f=JSON.parse(finalRaw.toString()),hash=createHash('sha256').update(activeRaw).digest('hex');
 need(a?.format==='sabalan-runtime-native/v1'&&a.phase==='ACTIVE'&&a.role===role&&a.guardian?.pid===expected.pid&&a.guardian.startTicks===expected.startTicks
  &&a.commandSha256===expected.commandSha256&&a.initialDatabase?.name===expected.database.name&&String(a.initialDatabase.oid)===expected.database.oid&&a.clusterIdentifier===expected.database.systemIdentifier
  &&a.onlineScope===undefined&&a.onlineLocks===undefined&&a.captureGate===undefined&&a.previousSha256===null&&/^[a-f0-9]{48}$/.test(a.instanceId)&&a.namespace==='sabalan-rt-'+a.instanceId);
 need(f?.phase==='QUIESCENT'&&f.nativeReaped===true&&f.databaseQuiet===true&&f.nativeStatus===0&&f.stoppedBySignal===false&&f.activeClaimSha256===hash);
 const restored={...f,phase:'ACTIVE'};for(const key of['nativeReaped','databaseQuiet','nativeStatus','stoppedBySignal','activeClaimSha256'])delete restored[key];
 need(JSON.stringify(canonical(restored))===JSON.stringify(canonical(a)));
 return Object.freeze({namespace:a.namespace,activeClaimSha256:hash,nativeReceiptSha256:createHash('sha256').update(finalRaw).digest('hex'),database:Object.freeze({...expected.database})});
}
export class RestoredQaHttpObservation {
 closed=false;fault:Error|undefined;code:number|null=null;signal:NodeJS.Signals|null=null;
 readonly done:Promise<void>;
 private outputBytes=0;private errorBytes=0;private buffer='';
 private readonly events:Array<Record<string,any>>=[];
 private readonly waiters:Array<()=>void>=[];
 constructor(readonly child:ChildProcessWithoutNullStreams,private readonly session:string,output:number,errors:number){
  this.done=new Promise(resolve=>child.once('close',(code,signal)=>{this.code=code;this.signal=signal;this.closed=true;this.wake();resolve();}));
  for(const emitter of [child,child.stdin,child.stdout,child.stderr])emitter.on('error',()=>this.fail());
  child.stdout.on('data',(raw:Buffer)=>{try{
   this.outputBytes+=raw.length;if(this.outputBytes>4194304)throw Error();fs.writeSync(output,raw);this.buffer+=raw.toString('utf8');
   for(;;){const end=this.buffer.indexOf('\n');if(end<0)break;const line=this.buffer.slice(0,end);this.buffer=this.buffer.slice(end+1);
    if(!line.startsWith('SABALAN_RESTORED_QA_HTTP '))continue;
    const event=JSON.parse(line.slice('SABALAN_RESTORED_QA_HTTP '.length));
    if(event.format!=='sabalan-restored-qa-http-original/v1'||event.session!==session)throw Error();
    // HELD revokes the live endpoint immediately, even while its original
    // callback is busy and has not requested the next protocol event.
    if(event.event==='HELD'){this.fail();continue;}
    this.events.push(event);
   }this.wake();
  }catch{this.fail();}});
  child.stderr.on('data',(raw:Buffer)=>{try{this.errorBytes+=raw.length;if(this.errorBytes>65536)throw Error();fs.writeSync(errors,raw);}catch{this.fail();}});
 }
 private wake(){for(const wake of this.waiters.splice(0))wake();}
 fail(){this.fault??=Error('RESTORED_QA_ORIGINAL_OBSERVATION_HELD');this.wake();}
 async next(name:string){for(;;){if(this.fault)throw this.fault;if(this.events.length){const event=this.events.shift()!;if(event.event!==name){this.fail();throw this.fault;}return event;}if(this.closed)throw Error('RESTORED_QA_ORIGINAL_CLOSED_BEFORE_EVENT');await new Promise<void>(resolve=>this.waiters.push(resolve));}}
 assertComplete(){if(this.fault)throw this.fault;if(!this.closed||this.code!==0||this.signal!==null||!this.child.stdout.readableEnded||!this.child.stderr.readableEnded||this.events.length||this.buffer!=='')throw Error('RESTORED_QA_ORIGINAL_CLOSURE_UNPROVEN');}
}
