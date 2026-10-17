'use strict';
// Private component preparation only. This cannot publish a healthy recovery
// point, prune dependencies, switch a release or certify application coherence.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { encryptRecoveryArchiveForRecipients, decryptRecoveryArchive, sha256File } = require('/app/dist/services/recoveryCrypto');
process.umask(0o077);
const check = (value, code) => { if (!value) throw Object.assign(new Error(code), { code }); };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const identity = value => [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].map(String).join(':');
function sync(file) { const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function privateFile(file, maximum) {
  check(fs.realpathSync(file) === file, 'PRIVATE_PATH_REQUIRED');
  const value = fs.lstatSync(file, { bigint: true });
  check(value.isFile() && value.nlink === 1n && value.uid === BigInt(process.getuid()) && !(value.mode & 0o077n)
    && value.size > 0n && value.size <= BigInt(maximum), 'PRIVATE_FILE_REQUIRED');
  return value;
}
function read(file, maximum) {
  const before = privateFile(file, maximum);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    check(identity(fs.fstatSync(fd, { bigint: true })) === identity(before), 'PRIVATE_FILE_CHANGED');
    const bytes = Buffer.alloc(Number(before.size)); let offset = 0;
    while (offset < bytes.length) { const count = fs.readSync(fd, bytes, offset, bytes.length - offset, null); check(count > 0, 'PRIVATE_FILE_CHANGED'); offset += count; }
    check(identity(fs.fstatSync(fd, { bigint: true })) === identity(before) && identity(privateFile(file, maximum)) === identity(before), 'PRIVATE_FILE_CHANGED');
    fs.fsyncSync(fd); return bytes;
  } finally { fs.closeSync(fd); }
}
async function main() {
  check(process.platform === 'linux' && process.argv.length === 4, 'PRIVATE_COMPONENT_ARGUMENTS_REQUIRED');
  const [root, expectedProof] = process.argv.slice(2);
  check(/^\/app\/online-runtime-acceptance\/base-stream-chain-[a-f0-9]{32}$/.test(root)
    && fs.realpathSync(root) === root && /^[a-f0-9]{64}$/.test(expectedProof), 'PRIVATE_COMPONENT_ROOT_REQUIRED');
  const directory = fs.lstatSync(root); check(directory.isDirectory() && directory.uid === process.getuid() && !(directory.mode & 0o077), 'PRIVATE_COMPONENT_ROOT_REQUIRED');
  const held = fs.fstatSync(9, { bigint: true }), named = fs.lstatSync(root + '/seal.lock', { bigint: true });
  check(named.isFile() && named.nlink === 1n && named.uid === BigInt(process.getuid()) && !(named.mode & 0o077n)
    && held.dev === named.dev && held.ino === named.ino, 'PRIVATE_COMPONENT_LOCK_REQUIRED');
  check(fs.readFileSync('/proc/self/fdinfo/9', 'utf8').split('\n').some(row =>
    new RegExp('^lock:\\s+\\d+:\\s+FLOCK\\s+ADVISORY\\s+WRITE\\s+\\S+\\s+[0-9a-f]+:[0-9a-f]+:' + named.ino + '\\s+0\\s+EOF\\s*$').test(row)), 'PRIVATE_COMPONENT_LOCK_REQUIRED');
  const proofBytes = read(root + '/source-proof.json', 65536), proof = JSON.parse(proofBytes);
  check(hash(proofBytes) === expectedProof && proof.nativeBaseStreamChainPassed === true
    && root.endsWith(proof.operation) && /^[a-f0-9]{32}$/.test(proof.operation)
    && proof.temporaryDatabaseDroppedWithoutForce === true, 'PRIVATE_SOURCE_PROOF_CHANGED');
  const manifestBytes = read(root + '/backup_manifest', 32 * 1024 ** 2);
  check(hash(manifestBytes) === proof.manifestSha256, 'PRIVATE_BASE_MANIFEST_CHANGED');
  const manifest = JSON.parse(manifestBytes);
  check(manifest['PostgreSQL-Backup-Manifest-Version'] === 1 && manifest['WAL-Ranges'].length === 1
    && JSON.stringify(manifest['WAL-Ranges'][0]) === JSON.stringify(proof.baseRange), 'PRIVATE_BASE_RANGE_CHANGED');
  const inputs = [{ name: 'source-proof.json', bytes: proofBytes.length, sha256: expectedProof },
    { name: 'backup_manifest', bytes: manifestBytes.length, sha256: proof.manifestSha256 },
    { name: 'base.tar.gz', bytes: proof.archiveBytes, sha256: proof.archiveSha256 },
    ...proof.segments.map(row => ({ name: 'wal/' + row.name, bytes: row.bytes, sha256: row.sha256 }))];
  check(proof.segments.length === 8 && inputs.every(row =>
    /^[a-f0-9]{64}$/.test(row.sha256) && Number.isSafeInteger(row.bytes) && row.bytes > 0 && row.bytes <= 3 * 1024 ** 3
    && (['source-proof.json', 'backup_manifest', 'base.tar.gz'].includes(row.name) || /^wal\/[0-9A-F]{24}$/.test(row.name))), 'PRIVATE_INPUTS_INVALID');
  const publicKey = crypto.createPublicKey(read(root + '/independent-public.pem', 65536));
  const publicSha256 = hash(publicKey.export({ type: 'spki', format: 'der' }));
  check(publicSha256 === '455e5a7ba5990866ca6992c0fd177fa0df5b22b5d3e985c41ee306e3a779b8af', 'PRIVATE_RSA_AUTHORITY_CHANGED');
  const localKey = read(root + '/test-local-rollback-key', 65536).toString('utf8'); check(localKey.length >= 32, 'PRIVATE_LOCAL_AUTHORITY_REQUIRED');
  const available = fs.statfsSync(root, { bigint: true });
  const total = inputs.reduce((sum, row) => sum + BigInt(row.bytes), 0n);
  check(available.bavail * available.bsize > total + 64n * 1024n ** 2n + 536870912n, 'PRIVATE_SEAL_CAPACITY_REQUIRED');
  const destination = root + '/sealed'; fs.mkdirSync(destination, { mode: 0o700 });
  const active = { format: 'sabalan-private-physical-chain/v1', phase: 'ACTIVE', sourceProofSha256: expectedProof,
    operation: proof.operation, independentPublicKeySha256: publicSha256, localKeyIsTestAuthority: true };
  const stateFile = destination + '/seal-state.json';
  fs.writeFileSync(stateFile, JSON.stringify(active), { flag: 'wx', mode: 0o600 }); sync(stateFile); sync(destination); sync(root); sync(path.dirname(root));
  const files = []; let sequence = 0;
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  for (const input of inputs) {
    const file = root + '/' + input.name, original = privateFile(file, input.bytes);
    check(original.size === BigInt(input.bytes), 'PRIVATE_SOURCE_SIZE_CHANGED');
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const whole = crypto.createHash('sha256'), chunks = []; let copied = 0;
    try {
      check(identity(fs.fstatSync(fd, { bigint: true })) === identity(original), 'PRIVATE_SOURCE_CHANGED');
      while (copied < input.bytes) {
        const buffer = Buffer.alloc(Math.min(16 * 1024 ** 2, input.bytes - copied)); let offset = 0;
        while (offset < buffer.length) { const count = fs.readSync(fd, buffer, offset, buffer.length - offset, null); check(count > 0, 'PRIVATE_SOURCE_CHANGED'); offset += count; }
        copied += buffer.length; whole.update(buffer);
        const plaintext = root + '/chunk-working.bin', restored = root + '/chunk-local-check.bin';
        fs.writeFileSync(plaintext, buffer, { flag: 'wx', mode: 0o600 }); sync(plaintext);
        const name = 'chunk-' + String(sequence++).padStart(6, '0') + '.sabrec', encrypted = destination + '/' + name;
        await encryptRecoveryArchiveForRecipients(plaintext, encrypted, [
          { keyId: 'local-rollback', passphrase: localKey }, { keyId: 'independent-recovery', publicKeyPem },
        ]);
        sync(encrypted); await decryptRecoveryArchive(encrypted, restored, localKey);
        const rawSha256 = hash(buffer);
        check(await sha256File(restored) === rawSha256 && fs.statSync(restored).size === buffer.length, 'PRIVATE_LOCAL_DECRYPT_MISMATCH');
        chunks.push({ name, rawBytes: buffer.length, rawSha256, encryptedBytes: fs.statSync(encrypted).size,
          encryptedSha256: await sha256File(encrypted), localDecryptVerified: true });
        fs.unlinkSync(plaintext); fs.unlinkSync(restored); sync(root); sync(destination);
        const current = fs.statfsSync(root, { bigint: true }); check(current.bavail * current.bsize > 536870912n, 'PRIVATE_SEAL_CAPACITY_LOST');
      }
      check(whole.digest('hex') === input.sha256 && identity(fs.fstatSync(fd, { bigint: true })) === identity(original)
        && identity(privateFile(file, input.bytes)) === identity(original), 'PRIVATE_SOURCE_CHANGED');
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    files.push({ ...input, chunks });
  }
  check(read(root + '/source-proof.json', 65536).equals(proofBytes), 'PRIVATE_SOURCE_PROOF_CHANGED');
  check(read(stateFile, 65536).equals(Buffer.from(JSON.stringify(active))), 'PRIVATE_SEAL_STATE_CHANGED');
  const result = { ...active, phase: 'SEALED', files, codecSha256: hash(fs.readFileSync(require.resolve('/app/dist/services/recoveryCrypto'))) };
  const temporary = destination + '/seal-complete.json'; fs.writeFileSync(temporary, JSON.stringify(result), { flag: 'wx', mode: 0o600 }); sync(temporary);
  fs.renameSync(temporary, stateFile); sync(destination); process.stdout.write(JSON.stringify(result) + '\n');
}
main().catch(error => { process.stderr.write((/^[A-Z_]+$/.test(error.code || '') ? error.code : 'PRIVATE_PHYSICAL_SEAL_FAILED') + '\n'); process.exitCode = 1; });
