/** One byte encoding for the manifest derived from an original request. Pure
 * content projection only: callers still need their original request tokens. */
import assert from'node:assert/strict';import{createHash}from'node:crypto';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export function projectOriginalOnlineManifest({request,runtimeBundleSha256,executionImage,physical=false}){
 assert.match(runtimeBundleSha256,/^[a-f0-9]{64}$/);assert.match(executionImage,/^sha256:[a-f0-9]{64}$/);assert.ok(Array.isArray(request.roots)&&Array.isArray(request.ephemeralRoots));
 const manifest={format:'sabalan-online-release-manifest/v1',releaseId:request.releaseId,sourceCommit:request.targetCommit,image:executionImage,runtimeBundleSha256,generation:physical?request.generation:1,database:{name:request.database.name,systemIdentifier:request.database.systemIdentifier},roots:request.roots,ephemeralRoots:request.ephemeralRoots};
 const raw=Buffer.from(JSON.stringify(canonical(manifest))+'\n');return{manifest,raw,sha256:createHash('sha256').update(raw).digest('hex')};
}
