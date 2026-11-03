import {createHash} from 'node:crypto';
const fail=(code:string):never=>{throw Object.assign(new Error(code),{code});};
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
type NativeRow={id:string;migration_name:string;checksum:string;started_at:string;finished_at:string|null;rolled_back_at:string|null;logs:string|null;applied_steps_count:number};
/** Data-only validation; caller must establish trusted issuer and owner separately. */
export function validateProtectedFinancialDeploymentHandoff(input:{qualification:any;expected:{deploymentId:string;releaseId:string;sourceCommit:string;checkpointSha256:string;targetImage:string};owner:{deploymentId:string;releaseId:string};targetCommit:string;database:unknown;checkpoint:unknown;beforeRaw:string;priorRaw:string;pending:readonly (readonly [string,Buffer])[]}){
 const {expected,owner}=input,point=input.checkpoint as any;
 if(expected?.deploymentId!==owner.deploymentId||expected?.releaseId!==owner.releaseId||expected.sourceCommit!==input.targetCommit
  ||!point||point.deploymentId!==owner.deploymentId||point.releaseId!==owner.releaseId||point.localVerified!==true||point.remoteVerified!==true||point.restoreVerified!==true||point.manifestReadable!==true||point.captureMethod!=='PROTECTED_MAINTENANCE_COMPLETE'||point.compatibility?.local?.compatible!==true||point.compatibility?.remote?.compatible!==true
  ||sha(JSON.stringify(canonical(point)))!==expected.checkpointSha256||!input.qualification)fail('PROTECTED_FINANCIAL_DEPLOYMENT_PREREQUISITE_UNPROVEN');
 const qualification=input.qualification;
 if(JSON.stringify(canonical(point.sourceDatabase))!==JSON.stringify(canonical(input.database)))fail('PROTECTED_FINANCIAL_DEPLOYMENT_BASELINE_CHANGED');
 if(JSON.stringify(canonical(qualification.sourceDatabase))!==JSON.stringify(canonical(input.database))||qualification.sourceCommit!==input.targetCommit||qualification.currentExecutionImage!==expected.targetImage
  ||sha(input.priorRaw)!==sha(qualification.originalHistoryRaw))fail('PROTECTED_FINANCIAL_DEPLOYMENT_BASELINE_CHANGED');
 const before:NativeRow[]=JSON.parse(input.beforeRaw),original:NativeRow[]=JSON.parse(qualification.originalHistoryRaw),ids=new Set(original.map(r=>r.id));
 const extras=before.filter(r=>!ids.has(r.id));
 if(extras.length>5||extras.some(r=>!qualification.steps.some((s:any)=>s.migrationName===r.migration_name&&s.sqlSha256===r.checksum)||r.rolled_back_at!==null||!r.finished_at||r.applied_steps_count!==1)
  ||input.pending.some(([name,bytes])=>!qualification.steps.some((s:any)=>s.migrationName===name&&s.sqlSha256===sha(bytes)))
  ||extras.some(r=>{try{const receipt=JSON.parse(r.logs!);return !qualification.catalogs.some((c:any)=>c.migrationName===r.migration_name&&c.sqlSha256===r.checksum&&c.catalogSha256===receipt.catalogSha256&&receipt.format==='sabalan-protected-bridge/v1'&&receipt.sqlSha256===r.checksum);}catch{return true;}})
  ||qualification.steps.some((s:any)=>!input.pending.some(([name])=>name===s.migrationName)&&!extras.some(r=>r.migration_name===s.migrationName)))fail('PROTECTED_FINANCIAL_DEPLOYMENT_BASELINE_CHANGED');
 return qualification;
}

