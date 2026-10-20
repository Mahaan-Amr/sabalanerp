import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const sha=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
/** Independently retain the exact canonical DB JSON inside original sidecar bytes. */
export function readIndependentCheckpointTransport(raw){
 assert.ok(Buffer.isBuffer(raw)&&raw.length>0&&raw.length<=16*1024**2);
 const value=JSON.parse(raw),metadata=value.canonicalMetadata;
 assert.ok(value&&typeof value==='object'&&!Array.isArray(value)&&metadata&&typeof metadata==='object'&&!Array.isArray(metadata));
 assert.ok(!('canonicalMetadata'in metadata)&&!('canonicalMetadataSha256'in metadata));
 assert.match(value.canonicalMetadataSha256,/^[a-f0-9]{64}$/);assert.equal(sha(metadata),value.canonicalMetadataSha256);
 const transport=new Set(['metadataPath','localPath','archivePath','canonicalMetadata','canonicalMetadataSha256']);
 for(const key of Object.keys(value))if(!transport.has(key))assert.ok(key in metadata&&sha(value[key])===sha(metadata[key]));
 for(const key of Object.keys(metadata))if(transport.has(key)){if(key in value)assert.equal(sha(value[key]),sha(metadata[key]));}else assert.ok(key in value&&sha(value[key])===sha(metadata[key]));
 return {metadata:structuredClone(metadata),sha256:value.canonicalMetadataSha256,rawSha256:createHash('sha256').update(raw).digest('hex')};
}
