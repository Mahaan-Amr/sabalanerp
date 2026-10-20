import {createHash} from 'node:crypto';
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
 ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function requireProof(value:unknown):asserts value{if(!value)throw Error('ONLINE_BOOTSTRAP_CHECKPOINT_LINEAGE_UNPROVEN');}

/** The independently restored rehearsal point is not the later activation
 * backup. Both are exact canonical production observations; this exception is
 * confined to the first protected installation and never qualifies WAL. */
export function assertProtectedBootstrapCheckpointLineage(acceptance:any,activation:any){
 const point=acceptance?.qualification?.qualificationCheckpoint,qualified=point?.metadata;
 requireProof(acceptance?.qualification?.recoveryMode==='PROTECTED_MAINTENANCE_COMPLETE'
  &&point&&Object.keys(point).length===2&&typeof point.metadataSha256==='string'
  &&/^[a-f0-9]{64}$/.test(point.metadataSha256)&&hash(qualified)===point.metadataSha256
  &&hash(activation)===acceptance.checkpointSha256);
 const database=acceptance.qualification.deploymentTargetDatabase;
 for(const metadata of [qualified,activation])requireProof(metadata?.captureMethod==='PROTECTED_MAINTENANCE_COMPLETE'
  &&hash(metadata.sourceDatabase)===hash(database)&&metadata.localVerified===true&&metadata.remoteVerified===true
  &&metadata.restoreVerified===true&&metadata.manifestReadable===true
  &&metadata.compatibility?.local?.compatible===true&&metadata.compatibility?.remote?.compatible===true
  &&typeof metadata.id==='string'&&metadata.id.length>0&&typeof metadata.releaseId==='string'&&metadata.releaseId.length>0
  &&/^[a-f0-9]{64}$/.test(metadata.checksum)&&Number.isSafeInteger(metadata.size)&&metadata.size>0
  &&/^[a-f0-9]{64}$/.test(metadata.sourceMachineUuidSha256)&&/^[a-f0-9]{64}$/.test(metadata.sourceKernelBootIdSha256)
  &&typeof metadata.createdAt==='string'&&Number.isFinite(Date.parse(metadata.createdAt)));
 requireProof(qualified.sourceMachineUuidSha256===activation.sourceMachineUuidSha256
  &&Date.parse(qualified.createdAt)<=Date.parse(activation.createdAt)
  &&qualified.id!==activation.id&&point.metadataSha256!==acceptance.checkpointSha256);
 return Object.freeze({qualificationCheckpointSha256:point.metadataSha256,activationCheckpointSha256:acceptance.checkpointSha256,
  continuousWalQualified:false as const});
}
