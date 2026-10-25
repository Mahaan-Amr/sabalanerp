/** Fixed callback of the original strict restore owner. No main(), dynamic
 * callback path, public route or caller boolean can qualify this lane. */
import assert from'node:assert/strict';import fs from'node:fs';import path from'node:path';import{createHash,randomUUID}from'node:crypto';
import{ownedRestoredQaLoopbackRequest}from'../services/restoredQaFinancialTransport';
import{assertRestoredQaPrivateNormal}from'../services/restoredQaMigrationBaseline';
import{withRestoredQaFinancialFixture,type RestoredQaFinancialScope}from'../services/restoredQaFinancialFixture';
import{withRestoredQaHistoricalRuntimeGraph}from'../services/restoredQaHistoricalRuntimeGraph';
import{withRestoredQaHistoricalHttpCohort,withRestoredQaOriginalHttpCohort,assertRestoredQaOriginalHttpCohort,type RestoredQaOriginalHttpCohort}from'../services/restoredQaOriginalHttpCohort';
import{compileProtectedFinancialMigrationPlan,verifyProtectedFinancialNativeRun}from'../services/protectedFinancialMigrationEvidence';
import{withSystemRecoveryDatabaseClient}from'../services/systemRecoveryEngine';
import{assertRestoredQaWorkingMaterial}from'../services/restoredQaWorkingMaterial';
import{observeRestoredQaPrivateNormalCatalog}from'../services/protectedBridgeMigrations';
const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const names=['20261014140000_online_deployment_control','20261019010000_customer_semantic_barrier','20261019020000_hr_versioned_file_cleanup','20261020010000_online_realtime_completion','20261020093000_online_serving_epochs'];
function need(v:unknown):asserts v{assert.ok(v,'RESTORED_QA_FINANCIAL_HTTP_UNPROVEN');}
function workingFileSnapshot(scope:RestoredQaFinancialScope){const view=assertRestoredQaWorkingMaterial(scope.material,scope.owner),files:Array<{root:string;path:string;bytes:number;sha256:string}>=[];let total=0;
 for(const[name,root]of Object.entries(view.roots)){if(name==='recovery-coordination')continue;need(fs.realpathSync(root)===root);const visit=(directory:string)=>{for(const child of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){const file=path.join(directory,child.name),before=fs.lstatSync(file,{bigint:true});need(before.uid===0n&&!before.isSymbolicLink());if(before.isDirectory()){visit(file);continue;}need(before.isFile()&&before.nlink===1n&&before.size<=536870912n&&files.length<250000);const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK),hash=createHash('sha256'),buffer=Buffer.alloc(262144);try{const opened=fs.fstatSync(fd,{bigint:true});for(const k of['dev','ino','size','mtimeNs','ctimeNs','mode','uid','nlink']as const)need(opened[k]===before[k]);let bytes=0;for(;;){const n=fs.readSync(fd,buffer,0,buffer.length,null);if(!n)break;bytes+=n;total+=n;need(bytes<=Number(before.size)&&total<=8*1024**3);hash.update(buffer.subarray(0,n));}need(bytes===Number(before.size));for(const after of[fs.fstatSync(fd,{bigint:true}),fs.lstatSync(file,{bigint:true})])for(const k of['dev','ino','size','mtimeNs','ctimeNs','mode','uid','nlink']as const)need(after[k]===before[k]);files.push({root:name,path:path.relative(root,file).split(path.sep).join('/'),bytes,sha256:hash.digest('hex')});}finally{fs.closeSync(fd);}}};visit(root);}
 assertRestoredQaPrivateNormal(scope.normal,scope.material,scope.owner);return files;}
function sourceFiles(){return new Map(names.map(name=>{const file=path.join('/app/prisma/migrations',name,'migration.sql');need(fs.realpathSync(file)===file);const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);try{const s=fs.fstatSync(fd,{bigint:true});need(s.isFile()&&s.uid===0n&&s.nlink===1n&&!(s.mode&0o022n)&&s.size>0n&&s.size<=1048576n);const raw=fs.readFileSync(fd),after=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(file,{bigint:true});for(const key of['dev','ino','size','mtimeNs','ctimeNs','mode','uid','nlink']as const)need(s[key]===after[key]&&s[key]===named[key]);return[name,raw]as const;}finally{fs.closeSync(fd);}}));}
/** Data-only strict decimal check, never financial or endpoint authority. */
export function restoredQaFinancialBalance(value:unknown,expected:string){need(typeof value==='string'&&/^-?(0|[1-9][0-9]*)$/.test(value)&&value.length<=32&&value===expected);return BigInt(value);}
async function request(scope:RestoredQaFinancialScope,cohort:RestoredQaOriginalHttpCohort,session:string,relative:string,body?:unknown){
 const live=assertRestoredQaOriginalHttpCohort(cohort,scope.material,scope.owner),url=new URL(relative,live.url);need(url.hostname==='127.0.0.1'&&url.protocol==='http:'&&url.origin===new URL(live.url).origin);
 const payload=body===undefined?undefined:Buffer.from(JSON.stringify(body));need(!payload||payload.length<=16384);
 const result=await ownedRestoredQaLoopbackRequest(url,session,payload);
 need(result.status===200);assertRestoredQaOriginalHttpCohort(cohort,scope.material,scope.owner);const value=JSON.parse(result.raw.toString());need(value&&value.data);return{value:value.data,receipt:Object.freeze({method:payload?'POST':'GET',pathSha256:sha(relative),requestBodySha256:payload?sha(payload):null,status:result.status,responseSha256:sha(result.raw),responseBytes:result.raw.length})};
}
/** Actual decimal/HTTP work remains partial until its outer original proves
 * exact B retirement, all native pipes EOF and genuine installed-image joins. */
export async function runRestoredQaFinancialQualification(scope:RestoredQaFinancialScope){
 const accepted=assertRestoredQaPrivateNormal(scope.normal,scope.material,scope.owner),files=sourceFiles(),plan=compileProtectedFinancialMigrationPlan(files),e=accepted.migrationEvidence;
 const native=verifyProtectedFinancialNativeRun(plan,e.run,e.historyRaw.before,e.historyRaw.after,e.historyRaw.prior),fileBefore=workingFileSnapshot(scope);
 const run=await withSystemRecoveryDatabaseClient(accepted.database.name,db=>withRestoredQaFinancialFixture(db,scope,async seed=>
  withRestoredQaHistoricalRuntimeGraph(scope.material,scope.owner,async graph=>{
   const account='/api/accounting/ledger/customer-accounts/'+encodeURIComponent(seed.customerId),events:unknown[]=[];
   const balance=async(c:RestoredQaOriginalHttpCohort,expected:string)=>{const r=await request(scope,c,seed.sessionToken,account);restoredQaFinancialBalance(r.value.netBalanceRials,expected);events.push(r.receipt);};
   const post=async(c:RestoredQaOriginalHttpCohort,kind:'DEBIT'|'CREDIT')=>{const body={...seed.command,kind,amountRials:'2',idempotencyKey:randomUUID()},first=await request(scope,c,seed.sessionToken,account+'/operations',body),again=await request(scope,c,seed.sessionToken,account+'/operations',body);need(typeof first.value.voucherId==='string'&&first.value.voucherId.length>0&&first.value.voucherId.length<=256&&first.value.voucherId===again.value.voucherId&&first.value.profileId===again.value.profileId);events.push(first.receipt,again.receipt);return first.value.voucherId as string;};
   const old=await withRestoredQaHistoricalHttpCohort(scope.material,scope.owner,scope.normal,graph,async previous=>{
    await balance(previous,seed.initialBalance);const oldVoucher=await post(previous,'DEBIT'),raised=(BigInt(seed.initialBalance)+2n).toString();await balance(previous,raised);
    const current=await withRestoredQaOriginalHttpCohort(scope.material,scope.owner,scope.normal,async next=>{
     await balance(next,raised);const newVoucher=await post(next,'CREDIT');need(newVoucher!==oldVoucher);await balance(next,seed.initialBalance);await balance(previous,seed.initialBalance);
     return Object.freeze({oldVoucher,newVoucher});
    });return Object.freeze({current});
   });
   need(old.originalClosure.applicationGraph.kind==='OLD_89DD'&&old.value.current.originalClosure.applicationGraph.kind==='CURRENT_INSTALLED');
   return Object.freeze({events:Object.freeze(events),oldOriginal:old.originalClosure,newOriginal:old.value.current.originalClosure,
    voucherIds:Object.freeze([old.value.current.value.oldVoucher,old.value.current.value.newVoucher]),initialBalance:seed.initialBalance,finalBalance:seed.initialBalance,
    oldAndNewWritersObserved:true as const,idempotentPostsObserved:2 as const});
  })));
 const now=assertRestoredQaPrivateNormal(scope.normal,scope.material,scope.owner);need(now.migrationEvidence.historyRaw.after===e.historyRaw.after);
 await withSystemRecoveryDatabaseClient(accepted.database.name,async db=>{const[row]=await db.$queryRaw<Array<{value:string}>>`SELECT coalesce(json_agg(t ORDER BY migration_name,id),'[]'::json)::text AS value FROM public._prisma_migrations t`;need(row.value===e.historyRaw.after);});
 need(run.value.voucherIds.every(id=>run.vouchers.some(v=>v.id===id)));
 const catalog=await observeRestoredQaPrivateNormalCatalog(scope.normal,scope.material,scope.owner);assert.deepEqual(workingFileSnapshot(scope),fileBefore);
 return Object.freeze({format:'sabalan-restored-qa-financial-domain-partial/v1' as const,database:accepted.database,native,ownedMigrationEvidence:e,
  pendingSql:Object.freeze(Object.fromEntries([...files].map(([name,bytes])=>[name,bytes.toString('base64')]))),
  originalBusinessRows:run.originalBusinessRows,sequence:run.sequence,vouchers:run.vouchers,decimalBalanced:run.decimalBalanced,http:run.value,
  catalog,workingFilesSha256:sha(JSON.stringify(fileBefore)),workingFilesUnchanged:true as const,
  financialDomainHttpObserved:true as const,financialSchemaQualified:false as const,postHttpCatalogRevalidationPending:false as const,
  cleanupPending:true as const,outerOriginalClosurePending:true as const,independentPointHealthy:false as const,productionAdmission:false as const});
}
