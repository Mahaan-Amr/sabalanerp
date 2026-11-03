import {exactCandidateMigrationDigests,exactCandidateMigrationNames,validateCandidateReceiptPrefix} from './protectedCandidateMigrationInventory';
import {validateProtectedMigrationHistory} from './protectedMigrationHistory';
import {observeCandidateInitialFunctions,observeCandidateInitialColumns,observeCandidateInitialTriggers,observeCandidateInitialKeys,observeCandidateInitialIndexes,observeCandidateInitialDefaults,observeCandidateInitialChecks} from './protectedCandidateInitialColumns';
import {observeLaterNumericColumns,observeLaterCreatedColumns,observeLaterAddedColumns,observeLaterCreatedIndexes,observeInvoiceConstraintDimension} from './protectedCandidateLaterProjection';
import {compareCandidateStage} from './protectedCandidateStageComparison';
import {observeCandidateExplicitDimensions} from './protectedCandidateExplicitDimensions';
import {observeCandidateRelationSecurity} from './protectedCandidateRelationSecurity';
import {checkCandidateSourceCoverage} from './protectedCandidateSourceCoverage';

/** Narrow Prisma transaction interface. This reader does not grant authority. */
export type CandidateObservationTransaction = {
  $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
};
export type CandidateObservationOwner = Readonly<{deploymentId:string;releaseId:string;leaseToken:string}>;
type LeaseRow={id:string;targetCommit:string;checkpoint:unknown};
type HistoryRow={name:string;checksum:string;finished:Date|null;rolledBack:Date|null;hasLogs:boolean};
const fail=(code:string):never=>{throw Object.assign(new Error(code),{code});};

/**
 * Call only inside the existing protected owner transaction, after native
 * boundary verification. The lease FOR SHARE takes a PostgreSQL row lock,
 * requires its corresponding role privilege, and is not valid in a READ ONLY
 * transaction. Caller must set a bounded interactive transaction timeout and
 * use the existing native-boundary validator. No DDL/history write occurs
 * here. Full active history is checked against source; candidate receipt-chain
 * consistency is checked separately and never accepted as catalog proof.
 */
export async function readProtectedTransactionHistory(tx:CandidateObservationTransaction,owner:CandidateObservationOwner,files:ReadonlyMap<string,Buffer>){
 if(!tx||typeof tx.$queryRaw!=='function'||!owner||[owner.deploymentId,owner.releaseId,owner.leaseToken].some(value=>typeof value!=='string'||value.length<1||value.length>256))fail('CANDIDATE_OWNER_INVALID');
 await tx.$queryRaw`SELECT set_config('lock_timeout','250ms',true),set_config('statement_timeout','10000ms',true)`;
 const leases=await tx.$queryRaw<LeaseRow[]>`SELECT id, "targetCommit", "checkpointJson" AS checkpoint FROM public.deployment_operations
   WHERE id=${owner.deploymentId} AND "releaseId"=${owner.releaseId} AND "leaseToken"=${owner.leaseToken}
   AND "activeKey"='production' AND phase='MUTATION_STARTED' AND "leaseExpiresAt">clock_timestamp()+interval '20 seconds' FOR SHARE`;
 if(!Array.isArray(leases))fail('CANDIDATE_CHECKPOINT_LEASE_UNPROVEN');
 const checkpoint=leases[0]?.checkpoint as Record<string,unknown>|undefined;
 if(leases.length!==1||!/^[a-f0-9]{40}$/.test(leases[0].targetCommit)||!checkpoint||checkpoint.deploymentId!==owner.deploymentId||checkpoint.releaseId!==owner.releaseId||
    checkpoint.localVerified!==true||checkpoint.remoteVerified!==true||checkpoint.restoreVerified!==true||checkpoint.manifestReadable!==true||
    typeof checkpoint.checksum!=='string'||!/^[a-f0-9]{64}$/.test(checkpoint.checksum))fail('CANDIDATE_CHECKPOINT_LEASE_UNPROVEN');
 const history=await tx.$queryRaw<HistoryRow[]>`SELECT migration_name AS name,checksum,finished_at AS finished,rolled_back_at AS "rolledBack",logs IS NOT NULL AS "hasLogs"
   FROM public._prisma_migrations ORDER BY migration_name,id LIMIT 8193 FOR SHARE`;
 if(!Array.isArray(history)||history.length>8192)fail('CANDIDATE_HISTORY_BOUND');
 validateProtectedMigrationHistory(history,files);
 return {targetCommit:leases[0].targetCommit,checkpointChecksum:checkpoint!.checksum as string,history};
}
export async function readCandidateTransactionObservation(tx:CandidateObservationTransaction,owner:CandidateObservationOwner,files:ReadonlyMap<string,Buffer>){
 const base=await readProtectedTransactionHistory(tx,owner,files),history=base.history;
 const candidate=new Set(exactCandidateMigrationNames),active=new Map<string,HistoryRow>();
 for(const row of history){
  if(!row.rolledBack&&!row.finished)fail('CANDIDATE_HISTORY_UNFINISHED');
  if(!candidate.has(row.name)||row.rolledBack)continue;
  if(active.has(row.name)||!row.finished||typeof row.hasLogs!=='boolean'||row.checksum!==exactCandidateMigrationDigests[row.name])fail('CANDIDATE_HISTORY_UNPROVEN');
  active.set(row.name,row);
 }
 let prefix=0;
 while(prefix<exactCandidateMigrationNames.length&&active.has(exactCandidateMigrationNames[prefix]))prefix++;
 if(active.size!==prefix)fail('CANDIDATE_HISTORY_NONCONTIGUOUS');
 // Narrow native precondition for the first CREATE stage only. Absence of
 // these objects is necessary but not sufficient to qualify its predecessor.
 if(prefix===0){
  const rows=await tx.$queryRaw<Array<{relations:number;functions:number}>>`SELECT
   (SELECT count(*)::integer FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('online_releases','online_runtime_slots','online_migration_steps')) AS relations,
   (SELECT count(*)::integer FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('sabalan_protect_online_release_identity','sabalan_protect_online_runtime_identity',
      'sabalan_protect_online_migration_identity','sabalan_prevent_online_registry_delete')) AS functions`;
  if(!Array.isArray(rows)||rows.length!==1||!Number.isSafeInteger(rows[0].relations)||!Number.isSafeInteger(rows[0].functions)||rows[0].relations<0||rows[0].functions<0)fail('CANDIDATE_INITIAL_CATALOG_UNKNOWN');
  if(rows[0].relations!==0||rows[0].functions!==0)fail('CANDIDATE_INITIAL_CATALOG_MISMATCH');
 }
 const receiptRows:Array<Parameters<typeof validateCandidateReceiptPrefix>[0][number]>=[];
 for(const name of exactCandidateMigrationNames.slice(0,prefix)){
  const rows=await tx.$queryRaw<Array<{checksum:string;finished:Date|null;receipt:string|null}>>`SELECT checksum,finished_at AS finished,
    CASE WHEN octet_length(logs)<=65536 THEN logs ELSE NULL END AS receipt FROM public._prisma_migrations
    WHERE migration_name=${name} AND rolled_back_at IS NULL LIMIT 2 FOR SHARE`;
  if(!Array.isArray(rows)||rows.length!==1||!rows[0].finished||rows[0].checksum!==exactCandidateMigrationDigests[name]||typeof rows[0].receipt!=='string')fail('CANDIDATE_RESUME_RECEIPT_UNPROVEN');
  let receipt:unknown;try{receipt=JSON.parse(rows[0].receipt!);}catch{fail('CANDIDATE_RESUME_RECEIPT_UNPROVEN');}
  receiptRows.push({name,checksum:rows[0].checksum,finished:true,rolledBack:false,receipt:receipt as any});
 }
 const lastReceiptScopedProjectionSha256=validateCandidateReceiptPrefix(receiptRows,base.checkpointChecksum);
 const numericDimension=prefix>1?await observeLaterNumericColumns(tx,exactCandidateMigrationNames[prefix-1]):null;
 if(numericDimension?.comparison==='MISMATCH')fail('CANDIDATE_NUMERIC_TYPE_MISMATCH');
 const createdColumnDimension=prefix>1?await observeLaterCreatedColumns(tx,exactCandidateMigrationNames[prefix-1]):null;
 if(createdColumnDimension?.structure==='MISMATCH'||createdColumnDimension?.defaults==='MISMATCH')fail('CANDIDATE_CREATED_COLUMN_MISMATCH');
 const addedColumnDimension=prefix>1?await observeLaterAddedColumns(tx,exactCandidateMigrationNames[prefix-1]):null;
 if(addedColumnDimension?.comparison==='MISMATCH')fail('CANDIDATE_ADDED_COLUMN_MISMATCH');
 const indexDimension=prefix>1?await observeLaterCreatedIndexes(tx,exactCandidateMigrationNames[prefix-1]):null;
 if(indexDimension?.structure==='MISMATCH')fail('CANDIDATE_INDEX_MISMATCH');
 const invoiceConstraintDimension=prefix>1?await observeInvoiceConstraintDimension(tx,exactCandidateMigrationNames[prefix-1]):null;
 if(invoiceConstraintDimension?.comparison==='MISMATCH')fail('CANDIDATE_INVOICE_CHECK_MISMATCH');
 const stageComparison=await compareCandidateStage(tx,prefix);
 if(stageComparison.state==='MISMATCH')fail('CANDIDATE_STAGE_WITNESS_MISMATCH');
 const explicitDimensions=stageComparison.state==='SCOPED_MATCH'?await observeCandidateExplicitDimensions(tx,prefix):{state:'UNKNOWN' as const};
 if(explicitDimensions.state==='MISMATCH')fail('CANDIDATE_EXPLICIT_DIMENSION_MISMATCH');
 const relationSecurity=stageComparison.state==='SCOPED_MATCH'?await observeCandidateRelationSecurity(tx,prefix):{state:'UNKNOWN' as const};
 if(relationSecurity.state==='MISMATCH')fail('CANDIDATE_RELATION_SECURITY_MISMATCH');
 const measured=explicitDimensions.state==='SCOPED_MATCH'?explicitDimensions.checks:[];
 const sourceCoverage=checkCandidateSourceCoverage(files);
 const unresolvedCatalog=[...(sourceCoverage.state!=='SCOPED_MATCH'?['pinned-ddl-source-map']:[]),
  ...(relationSecurity.state!=='SCOPED_MATCH'?['relation-kind-persistence-rls-policies-inheritance-control-privileges']:[]),
  ...(prefix>=2&&!measured.includes('customer_barrier_public_revoke')?['customer-barrier-public-revoke']:[]),
  ...(prefix>=8&&!measured.includes('sales_invoice_sequence')?['sales-dispatch-invoice-sequence']:[]),
  ...(prefix>=11&&!measured.includes('purchasing_serial_binding')?['purchasing-documents-serial-sequence-binding']:[])];
 // Exact stage-one projection is not reused for later schemas: legitimate
 // successor evolution needs a reviewed stage-aware projection. Either way
 // the full catalog remains unqualified.
 let initialDimensions:null|Readonly<{indexes:'MATCH';defaults:'MATCH';checks:'MATCH';witness:'LOCAL_SCHEMA_ROLLBACK'}>=null;
 if(prefix===1){const sql=files.get(exactCandidateMigrationNames[0]);if(!sql)fail('CANDIDATE_INITIAL_FUNCTIONS_UNPROVEN');await observeCandidateInitialFunctions(tx,sql!);await observeCandidateInitialColumns(tx);await observeCandidateInitialTriggers(tx);await observeCandidateInitialKeys(tx);const indexes=await observeCandidateInitialIndexes(tx),defaults=await observeCandidateInitialDefaults(tx),checks=await observeCandidateInitialChecks(tx);initialDimensions=Object.freeze({indexes,defaults,checks,witness:'LOCAL_SCHEMA_ROLLBACK'});}
 return Object.freeze({prefixLength:prefix,targetCommit:base.targetCommit,sourceImageBinding:'UNPROVEN' as const,checkpointChecksum:base.checkpointChecksum,
   originalRows:Object.freeze(exactCandidateMigrationNames.slice(0,prefix).map(name=>Object.freeze({name,checksum:active.get(name)!.checksum,hasLogs:active.get(name)!.hasLogs}))),
   lastReceiptScopedProjectionSha256,initialDimensions,numericDimension,createdColumnDimension,addedColumnDimension,indexDimension,invoiceConstraintDimension,stageComparison,explicitDimensions,relationSecurity,sourceCoverage,unresolvedCatalog:Object.freeze(unresolvedCatalog),receiptPrefix:'CONSISTENT_NOT_QUALIFIED' as const,catalogQualification:'UNPROVEN' as const,executionAuthority:'NOT_GRANTED' as const});
}
