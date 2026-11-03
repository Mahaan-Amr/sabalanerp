/** Bind finite commands to the SAME live coordinator. No CLI entry point,
 * historical process adoption, serialized lease, or default application port. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {compileNativePrimitives,retainSerialNativePrimitive,renderSerialSources,validateSerialToolObservation} from './native-primitives.mjs';
import {parseFrozenOriginalInventory} from './frozen-inventory.mjs';
import {assertSerialExistingPostgresPlan,validateResolvedSerialService} from './serial-owner.mjs';
import {assertIndependentPhysicalReplayObserved} from '../independent-physical-replay.mjs';
import {isClosedSerialNegative} from './retained-child.mjs';

function stdout(row) {
 assert.equal(row.code,0);assert.equal(row.signal,null);assert.equal(row.stdoutEof,true);assert.equal(row.stderrEof,true);assert.equal(row.observationFault,false);
 assert.ok(row.stdoutBytes<=32*1024**2);
 const raw=fs.readFileSync(row.stdoutFile);assert.equal(raw.length,row.stdoutBytes);
 assert.equal(createHash('sha256').update(raw).digest('hex'),row.stdoutSha256);return raw.toString('utf8');
}

/** Coordinator-owned ports carry the actual material/lease/apps and postmaster
 * observation. They are required functions, never inferred from old reports.
 * Finite Docker children and all frozen inventories are owned here. */
export function createSerialPhysicalNativeBinding(plan,{originalService,originalPostgresId,overrideFile,restoreFile,native,coordinator,requiredFreeBytes}) {
 assertSerialExistingPostgresPlan(plan);
 assert.ok(Number.isSafeInteger(requiredFreeBytes)&&requiredFreeBytes>0);
 const required=['guardAllTenAndQuiet','stageOwnedPhysicalMaterial','persistRestorationObligation',
  'observeIdleWrapper','verifyWrapperAndOriginalAbsence','persistFrozenOriginalInventory',
  'observeResolvedOverride','verifyCanonicalNamedReplay','runBoundRestoredApplications',
  'drainAllReplayOriginals','observeReplayNormalShutdown','verifyOriginalComposeAndImage',
  'persistFinalFrozenInventory','persistRootDirectoryMetadataChange','observeWrapperReleaseReady','observeWrapperClosed','invalidateAffectedNativeBindings',
  'verifyRestoredOriginalClusterAndAllTen','persistRestorationCompleted'];
 for(const name of required)assert.equal(typeof coordinator[name],'function','LIVE_COORDINATOR_PORT_REQUIRED:'+name);
 assert.equal(typeof native.beforeDocker,'function');
 const commands=compileNativePrimitives(plan,{originalPostgresId,overrideFile,restoreFile});
 let ordinal=0,wrapper=null,replayRequested=false,snapshot=0,nativeFault=false;
 const run=async c=>{
  try {return await retainSerialNativePrimitive(c,{...native,ordinal:ordinal++});}
  catch(error){if(!isClosedSerialNegative(error))nativeFault=true;throw error;}
 };
 const requireWrapper=()=>{assert.ok(wrapper,'ACTUAL_IDLE_WRAPPER_REQUIRED');return wrapper;};
 return Object.freeze({
  guardAllTenAndQuiet:()=>coordinator.guardAllTenAndQuiet(plan),
  async verifyAndStageOwnedPhysicalMaterial(){
   await coordinator.stageOwnedPhysicalMaterial(plan,{sources:renderSerialSources(plan),override:plan.override,restore:{services:{postgres:{image:plan.originalImage}}}});
   // All costly material/tool checks happen before the first shutdown.
   validateSerialToolObservation(plan,stdout(await run(commands.stagedMaterial.toolsAndCapacity)),{requiredFreeBytes});
   await run(commands.stagedMaterial.verifyBackup);await run(commands.stagedMaterial.verifyWal);
  },
  persistRestorationObligation:()=>coordinator.persistRestorationObligation(plan),
  async normalShutdownOriginal(){
   const before=JSON.parse(stdout(await run(commands.inspectOriginal)))[0];
   await run(commands.disableOriginalRestart);
   const suppressed=JSON.parse(stdout(await run(commands.inspectOriginal)))[0];
   assert.equal(suppressed.Id,originalPostgresId);assert.equal(suppressed.HostConfig.RestartPolicy.Name,'no');
   await run(commands.originalShutdown);
   assert.equal(stdout(await run(commands.waitOriginal)).trim(),'0');
   const closed=JSON.parse(stdout(await run(commands.inspectOriginal)))[0];
   assert.equal(closed.State.Running,false);assert.equal(closed.State.ExitCode,0);
   assert.equal(closed.RestartCount,before.RestartCount);assert.equal(closed.State.StartedAt,before.State.StartedAt);
  },
  async activateSameServiceIdleWrapper(){
   await coordinator.invalidateAffectedNativeBindings(plan);
   await run(commands.activateWrapper);
   const actual=await coordinator.observeIdleWrapper(plan);
   assert.match(actual.containerId,/^[a-f0-9]{64}$/);assert.notEqual(actual.containerId,originalPostgresId);
   assert.equal(actual.image,plan.originalImage);assert.equal(actual.running,true);
   wrapper=commands.forActualWrapper(actual.containerId);
  },
  verifyWrapperAndOriginalAbsence:()=>coordinator.verifyWrapperAndOriginalAbsence(plan),
  async frozenOriginalInventory(){
   const initial=snapshot++===0;
   return parseFrozenOriginalInventory(plan,stdout(await run(initial?requireWrapper().inventoryInitial:requireWrapper().inventoryFinal)));
  },
  persistFrozenOriginalInventory:(_plan,inventory)=>coordinator.persistFrozenOriginalInventory(plan,inventory),
  async verifyResolvedOverride(){validateResolvedSerialService(plan,originalService,await coordinator.observeResolvedOverride(plan));},
  async startSameServiceReplay(){replayRequested=true;await run(requireWrapper().requestReplay);},
  async verifyCanonicalNamedReplay(){
   const result=await coordinator.verifyCanonicalNamedReplay(plan);
   return assertIndependentPhysicalReplayObserved(plan.canonicalReplay,result);
  },
  runBoundRestoredApplications:(_plan,result)=>coordinator.runBoundRestoredApplications(plan,result),
  async drainAllReplayOriginals(){
   let failed=false,error;
   try {await coordinator.drainAllReplayOriginals(plan);}catch(e){failed=true;error=e;}
   assert.equal(nativeFault,false,'SERIAL_NATIVE_OBSERVATION_REMAINS_HELD');
   if(failed)throw error;
  },
  async normalShutdownReplayIfStarted(){
   if(replayRequested){await run(requireWrapper().requestStopReplay);await coordinator.observeReplayNormalShutdown(plan);}
  },
  verifyOriginalComposeAndImage:()=>coordinator.verifyOriginalComposeAndImage(plan),
  async releaseWrapperAfterInventory(){
   await coordinator.persistFinalFrozenInventory(plan);
   await run(requireWrapper().requestRelease);await coordinator.observeWrapperReleaseReady(plan);
   await run(requireWrapper().stopReleasedWrapper);await coordinator.observeWrapperClosed(plan);
  },
  async startOriginalSameService(){await coordinator.invalidateAffectedNativeBindings(plan);return run(commands.restoreOriginal);},
  verifyRestoredOriginalClusterAndAllTen:()=>coordinator.verifyRestoredOriginalClusterAndAllTen(plan),
  persistRestorationCompleted:()=>coordinator.persistRestorationCompleted(plan),
  persistRootDirectoryMetadataChange:(_plan,before,after)=>coordinator.persistRootDirectoryMetadataChange(plan,before,after)
 });
}
