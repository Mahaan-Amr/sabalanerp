#!/usr/bin/env node
'use strict';
// Encryption of a closed private WAL component. No remote publication, pruning,
// recovery-point certification or production admission is granted here.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
process.umask(0o077);
const requireValue = (value, code) => { if (!value) throw Object.assign(new Error(code), { code }); };
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const identity = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':');
function privateStat(file, maximum) {
  requireValue(path.isAbsolute(file) && fs.realpathSync(file) === file, 'WAL_SEAL_PATH_INVALID');
  const value = fs.lstatSync(file, { bigint: true });
  requireValue(value.isFile() && value.nlink === 1n && value.uid === BigInt(process.getuid())
    && !(value.mode & 0o077n) && value.size > 0n && value.size <= BigInt(maximum), 'WAL_SEAL_PRIVATE_FILE_REQUIRED');
  return value;
}
function privateRead(file, maximum) {
  const named = privateStat(file, maximum);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    requireValue(identity(fs.fstatSync(fd, { bigint: true })) === identity(named), 'WAL_SEAL_FILE_CHANGED');
    const bounded = Buffer.alloc(maximum + 1);
    let count = 0, read;
    while (count <= maximum && (read = fs.readSync(fd, bounded, count, bounded.length - count, null))) count += read;
    requireValue(count <= maximum && BigInt(count) === named.size, 'WAL_SEAL_FILE_CHANGED');
    const bytes = bounded.subarray(0, count);
    requireValue(identity(fs.fstatSync(fd, { bigint: true })) === identity(named)
      && identity(fs.lstatSync(file, { bigint: true })) === identity(named), 'WAL_SEAL_FILE_CHANGED');
    // In particular, the retained local key's bytes must survive alongside a
    // durable SEALED receipt. Syncing its containing directory is insufficient.
    fs.fsyncSync(fd);
    return bytes;
  } finally { fs.closeSync(fd); }
}
function sync(file) { const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function privateDirectory(root) {
  requireValue(path.isAbsolute(root) && fs.realpathSync(root) === root, 'WAL_SEAL_ROOT_INVALID');
  const value = fs.lstatSync(root);
  requireValue(value.isDirectory() && value.uid === process.getuid() && !(value.mode & 0o077), 'WAL_SEAL_ROOT_INVALID');
}
async function main() {
  requireValue(process.platform === 'linux' && process.argv.length === 5, 'WAL_SEAL_LINUX_ARGUMENTS_REQUIRED');
  const [root, localKeyFile, publicKeyFile] = process.argv.slice(2);
  privateDirectory(root); privateDirectory(root + '/wal');
  const inherited = fs.fstatSync(9, { bigint: true }), named = fs.lstatSync(root + '/receiver.lock', { bigint: true });
  requireValue(named.isFile() && named.nlink === 1n && named.uid === BigInt(process.getuid()) && !(named.mode & 0o022n)
    && inherited.dev === named.dev && inherited.ino === named.ino, 'WAL_SEAL_LOCK_REQUIRED');
  requireValue(fs.readFileSync('/proc/self/fdinfo/9', 'utf8').split('\n').some(row =>
    new RegExp('^lock:\\s+\\d+:\\s+FLOCK\\s+ADVISORY\\s+WRITE\\s+\\S+\\s+[0-9a-f]+:[0-9a-f]+:' + named.ino + '\\s+0\\s+EOF\\s*$').test(row)), 'WAL_SEAL_LOCK_REQUIRED');
  const captureFile = root + '/capture-state.json', configurationFile = root + '/configuration.json';
  const captureBytes = privateRead(captureFile, 65536), capture = JSON.parse(captureBytes);
  const configurationBytes = privateRead(configurationFile, 32768), configuration = JSON.parse(configurationBytes);
  requireValue(capture.phase === 'COMPLETE' && capture.nativeReaped === true && capture.databaseQuiet === true && capture.nativeStatus === 0
    && /^sabalan-wal-[a-f0-9]{32}$/.test(capture.namespace) && capture.namespace === configuration.namespace
    && configuration.root === root && capture.configurationSha256 === sha(configurationBytes), 'WAL_SEAL_CLOSED_CAPTURE_REQUIRED');
  for (const key of ['databaseName', 'databaseOid', 'systemIdentifier', 'timeline', 'segmentBytes']) {
    requireValue(capture.source[key] === configuration[key], 'WAL_SEAL_SOURCE_CHANGED');
  }
  requireValue(capture.startLsn === configuration.startLsn && capture.endLsn === configuration.endLsn, 'WAL_SEAL_RANGE_CHANGED');
  const { postgresWalSegments, verifyWalSegmentFiles } = await import('../../scripts/postgres-recovery-coverage.mjs');
  const range = { startLsn: capture.startLsn, endLsn: capture.endLsn, timeline: capture.source.timeline, segmentBytes: capture.source.segmentBytes };
  requireValue(postgresWalSegments(range).length <= 8, 'WAL_SEAL_RANGE_TOO_LARGE');
  await verifyWalSegmentFiles(root + '/wal', range, capture.segments);
  const localKey = privateRead(localKeyFile, 65536).toString('utf8');
  requireValue(localKey.length >= 32, 'WAL_SEAL_LOCAL_AUTHORITY_REQUIRED');
  const publicKey = crypto.createPublicKey(privateRead(publicKeyFile, 65536));
  requireValue(publicKey.asymmetricKeyType === 'rsa' && publicKey.asymmetricKeyDetails.modulusLength >= 2048, 'WAL_SEAL_RSA_AUTHORITY_REQUIRED');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const independentPublicKeySha256 = sha(publicKey.export({ type: 'spki', format: 'der' }));
  const sources = [{ file: captureFile, name: 'capture.sabrec', sha256: sha(captureBytes), bytes: captureBytes.length },
    ...capture.segments.map(row => ({ file: root + '/wal/' + row.name, name: row.name + '.sabrec', sha256: row.sha256, bytes: row.bytes }))];
  const space = fs.statfsSync(root, { bigint: true });
  const total = sources.reduce((sum, row) => sum + BigInt(row.bytes), 0n);
  requireValue(space.bavail * space.bsize >= total * 3n + 536870912n, 'WAL_SEAL_CAPACITY_REQUIRED');
  const destination = root + '/sealed'; fs.mkdirSync(destination, { mode: 0o700 });
  const stateFile = destination + '/seal-state.json';
  const active = { format: 'sabalan-wal-seal/v1', phase: 'ACTIVE', namespace: capture.namespace,
    captureSha256: sha(captureBytes), independentPublicKeySha256 };
  fs.writeFileSync(stateFile, JSON.stringify(active), { flag: 'wx', mode: 0o600 });
  sync(stateFile); sync(destination); sync(root); sync(path.dirname(root));
  const { encryptRecoveryArchiveForRecipients, decryptRecoveryArchive, sha256File } = require('/app/dist/services/recoveryCrypto');
  const objects = [];
  for (const source of sources) {
    const observed = privateStat(source.file, source.bytes);
    requireValue(observed.size === BigInt(source.bytes) && await sha256File(source.file) === source.sha256, 'WAL_SEAL_SOURCE_CHANGED');
    const encrypted = destination + '/' + source.name;
    await encryptRecoveryArchiveForRecipients(source.file, encrypted, [
      { keyId: 'local-rollback', passphrase: localKey }, { keyId: 'independent-recovery', publicKeyPem },
    ]);
    sync(encrypted);
    const restored = encrypted + '.local-check';
    await decryptRecoveryArchive(encrypted, restored, localKey);
    requireValue(await sha256File(restored) === source.sha256 && fs.statSync(restored).size === source.bytes,
      'WAL_SEAL_LOCAL_DECRYPT_MISMATCH');
    requireValue(identity(privateStat(source.file, source.bytes)) === identity(observed), 'WAL_SEAL_SOURCE_CHANGED');
    const cipher = privateStat(encrypted, source.bytes + 65536);
    objects.push({ name: source.name, rawSha256: source.sha256, rawBytes: source.bytes,
      encryptedSha256: await sha256File(encrypted), encryptedBytes: Number(cipher.size), localDecryptVerified: true });
    fs.unlinkSync(restored); sync(destination);
  }
  await verifyWalSegmentFiles(root + '/wal', range, capture.segments);
  requireValue(privateRead(captureFile, 65536).equals(captureBytes)
    && privateRead(configurationFile, 32768).equals(configurationBytes), 'WAL_SEAL_CAPTURE_CHANGED');
  requireValue(privateRead(stateFile, 65536).equals(Buffer.from(JSON.stringify(active))), 'WAL_SEAL_STATE_CHANGED');
  const result = { ...active, phase: 'SEALED', range, source: capture.source, objects };
  const temporary = destination + '/seal-complete.json';
  fs.writeFileSync(temporary, JSON.stringify(result), { flag: 'wx', mode: 0o600 }); sync(temporary);
  fs.renameSync(temporary, stateFile); sync(destination);
  process.stdout.write(JSON.stringify(result) + '\n');
}
main().catch(error => { process.stderr.write((/^WAL_SEAL_[A-Z_]+$/.test(error.code || '') ? error.code : 'WAL_SEAL_FAILED') + '\n'); process.exitCode = 1; });
