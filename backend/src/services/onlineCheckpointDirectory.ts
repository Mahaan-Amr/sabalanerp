/** A directory recovery point is not a single .sabrec archive. Only a fixed-key
 * certificate chain and a complete, pinned inventory confer retention eligibility. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, createPublicKey, verify } from 'node:crypto';

const KEY = '/etc/sabalan/online/qualification-public-key.pem';
const KEY_SHA = 'e61a06dfe5562a2375cb3051178ad9760857a7a01ea8b88f094a6e6123fdbc48';
const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const encode = (v: any) => Buffer.from(JSON.stringify(canonical(v)));
const sha = (raw: Buffer) => createHash('sha256').update(raw).digest('hex');
const hex = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function need(v: unknown): asserts v { if (!v) throw Error('ONLINE_RECOVERY_DIRECTORY_UNPROVEN'); }
const equal = (a: any, b: any) => { if (a === undefined || b === undefined) need(a === b); else need(encode(a).equals(encode(b))); };
const pin = (s: fs.BigIntStats) => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs, s.uid, s.mode, s.nlink].map(String).join(':');
const safeRelative = (v: unknown): string => {
  need(typeof v === 'string' && v.length <= 512 && !v.includes('\\') && !v.startsWith('/')
    && v.split('/').every(part => /^[A-Za-z0-9_.-]+$/.test(part) && part !== '.' && part !== '..'));
  return v;
};
export type OnlineDirectoryEvidence = Readonly<{ format: 'sabalan-verified-online-directory/v1' }>;
type Snapshot = { root: string; files: Map<string, { pin: string; bytes: number; sha256: string }>; directories: Map<string, string>;
  metadata: any; terminal: boolean; pointIndexSha256: string };
const originals = new WeakMap<OnlineDirectoryEvidence, Snapshot>();

/** Pure verification is useful for negative tests; it does not mint retention custody. */
export function verifyOnlineRecoveryCertificate(raw: Buffer, publicKey: Buffer, domain: string, signedFormat: string, acceptedAt: string) {
  need(raw.length > 0 && raw.length <= 1024 * 1024);
  const envelope = JSON.parse(raw.toString('utf8')), d = envelope.decision;
  need(envelope.format === signedFormat && d?.format === domain && typeof envelope.signature === 'string');
  const accepted = Date.parse(acceptedAt), issued = Date.parse(d.issuedAt), expires = Date.parse(d.expiresAt);
  need(Number.isFinite(accepted) && Number.isFinite(issued) && Number.isFinite(expires)
    && issued <= accepted && accepted < expires && expires - issued <= 600000 && accepted <= Date.now());
  const signature = Buffer.from(envelope.signature, 'base64'), key = createPublicKey(publicKey);
  need(signature.length === 64 && signature.toString('base64') === envelope.signature && key.asymmetricKeyType === 'ed25519'
    && verify(null, Buffer.concat([Buffer.from(domain + '\n'), encode(d)]), key, signature));
  return d;
}

/** Data-only checks never mint the private filesystem retention token. */
export function verifyOnlineRecoveryImage(image: any) {
  const imageId = (value: unknown) => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
  need(image && imageId(image.configImageId) && imageId(image.sourceImageId));
  need(image.archiveGraph && image.archiveGraph.config === image.configImageId && image.archiveGraph.index === image.sourceImageId);
}

const lsn = (value: unknown): bigint => {
  need(typeof value === 'string' && /^[0-9A-F]{1,8}\/[0-9A-F]{1,8}$/.test(value));
  const [high, low] = value.split('/'); return (BigInt('0x' + high) << 32n) | BigInt('0x' + low);
};
function windowNames(range: any): string[] {
  need(Number.isSafeInteger(range.timeline) && range.timeline > 0 && range.timeline <= 0xffffffff
    && Number.isSafeInteger(range.segmentBytes) && range.segmentBytes >= 1024 ** 2 && range.segmentBytes <= 1024 ** 3);
  const bytes = BigInt(range.segmentBytes); need((bytes & (bytes - 1n)) === 0n);
  const start = lsn(range.startLsn), end = lsn(range.endLsn); need(end > start);
  const first = start / bytes, last = (end - 1n) / bytes, perLog = 0x100000000n / bytes; need(last - first < 8n);
  const hex8 = (v: bigint) => v.toString(16).toUpperCase().padStart(8, '0'); const names: string[] = [];
  for (let index = first; index <= last; index++) names.push(hex8(BigInt(range.timeline)) + hex8(index / perLog) + hex8(index % perLog));
  return names;
}
export function verifyOnlineRecoveryWindow(dependency: any, input: { requestRaw: Buffer; sealRaw: Buffer; captureRaw: Buffer; certificateRaw: Buffer }, publicKey: Buffer) {
  const request = JSON.parse(input.requestRaw.toString()), seal = JSON.parse(input.sealRaw.toString()), capture = JSON.parse(input.captureRaw.toString());
  need(request.format === 'sabalan-original-wal-window-verification-request/v1' && hex(request.challenge)
    && Number.isSafeInteger(request.sequence) && request.sequence > 0 && sha(encode(request)) === dependency.requestSha256);
  need(seal.format === 'sabalan-wal-seal/v1' && seal.phase === 'SEALED' && sha(input.sealRaw) === dependency.windowSha256
    && request.windowSha256 === dependency.windowSha256 && seal.captureSha256 === sha(input.captureRaw));
  need(capture.phase === 'COMPLETE' && capture.nativeReaped === true && capture.databaseQuiet === true && capture.nativeStatus === 0);
  equal(request.sourceIdentity, dependency.sourceIdentity); equal(request.sourceIdentity, { systemIdentifier: seal.source?.systemIdentifier, timeline: seal.source?.timeline });
  equal(seal.source, capture.source); equal(seal.range, { startLsn: capture.startLsn, endLsn: capture.endLsn, timeline: capture.source.timeline, segmentBytes: capture.source.segmentBytes });
  equal(request.deploymentId, dependency.deploymentId); equal(request.releaseId, dependency.releaseId);
  const names = windowNames(seal.range); need(Array.isArray(capture.segments) && capture.segments.length === names.length);
  equal(capture.segments.map((row: any) => row.name).sort(), [...names].sort());
  const rawObjects = [{ name: 'capture.sabrec', rawBytes: input.captureRaw.length, rawSha256: sha(input.captureRaw) },
    ...capture.segments.map((row: any) => { need(row.bytes === seal.range.segmentBytes && hex(row.sha256)); return { name: row.name + '.sabrec', rawBytes: row.bytes, rawSha256: row.sha256 }; })];
  need(Array.isArray(seal.objects) && seal.objects.length === rawObjects.length && seal.objects.length <= 9);
  const objects = seal.objects.map((row: any, index: number) => {
    const raw = rawObjects[index]; need(row.name === raw.name && row.rawBytes === raw.rawBytes && row.rawSha256 === raw.rawSha256
      && row.localDecryptVerified === true && hex(row.encryptedSha256) && Number.isSafeInteger(row.encryptedBytes)
      && row.encryptedBytes > row.rawBytes && row.encryptedBytes <= 64 * 1024 ** 2);
    return { name: row.name, bytes: row.encryptedBytes, sha256: row.encryptedSha256 };
  });
  need(objects.reduce((total: number, row: any) => total + row.bytes, 0) <= 256 * 1024 ** 2);
  equal(request.objects, objects); equal(dependency.objects, objects.map((row: any) => ({ ...row, relativePath: 'ciphertexts/' + row.name })));
  need(dependency.certificateFile === 'certificate.json' && dependency.certificateSha256 === sha(input.certificateRaw));
  const decision = verifyOnlineRecoveryCertificate(input.certificateRaw, publicKey, 'sabalan-original-wal-window-verification/v1', 'sabalan-signed-original-wal-window-verification/v1', dependency.certificateAcceptedAt);
  for (const field of ['challenge', 'windowSha256', 'sourceIdentity', 'objects']) equal(decision[field], request[field]);
  need(decision.requestSha256 === dependency.requestSha256 && hex(decision.independentTokenSha256));
  return { requestSha256: dependency.requestSha256, windowSha256: dependency.windowSha256, certificateSha256: dependency.certificateSha256 };
}
export function verifyOnlineInitialWalWindows(references: any[], bindings: any[], captureId: string) {
  need(Array.isArray(references)); const seen = new Set<string>();
  for (const reference of references) {
    need(hex(reference.requestSha256) && !seen.has(reference.requestSha256)); seen.add(reference.requestSha256);
    const row = bindings.find(value => value.requestSha256 === reference.requestSha256); need(row);
    need(reference.relativeDirectory === 'wal-windows/' + row.requestSha256 && reference.file === '/srv/sabalanerp-recovery/checkpoints/online-' + captureId + '/' + reference.relativeDirectory + '/dependency.json'
      && reference.sha256 === row.dependencySha256 && reference.originalDependencySha256 === row.originalDependencySha256 && reference.certificateSha256 === row.certificateSha256);
  }
}
export function verifyOnlineRecoveryTerminal(raw: Buffer, decision: any, point: any, dependencies: Array<{ requestSha256: string; dependencySha256: string; windowSha256: string; certificateSha256: string }>) {
  need(sha(raw) === decision.terminalResultSha256); const terminal = JSON.parse(raw.toString());
  need(terminal.format === 'sabalan-original-terminal-wal-coverage/v1' && terminal.phase === 'COMPLETE' && terminal.captureId === point.captureId
    && terminal.ownedChildrenDomain === 'continuous-wal-producer' && terminal.allOriginalChildrenClosed === true
    && terminal.replicationAuthenticationRestored === true && terminal.finalIntervalCompletion === true
    && ['ONLINE_SERVING', 'ONLINE_ROLLBACK_PUBLISHING'].includes(terminal.terminalPhase));
  equal({ name: terminal.source?.databaseName, oid: terminal.source?.databaseOid, systemIdentifier: terminal.source?.systemIdentifier }, point.sourceDatabase);
  need(terminal.terminalEpochSha256 === decision.terminalEpochSha256 && terminal.publicationSha256 === decision.publicationSha256);
  need(Array.isArray(terminal.windows) && terminal.windows.length === dependencies.length && terminal.windows.length > 0);
  const seen = new Set<string>(); let through: bigint | undefined;
  for (const window of terminal.windows) {
    need(hex(window.requestSha256) && !seen.has(window.requestSha256)); seen.add(window.requestSha256);
    const dependency = dependencies.find(row => row.requestSha256 === window.requestSha256); need(dependency);
    need(dependency.windowSha256 === window.windowSha256 && dependency.certificateSha256 === window.certificateSha256);
    const start = lsn(window.startLsn), end = lsn(window.endLsn); need(end > start && (through === undefined || start <= through && end > through)); through = end;
  }
  need(terminal.coveredFromLsn === terminal.windows[0].startLsn && terminal.coveredThroughLsn === terminal.windows[terminal.windows.length - 1].endLsn
    && lsn(terminal.coveredFromLsn) <= lsn(point.restorePoint.lsn) && lsn(terminal.coveredThroughLsn) >= lsn(terminal.terminalLsn));
  equal([...decision.windows].sort((a, b) => a.requestSha256.localeCompare(b.requestSha256)), dependencies.map(({ requestSha256, dependencySha256 }) => ({ requestSha256, dependencySha256 })).sort((a, b) => a.requestSha256.localeCompare(b.requestSha256)));
  return terminal;
}

async function readOriginal(file: string, maximum: number, collect = false) {
  need(await fs.promises.realpath(file) === file);
  const handle = await fs.promises.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    need(before.isFile() && before.nlink === 1n && (before.mode & 0o022n) === 0n && before.size >= 0n && before.size <= BigInt(maximum));
    const hash = createHash('sha256'), chunks: Buffer[] = [], chunk = Buffer.allocUnsafe(256 * 1024); let bytes = 0;
    for (;;) {
      const result = await handle.read(chunk, 0, chunk.length, null); if (!result.bytesRead) break;
      bytes += result.bytesRead; need(bytes <= maximum); const data = chunk.subarray(0, result.bytesRead); hash.update(data);
      if (collect) chunks.push(Buffer.from(data));
      await new Promise(resolve => setImmediate(resolve));
    }
    need(BigInt(bytes) === before.size && pin(before) === pin(await handle.stat({ bigint: true }))
      && pin(before) === pin(await fs.promises.lstat(file, { bigint: true })));
    return { pin: pin(before), bytes, sha256: hash.digest('hex'), raw: collect ? Buffer.concat(chunks) : undefined };
  } finally { await handle.close(); }
}

export async function readOnlineCheckpointDirectory(repositoryRoot: string, directory: string) {
  need(process.platform === 'linux');
  const root = await fs.promises.realpath(repositoryRoot), absolute = path.resolve(directory);
  need(path.dirname(absolute) === root && /^online-[a-f0-9]{64}$/.test(path.basename(absolute))
    && await fs.promises.realpath(absolute) === absolute);
  const key = await readOriginal(KEY, 4096, true); need(key.sha256 === KEY_SHA);
  const files: Snapshot['files'] = new Map(), directories: Snapshot['directories'] = new Map();
  const read = async (relative: string, maximum = 8 * 1024 ** 2, expected?: { bytes?: number; sha256: string }, json = false): Promise<any> => {
    safeRelative(relative); need(!files.has(relative));
    const value = await readOriginal(path.join(absolute, ...relative.split('/')), maximum, json);
    if (expected) need(value.sha256 === expected.sha256 && (expected.bytes === undefined || value.bytes === expected.bytes));
    files.set(relative, { pin: value.pin, bytes: value.bytes, sha256: value.sha256 });
    return json ? JSON.parse(value.raw!.toString('utf8')) : value;
  };
  const point = await read('point.json', undefined, undefined, true);
  need(point.format === 'sabalan-online-recovery-point/v1' && point.captureId === path.basename(absolute).slice(7));
  const certification = await read('certification.json', 1024 * 1024, undefined, true);
  need(certification.format === 'sabalan-online-recovery-point-certification/v1'
    && certification.pointIndexSha256 === files.get('point.json')!.sha256
    && certification.materialIndexSha256 === point.materialIndexSha256
    && certification.canonicalMetadataSha256 === point.canonicalMetadataSha256);
  need(point.materialIndexFile === 'recovery-material.json' && point.canonicalMetadataFile === 'canonical-checkpoint.json');
  const material = await read(point.materialIndexFile, undefined, { sha256: point.materialIndexSha256 }, true);
  need(material.format === 'sabalan-online-recovery-material/v1');
  for (const field of ['captureId', 'sealedManifestSha256', 'plaintextManifestSha256', 'cipherInventorySha256', 'physicalCompletionSha256', 'physicalReportSha256', 'sourceDatabase', 'restorePoint', 'objects', 'images', 'custodyFile', 'custodySha256', 'initialWalWindows']) equal(point[field], material[field]);
  const envelope = await read(point.canonicalMetadataFile, undefined, { sha256: point.canonicalMetadataFileSha256 }, true);
  const metadata = envelope.canonicalMetadata;
  need(metadata && sha(encode(metadata)) === point.canonicalMetadataSha256 && envelope.canonicalMetadataSha256 === point.canonicalMetadataSha256);
  for (const [k, v] of Object.entries(metadata)) equal(envelope[k], v);
  need(metadata.captureMethod === 'ONLINE_COHERENT_WAL' && typeof metadata.id === 'string' && metadata.id.length > 0
    && typeof metadata.releaseId === 'string' && metadata.releaseId.length > 0 && Number.isFinite(Date.parse(metadata.createdAt))
    && metadata.checksum === point.cipherInventorySha256 && metadata.remoteVerified === true && metadata.independentRestoreVerified === true);
  need(Number.isSafeInteger(metadata.size) && metadata.size > 0
    && hex(metadata.sourceMachineUuidSha256) && hex(metadata.sourceKernelBootIdSha256));
  const repository = metadata.repositoryDirectory;
  need(repository?.format === 'sabalan-online-checkpoint-directory/v1' && repository.captureId === point.captureId
    && repository.repository === 'independent-recovery' && repository.mountPath === '/mnt/sabalanerp-independent-recovery/online-' + point.captureId
    && repository.sftpPath === '/checkpoints/online-' + point.captureId && repository.materialIndexSha256 === point.materialIndexSha256
    && metadata.remotePath === repository.mountPath);
  for (const field of ['sealedManifestSha256', 'plaintextManifestSha256', 'cipherInventorySha256']) need(hex(point[field]) && repository[field] === point[field]);
  equal(metadata.sourceDatabase, point.sourceDatabase);
  equal(metadata.physicalPoint, { sealedManifestSha256: point.sealedManifestSha256, plaintextManifestSha256: point.plaintextManifestSha256,
    cipherInventorySha256: point.cipherInventorySha256, restorePoint: point.restorePoint });
  const specs = [
    ['physical', 'physical-verification.json', 'sabalan-original-physical-checkpoint-verification/v1', 'sabalan-signed-physical-checkpoint-verification/v1'],
    ['repository', 'repository-promotion.json', 'sabalan-original-physical-repository-promotion/v1', 'sabalan-signed-physical-repository-promotion/v1'],
    ['metadataPublication', 'publication-verification.json', 'sabalan-original-physical-checkpoint-publication/v1', 'sabalan-signed-physical-checkpoint-publication/v1'],
  ];
  const decisions: any = {};
  for (const [role, filename, domain, format] of specs) {
    const reference = certification.certificates?.[role]; need(reference?.relativePath === filename && hex(reference.sha256));
    await read(filename, 1024 * 1024, { sha256: reference.sha256 });
    const raw = await readOriginal(path.join(absolute, filename), 1024 * 1024, true);
    need(raw.sha256 === reference.sha256);
    decisions[role] = verifyOnlineRecoveryCertificate(raw.raw!, key.raw!, domain, format, reference.acceptedAt);
  }
  const physical = decisions.physical, promotion = decisions.repository, publication = decisions.metadataPublication;
  for (const field of ['sealedManifestSha256', 'plaintextManifestSha256', 'cipherInventorySha256']) need(physical[field] === point[field]);
  need(physical.reportSha256 === point.physicalReportSha256 && physical.originalCompletionSha256 === point.physicalCompletionSha256
    && physical.continuousWalQualified === false && physical.productionAdmission === false);
  equal(physical.sourceDatabase, point.sourceDatabase); equal(physical.restorePoint, point.restorePoint);
  for (const d of [promotion, publication]) { equal(d.repository, repository); need(d.physicalCompletionSha256 === point.physicalCompletionSha256); }
  need(promotion.originalPromotionSha256 === metadata.repositoryPromotionSha256 && publication.canonicalMetadataSha256 === point.canonicalMetadataSha256
    && publication.remoteMetadataSha256 === point.canonicalMetadataFileSha256
    && publication.remoteMetadataFile === '/srv/sabalanerp-recovery/checkpoints/online-' + point.captureId + '/canonical-checkpoint.json');
  need(Array.isArray(point.objects) && point.objects.length >= 15 && point.objects.length <= 8192 + 32);
  for (const object of point.objects) {
    need(hex(object.sha256) && Number.isSafeInteger(object.bytes) && object.bytes > 0 && object.bytes <= 4 * 1024 ** 3);
    await read(object.relativePath, object.bytes, object);
  }
  const reports = point.objects.filter((row: any) => row.kind === 'PHYSICAL_REPORT'); need(reports.length === 1);
  const reportRaw = await readOriginal(path.join(absolute, safeRelative(reports[0].relativePath)), 32 * 1024 ** 2, true);
  need(reportRaw.sha256 === point.physicalReportSha256);
  const report = JSON.parse(reportRaw.raw!.toString());
  need(report.format === 'sabalan-original-independent-online-physical-restore/v1' && report.pass === true
    && report.physicalAndThreeApplicationsQualified === true && report.continuousWalQualified === false
    && report.sourceMachineUuidSha256 === metadata.sourceMachineUuidSha256
    && report.sourceKernelBootIdSha256 === metadata.sourceKernelBootIdSha256
    && hex(report.recoveryMachineUuidSha256) && report.recoveryMachineUuidSha256 !== report.sourceMachineUuidSha256
    && hex(report.recoveryKernelBootIdSha256) && report.recoveryKernelBootIdSha256 !== report.sourceKernelBootIdSha256);
  equal(report.sourceDatabase, point.sourceDatabase); equal(report.restorePoint, point.restorePoint);
  need(point.custodyFile === 'publication-custody.json' && hex(point.custodySha256));
  if (files.has(point.custodyFile)) need(files.get(point.custodyFile)!.sha256 === point.custodySha256);
  else await read(point.custodyFile, undefined, { sha256: point.custodySha256 });
  for (const role of ['backend', 'frontend', 'inquiry']) {
    const image = point.images?.[role]; verifyOnlineRecoveryImage(image);
    need(files.get(image.cipherRelativePath)?.sha256 === image.cipherSha256 && files.get(image.cipherRelativePath)?.bytes === image.cipherBytes
      && files.get(image.archiveReceiptRelativePath)?.sha256 === image.archiveReceiptSha256);
  }
  const walParent = path.join(absolute, 'wal-windows'), windows: any[] = [], windowBindings: any[] = [];
  const readAgain = async (relative: string, maximum: number): Promise<Buffer> => {
    const old = files.get(relative); need(old); const value = await readOriginal(path.join(absolute, safeRelative(relative)), maximum, true);
    need(value.pin === old.pin && value.sha256 === old.sha256 && value.bytes === old.bytes); return value.raw!;
  };
  need(point.walWindowDirectory === 'wal-windows');
  for (const entry of await fs.promises.readdir(walParent, { withFileTypes: true })) {
    need(entry.isDirectory() && hex(entry.name)); const prefix = 'wal-windows/' + entry.name + '/';
    const dependency = await read(prefix + 'dependency.json', undefined, undefined, true);
    need(dependency.format === 'sabalan-online-certified-wal-dependency/v1' && dependency.requestSha256 === entry.name
      && dependency.basePoint?.sealedManifestSha256 === point.sealedManifestSha256 && dependency.basePoint?.plaintextManifestSha256 === point.plaintextManifestSha256
      && dependency.basePoint?.cipherInventorySha256 === point.cipherInventorySha256 && dependency.deploymentId === metadata.deploymentId && dependency.releaseId === metadata.releaseId);
    need(Array.isArray(dependency.files) && Array.isArray(dependency.objects));
    for (const row of [...dependency.files, ...dependency.objects]) {
      need(hex(row.sha256) && Number.isSafeInteger(row.bytes) && row.bytes >= 0 && row.bytes <= 1024 ** 3);
      await read(prefix + safeRelative(row.relativePath), row.bytes, row);
    }
    for (const [file, checksum] of [[dependency.originalDependencyFile, dependency.originalDependencySha256], [dependency.custodyFile, dependency.custodySha256]]) {
      need(hex(checksum)); if (files.has(prefix + file)) need(files.get(prefix + file)!.sha256 === checksum);
      else await read(prefix + safeRelative(file), undefined, { sha256: checksum });
    }
    need(dependency.certificateFile === 'certificate.json' && files.get(prefix + 'certificate.json')?.sha256 === dependency.certificateSha256);
    verifyOnlineRecoveryWindow(dependency, { requestRaw: await readAgain(prefix + 'request.json', 1024 * 1024), sealRaw: await readAgain(prefix + 'seal.json', 1024 * 1024), captureRaw: await readAgain(prefix + 'capture.json', 1024 * 1024), certificateRaw: await readAgain(prefix + 'certificate.json', 1024 * 1024) }, key.raw!);
    const row = { requestSha256: entry.name, dependencySha256: files.get(prefix + 'dependency.json')!.sha256 }; windows.push(row);
    windowBindings.push({ ...row, windowSha256: dependency.windowSha256, certificateSha256: dependency.certificateSha256, originalDependencySha256: dependency.originalDependencySha256 });
  }
  verifyOnlineInitialWalWindows(point.initialWalWindows, windowBindings, point.captureId);
  let terminal = false;
  try {
    const terminalRaw = await readOriginal(path.join(absolute, 'terminal-coverage.json'), 2 * 1024 ** 2, true);
    const accepted = JSON.parse(terminalRaw.raw!.toString());
    need(accepted.format === 'sabalan-accepted-online-terminal-coverage/v1');
    const d = verifyOnlineRecoveryCertificate(encode(accepted.envelope), key.raw!, 'sabalan-original-online-terminal-coverage/v1', 'sabalan-signed-online-terminal-coverage/v1', accepted.acceptedAt);
    need(d.captureId === point.captureId && d.pointIndexSha256 === files.get('point.json')!.sha256
      && d.canonicalMetadataSha256 === point.canonicalMetadataSha256 && hex(d.terminalResultSha256)
      && hex(d.terminalEpochSha256) && hex(d.publicationSha256));
    equal(d.sourceDatabase, point.sourceDatabase);
    const terminalResultRaw = await readOriginal(path.join(absolute, 'terminal-result.json'), 4 * 1024 ** 2, true);
    need(terminalResultRaw.sha256 === d.terminalResultSha256); verifyOnlineRecoveryTerminal(terminalResultRaw.raw!, d, point, windowBindings);
    files.set('terminal-result.json', { pin: terminalResultRaw.pin, bytes: terminalResultRaw.bytes, sha256: terminalResultRaw.sha256 });
    equal([...d.windows].sort((a: any, b: any) => a.requestSha256.localeCompare(b.requestSha256)), windows.sort((a, b) => a.requestSha256.localeCompare(b.requestSha256)));
    files.set('terminal-coverage.json', { pin: terminalRaw.pin, bytes: terminalRaw.bytes, sha256: terminalRaw.sha256 }); terminal = true;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const inventory = async (folder: string, relative = ''): Promise<void> => {
    const stat = await fs.promises.lstat(folder, { bigint: true }); need(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o022n) === 0n);
    directories.set(relative, pin(stat));
    for (const entry of await fs.promises.readdir(folder, { withFileTypes: true })) {
      const name = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isDirectory()) { need([...files.keys()].some(file => file.startsWith(name + '/')) || name === 'wal-windows'); await inventory(path.join(folder, entry.name), name); }
      else need(entry.isFile() && !entry.isSymbolicLink() && files.has(name));
    }
  };
  await inventory(absolute);
  const evidence: OnlineDirectoryEvidence = Object.freeze({ format: 'sabalan-verified-online-directory/v1' });
  originals.set(evidence, { root: absolute, files, directories, metadata, terminal, pointIndexSha256: files.get('point.json')!.sha256 });
  await assertOnlineCheckpointDirectoryUnchanged(evidence);
  return { metadata, metadataPath: path.join(absolute, point.canonicalMetadataFile), directory: absolute, evidence };
}

export function hasHealthyOnlineDirectory(evidence: unknown, artifact: { id: string; releaseId: string; checksum?: string; size: number }) {
  const state = evidence && typeof evidence === 'object' ? originals.get(evidence as OnlineDirectoryEvidence) : undefined;
  return !!state && ['id', 'releaseId', 'checksum', 'size'].every(field => state.metadata[field] === (artifact as any)[field]);
}
export function canRetireOnlineDirectory(evidence: unknown) { return !!(evidence && typeof evidence === 'object' && originals.get(evidence as OnlineDirectoryEvidence)?.terminal); }
export async function assertOnlineCheckpointDirectoryUnchanged(evidence: OnlineDirectoryEvidence) {
  const state = originals.get(evidence); need(state);
  for (const [relative, expected] of state.directories) need(pin(await fs.promises.lstat(path.join(state.root, relative), { bigint: true })) === expected);
  for (const [relative, expected] of state.files) {
    const actual = await readOriginal(path.join(state.root, relative), expected.bytes);
    need(actual.pin === expected.pin && actual.bytes === expected.bytes && actual.sha256 === expected.sha256);
  }
}
/** No recursive removal: an added file or a changed directory aborts before the
 * first unlink. The caller must hold the documented repository storage lock. */
export async function removeVerifiedOnlineCheckpointDirectory(evidence: OnlineDirectoryEvidence) {
  const state = originals.get(evidence); need(state?.terminal); await assertOnlineCheckpointDirectoryUnchanged(evidence);
  for (const relative of [...state.files.keys()].sort((a, b) => Number(a === 'point.json') - Number(b === 'point.json'))) {
    const file = path.join(state.root, relative); need(pin(await fs.promises.lstat(file, { bigint: true })) === state.files.get(relative)!.pin);
    await fs.promises.unlink(file);
  }
  for (const relative of [...state.directories.keys()].sort((a, b) => b.length - a.length)) await fs.promises.rmdir(path.join(state.root, relative));
}
