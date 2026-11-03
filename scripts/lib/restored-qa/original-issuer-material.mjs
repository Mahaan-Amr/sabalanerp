/** Compare the original coordinator's fixed-operation output with the worker's
 * independently compiled observations. No worker signing input crosses this port. */
import assert from 'node:assert/strict';
import {createPublicKey,verify} from 'node:crypto';
import {compileRestoredQaPrivateQualificationMaterial,qualificationBytes} from '../independent-private-qualification-material.mjs';

function publicKey(issuer){
 const {publicKey:encoded,publicKeyPem}=issuer.enrollment;
 const key=createPublicKey(publicKeyPem);
 assert.equal(key.asymmetricKeyType,'ed25519');
 assert.equal(key.export({type:'spki',format:'der'}).toString('base64'),encoded);
 return key;
}
function signature(value,preimage,key){
 assert.equal(typeof value,'string');const raw=Buffer.from(value,'base64');
 assert.equal(raw.length,64);assert.equal(raw.toString('base64'),value);
 assert.ok(verify(null,preimage,key,raw),'ORIGINAL_ISSUER_SIGNATURE_REFUSED');
}
/** A local transport guard alone cannot prove the Windows owner still lives. */
export async function assertOriginalIssuerResources(issuer,assertNativeActive){
 assertNativeActive();issuer.assertActive();await issuer.checkOriginalResources();issuer.assertActive();assertNativeActive();
}
export async function consumeOriginalRestoredMaterial(issuer,observed){
 observed=structuredClone(observed);const startedAt=Date.now();issuer.assertActive();const result=await issuer.issueOriginalRestoredMaterial();issuer.assertActive();const receivedAt=Date.now();
 assert.deepEqual(Object.keys(result).sort(),['enrollment','materials','productionAdmission']);
 assert.equal(result.productionAdmission,false);assert.deepEqual(result.enrollment,issuer.enrollment);
 const key=publicKey(issuer),rows=Object.values(result.materials);assert.equal(rows.length,2);
 for(const row of rows)signature(row.decision.signature,Buffer.concat([Buffer.from('sabalan-online-private-qualification/v1\n'),qualificationBytes(row.decision.decision)]),key);
 const issuedAt=rows[0].decision.decision.issuedAt,expiresAt=rows[0].decision.decision.expiresAt;
 assert.equal(new Date(issuedAt).toISOString(),issuedAt);assert.equal(new Date(expiresAt).toISOString(),expiresAt);
 assert.ok(Date.parse(issuedAt)>=startedAt&&Date.parse(issuedAt)<=receivedAt,'ORIGINAL_ISSUANCE_CLOCK_REFUSED');
 assert.equal(Date.parse(expiresAt)-Date.parse(issuedAt),600_000);assert.ok(Date.parse(expiresAt)>receivedAt);
 const material=compileRestoredQaPrivateQualificationMaterial({...observed,now:new Date(issuedAt)});
 const ids=Object.keys(material.decisionsByRuntime).sort();assert.equal(ids.length,2);
 assert.deepEqual(Object.keys(result.materials).sort(),ids);
 for(const id of ids){
  const row=result.materials[id];assert.deepEqual(Object.keys(row).sort(),['artifacts','decision']);
  assert.deepEqual(row.artifacts,material.artifactsByRuntime[id]);
  assert.deepEqual(Object.keys(row.decision).sort(),['decision','format','signature']);
  assert.equal(row.decision.format,'sabalan-signed-online-private-qualification/v1');
  assert.deepEqual(row.decision.decision,material.decisionsByRuntime[id]);
  signature(row.decision.signature,Buffer.concat([Buffer.from('sabalan-online-private-qualification/v1\n'),qualificationBytes(row.decision.decision)]),key);
 }
 return {material,materials:structuredClone(result.materials)};
}
export async function consumeOriginalPrivateControl(issuer,expected){
 assert.deepEqual(Object.keys(expected).sort(),['actorId','command','format','scopeSha256','sequence','session']);
 assert.equal(expected.format,'sabalan-private-qualification-control/v1');
 assert.equal(expected.session,issuer.enrollment.session);assert.equal(expected.actorId,issuer.enrollment.actorId);
 assert.match(expected.scopeSha256,/^[a-f0-9]{64}$/);
 const method=expected.command==='PRIVATE_PREPARE_DRAIN'&&expected.sequence===1?'prepareOriginalPrivateDrain':
  expected.command==='PRIVATE_SHUTDOWN'&&expected.sequence===2?'shutdownOriginalPrivateHttp':null;
 assert.ok(method,'ORIGINAL_FIXED_PRIVATE_CONTROL_REQUIRED');issuer.assertActive();
 const result=await issuer[method]();issuer.assertActive();
 assert.deepEqual(Object.keys(result).sort(),[...Object.keys(expected),'signature'].sort());
 const {signature:encoded,...control}=result;assert.deepEqual(control,expected);
 signature(encoded,Buffer.from([control.format,control.session,control.actorId,control.scopeSha256,String(control.sequence),control.command].join('\0')),publicKey(issuer));
 return structuredClone(result);
}
