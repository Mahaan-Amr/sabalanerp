import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const expectedNames=['backend/src/application.ts','backend/src/services/identitySessionService.ts',
  'backend/src/services/onlineRuntimeWork.ts','backend/src/services/realtimeDeliveryLifecycle.ts',
  'tests/online-deployment/application-native-environment.fixture.ts','tests/online-deployment/application-native.worker.ts',
  'tests/online-deployment/browser-support-restore-native.fixture.ts','tests/online-deployment/realtime-http-native.fixture.ts',
  'tests/online-deployment/security-upload-native.fixture.ts','tests/online-deployment/support-staged-http-client.fixture.ts',
  'tests/online-deployment/support-staged-http-native.fixture.ts','tests/online-deployment/native-private-network.fixture.mjs'].sort();
/** Trusted diagnostic preparation only. The actual esbuild onLoad capture map
 * must already contain every reviewed module; this cannot invent membership or
 * approve a source tuple different from the issuer's explicitly reviewed one. */
export function collectApplicationReadonlyTransportArtifacts({capture,sources,bundle,bundleSha256}){
  assert.equal(typeof capture,'function');assert.ok(Buffer.isBuffer(bundle));assert.equal(sha(bundle),bundleSha256);
  capture('scripts/lib/application-native-readonly-transport-artifacts.mjs');
  const issuer=capture('deploy/scripts/readonly-transport-retirement.py');
  const match=/^APPROVED_PROTOCOL_SOURCES = \{\r?\n((?:    '[A-Za-z0-9_./-]+': '[a-f0-9]{64}',\r?\n)+)\}/m.exec(issuer.toString('utf8'));
  assert.ok(match,'reviewed protocol tuple must have an exact bounded literal shape');
  const pins=Object.fromEntries([...match[1].matchAll(/^    '([^']+)': '([a-f0-9]{64})',$/gm)].map(value=>[value[1],value[2]]));
  assert.deepEqual(Object.keys(pins).sort(),expectedNames);
  for(const [name,digest]of Object.entries(pins)){
    assert.equal(sources[name],digest,`actual esbuild onLoad protocol source needs explicit review: ${name}`);
    assert.equal(sha(capture(name)),digest,`protocol source changed after bundling: ${name}`);
  }
  const protocol={format:'sabalan-reviewed-diagnostic-readonly-socket-protocol/v1',bundleSha256,sources:pins,productionAdmission:false};
  const receipt=Buffer.from(JSON.stringify(canonical(protocol))+'\n');
  return {files:{'readonly-transport-retirement.py':issuer,
    'readonly-transport-retirement-native.fixture.py':capture('tests/online-deployment/readonly-transport-retirement-native.fixture.py'),
    'readonly-socket-protocol.json':receipt},
    proof:Object.freeze({protocolReceiptSha256:sha(receipt),bundleSha256,sources:Object.freeze({...pins}),productionAdmission:false})};
}
