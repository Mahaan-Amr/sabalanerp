import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {assertOriginalIndependentPhysicalPoint} from '../../backend/src/services/onlinePhysicalCheckpointEvidence';
import {syntheticQualificationProof,syntheticQualificationIdentities,syntheticQualificationImageGraphs} from './online-qualification-evidence.fixture';
const base:any={releaseId:'unit_release',sourceCommit:'a'.repeat(40),runtimeBundleSha256:'b'.repeat(64),checkpointArchiveChecksum:'c'.repeat(64),captureId:'d'.repeat(64),
 sourceDatabase:{name:'unit_local',oid:'1',systemIdentifier:'123'},deploymentTargetDatabase:{name:'production_database',systemIdentifier:'456',oid:'77'},recoveryMode:'ONLINE_COHERENT_WAL',
 images:{backend:'sha256:'+'1'.repeat(64),frontend:'sha256:'+'2'.repeat(64),inquiry:'sha256:'+'3'.repeat(64)},deploymentTargetImages:{backend:'sha256:'+'4'.repeat(64),frontend:'sha256:'+'5'.repeat(64),inquiry:'sha256:'+'6'.repeat(64)}};
const binding:any={...base,imageGraphs:syntheticQualificationImageGraphs(base.images,base.deploymentTargetImages),...syntheticQualificationIdentities(base)};
const raw=(v:any)=>Buffer.from(JSON.stringify(v)),descriptor=(v:any)=>{const b=raw(v);return{rawBase64:b.toString('base64'),bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')};};
function fixture(){
 const source=syntheticQualificationProof('coherent-independent-restore',binding),r=JSON.parse(Buffer.from(source.physicalRestoreRawBase64,'base64').toString());
 r.format='sabalan-original-same-compose-online-physical-restore/v1';r.pass=true;r.phase='COMPLETE';
 r.sourceHost={machineUuidSha256:r.sourceMachineUuidSha256,kernelBootIdSha256:r.sourceKernelBootIdSha256};
 r.rsaHost={machineUuidSha256:r.recoveryMachineUuidSha256,kernelBootIdSha256:r.recoveryKernelBootIdSha256};
 r.replayHost={machineUuidSha256:'7'.repeat(64),kernelBootIdSha256:'8'.repeat(64)};
 for(const key of ['sourceMachineUuidSha256','sourceKernelBootIdSha256','recoveryMachineUuidSha256','recoveryKernelBootIdSha256'])delete r[key];
 r.originalApplicationReport=descriptor(r);
 r.restoredIncarnation={format:'sabalan-original-serial-restored-incarnation/v1',project:'sabalanerp-local',service:'postgres',operation:'a'.repeat(32),
  containerId:'9'.repeat(64),systemIdentifier:'111',image:'sha256:'+'a'.repeat(64),startedAt:'2026-10-25T00:00:00Z',epoch:2,productionAdmission:false};
 r.originalSerialRestoration={operation:r.restoredIncarnation.operation,originalClusterRestored:true,originalControllers:[{originalPid:777,code:0,signal:null,stdoutEof:true,stderrEof:true,observationFault:false}]};
 return {source,report:r};
}
test('canonical physical parser preserves replay host separately from independent RSA host and real restoration incarnation',()=>{
 const {source,report}=fixture();source.physicalRestoreRawBase64=raw(report).toString('base64');
 const observed=assertOriginalIndependentPhysicalPoint(source,binding);assert.deepEqual(observed.rsaHost,report.rsaHost);assert.deepEqual(observed.replayHost,report.replayHost);
});
test('same-Compose evidence rejects synthetic recovery envelopes, changed originals, missing EOF and invalid incarnation',()=>{
 for(const change of [(r:any)=>r.rsaHost=r.sourceHost,(r:any)=>r.recoveryMachineUuidSha256=r.rsaHost.machineUuidSha256,
  (r:any)=>r.restoredIncarnation.project='another-stack',(r:any)=>r.restoredIncarnation.epoch=0,
  (r:any)=>r.originalSerialRestoration.originalControllers[0].stderrEof=false,(r:any)=>r.originalApplicationReport.sha256='f'.repeat(64)]){
  const {source,report}=fixture();change(report);source.physicalRestoreRawBase64=raw(report).toString('base64');assert.throws(()=>assertOriginalIndependentPhysicalPoint(source,binding));
 }
});
