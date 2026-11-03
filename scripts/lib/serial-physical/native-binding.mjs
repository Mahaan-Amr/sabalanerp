/** Bind finite commands to the SAME live coordinator. No CLI entry point,
 * historical process adoption, serialized lease, or default application port. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {compileNativePrimitives,retainSerialNativePrimitive,renderSerialSources,validateSerialToolObservation} from './native-primitives.mjs';
import {parseFrozenOriginalInventory} from './frozen-inventory.mjs';
import {assertSerialExistingPostgresPlan,validateResolvedSerialService,runSerialRestorationProtocol} from './serial-owner.mjs';
import {assertIndependentPhysicalReplayObserved} from '../independent-physical-replay.mjs';
import {isClosedSerialNegative} from './retained-child.mjs';
import {serialIncarnationGeneration,invalidateSerialIncarnation,assertSerialIncarnationGeneration} from './incarnation-generation.mjs';
import {readOriginalPhysicalApplicationWorker,runOriginalSameComposeApplicationWorker} from '../original-physical-application-worker.mjs';
import {readOriginalIndependentComponents} from '../independent-full-restore-ssh.mjs';

const bindings=new WeakMap(),completions=new WeakMap(),incarnations=new WeakMap();
const digest=raw=>createHash('sha256').update(raw).digest('hex');
export function readOriginalSerialPhysicalPlan(binding){const value=bindings.get(binding);assert.ok(value,'ORIGINAL_SERIAL_NATIVE_BINDING_REQUIRED');return structuredClone(value.plan);}
export function bindOriginalSerialPhysicalMaterial(binding,rsaCompletion){
 const value=bindings.get(binding);assert.ok(value&&!value.started,'ORIGINAL_SERIAL_NATIVE_BINDING_REQUIRED');value.bindMaterial(rsaCompletion);
}

/** Neither the bounded fault milestone nor a saved restoration receipt can
 * issue these capabilities. Only this binding's real finite Docker originals
 * and its normally restored service may reach this table. */
export function readOriginalSerialPhysicalCompletion(token){
 const held=completions.get(token);assert.ok(held,'ORIGINAL_SERIAL_PHYSICAL_COMPLETION_REQUIRED');
 held.revalidate();return structuredClone(held.record);
}
export function readOriginalSerialRestoredIncarnation(token){
 const held=incarnations.get(token);assert.ok(held,'ORIGINAL_SERIAL_RESTORED_INCARNATION_REQUIRED');
 held.revalidate();return structuredClone(held.record);
}
export async function runOriginalSerialPhysicalBinding(binding){
 const state=bindings.get(binding);assert.ok(state,'ORIGINAL_SERIAL_NATIVE_BINDING_REQUIRED');
 assert.equal(state.started,false,'ORIGINAL_SERIAL_BINDING_ALREADY_USED');state.assertCompletionPorts();state.started=true;
 const result=await runSerialRestorationProtocol(state.plan,binding);
 return state.complete(result);
}

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
  'observeResolvedOverride','verifyCanonicalNamedReplay','preparePhysicalApplicationWorker',
  'drainAllReplayOriginals','observeReplayNormalShutdown','verifyOriginalComposeAndImage',
  'persistFinalFrozenInventory','persistRootDirectoryMetadataChange','observeWrapperReleaseReady','observeWrapperClosed','invalidateAffectedNativeBindings',
  'verifyRestoredOriginalClusterAndAllTen','persistRestorationCompleted'];
 for(const name of required)assert.equal(typeof coordinator[name],'function','LIVE_COORDINATOR_PORT_REQUIRED:'+name);
 assert.equal(typeof native.beforeDocker,'function');
 const commands=compileNativePrimitives(plan,{originalPostgresId,overrideFile,restoreFile});
 let ordinal=0,wrapper=null,replayRequested=false,snapshot=0,nativeFault=false;
 const originals=[];let applicationWorker,material;
 const run=async c=>{
  try {const row=await retainSerialNativePrimitive(c,{...native,ordinal:ordinal++});originals.push(row);return row;}
  catch(error){if(!isClosedSerialNegative(error))nativeFault=true;throw error;}
 };
 const requireWrapper=()=>{assert.ok(wrapper,'ACTUAL_IDLE_WRAPPER_REQUIRED');return wrapper;};
 const invalidate=async()=>{invalidateSerialIncarnation();await coordinator.invalidateAffectedNativeBindings(plan);};
 const binding=Object.freeze({
  guardAllTenAndQuiet:()=>coordinator.guardAllTenAndQuiet(plan),
  async verifyAndStageOwnedPhysicalMaterial(){
   await coordinator.stageOwnedPhysicalMaterial(plan,{sources:renderSerialSources(plan),override:plan.override,restore:{services:{postgres:{image:plan.originalImage}}},...(material?{authenticatedMaterial:structuredClone(material)}:{})});
   if(material){
    const lines=stdout(await run(commands.forAuthenticatedMaterial(material))).trim().split('\n');
    assert.equal(lines.length,material.components.length+2);
    material.components.forEach((row,i)=>assert.equal(lines[i],row.bytes+'\t'+row.sha256));
    assert.equal(lines.at(-2).split('\t')[1],material.physicalBaseFacts.backup_manifest);
    assert.equal(lines.at(-1).split('\t')[1],material.physicalBaseFacts['global/pg_control']);
   }
   // All costly material/tool checks happen before the first shutdown.
   validateSerialToolObservation(plan,stdout(await run(commands.stagedMaterial.toolsAndCapacity)),{requiredFreeBytes});
   await run(commands.stagedMaterial.verifyBackup);await run(commands.stagedMaterial.verifyWal);
   assert.equal(digest(Buffer.from(stdout(await run(commands.stagedMaterial.controlData)))),plan.canonicalReplay.controlDataSha256);
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
   await invalidate();
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
  async runBoundRestoredApplications(_plan,result){
   const prepared=await coordinator.preparePhysicalApplicationWorker(plan,result);
   applicationWorker=await runOriginalSameComposeApplicationWorker({prepared,plan,replay:result,material});
   return readOriginalPhysicalApplicationWorker(applicationWorker);
  },
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
  async startOriginalSameService(){await invalidate();return run(commands.restoreOriginal);},
  verifyRestoredOriginalClusterAndAllTen:()=>coordinator.verifyRestoredOriginalClusterAndAllTen(plan),
  persistRestorationCompleted:()=>coordinator.persistRestorationCompleted(plan),
  persistRootDirectoryMetadataChange:(_plan,before,after)=>coordinator.persistRootDirectoryMetadataChange(plan,before,after)
 });
 const assertCompletionPorts=()=>{assert.ok(material,'ORIGINAL_RSA_AUTHENTICATED_MATERIAL_REQUIRED');for(const name of ['observeRestoredIncarnation','assertCurrentRestoredIncarnation'])
  assert.equal(typeof coordinator[name],'function','LIVE_RESTORED_INCARNATION_PORT_REQUIRED:'+name);};
 bindings.set(binding,{plan,started:false,assertCompletionPorts,bindMaterial(token){
  assert.equal(material,undefined,'SERIAL_AUTHENTICATED_MATERIAL_ALREADY_BOUND');
  const rsa=readOriginalIndependentComponents(token),decryption=JSON.parse(Buffer.from(rsa.ownedOutputs.decryption.rawBase64,'base64'));
  for(const role of ['coherent-cut','coverage-manifest','wal-capture']){
   const descriptor=rsa.materialFacts[role],raw=Buffer.from(descriptor.rawBase64,'base64'),rows=decryption.components.filter(row=>row.role===role);
   assert.equal(rows.length,1);assert.equal(raw.length,rows[0].bytes);assert.equal(digest(raw),rows[0].sha256);
  }
  for(const key of ['backup_manifest','global/pg_control'])assert.match(rsa.physicalBaseFacts[key],/^[a-f0-9]{64}$/);
  material={components:decryption.components,materialFacts:rsa.materialFacts,physicalBaseFacts:rsa.physicalBaseFacts};
 },async complete(result){
  // The persistent coordinator observes a new actual service, not the old ID
  // relabelled after recreation. Fixed Docker commands independently bind it.
  assertCompletionPorts();
  assert.equal(result.originalClusterRestored,true);assert.equal(nativeFault,false);
  const actual=await coordinator.observeRestoredIncarnation(plan);
  assert.match(actual.containerId,/^[a-f0-9]{64}$/);assert.notEqual(actual.containerId,originalPostgresId);
  const restored=commands.forActualRestored(actual.containerId);
  const inspect=JSON.parse(stdout(await run(restored.inspect)))[0];
  const system=JSON.parse(stdout(await run(restored.system)));
  assert.equal(inspect.Id,actual.containerId);assert.equal(inspect.Image,plan.originalImage);
  assert.equal(inspect.State.Running,true);assert.equal(inspect.State.Health.Status,'healthy');
  assert.equal(inspect.RestartCount,0);assert.equal(inspect.HostConfig.RestartPolicy.Name,'unless-stopped');
  assert.equal(inspect.Config.Labels['com.docker.compose.project'],'sabalanerp-local');
  assert.equal(inspect.Config.Labels['com.docker.compose.service'],'postgres');
  assert.equal(system.systemIdentifier,plan.originalSystemIdentifier);
  assert.equal(system.inRecovery,false);assert.ok(Number.isFinite(Date.parse(inspect.State.StartedAt)));
  const completedEpoch=serialIncarnationGeneration();
  const record={format:'sabalan-original-serial-restored-incarnation/v1',project:plan.project,service:plan.service,
   operation:plan.operation,containerId:inspect.Id,startedAt:inspect.State.StartedAt,image:inspect.Image,
   systemIdentifier:system.systemIdentifier,epoch:completedEpoch,productionAdmission:false};
  const checks=originals.map(row=>{
   const pins=Object.fromEntries(['stdout','stderr'].map(name=>{
    const file=row[name+'File'],stat=fs.lstatSync(file,{bigint:true});
    assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1n);
    return [name,{file,stamp:['dev','ino','mode','nlink','size','mtimeNs','ctimeNs'].map(k=>String(stat[k])).join(':')}];
   }));
   return ()=>{
   assert.equal(row.code,0);assert.equal(row.signal,null);assert.equal(row.stdoutEof,true);assert.equal(row.stderrEof,true);assert.equal(row.observationFault,false);
   for(const name of ['stdout','stderr']){const {file,stamp}=pins[name],stat=fs.lstatSync(file,{bigint:true});
    assert.equal(['dev','ino','mode','nlink','size','mtimeNs','ctimeNs'].map(k=>String(stat[k])).join(':'),stamp);
    const raw=fs.readFileSync(file);assert.equal(raw.length,row[name+'Bytes']);assert.equal(digest(raw),row[name+'Sha256']);}
  };});
  const revalidate=()=>{assertSerialIncarnationGeneration(completedEpoch);
   assert.equal(coordinator.assertCurrentRestoredIncarnation(structuredClone(record)),true,'SERIAL_CURRENT_INCARNATION_UNPROVEN');
   readOriginalPhysicalApplicationWorker(applicationWorker);
   assert.equal(nativeFault,false);for(const check of checks)check();};
  revalidate();const incarnation=Object.freeze({});incarnations.set(incarnation,{record,revalidate});
  const completion=Object.freeze({});completions.set(completion,{revalidate,record:{format:'sabalan-original-serial-physical-completion/v1',
   operation:plan.operation,restoredIncarnation:record,originalControllers:structuredClone(originals),
   replay:structuredClone(result.physicalResult),applicationResult:structuredClone(result.applicationResult),originalClusterRestored:true,physicalReplayQualified:false,productionAdmission:false}});
  return Object.freeze({completion,incarnation});
 }});
 return binding;
}
