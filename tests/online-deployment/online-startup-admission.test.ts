import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyOnlineStartupDecision, assertOriginalOnlineControllerAuthority } from '../../backend/src/services/onlineReleaseControllerAuthority';
import { admitOnlineRuntime, assertOnlineRuntimeAdmission } from '../../backend/src/services/onlineReleaseAdmission';
import { readOnlineReleaseEvidence } from '../../backend/src/services/onlineReleaseEvidence';
import {productionImageInspectionSha256,type ProductionImageExecutionBindings} from '../../backend/src/services/onlineImageExecutionBinding';
import { syntheticQualificationProof, syntheticCheckpointMetadata, syntheticQualificationIdentities,syntheticQualificationImageGraphs } from './online-qualification-evidence.fixture';
import type { OnlineQualificationScope } from '../../backend/src/services/onlineQualificationEvidence';
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const encoded = (value: unknown) => Buffer.from(JSON.stringify(canonical(value)) + '\n');
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const now = new Date('2026-10-19T12:00:00.000Z');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicBytes = Buffer.from(publicKey.export({ type: 'spki', format: 'pem' }));
const decision = { format: 'sabalan-online-startup-decision/v2', purpose: 'online-runtime-startup', scopeSha256: 'a'.repeat(64),
  runtimeId: 'b'.repeat(64), nonceSha256: 'c'.repeat(64), runtimePurpose: 'http', role: 'serving', releaseId: 'release_qualification',
  image: 'sha256:' + 'd'.repeat(64), sourceCommit: 'e'.repeat(40), runtimeBundleSha256: 'f'.repeat(64), manifestSha256: '1'.repeat(64),
  acceptanceSha256: '2'.repeat(64), database: { name: 'qa_online_acceptance', systemIdentifier: '12345678' }, httpIngress: { bindHost: '172.19.0.4', port: 5000 },
  issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 300000).toISOString() };
function signed(value: any, key = privateKey) {
  const raw = Buffer.from('sabalan-online-runtime-startup/v2\n' + JSON.stringify(canonical(value)));
  return encoded({ format: 'sabalan-signed-online-startup/v2', decision: value, signature: sign(null, raw, key).toString('base64') });
}
test('real Ed25519 signature verifies data; changed incarnation, purpose, signer or expiry refuses', () => {
  const bytes = signed(decision);const verified = verifyOnlineStartupDecision(bytes, publicBytes, now);
  assert.equal(verified.runtimeBundleSha256, decision.runtimeBundleSha256);assert.ok(Object.isFrozen(verified.database));
  const envelope = JSON.parse(bytes.toString());envelope.decision.runtimeId = '3'.repeat(64);
  assert.throws(() => verifyOnlineStartupDecision(encoded(envelope), publicBytes, now));
  assert.throws(() => verifyOnlineStartupDecision(signed({ ...decision, purpose: 'read-only-transport-retirement' }), publicBytes, now));
  assert.throws(() => verifyOnlineStartupDecision(signed({ ...decision, runtimePurpose: 'jobs', role: 'serving' }), publicBytes, now));
  assert.throws(() => verifyOnlineStartupDecision(bytes, Buffer.from(generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' })), now));
  assert.throws(() => verifyOnlineStartupDecision(bytes, publicBytes, new Date(now.getTime() + 300000)));
  assert.throws(() => verifyOnlineStartupDecision(signed({ ...decision, expiresAt: new Date(now.getTime() + 600001).toISOString() }), publicBytes, now));
});
test('signed HTTP ingress is exact and immutable; jobs has no listener authority and v1 refuses', () => {
  const bytes = signed(decision); const verified = verifyOnlineStartupDecision(bytes, publicBytes, now);
  assert.deepEqual(verified.httpIngress, decision.httpIngress); assert.ok(Object.isFrozen(verified.httpIngress));
  for (const changed of [{ bindHost: '172.19.0.5', port: 5000 }, { bindHost: '172.19.0.4', port: 5001 }]) {
    const envelope = JSON.parse(bytes.toString()); envelope.decision.httpIngress = changed;
    assert.throws(() => verifyOnlineStartupDecision(encoded(envelope), publicBytes, now));
  }
  for (const httpIngress of [null, { bindHost: '8.8.8.8', port: 5000 }, { bindHost: '127.0.0.1', port: 5000 },
    { bindHost: '172.19.0.4', port: 5000, unchecked: true }]) {
    assert.throws(() => verifyOnlineStartupDecision(signed({ ...decision, httpIngress }), publicBytes, now));
  }
  const jobs = { ...decision, runtimePurpose: 'jobs', role: 'control', httpIngress: null };
  assert.equal(verifyOnlineStartupDecision(signed(jobs), publicBytes, now).httpIngress, null);
  assert.throws(() => verifyOnlineStartupDecision(signed({ ...jobs, httpIngress: decision.httpIngress }), publicBytes, now));
  const { httpIngress: omitted, ...old } = decision;
  assert.throws(() => verifyOnlineStartupDecision(signed(old), publicBytes, now));
  const v1 = { ...old, format: 'sabalan-online-startup-decision/v1' };
  const signature = sign(null, Buffer.from('sabalan-online-runtime-startup/v1\n' + JSON.stringify(canonical(v1))), privateKey).toString('base64');
  assert.throws(() => verifyOnlineStartupDecision(encoded({ format: 'sabalan-signed-online-startup/v1', decision: v1, signature }), publicBytes, now));
});
test('a private signer may never be mounted as the application public trust anchor', () => {
  const privateBytes = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }));
  assert.throws(() => verifyOnlineStartupDecision(signed(decision), privateBytes, now));
});
test('verified data and JSON copies cannot become native/controller/runtime capabilities or reach SQL', async () => {
  const verified = verifyOnlineStartupDecision(signed(decision), publicBytes, now);
  assert.throws(() => assertOriginalOnlineControllerAuthority(verified as any));
  assert.throws(() => assertOnlineRuntimeAdmission(verified as any));
  let enteredSql = false;
  await assert.rejects(admitOnlineRuntime(verified as any, { $transaction: () => { enteredSql = true; } } as any));
  assert.equal(enteredSql, false);
});
for(const store of ['legacy','containerd','classic'] as const)test(`actual immutable ${store} evidence binds distinct content/execution identities and detects altered proof bytes`, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-online-evidence-'));
  const write = (name: string, value: unknown) => { const bytes = encoded(value);fs.writeFileSync(path.join(root, name), bytes, { mode: 0o600 });
    return { file: name, bytes: bytes.length, sha256: hash(bytes) }; };
  try {
    const manifest = { format: 'sabalan-online-release-manifest/v1', releaseId: decision.releaseId, sourceCommit: decision.sourceCommit,
      image: store==='containerd'?'sha256:'+'3'.repeat(64):decision.image, runtimeBundleSha256: decision.runtimeBundleSha256, generation: 2, database: decision.database,
      roots: Array.from({ length: 9 }, (_, i) => ({ live: '/runtime/live-' + i, store: '/runtime/versions-' + i,
        liveDevice: '1', liveInode: String(i + 1), storeDevice: '1', storeInode: String(i + 20), baselineSha256: '4'.repeat(64) })),
      ephemeralRoots: ['reports', 'sales-reports', 'bi-reports'].map(name => '/runtime/' + name) };
    const manifestFile = write('manifest.json', manifest);assert.notEqual(manifestFile.sha256, manifest.runtimeBundleSha256);
    const qualification = { schemaSha256: '6'.repeat(64), sourceDatabase:{name:'unit_qualification',systemIdentifier:'321',oid:'43'}, deploymentTargetDatabase:{...manifest.database,oid:'42'}, captureId: '7'.repeat(64),
      recoveryMode:'ONLINE_COHERENT_WAL' as const,checkpointArchiveChecksum: 'a'.repeat(64), deploymentTargetImages:{backend:decision.image,frontend:'sha256:'+'1'.repeat(64),inquiry:'sha256:'+'2'.repeat(64)},images: { backend:'sha256:'+'3'.repeat(64), frontend: 'sha256:' + '8'.repeat(64), inquiry: 'sha256:' + '9'.repeat(64) } };
    const imageGraphs=syntheticQualificationImageGraphs(qualification.images,qualification.deploymentTargetImages);
    const imageArchiveReceipts=Object.fromEntries(Object.entries(imageGraphs).map(([role,graph])=>[role,write('image-archive-'+role+'.json',graph)]));
    Object.assign(qualification,{imageGraphs,imageArchiveReceipts});
    let productionExecutionBindings:ProductionImageExecutionBindings|undefined;
    if(store!=='legacy'){
      productionExecutionBindings={} as ProductionImageExecutionBindings;
      for(const role of ['backend','frontend','inquiry'] as const){const graph=imageGraphs[role],nativeInspection={Id:store==='containerd'?graph.index:graph.config,
        Descriptor:store==='containerd'?{mediaType:'application/vnd.oci.image.index.v1+json',digest:graph.index,size:123}:null,
        RootFS:{Type:'layers' as const,Layers:[...graph.rootfsDiffIds]},Os:'linux' as const,Architecture:'amd64' as const,Config:{Labels:null}};
        productionExecutionBindings[role]={format:'sabalan-production-image-execution-binding/v1',role,releaseId:manifest.releaseId,sourceMachineUuidSha256:'1'.repeat(64),sourceKernelBootIdSha256:'2'.repeat(64),store,
          executionImageId:nativeInspection.Id,graph,nativeInspection,inspectionSha256:productionImageInspectionSha256(nativeInspection)};
      }Object.assign(qualification,{productionExecutionBindings});
    }
    const identities=syntheticQualificationIdentities({...manifest,sourceDatabase:qualification.sourceDatabase,images:qualification.images,deploymentTargetImages:qualification.deploymentTargetImages});
    const binding = { ...qualification,imageGraphs,...identities,...(productionExecutionBindings?{productionExecutionBindings}:{}),
      manifestSha256: manifestFile.sha256, checkpointSha256: '5'.repeat(64), releaseId: manifest.releaseId,
      sourceCommit: manifest.sourceCommit, runtimeBundleSha256: manifest.runtimeBundleSha256 };
    binding.checkpointSha256 = hash(Buffer.from(JSON.stringify(canonical(syntheticCheckpointMetadata(binding)))));
    assert.notEqual(binding.checkpointSha256, qualification.checkpointArchiveChecksum);
    const scopes: OnlineQualificationScope[] = ['compatible-migrations', 'coherent-independent-restore', 'browser-24-hours', 'single-worker-and-completion', 'current-domain'];
    const reports: Record<string, unknown> = {};
    for (const scope of scopes) reports[scope] = write(scope + '.json', { format: 'sabalan-online-qualification/v1', scope,
      releaseId: manifest.releaseId, sourceCommit: manifest.sourceCommit, image: manifest.image, manifestSha256: manifestFile.sha256,
      productionAdmission: true, proofs: [write(scope + '-proof.json', {...syntheticQualificationProof(scope, binding),...(productionExecutionBindings?{productionExecutionBindings}:{})})] });
    reports['release-gates'] = write('release-gates.json', {format:'sabalan-online-private-qualification-prerequisite/v1',
      releaseId:manifest.releaseId,manifestSha256:manifestFile.sha256,checkpointSha256:binding.checkpointSha256,captureId:binding.captureId,
      publicTrafficQualified:false,qualificationReports:Object.fromEntries(scopes.map(scope=>[scope,(reports[scope] as any).sha256]))});
    const acceptanceFile = write('acceptance.json', { format: 'sabalan-online-release-acceptance/v2', deploymentId: 'lease-owned', qualification:{...qualification,...identities},
      checkpointSha256: binding.checkpointSha256, manifestSha256: manifestFile.sha256, reports });
    const expected = { manifestSha256: manifestFile.sha256, acceptanceSha256: acceptanceFile.sha256 };
    const read = readOnlineReleaseEvidence(root, expected);const {originalOnlineEvidenceReader}=await import('../../scripts/lib/original-online-evidence-reader.mjs');const original=originalOnlineEvidenceReader().readOnlineReleaseEvidence(root,expected);assert.deepEqual(original.evidenceInventory,read.evidenceInventory);original.revalidate();assert.ok(Object.isFrozen(read.manifest.roots[0]));
    assert.equal(read.manifest.image,store==='containerd'?imageGraphs.backend.index:imageGraphs.backend.config);
    assert.throws(() => assertOnlineRuntimeAdmission(read as any),'filesystem receipts alone grant no runtime admission');
    const proofName = scopes[0] + '-proof.json';
    fs.writeFileSync(path.join(root, proofName), encoded({ passResult: false }));assert.throws(read.revalidate);
    assert.throws(() => readOnlineReleaseEvidence(root, expected));
    fs.unlinkSync(path.join(root, proofName));assert.throws(() => readOnlineReleaseEvidence(root, expected));
    const target = path.join(root, 'outside.json');fs.writeFileSync(target, encoded({ passResult: true, fixtureOnly: true }), { mode: 0o600 });
    fs.linkSync(target, path.join(root, proofName));assert.throws(() => readOnlineReleaseEvidence(root, expected));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
