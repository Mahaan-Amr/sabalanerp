import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {collectApplicationReadonlyTransportArtifacts} from '../../scripts/lib/application-native-readonly-transport-artifacts.mjs';
const root=path.resolve(import.meta.dirname,'../..'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function prepared(){
  const sources={},capture=name=>{const raw=fs.readFileSync(path.join(root,name));sources[name]??=sha(raw);assert.equal(sources[name],sha(raw));return raw;};
  const issuer=fs.readFileSync(path.join(root,'deploy/scripts/readonly-transport-retirement.py'),'utf8');
  // Actual source names are independently captured as a diagnostic collector
  // input. The small fixture body is explicitly NOT a qualified app bundle.
  for(const match of issuer.matchAll(/^    '((?:backend|tests)\/[^']+)': '([a-f0-9]{64})',$/gm))capture(match[1]);
  const bundle=Buffer.from('diagnostic collector UNIT fixture; not native application');
  return {capture,sources,bundle,bundleSha256:sha(bundle)};
}
test('protocol receipt refuses missing actual onLoad membership',()=>{
  const input=prepared();delete input.sources['backend/src/application.ts'];
  assert.throws(()=>collectApplicationReadonlyTransportArtifacts(input),/actual esbuild onLoad protocol source/);
});
test('protocol receipt refuses substituted bundle identity',()=>{
  const input=prepared();input.bundleSha256='0'.repeat(64);
  assert.throws(()=>collectApplicationReadonlyTransportArtifacts(input));
});
test('protocol collector binds exact reviewed source tuple and bundle bytes',()=>{
  const input=prepared(),result=collectApplicationReadonlyTransportArtifacts(input);
  const value=JSON.parse(result.files['readonly-socket-protocol.json']);
  assert.equal(value.bundleSha256,input.bundleSha256);assert.equal(value.productionAdmission,false);
  assert.equal(Object.keys(value.sources).length,12);
  assert.equal(sha(result.files['readonly-socket-protocol.json']),result.proof.protocolReceiptSha256);
});
