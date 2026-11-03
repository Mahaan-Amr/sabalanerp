/** SAME existing PostgreSQL service, serial physical replay. Source-only until
 * a fixed native binding supplies the actual coherent point and owned handles.
 * This module neither mints physical qualification nor changes a service. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {compileIndependentPhysicalReplay} from '../independent-physical-replay.mjs';
import {isClosedSerialNegative} from './retained-child.mjs';
const SHA=/^[a-f0-9]{64}$/,IMAGE=/^sha256:[a-f0-9]{64}$/;
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const equal=(a,b)=>assert.deepEqual(a,b);
const plans=new WeakSet();
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
export function assertSerialExistingPostgresPlan(plan){assert.ok(plans.has(plan),'SOURCE_COMPILED_SERIAL_PLAN_REQUIRED');}
export function compileSerialExistingPostgresPlan({operation,originalService,originalImage,originalSystemIdentifier,physicalInput}){
 assert.match(operation,/^[a-f0-9]{32}$/);assert.match(originalImage,IMAGE);assert.match(originalSystemIdentifier,/^[1-9][0-9]*$/);
 assert.equal(originalService.image,'postgres:15-alpine');assert.equal(originalService.environment.PGDATA??'/var/lib/postgresql/data','/var/lib/postgresql/data');
 assert.equal(originalService.volumes.length,1);const mount=originalService.volumes[0];
 assert.equal(mount.type,'volume');assert.equal(mount.source,'postgres_data');assert.equal(mount.target,'/var/lib/postgresql/data');assert.notEqual(mount.read_only,true);
 const replay=compileIndependentPhysicalReplay({...physicalInput,operation});
 assert.equal(replay.format,'sabalan-independent-physical-replay-plan/v1');assert.equal(replay.productionAdmission,false);assert.equal(replay.systemIdentifier!==originalSystemIdentifier,true);
 assert.match(replay.systemIdentifier,/^[1-9][0-9]*$/);assert.match(replay.controlDataSha256,SHA);
 assert.equal(replay.postgresArguments[0],'postgres');equal(replay.postgresArguments.slice(1,5),['-D','/var/lib/postgresql/data','-c','config_file=/restore.conf']);
 const root='/var/lib/postgresql/data/serial-physical-'+operation;
 const projectValue=value=>value.replaceAll('/var/lib/postgresql/data',root+'/data').replaceAll('/restore.conf',root+'/restore.conf').replaceAll('/restore-hba.conf',root+'/restore-hba.conf').replaceAll('/restore-ident.conf',root+'/restore-ident.conf').replaceAll('/wal/',root+'/wal/');
 const command=replay.postgresArguments.map(projectValue);
 // Pure projection of fixed canonical replay commands, never arbitrary options.
 assert.equal(command[2],root+'/data');assert.equal(command[4],'config_file='+root+'/restore.conf');
 assert.ok(command.includes('restore_command=cp '+root+'/wal/%f %p && chmod 600 %p'));
 assert.ok(command.includes('recovery_target_action=promote'));assert.ok(command.includes('archive_mode=off'));
 const override={services:{postgres:{image:originalImage,entrypoint:['/bin/sh',root+'/serial-wrapper.sh'],environment:{PGDATA:root+'/data'},command:command.slice(1)}}};
 const result={format:'sabalan-existing-compose-serial-physical-plan/v1',project:'sabalanerp-local',service:'postgres',operation,root,originalImage,originalSystemIdentifier,originalServiceSha256:hash(originalService),override,canonicalReplay:structuredClone(replay),originalDataExcludedEntry:'serial-physical-'+operation,sourceOnly:true,physicalReplayQualified:false,productionAdmission:false};
 freeze(result);plans.add(result);return result;
}
export function validateResolvedSerialService(plan,original,resolved){
 equal(hash(original),plan.originalServiceSha256);const expected=structuredClone(original);
 expected.image=plan.originalImage;expected.entrypoint=plan.override.services.postgres.entrypoint;expected.environment.PGDATA=plan.root+'/data';expected.command=plan.override.services.postgres.command;
 equal(resolved,expected); // No mounts/ports/network/capabilities/entrypoint drift.
}
export function validateFrozenOriginalInventory(plan,inventory){
 assert.equal(inventory.format,'sabalan-original-local-pgdata-frozen-inventory/v1');assert.equal(inventory.pgdata,'/var/lib/postgresql/data');assert.equal(inventory.excludedEntry,plan.originalDataExcludedEntry);
 assert.equal(inventory.normalShutdown,true);assert.equal(inventory.postmasterAbsent,true);assert.equal(inventory.runningServers,0);assert.equal(inventory.fullFileContentsHashed,true);
 assert.ok(inventory.rows.length>0);const names=new Set(),inodes=new Set();
 for(const row of inventory.rows){assert.equal(typeof row.path,'string');assert.ok(row.path.length>0&&!row.path.startsWith('/')&&!row.path.includes('\\')&&!row.path.split('/').some(x=>!x||x==='.'||x==='..'));assert.notEqual(row.path.split('/')[0],plan.originalDataExcludedEntry);assert.ok(!names.has(row.path));names.add(row.path);assert.ok(['file','directory'].includes(row.type));assert.equal(row.uid,'70');assert.equal(row.gid,'70');assert.ok(Number.isSafeInteger(row.mode));assert.equal(row.mode&0o022,0);assert.match(row.device,/^[0-9]+$/);assert.match(row.inode,/^[0-9]+$/);if(row.type==='file'){assert.equal(row.nlink,1);assert.match(row.sha256,SHA);assert.ok(Number.isSafeInteger(row.bytes)&&row.bytes>=0);const key=row.device+':'+row.inode;assert.ok(!inodes.has(key));inodes.add(key);}}
 assert.ok(names.has('PG_VERSION')&&names.has('global/pg_control'));return hash(inventory);
}
/** Ordered owner mechanism. Ports are source-owned native operations in a later
 * fixed binding, never caller argv or JSON authority. Tests use explicit models.
 * Every returned receipt must remain inside its original native owner. */
export async function runSerialRestorationProtocol(plan,port){
 assertSerialExistingPostgresPlan(plan);
 let obligation=false,originalStopped=false,primaryFailed=false,primary,restoreFailed=false,restoreError;let originalInventory,physicalResult;
 try{
  await port.guardAllTenAndQuiet();await port.verifyAndStageOwnedPhysicalMaterial(plan);
  await port.persistRestorationObligation(plan);obligation=true;
  await port.normalShutdownOriginal(plan); // Same original pg_ctl smart, no signal fallback.
  originalStopped=true;
  await port.activateSameServiceIdleWrapper(plan); // Alive, NO postmaster; same existing service.
  await port.verifyWrapperAndOriginalAbsence(plan);
  originalInventory=freeze(structuredClone(await port.frozenOriginalInventory(plan)));validateFrozenOriginalInventory(plan,originalInventory);
  await port.persistFrozenOriginalInventory(plan,originalInventory);
  await port.verifyResolvedOverride(plan);await port.startSameServiceReplay(plan);
  physicalResult=await port.verifyCanonicalNamedReplay(plan);
  await port.runBoundRestoredApplications(plan,physicalResult);
 }catch(error){primaryFailed=true;primary=error;}
 finally{
  if(obligation){
   try{
    // Ports must retain any started original and close it naturally before
    // returning. Held/lost originals retain the owner; no success is emitted.
    try { await port.drainAllReplayOriginals(plan); }
    catch(error) {
     if(!isClosedSerialNegative(error))throw error;
     if(!primaryFailed){primaryFailed=true;primary=error;}
    }
    assert.ok(originalStopped,'ORIGINAL_NORMAL_SHUTDOWN_NOT_PROVEN');
    try { await port.normalShutdownReplayIfStarted(plan); } // Wrapper PID1 remains alive for final inventory.
    catch(error) {
     if(!isClosedSerialNegative(error))throw error;
     if(!primaryFailed){primaryFailed=true;primary=error;}
    }
    assert.ok(originalInventory,'FROZEN_ORIGINAL_BASELINE_REQUIRED');
    const actual=await port.frozenOriginalInventory(plan);validateFrozenOriginalInventory(plan,actual);
    const {rootMetadata:before,...heldBefore}=originalInventory;
    const {rootMetadata:after,...heldAfter}=actual;
    equal(heldAfter,heldBefore);
    if(hash(before??null)!==hash(after??null))await port.persistRootDirectoryMetadataChange(plan,before,after);
    await port.verifyOriginalComposeAndImage(plan);await port.releaseWrapperAfterInventory(plan);await port.startOriginalSameService(plan);
    await port.verifyRestoredOriginalClusterAndAllTen(plan);
    await port.persistRestorationCompleted(plan);obligation=false;
   }catch(error){restoreFailed=true;restoreError=error;}
  }
 }
 // Preserve falsy rejections; restoring local development is mandatory even
 // when named replay or an application fails. No partial physical promotion.
 if(restoreFailed)throw new AggregateError(primaryFailed?[primary,restoreError]:[restoreError],'SERIAL_ORIGINAL_CLUSTER_RESTORATION_REQUIRED');
 if(primaryFailed)throw primary;
 assert.equal(obligation,false);return {physicalResult,originalClusterRestored:true,physicalReplayQualified:false,productionAdmission:false};
}
export const runtimeBindingRequired=Object.freeze({coherentPhysicalPoint:true,sourceOwnedNativeAdapter:true,allClientOriginalClosures:true,fixedComposeConfig:true,originalClusterInventory:true,exactSameImage:true,newActualPostgresIncarnation:true});
