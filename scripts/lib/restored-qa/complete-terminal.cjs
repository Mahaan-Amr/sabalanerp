/** Separate read-only terminal B observation after the financial benchmark.
 * It never relabels Source410's earlier exact-source business readback. */
'use strict';
const assert=require('node:assert/strict'),{createHash}=require('node:crypto');
async function observeOriginalCompleteTerminal(scope,sourceOwned,assertActive){
 const{assertOriginalIssuerResources}=await import('./original-issuer-material.mjs');
 const{assertRestoredQaPrivateNormal}=require('/app/dist/services/restoredQaMigrationBaseline.js');
 const{withSystemRecoveryDatabaseClient}=require('/app/dist/services/systemRecoveryEngine.js');
 await assertOriginalIssuerResources(sourceOwned.issuer,assertActive);sourceOwned.inquiryCarrier.assertCurrent();const normal=assertRestoredQaPrivateNormal(scope.normal,scope.material,scope.owner);
 const result=await withSystemRecoveryDatabaseClient(normal.database.name,db=>db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const rows=await tx.$queryRawUnsafe("SELECT current_database()::text AS name,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid,(SELECT system_identifier::text FROM pg_control_system()) AS \"systemIdentifier\",(SELECT rolsuper OR pg_has_role(current_user,'pg_read_all_stats','member') FROM pg_roles WHERE rolname=current_user) AS visible,(SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()) AS sessions,(SELECT count(*)::int FROM pg_prepared_xacts WHERE database=current_database()) AS prepared");
  assert.deepEqual(rows,[{...normal.database,visible:true,sessions:0,prepared:0}]);
  const[history]=await tx.$queryRawUnsafe("SELECT coalesce(json_agg(t ORDER BY migration_name,id),'[]'::json)::text AS value FROM public._prisma_migrations t");assert.equal(history.value,normal.migrationEvidence.historyRaw.after);
  return{format:'sabalan-original-complete-terminal-observation/v1',database:normal.database,sql:{visible:true,sessions:0,prepared:0},nativeHistorySha256:createHash('sha256').update(history.value).digest('hex'),observedAt:new Date().toISOString(),applicationReadbackPhase:'BEFORE_FINANCIAL_BENCHMARK',financialReadersClosedBeforeObservation:true,originalInquiryConservationRechecked:true,cleanupPending:true,productionAdmission:false};
 },{maxWait:1000,timeout:15000}));
 await assertOriginalIssuerResources(sourceOwned.issuer,assertActive);sourceOwned.inquiryCarrier.assertCurrent();assert.deepEqual(assertRestoredQaPrivateNormal(scope.normal,scope.material,scope.owner).database,result.database);return Object.freeze(result);
}
module.exports={observeOriginalCompleteTerminal};
