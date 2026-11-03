import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
const source=fs.readFileSync(new URL('../../deploy/scripts/online-qualification-origin-issuer.mjs',import.meta.url),'utf8');
const start=source.indexOf('export async function issueOriginalQualificationOrigin('),end=source.indexOf('\n/** The independent replay',start);
const fn=source.slice(start,end).trim().replace(/^export /,'').replaceAll('await import(','await load(');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const bytes=v=>Buffer.from(JSON.stringify(canonical(v))),sha=b=>createHash('sha256').update(b).digest('hex');
test('origin consumes the distinct original COMPLETE reader before the unchanged protected key boundary; JSON and changed ownership fail',async()=>{
 const token={},local={originalControllers:[{code:0,signal:null}],nativeClosures:[],fileHashes:{}},images={backend:'unit-image'},
  independent={originalControllers:[{code:0,signal:null}],nativeClosures:[],fileHashes:{},images,imageGraphs:{},checkpoint:{metadataSha256:'point',checksum:'archive',releaseId:'release'}};
 const execution={releaseId:'release',bindings:null,sourceHost:{},executionImages:images};
 const assembly={independentCompletionKind:'EXISTING_COMPOSE_COMPLETE',originalLocalCompletionSha256:sha(bytes(local)),originalIndependentCompletionSha256:sha(bytes(independent)),
  evidenceDirectory:'unit',manifestSha256:'manifest',acceptanceSha256:'acceptance',files:{},originalProductionExecution:execution,originalProductionExecutionSha256:sha(bytes(execution))};
 const accepted={manifest:{releaseId:'release',image:images.backend},acceptance:{checkpointSha256:'point',qualification:{recoveryMode:'PROTECTED_MAINTENANCE_COMPLETE',checkpointArchiveChecksum:'archive',deploymentTargetImages:images},reports:{}},nativeClosures:[],revalidate:()=>{}};
 const calls=[],keyBoundary=Error('UNIT_STOP_BEFORE_ANY_KEY_READ');
 const issue=vm.runInNewContext('('+fn+')',{
  assert:(v,code)=>assert.ok(v,code),canonical,bytes,sha,Buffer,
  readOriginalRoleQualificationCompletion:()=>local,
  readOriginalExistingComposeComplete:t=>{assert.equal(t,token,'COMPLETE_TOKEN_REQUIRED');calls.push('complete-reader');return independent;},
  readOriginalIndependentRestoreSshCompletion:()=>assert.fail('legacy reader selected'),
  hashes:()=>[],assertProtectedKeyAcl:async()=>{calls.push('protected-key-boundary');throw keyBoundary;},
  load:async spec=>spec.includes('original-online-evidence-assembler')?{readOriginalOnlineEvidenceAssembly:()=>assembly}:
    {originalOnlineEvidenceReader:()=>({readOnlineReleaseEvidence:()=>accepted,validateProductionExecutionBindings:()=>images})},
 });
 await assert.rejects(issue({localCompletion:{},independentCompletion:token,assemblyCompletion:{}}),e=>e===keyBoundary);
 assert.deepEqual(calls,['complete-reader','protected-key-boundary']);
 await assert.rejects(issue({localCompletion:{},independentCompletion:{},assemblyCompletion:{}}),/COMPLETE_TOKEN_REQUIRED/);
 assembly.originalIndependentCompletionSha256='changed';await assert.rejects(issue({localCompletion:{},independentCompletion:token,assemblyCompletion:{}}),/ORIGINAL_OWNERS_CHANGED/);
});
