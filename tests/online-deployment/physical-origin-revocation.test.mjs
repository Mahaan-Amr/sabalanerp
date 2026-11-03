import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {createHash} from 'node:crypto';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const bytes=v=>Buffer.from(JSON.stringify(canonical(v))),sha=v=>createHash('sha256').update(v).digest('hex');
const source=fs.readFileSync(new URL('../../deploy/scripts/online-qualification-origin-issuer.mjs',import.meta.url),'utf8');
function issuer(name,context){const start=source.indexOf('export async function '+name+'('),end=source.indexOf('\n}',start)+2;
 return vm.runInNewContext('('+source.slice(start,end).replace(/^export /,'').replaceAll('await import(','await load(')+')',context);}
test('all physical signers recheck same-Compose incarnation after delayed ACL original closes',async()=>{
 for(const name of ['issueOriginalPhysicalCheckpointVerification','issueOriginalPhysicalRepositoryPromotion','issueOriginalPhysicalCheckpointPublication']){
  const h='a'.repeat(64),owned=value=>{const raw=bytes(value);return{bytes:raw.length,sha256:sha(raw),rawBase64:raw.toString('base64')};};
  const report={format:'sabalan-original-same-compose-online-physical-restore/v1',sealedManifestSha256:h,plaintextManifestSha256:h,cipherInventorySha256:h,
   sourceDatabase:{name:'source',oid:'1',systemIdentifier:'123'},restorePoint:{name:'cut',lsn:'0/100',requiredWalEndLsn:'0/200',timeline:1},continuousWalQualified:false};
  const physical={...report,originalControllers:[{code:0,signal:null}],ownedOutputs:{report:owned(report)},nativeClosures:[]};
  const promotion={physicalCompletionSha256:sha(bytes(physical)),originalControllers:[{code:0,signal:null}],repositoryDescriptor:{captureId:h}};
  const metadata={...promotion,sealedManifestSha256:h,cipherInventorySha256:h,canonicalMetadataSha256:h,remoteMetadataSha256:h};
  let revoked=false,reads=0;
  const fn=issuer(name,{Buffer,JSON,Object,Date,bytes,sha,canonical,assert:(v,code)=>assert.ok(v,code),
   readOriginalPhysicalCompletion:()=>{reads++;assert.equal(revoked,false,'INCARNATION_REVOKED');return physical;},
   assertProtectedKeyAcl:async()=>{await Promise.resolve();revoked=true;},
   fs:{lstatSync(){assert.fail('revoked completion reached private key');}},
   load:async spec=>spec.includes('online-checkpoint-finalization')?{assertOriginalCheckpointRepository:()=>promotion.repositoryDescriptor}:
    {readOriginalIndependentPhysicalRepositoryPromotion:()=>promotion,readOriginalIndependentPhysicalMetadataPublication:()=>metadata},
  });
  await assert.rejects(fn({independentCompletion:{},physicalCompletion:{},repositoryPromotion:{},metadataCompletion:{}}),/INCARNATION_REVOKED/);
  assert.equal(reads,2);
 }
});
