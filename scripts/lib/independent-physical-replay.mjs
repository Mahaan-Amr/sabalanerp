/** Fixed PG15 replay commands for the original independent controller. Pure
 * compilation does not prove that a verifier/server ran or mint a closure. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const lsn=value=>{assert.match(value,/^(?:0|[1-9A-F][0-9A-F]{0,7})\/(?:0|[1-9A-F][0-9A-F]{0,7})$/);const [a,b]=value.split('/');return BigInt('0x'+a)*0x100000000n+BigInt('0x'+b);};
export function compileIndependentPhysicalReplay({operation,layout,controlDataRaw,postgresUser}){
 assert.match(operation,/^[a-f0-9]{32}$/);assert.match(postgresUser,/^[A-Za-z_][A-Za-z0-9_]{0,62}$/);
 assert.equal(layout.format,'sabalan-original-independent-online-layout/v1');assert.equal(layout.operation,operation);
 assert.equal(layout.physicalReplayQualified,false);assert.equal(layout.productionAdmission,false);
 const point=layout.restorePoint,coverage=layout.coverage;
 assert.match(point.name,/^[A-Za-z_][A-Za-z0-9_]{0,62}$/);assert.equal(point.lsn,coverage.restorePointLsn);
 assert.ok(lsn(coverage.startLsn)<=lsn(point.lsn)&&lsn(point.lsn)<=lsn(point.requiredWalEndLsn)&&lsn(point.requiredWalEndLsn)<=lsn(coverage.endLsn));
 assert.equal(layout.restoredFileCuts.length,9);assert.equal(new Set(layout.restoredFileCuts.map(row=>row.name)).size,9);
 assert.equal(coverage.nativeClosureQualified,false);assert.equal(coverage.independentRestoreQualified,false);
 assert.equal(typeof controlDataRaw,'string');assert.ok(Buffer.byteLength(controlDataRaw)>0&&Buffer.byteLength(controlDataRaw)<=65536);
 const settings={};
 for(const [label,key] of [['max_connections','max_connections'],['max_worker_processes','max_worker_processes'],['max_wal_senders','max_wal_senders'],['max_prepared_xacts','max_prepared_transactions'],['max_locks_per_xact','max_locks_per_transaction']]){
  const match=new RegExp('^'+label+' setting:\\s+(\\d+)\\s*$','m').exec(controlDataRaw);assert.ok(match);const value=Number(match[1]);assert.ok(Number.isSafeInteger(value)&&value>=0&&value<=1000);settings[key]=String(value);
 }
 const system=/^Database system identifier:\s+([1-9][0-9]*)\s*$/m.exec(controlDataRaw);assert.ok(system);assert.equal(system[1],layout.sourceDatabase.systemIdentifier);
 assert.equal(coverage.database.systemIdentifier,system[1]);assert.equal(coverage.database.databaseName,layout.sourceDatabase.database);assert.equal(String(coverage.database.databaseOid),String(layout.sourceDatabase.databaseOid));
 assert.ok(Number.isSafeInteger(coverage.timeline)&&coverage.timeline>=1&&coverage.timeline<=0xffffffff);
 const values={...settings,listen_addresses:'*',shared_buffers:'64MB',unix_socket_directories:'/var/run/postgresql',hba_file:'/restore-hba.conf',ident_file:'/restore-ident.conf',
  shared_preload_libraries:'',session_preload_libraries:'',local_preload_libraries:'',primary_conninfo:'',primary_slot_name:'',archive_mode:'off',archive_command:'',archive_library:'',ssl:'off',archive_cleanup_command:'',recovery_end_command:'',
  logging_collector:'off',log_destination:'stderr',autovacuum:'off',max_logical_replication_workers:'0',
  restore_command:'cp /wal/%f %p && chmod 600 %p',recovery_target:'',recovery_target_time:'',recovery_target_xid:'',recovery_target_lsn:'',recovery_target_name:point.name,recovery_target_inclusive:'true',recovery_target_action:'promote',recovery_target_timeline:String(coverage.timeline)};
 const argumentsList=['postgres','-D','/var/lib/postgresql/data','-c','config_file=/restore.conf'];for(const [key,value] of Object.entries(values))argumentsList.push('-c',key+'='+value);
 const sourceDatabase=layout.sourceDatabase.database;assert.match(sourceDatabase,/^[A-Za-z_][A-Za-z0-9_]{0,62}$/);
 assert.ok(!['postgres','template0','template1'].includes(sourceDatabase));
 const targetDatabase='qa_application_restored_'+operation;
 return Object.freeze({format:'sabalan-independent-physical-replay-plan/v1',controlDataSha256:sha(Buffer.from(controlDataRaw)),
  verifyBackup:['pg_verifybackup','--no-parse-wal','/var/lib/postgresql/data'],
  verifyWal:['pg_waldump','-q','-p','/wal','-s',coverage.startLsn,'-e',coverage.endLsn],
  postgresArguments:argumentsList,postgresUser,sourceDatabase,targetDatabase,systemIdentifier:system[1],sourceDatabaseOid:String(layout.sourceDatabase.databaseOid),
  observeReplaySql:"SELECT json_build_object('inRecovery',pg_is_in_recovery(),'lastReplayLsn',pg_last_wal_replay_lsn()::text,'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'sourceDatabaseOid',(SELECT oid::text FROM pg_database WHERE datname='"+sourceDatabase+"'))::text",
  renameDatabaseSql:'ALTER DATABASE "'+sourceDatabase+'" RENAME TO "'+targetDatabase+'"',
  restorePoint:{name:point.name,lsn:point.lsn,requiredWalEndLsn:point.requiredWalEndLsn,timeline:coverage.timeline},productionAdmission:false});
}
export function assertIndependentPhysicalReplayObserved(plan,actual){
 assert.equal(actual.inRecovery,false);assert.equal(actual.systemIdentifier,plan.systemIdentifier);assert.equal(actual.sourceDatabaseOid,plan.sourceDatabaseOid);
 assert.ok(lsn(actual.lastReplayLsn)>=lsn(plan.restorePoint.lsn)&&lsn(actual.lastReplayLsn)<=lsn(plan.restorePoint.requiredWalEndLsn));
 assert.match(actual.sourceDatabaseOid,/^[1-9][0-9]*$/);return actual;
}
