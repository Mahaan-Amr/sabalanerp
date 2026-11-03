/** Bind the actual compact manifest bytes to the immutable source manifest.
 * JSON object order is not guessed from a canonicalized metadata sidecar. */
import assert from'node:assert/strict';import{createHash}from'node:crypto';
export function bindObservedCompleteManifest(expected,observation){
 assert.equal(expected.format,'sabalan-recovery');assert.equal(expected.packageType,'COMPLETE');assert.ok(Array.isArray(expected.components)&&expected.components.length>0);
 const raw=Buffer.from(observation.completeManifestValueRawBase64,'base64');assert.equal(raw.toString('base64'),observation.completeManifestValueRawBase64);assert.ok(raw.length>0&&raw.length<=4*1024**2);assert.equal(createHash('sha256').update(raw).digest('hex'),observation.completeManifestSha256);const actual=JSON.parse(raw);assert.deepEqual(actual,expected,'COMPLETE_SOURCE_MANIFEST_CHANGED');assert.ok(Buffer.from(JSON.stringify(actual)).equals(raw),'COMPLETE_ORIGINAL_MANIFEST_VALUE_BYTES_REQUIRED');return observation.completeManifestSha256;
}
