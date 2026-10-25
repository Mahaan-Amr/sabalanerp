import {createHash} from 'node:crypto';
import {compileProtectedBridgeMigration} from './protectedBridgeMigrationCompiler';

const pending=Object.freeze(['20261014140000_online_deployment_control','20261019010000_customer_semantic_barrier',
 '20261019020000_hr_versioned_file_cleanup','20261020010000_online_realtime_completion','20261020093000_online_serving_epochs']);
const hr='20261014120000_hr_vehicle_assignment_plans';
const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const hex=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'
 ?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const same=(a:unknown,b:unknown)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
function need(v:unknown):asserts v{if(!v)throw Error('PROTECTED_FINANCIAL_NATIVE_EVIDENCE_UNPROVEN');}
type Step=Readonly<{migrationName:string;sqlSha256:string;statementCount:number;tables:readonly string[];functions:readonly string[]}>;
export type ProtectedFinancialMigrationPlan=Readonly<{strategy:'sabalan-protected-owned-financial/v1';steps:readonly Step[];sourceCatalogSha256:string}>;
const plans=new WeakSet<ProtectedFinancialMigrationPlan>();

/** Finite compiler for the five actual production-pending files. This is not
 * an online expansion plan and never grants arbitrary SQL execution. */
export function compileProtectedFinancialMigrationPlan(files:ReadonlyMap<string,Buffer>):ProtectedFinancialMigrationPlan{
 need(files.size===pending.length&&same([...files.keys()].sort(),[...pending].sort()));
 const steps=pending.map(name=>{
  const bytes=files.get(name);need(bytes);const compiled=compileProtectedBridgeMigration(name,bytes);
  return Object.freeze({migrationName:name,sqlSha256:compiled.sha256,statementCount:compiled.statements.length,
   tables:Object.freeze(compiled.tables),functions:Object.freeze(compiled.functions)});
 });
 const result=Object.freeze({strategy:'sabalan-protected-owned-financial/v1' as const,steps:Object.freeze(steps),
  sourceCatalogSha256:sha(JSON.stringify(steps))});plans.add(result);return result;
}
type NativeRow={id:string;migration_name:string;checksum:string;started_at:string;finished_at:string|null;
 rolled_back_at:string|null;logs:string|null;applied_steps_count:number};
function history(raw:string):NativeRow[]{
 need(typeof raw==='string'&&Buffer.byteLength(raw)>0&&Buffer.byteLength(raw)<=16*1024*1024);
 const rows=JSON.parse(raw);need(Array.isArray(rows)&&rows.length<=4096);const ids=new Set<string>();
 for(const r of rows){need(r&&same(Object.keys(r).sort(),['id','migration_name','checksum','started_at','finished_at','rolled_back_at','logs','applied_steps_count'].sort())
  &&typeof r.id==='string'&&r.id.length>0&&r.id.length<=256&&!ids.has(r.id)&&typeof r.migration_name==='string'&&r.migration_name.length<=256
  &&hex(r.checksum)&&typeof r.started_at==='string'&&Number.isFinite(Date.parse(r.started_at))
  &&(r.finished_at===null||typeof r.finished_at==='string'&&Number.isFinite(Date.parse(r.finished_at)))
  &&(r.rolled_back_at===null||typeof r.rolled_back_at==='string'&&Number.isFinite(Date.parse(r.rolled_back_at)))
  &&(r.logs===null||typeof r.logs==='string')&&Number.isSafeInteger(r.applied_steps_count)&&r.applied_steps_count>=0);
  if(r.rolled_back_at===null)need(r.finished_at!==null&&r.applied_steps_count>0);ids.add(r.id);
 }
 return rows;
}

/** Data-only native-run proof. Both raw histories and the native SQL prior-ID
 * projection are required; summaries or a copied run JSON cannot supply them.
 * Even a valid result deliberately remains financially UNQUALIFIED until a
 * source-owned issuer joins genuine old/new HTTP originals and domain checks. */
export function verifyProtectedFinancialNativeRun(plan:ProtectedFinancialMigrationPlan,run:any,beforeRaw:string,afterRaw:string,priorRaw:string){
 need(plans.has(plan));const before=history(beforeRaw),after=history(afterRaw);history(priorRaw);
 need(before.length===440&&before.filter(r=>r.rolled_back_at===null).length===439
  &&after.length===445&&after.filter(r=>r.rolled_back_at===null).length===444
  &&sha(priorRaw)===sha(beforeRaw)&&run?.format==='sabalan-owned-protected-migration-run/v1'
  &&run.protectedMigrationsCompleted===true&&run.pendingCount===5&&Array.isArray(run.steps)&&run.steps.length===5
  &&same(run.validatedAlreadyApplied,[hr])&&Array.isArray(run.historicalInspections)&&run.historicalInspections.length===1
  &&typeof run.historicalInspections[0]?.file==='string'&&run.historicalInspections[0].file.length>0&&hex(run.historicalInspections[0].sha256)
  &&same(run.history,{before:{rows:440,appliedRows:439,sha256:sha(beforeRaw)},after:{rows:445,appliedRows:444,sha256:sha(afterRaw)},
   priorProjectionSha256:sha(priorRaw),priorProjectionUnchanged:true}));
 const oldIds=new Set(before.map(r=>r.id)),added=after.filter(r=>!oldIds.has(r.id));
 need(added.length===5&&same(after.filter(r=>oldIds.has(r.id)),before));
 const oldHr=before.filter(r=>r.migration_name===hr&&r.rolled_back_at===null);need(oldHr.length===1&&oldHr[0].logs===null);
 for(let i=0;i<plan.steps.length;i++){
  const input=plan.steps[i],step=run.steps[i],rows=added.filter(r=>r.migration_name===input.migrationName);
  need(!before.some(r=>r.migration_name===input.migrationName&&r.rolled_back_at===null)&&rows.length===1);
  const row=rows[0];need(row.checksum===input.sqlSha256&&row.rolled_back_at===null&&row.finished_at!==null
   &&row.applied_steps_count===1&&typeof row.logs==='string');const receipt=JSON.parse(row.logs);
  need(receipt?.format==='sabalan-protected-bridge/v1'&&receipt.sqlSha256===input.sqlSha256&&hex(receipt.catalogSha256)
   &&same(Object.keys(receipt).sort(),['format','sqlSha256','catalogSha256'].sort())
   &&step?.migrationName===input.migrationName&&step.sqlSha256===input.sqlSha256&&step.applied===true
   &&same(step.nativeRow,row)&&same(step.ownedReceipt,receipt));
 }
 return Object.freeze({format:'sabalan-protected-financial-native-data/v1' as const,strategy:plan.strategy,
  sourceCatalogSha256:plan.sourceCatalogSha256,originalHistorySha256:sha(beforeRaw),currentHistorySha256:sha(afterRaw),
  originalRows:440,currentRows:445,originalAppliedRows:439,currentAppliedRows:444,
  financialSchemaQualified:false as const,productionAdmission:false as const,requiresOriginalOldAndNewHttpProof:true as const});
}
