import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { verifyOnlineRecoveryCertificate, hasHealthyOnlineDirectory, canRetireOnlineDirectory, verifyOnlineRecoveryImage, verifyOnlineRecoveryWindow, verifyOnlineRecoveryTerminal, verifyOnlineInitialWalWindows } from '../onlineCheckpointDirectory';
import { planRemoteCheckpointRetention } from '../deploymentCheckpointPolicy';
import { withHealthyDrill } from './deploymentCheckpointDrill.fixture';

const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const encode = (v: any) => Buffer.from(JSON.stringify(canonical(v)));
const domain = 'sabalan-original-physical-checkpoint-verification/v1';
const signedFormat = 'sabalan-signed-physical-checkpoint-verification/v1';

test('historical certificate remains valid only at its actual acceptance inside the signed interval', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const key = publicKey.export({ type: 'spki', format: 'pem' }) as Buffer;
  const decision = { format: domain, issuedAt: '2025-01-01T00:00:00.000Z', expiresAt: '2025-01-01T00:05:00.000Z', reportSha256: 'a'.repeat(64) };
  const signature = sign(null, Buffer.concat([Buffer.from(domain + '\n'), encode(decision)]), privateKey).toString('base64');
  const raw = encode({ format: signedFormat, decision, signature });
  assert.deepEqual(verifyOnlineRecoveryCertificate(raw, key, domain, signedFormat, '2025-01-01T00:01:00.000Z'), decision);
  for (const at of ['invalid', decision.expiresAt, '2024-12-31T23:59:59.000Z']) {
    assert.throws(() => verifyOnlineRecoveryCertificate(raw, key, domain, signedFormat, at));
  }
  assert.throws(() => verifyOnlineRecoveryCertificate(encode({ format: signedFormat, decision: { ...decision, reportSha256: 'b'.repeat(64) }, signature }), key, domain, signedFormat, '2025-01-01T00:01:00.000Z'));
  assert.throws(() => verifyOnlineRecoveryCertificate(raw, generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }) as Buffer, domain, signedFormat, '2025-01-01T00:01:00.000Z'));
});

test('certificate domain and maximum issuance interval cannot be relabeled', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const key = publicKey.export({ type: 'spki', format: 'pem' }) as Buffer;
  for (const expiresAt of ['2025-01-01T00:11:00.000Z', '2025-01-01T00:00:00.000Z']) {
    const decision = { format: domain, issuedAt: '2025-01-01T00:00:00.000Z', expiresAt };
    const signature = sign(null, Buffer.concat([Buffer.from(domain + '\n'), encode(decision)]), privateKey).toString('base64');
    assert.throws(() => verifyOnlineRecoveryCertificate(encode({ format: signedFormat, decision, signature }), key, domain, signedFormat, decision.issuedAt));
  }
});

test('a JSON copy of directory evidence cannot displace healthy legacy points or authorize directory removal', () => {
  const fake = { format: 'sabalan-verified-online-directory/v1' as const };
  const online = { ...withHealthyDrill({ id: 'online', releaseId: 'release', size: 100 }), createdAt: new Date('2030-01-01'), onlineDirectoryEvidence: fake,
    remoteVerified: true, active: false, incidentOpen: false };
  assert.equal(hasHealthyOnlineDirectory(fake, online), false); assert.equal(canRetireOnlineDirectory(fake), false);
  const legacy = [1, 2, 3].map(n => ({ ...withHealthyDrill({ id: 'legacy-' + n, releaseId: 'release', size: 100 }), createdAt: new Date(`2025-01-0${n}`), remoteVerified: true, active: false, incidentOpen: false }));
  const plan = planRemoteCheckpointRetention([...legacy, online]);
  assert.deepEqual(plan.deleteIds, ['legacy-1']);
  assert.ok(plan.keepIds.includes('online') && plan.keepIds.includes('legacy-3') && plan.keepIds.includes('legacy-2'));
});

const digest = (raw: Buffer) => createHash('sha256').update(raw).digest('hex');
function walFixture(segment = '000000010000000000000001') {
  const source = { databaseName: 'sabalanerp', databaseOid: '16384', systemIdentifier: '123456789', timeline: 1, segmentBytes: 16777216 };
  const closure = { phase: 'COMPLETE', nativeReaped: true, databaseQuiet: true, nativeStatus: 0, source, startLsn: '0/1000000', endLsn: '0/2000000', segments: [{ name: segment, bytes: 16777216, sha256: 'a'.repeat(64) }] };
  const captureRaw = Buffer.concat([encode(closure), Buffer.from('\n')]);
  const objects = [{ name: 'capture.sabrec', rawBytes: captureRaw.length, rawSha256: digest(captureRaw), encryptedBytes: captureRaw.length + 1000, encryptedSha256: 'b'.repeat(64), localDecryptVerified: true },
    { name: segment + '.sabrec', rawBytes: 16777216, rawSha256: 'a'.repeat(64), encryptedBytes: 16778216, encryptedSha256: 'c'.repeat(64), localDecryptVerified: true }];
  const seal = { format: 'sabalan-wal-seal/v1', phase: 'SEALED', source, range: { startLsn: closure.startLsn, endLsn: closure.endLsn, timeline: 1, segmentBytes: 16777216 }, captureSha256: digest(captureRaw), objects };
  const sealRaw = encode(seal), windowSha256 = digest(sealRaw), sourceIdentity = { systemIdentifier: source.systemIdentifier, timeline: 1 };
  const encrypted = objects.map(row => ({ name: row.name, bytes: row.encryptedBytes, sha256: row.encryptedSha256 }));
  const request = { format: 'sabalan-original-wal-window-verification-request/v1', sequence: 1, challenge: 'd'.repeat(64), deploymentId: 'deployment_123', releaseId: 'release_123', windowSha256, sourceIdentity, objects: encrypted };
  const requestSha256 = digest(encode(request)), pair = generateKeyPairSync('ed25519');
  const decision = { format: 'sabalan-original-wal-window-verification/v1', requestSha256, challenge: request.challenge, independentTokenSha256: 'e'.repeat(64), windowSha256, sourceIdentity, objects: encrypted, issuedAt: '2025-01-01T00:00:00.000Z', expiresAt: '2025-01-01T00:10:00.000Z' };
  const certificateRaw = encode({ format: 'sabalan-signed-original-wal-window-verification/v1', decision, signature: sign(null, Buffer.concat([Buffer.from(decision.format + '\n'), encode(decision)]), pair.privateKey).toString('base64') });
  const dependency = { requestSha256, windowSha256, sourceIdentity, deploymentId: request.deploymentId, releaseId: request.releaseId, objects: encrypted.map(row => ({ ...row, relativePath: 'ciphertexts/' + row.name })), certificateFile: 'certificate.json', certificateSha256: digest(certificateRaw), certificateAcceptedAt: '2025-01-01T00:01:00.000Z' };
  return { dependency, input: { requestRaw: Buffer.concat([encode(request), Buffer.from('\n')]), sealRaw, captureRaw, certificateRaw }, publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }) as Buffer };
}

test('actual OCI source index and classic config prefixes match the complete saved graph', () => {
  const image = { sourceImageId: 'sha256:' + 'a'.repeat(64), configImageId: 'sha256:' + 'b'.repeat(64), archiveGraph: { index: 'sha256:' + 'a'.repeat(64), config: 'sha256:' + 'b'.repeat(64) } };
  verifyOnlineRecoveryImage(image);
  for (const changed of [{ ...image, sourceImageId: 'a'.repeat(64) }, { ...image, configImageId: 'sha256:latest' }, { ...image, archiveGraph: { ...image.archiveGraph, config: image.sourceImageId } }]) assert.throws(() => verifyOnlineRecoveryImage(changed));
});

test('retained WAL requires actual signed request/seal/capture/cipher union and historical acceptance', () => {
  const valid = walFixture(); assert.equal(verifyOnlineRecoveryWindow(valid.dependency, valid.input, valid.publicKey).requestSha256, valid.dependency.requestSha256);
  for (const mutate of [(v: any) => { v.dependency.objects[1].sha256 = 'f'.repeat(64); }, (v: any) => { v.dependency.certificateAcceptedAt = '2025-01-01T00:10:00.000Z'; }, (v: any) => { v.dependency.requestSha256 = 'f'.repeat(64); }, (v: any) => { v.input.captureRaw = Buffer.from('{}'); }, (v: any) => { v.input.certificateRaw = walFixture().input.certificateRaw; }]) {
    const changed = walFixture(); mutate(changed); assert.throws(() => verifyOnlineRecoveryWindow(changed.dependency, changed.input, changed.publicKey));
  }
  const wrongTimelineFile = walFixture('000000020000000000000001'); assert.throws(() => verifyOnlineRecoveryWindow(wrongTimelineFile.dependency, wrongTimelineFile.input, wrongTimelineFile.publicKey));
  const gap = walFixture('000000010000000000000003'); assert.throws(() => verifyOnlineRecoveryWindow(gap.dependency, gap.input, gap.publicKey));
});

test('signed initial window references cannot disappear or point to different source custody', () => {
  const capture = 'a'.repeat(64), id = 'b'.repeat(64), binding = { requestSha256: id, dependencySha256: 'c'.repeat(64), originalDependencySha256: 'd'.repeat(64), certificateSha256: 'e'.repeat(64) };
  const reference = { requestSha256: id, sha256: binding.dependencySha256, relativeDirectory: 'wal-windows/' + id, file: '/srv/sabalanerp-recovery/checkpoints/online-' + capture + '/wal-windows/' + id + '/dependency.json', originalDependencySha256: binding.originalDependencySha256, certificateSha256: binding.certificateSha256 };
  verifyOnlineInitialWalWindows([reference], [binding], capture);
  assert.throws(() => verifyOnlineInitialWalWindows([reference], [], capture));
  for (const changed of [{ ...reference, sha256: 'f'.repeat(64) }, { ...reference, originalDependencySha256: 'f'.repeat(64) }, { ...reference, file: reference.file.replace('online-', 'foreign-') }]) assert.throws(() => verifyOnlineInitialWalWindows([changed], [binding], capture));
  assert.throws(() => verifyOnlineInitialWalWindows([reference, reference], [binding], capture));
});

test('exact terminal result bytes prove normal closure and every retained overlapping WAL interval', () => {
  const sourceDatabase = { name: 'sabalanerp', oid: '16384', systemIdentifier: '123456789' }, ids = ['a'.repeat(64), 'b'.repeat(64)];
  const dependencies = ids.map((id, index) => ({ requestSha256: id, dependencySha256: String(index + 1).repeat(64), windowSha256: String(index + 3).repeat(64), certificateSha256: String(index + 5).repeat(64) }));
  const windows = dependencies.map((row, index) => ({ requestSha256: row.requestSha256, windowSha256: row.windowSha256, certificateSha256: row.certificateSha256, startLsn: index ? '0/2000000' : '0/1000000', endLsn: index ? '0/4000000' : '0/3000000' }));
  const point = { captureId: 'c'.repeat(64), sourceDatabase, restorePoint: { lsn: '0/1800000' } };
  const terminal = { format: 'sabalan-original-terminal-wal-coverage/v1', phase: 'COMPLETE', captureId: point.captureId, source: { databaseName: sourceDatabase.name, databaseOid: sourceDatabase.oid, systemIdentifier: sourceDatabase.systemIdentifier }, ownedChildrenDomain: 'continuous-wal-producer', allOriginalChildrenClosed: true, replicationAuthenticationRestored: true, finalIntervalCompletion: true, terminalPhase: 'ONLINE_SERVING', terminalEpochSha256: 'd'.repeat(64), publicationSha256: 'e'.repeat(64), coveredFromLsn: windows[0].startLsn, coveredThroughLsn: windows[1].endLsn, terminalLsn: '0/3800000', windows };
  const raw = encode(terminal), decision = { terminalResultSha256: digest(raw), terminalEpochSha256: terminal.terminalEpochSha256, publicationSha256: terminal.publicationSha256, windows: dependencies.map(({ requestSha256, dependencySha256 }) => ({ requestSha256, dependencySha256 })) };
  verifyOnlineRecoveryTerminal(raw, decision, point, dependencies);
  assert.throws(() => verifyOnlineRecoveryTerminal(Buffer.concat([raw, Buffer.from(' ')]), decision, point, dependencies));
  for (const mutate of [(v: any) => { v.allOriginalChildrenClosed = false; }, (v: any) => { v.windows.pop(); }, (v: any) => { v.windows[1].startLsn = '0/3800000'; }, (v: any) => { v.source.systemIdentifier = '999'; }]) {
    const changed = structuredClone(terminal); mutate(changed); const bytes = encode(changed); assert.throws(() => verifyOnlineRecoveryTerminal(bytes, { ...decision, terminalResultSha256: digest(bytes) }, point, dependencies));
  }
});
