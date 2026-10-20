import test from 'node:test';
import assert from 'node:assert/strict';
import {compileIndependentPhysicalReplay,assertIndependentPhysicalReplayObserved} from '../../scripts/lib/independent-physical-replay.mjs';
function input(){return {operation:'a'.repeat(32),postgresUser:'postgres',controlDataRaw:'Database system identifier: 123456\nmax_connections setting: 100\nmax_worker_processes setting: 8\nmax_wal_senders setting: 10\nmax_prepared_xacts setting: 0\nmax_locks_per_xact setting: 64\n',
 layout:{format:'sabalan-original-independent-online-layout/v1',operation:'a'.repeat(32),physicalReplayQualified:false,productionAdmission:false,sourceDatabase:{database:'actual_source',databaseOid:'123',systemIdentifier:'123456'},restorePoint:{name:'sabalan_cut_actual',lsn:'0/120',requiredWalEndLsn:'0/200'},restoredFileCuts:Array.from({length:9},(_,i)=>({name:'root'+i})),
  coverage:{restorePointLsn:'0/120',startLsn:'0/100',endLsn:'0/300',timeline:1,nativeClosureQualified:false,independentRestoreQualified:false,database:{databaseName:'actual_source',databaseOid:'123',systemIdentifier:'123456'}}}};}
test('fixed replay uses captured named restorepoint and suppresses inherited hooks and replication/preload settings',()=>{const plan=compileIndependentPhysicalReplay(input());
 const args=plan.postgresArguments;assert.ok(args.includes('recovery_target_name=sabalan_cut_actual'));assert.ok(args.includes('recovery_target_lsn='));
 for(const key of ['primary_conninfo','primary_slot_name','shared_preload_libraries','session_preload_libraries','local_preload_libraries','archive_command','archive_library','archive_cleanup_command','recovery_end_command'])assert.ok(args.includes(key+'='));
 assert.ok(args.includes('recovery_target_action=promote'));assert.ok(args.includes('hba_file=/restore-hba.conf'));assert.deepEqual(plan.verifyBackup,['pg_verifybackup','--no-parse-wal','/var/lib/postgresql/data']);
 assert.deepEqual(plan.verifyWal,['pg_waldump','-q','-p','/wal','-s','0/100','-e','0/300']);assert.equal(plan.productionAdmission,false);
 assert.equal(plan.renameDatabaseSql,'ALTER DATABASE "actual_source" RENAME TO "qa_application_restored_'+input().operation+'"');
});
test('changed source cluster/OID, incomplete actual9roots or unsafe SQL identifier refuse before commands',()=>{for(const mutate of [v=>v.layout.sourceDatabase.systemIdentifier='999',v=>v.layout.sourceDatabase.databaseOid='444',v=>v.layout.restoredFileCuts.pop(),v=>v.postgresUser='postgres;DELETE',v=>v.layout.restorePoint.name="x';evil",v=>v.layout.restorePoint.lsn='0/999',v=>v.layout.physicalReplayQualified=true]){const value=input();mutate(value);assert.throws(()=>compileIndependentPhysicalReplay(value));}});
test('actual replay observation must have promoted at the captured boundary on original cluster/OID',()=>{const plan=compileIndependentPhysicalReplay(input()),actual={inRecovery:false,lastReplayLsn:'0/130',systemIdentifier:'123456',sourceDatabaseOid:'123'};
 assert.equal(assertIndependentPhysicalReplayObserved(plan,actual),actual);
 for(const mutate of [v=>v.inRecovery=true,v=>v.lastReplayLsn='0/110',v=>v.lastReplayLsn='0/201',v=>v.systemIdentifier='999',v=>v.sourceDatabaseOid='999']){const value={...actual};mutate(value);assert.throws(()=>assertIndependentPhysicalReplayObserved(plan,value));}
});
