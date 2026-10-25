/** Data-only fixed live-baseline projection. Owns no cap, key, runtime or admission. */
'use strict';
const assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const sha=raw=>createHash('sha256').update(raw).digest('hex');
function produce(contextManifest,view,nativeHistoryRaw,sources){
 const completeManifestValueRaw=Buffer.from(JSON.stringify(contextManifest));
 assert.equal(sha(completeManifestValueRaw),view.sourceManifestValueSha256);
 assert.notEqual(view.sourceDatabase.systemIdentifier,view.database.systemIdentifier);
 assert.equal(typeof nativeHistoryRaw,'string');assert.equal(JSON.parse(nativeHistoryRaw).length,440);
 assert.equal(sources.length,9);
 const workingManifestValueRaw=Buffer.from(JSON.stringify({database:view.database,sources:sources.map(r=>({name:r.name,files:r.files,directories:r.directories}))}));
 return {completeManifestValueRaw,workingManifestValueRaw,lineage:{format:'sabalan-live-restored-qa-private-lineage/v1',sourceDatabase:view.sourceDatabase,targetDatabase:view.database,completeManifestSha256:sha(completeManifestValueRaw),nativeHistorySha256:sha(nativeHistoryRaw),workingManifestSha256:sha(workingManifestValueRaw),cleanupPending:true,independentPointHealthy:false,productionAdmission:false}};
}
module.exports={produce};
