import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire,Module} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readIndependentCheckpointTransport} from '../../scripts/lib/independent-checkpoint-transport.mjs';
const require=createRequire(new URL('../../backend/package.json',import.meta.url));
const source=fileURLToPath(new URL('../../backend/src/services/deploymentCheckpointMetadataIdentity.ts',import.meta.url));
const compiled=require('esbuild').transformSync(fs.readFileSync(source,'utf8'),{loader:'ts',format:'cjs',target:'node18'}).code;
const producer=new Module(source);producer.filename=source;producer.paths=[];producer._compile(compiled,source);
const {checkpointMetadataTransport,readCanonicalCheckpointMetadata}=producer.exports;
const raw=value=>Buffer.from(JSON.stringify(value));
test('independent sidecar reader retains exact nested canonical DB JSON with allowed transport path omissions',()=>{
 const metadata={id:'actual-point',localPath:'/source/point.sabrec',archivePath:'/source/point.sabrec',captureMethod:'PROTECTED_MAINTENANCE_COMPLETE',sourceMachineUuidSha256:'a'.repeat(64),manifest:{components:[{path:'files/actual',size:123}],opaqueField:{b:2,a:1}}};
 const transport=checkpointMetadataTransport(metadata);delete transport.localPath;delete transport.archivePath;
 const actual=readIndependentCheckpointTransport(raw(transport)),canonical=readCanonicalCheckpointMetadata(transport);
 assert.deepEqual(actual.metadata,metadata);assert.deepEqual(actual.metadata,canonical.metadata);assert.equal(actual.sha256,canonical.sha256);
 assert.equal(actual.metadata.localPath,'/source/point.sabrec');
});
test('missing canonical envelope, changed exact metadata or projected transport business fields cannot qualify',()=>{
 const metadata={id:'actual-point',checksum:'a'.repeat(64),size:123,manifest:{components:[]}},transport=checkpointMetadataTransport(metadata);
 for(const mutate of [v=>delete v.canonicalMetadata,v=>v.canonicalMetadata.manifest.components.push({path:'foreign'}),v=>v.size=124,v=>delete v.size,v=>v.extraBusinessMeaning=true,v=>v.canonicalMetadataSha256='0'.repeat(64)]){
  const changed=structuredClone(transport);mutate(changed);assert.throws(()=>readIndependentCheckpointTransport(raw(changed)));assert.throws(()=>readCanonicalCheckpointMetadata(changed));}
});
