/** Literal restored C29 view. Its two historical capsules remain readonly and unqualified. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {historicalCapsulePreflightSpec} from './application-native-historical-capsules.mjs';
export const negativeCapsuleFormat='sabalan-C29-verified-negative-predecessor/v1';
export const negativeCapsuleAcceptanceFormat='sabalan-C29-exact-two-readonly-capsule-acceptance/v1';
export const negativeCapsuleSubpath='c16-recovery-70360dba0eb244dc91cdfcd0533315f9/c16-recovery-32c29444431a4f98bc6070f4182e7bb8';
export const negativeCapsuleNonce='32c29444431a4f98bc6070f4182e7bb8';
export const negativeCapsuleNames=['application-prisma-ebcfd40fff0a28e39d983c6616893b50','inquiry-coherent-7878c93646acd9ac37cef95e27a4029d'];
export function validateNegativeCapsuleAcceptanceResult(descriptor,value){
 const a=descriptor.acceptance;
 assert.equal(descriptor.format,negativeCapsuleFormat);assert.equal(a.format,negativeCapsuleAcceptanceFormat);
 assert.equal(a.subpath,negativeCapsuleSubpath);assert.equal(a.nonce,negativeCapsuleNonce);
 assert.equal(a.physicalEmpty,false);assert.deepEqual(a.actorEntries,[]);
 assert.deepEqual(Object.keys(value).sort(),['format','mode','nonce','namespace','physicalEmpty','actorEntries','readOnlyCapsules','canonicalCapsules','qualificationSucceeded','productionAdmission'].sort());
 assert.equal(value.format,'sabalan-C29-current-two-readonly-capsule-acceptance/v1');assert.equal(value.mode,'verify');assert.equal(value.nonce,a.nonce);
 assert.deepEqual(value.namespace,a.namespace);assert.equal(value.physicalEmpty,false);assert.deepEqual(value.actorEntries,[]);assert.deepEqual(value.readOnlyCapsules,negativeCapsuleNames);
 assert.equal(value.qualificationSucceeded,false);assert.equal(value.productionAdmission,false);
 const full=value.canonicalCapsules,want=a.canonicalCapsules;
 assert.deepEqual(Object.keys(full).sort(),Object.keys(want).sort());
 for(const k of Object.keys(want).filter(k=>k!=='inventoryChild'))assert.deepEqual(full[k],want[k]);
 const child=full.inventoryChild;assert.deepEqual(Object.keys(child).sort(),['originalPid','code','stdoutEof','stderrEof'].sort());
 assert.ok(Number.isSafeInteger(child.originalPid)&&child.originalPid>0);assert.equal(child.code,0);assert.equal(child.stdoutEof,true);assert.equal(child.stderrEof,true);
 assert.equal(full.readOnly,true);assert.equal(full.capsulesVerified,2);assert.equal(full.databaseExecuted,false);assert.equal(full.nativeActorStarted,false);assert.equal(full.productionAdmission,false);assert.equal(full.lockIdentities.length,3);
 return value;
}
export function negativeCapsuleAcceptanceSelection(repositoryRoot,descriptor){
 assert.equal(descriptor.format,negativeCapsuleFormat);assert.equal(descriptor.acceptance.subpath,negativeCapsuleSubpath);
 const source=path.join(repositoryRoot,'tests/online-deployment/application-native-negative-capsule-acceptance.fixture.py');
 const capsuleSource=fs.readFileSync(path.join(repositoryRoot,'tests/online-deployment/historical-capsule-preflight.fixture.py'));
 return{source:{file:source,sha256:createHash('sha256').update(fs.readFileSync(source)).digest('hex')},spec:{nonce:negativeCapsuleNonce,subpath:negativeCapsuleSubpath,expected:descriptor.acceptance.namespace,capsuleSource:capsuleSource.toString('base64'),capsuleSpec:historicalCapsulePreflightSpec(repositoryRoot)}};
}
export function negativeCapsuleAcceptanceBootstrap(sourceSha256){
 assert.match(sourceSha256,/^[a-f0-9]{64}$/);
 return "import base64,hashlib,io,json,sys;p=json.load(sys.stdin);s=base64.b64decode(p['source'],validate=True);assert hashlib.sha256(s).hexdigest()=="+JSON.stringify(sourceSha256)+";sys.stdin=io.TextIOWrapper(io.BytesIO(json.dumps(p['spec']).encode()));exec(compile(s,'source-owned-negative-capsule-acceptance','exec'),{'__name__':'__main__'})";
}
