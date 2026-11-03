import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as compiler from '../../scripts/lib/independent-private-qualification-material.mjs';
const {qualificationBytes}=compiler;
const sha=raw=>createHash('sha256').update(raw).digest('hex');
import {fixture,restored} from './restored-qa-material.fixture.mjs';

test('explicit restored QA data retains genuine different-cluster source lineage without healthy or public claims',()=>{
 const v=restored(),result=compiler.compileRestoredQaPrivateQualificationMaterial(v);
 assert.equal(result.format,'sabalan-original-restored-qa-private-material/v1');
 assert.deepEqual(result.restoredQaLineage,v.restoredQaLineage);assert.equal(result.cleanupPending,true);
 assert.equal(result.independentPointHealthy,false);assert.equal(result.productionAdmission,false);
 for(const decision of Object.values(result.decisionsByRuntime)){
  assert.deepEqual(decision.sourceDatabase,v.restoredQaLineage.sourceDatabase);assert.deepEqual(decision.database,v.facts.database);
  assert.notEqual(decision.sourceDatabase.systemIdentifier,decision.database.systemIdentifier);
 }
 assert.throws(()=>compiler.compileIndependentPrivateQualificationMaterial(v));
});
test('restored QA compiler rejects source-role laundering, unbound lineage and future cleanup claims',()=>{
 const changes=[v=>v.index.sourceDatabaseRole='EMPTY_ISOLATED_IDENTITY_OBSERVER',v=>v.restoredQaLineage.cleanupPending=false,
  v=>v.restoredQaLineage.independentPointHealthy=true,v=>v.restoredQaLineage.productionAdmission=true,
  v=>v.restoredQaLineage.targetDatabase={...v.facts.database,oid:'99'},v=>v.restoredQaLineage.sourceDatabase.oid='100',
  v=>v.restoredQaLineage.completeManifestSha256='e'.repeat(64),v=>v.restoredQaLineage.nativeHistorySha256='bad',
  v=>v.restoredQaLineage.workingManifestSha256='bad',v=>v.restoredQaLineage.extra=true,v=>v.restoredQaLineage.sourceDatabase.systemIdentifier=v.restoredQaLineage.targetDatabase.systemIdentifier];
 for(const change of changes){const v=restored();change(v);assert.throws(()=>compiler.compileRestoredQaPrivateQualificationMaterial(v));}
 const old=fixture();assert.throws(()=>compiler.compileRestoredQaPrivateQualificationMaterial(old));
 assert.equal(compiler.compileIndependentPrivateQualificationMaterial(old).actualHttpTargets,1);
});

// Restored material must bind the actual raw values, not caller-supplied digests.
test('restored QA refuses lineage without original COMPLETE, working and history bytes',()=>{
 for(const field of ['completeManifestValueRawBase64','workingManifestValueRawBase64','nativeHistoryRawBase64']){const v=restored();delete v.facts[field];assert.throws(()=>compiler.compileRestoredQaPrivateQualificationMaterial(v));}
});

test('restored QA rejects changed raw values even when baseline lineage is preserved',()=>{
 for(const field of ['completeManifestValueRawBase64','workingManifestValueRawBase64','nativeHistoryRawBase64']){const v=restored();v.facts[field]=Buffer.from('{}').toString('base64');assert.throws(()=>compiler.compileRestoredQaPrivateQualificationMaterial(v));}
});

test('restored QA rejects a version store aliased to its live business root',()=>{
 const v=restored(),root=v.facts.roots[0];root.store=root.live;
 const manifest=JSON.parse(Buffer.from(v.facts.restoreManifestRawBase64,'base64'));manifest.sources[0].storeRoot=root.live;
 const raw=Buffer.concat([qualificationBytes(manifest),Buffer.from('\n')]);
 v.facts.restoreManifestRawBase64=raw.toString('base64');v.facts.restoreManifestSha256=sha(raw);v.baselineCompletion.manifestSha256=sha(raw);
 assert.throws(()=>compiler.compileRestoredQaPrivateQualificationMaterial(v));
});

test('different-cluster restored QA may retain the same numeric OID as production',()=>{
 const v=restored();v.restoredQaLineage.sourceDatabase.oid=v.facts.database.oid;v.index.oid=v.facts.database.oid;
 const manifest=JSON.parse(Buffer.from(v.facts.restoreManifestRawBase64,'base64'));manifest.restoredQaLineage=v.restoredQaLineage;
 const raw=Buffer.concat([qualificationBytes(manifest),Buffer.from('\n')]);v.facts.restoreManifestRawBase64=raw.toString('base64');v.facts.restoreManifestSha256=sha(raw);v.baselineCompletion.manifestSha256=sha(raw);
 const result=compiler.compileRestoredQaPrivateQualificationMaterial(v);assert.equal(result.actualHttpTargets,1);
 assert.notEqual(result.restoredQaLineage.sourceDatabase.systemIdentifier,result.restoredQaLineage.targetDatabase.systemIdentifier);
});
