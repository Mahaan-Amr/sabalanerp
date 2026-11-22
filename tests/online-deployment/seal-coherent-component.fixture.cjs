'use strict';
// Small diagnostic package only. Cannot publish/prune a production checkpoint.
const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
process.umask(0o077);
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
function sync(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function read(file, maximum) {
  assert.equal(fs.realpathSync(file), file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const identity = value => [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].map(String).join(':');
    const before = fs.fstatSync(fd, { bigint: true });
    assert.ok(before.isFile() && before.uid === BigInt(process.getuid()) && before.nlink === 1n
      && !(before.mode & 0o077n) && before.size > 0n && before.size <= BigInt(maximum));
    const bytes = fs.readFileSync(fd);
    assert.equal(bytes.length, Number(before.size));
    assert.equal(identity(fs.fstatSync(fd, { bigint: true })), identity(before));
    assert.equal(identity(fs.lstatSync(file, { bigint: true })), identity(before));
    fs.fsyncSync(fd);
    return bytes;
  } finally { fs.closeSync(fd); }
}
async function main() {
  const [root, expectedProof] = process.argv.slice(2);
  assert.equal(process.platform, 'linux');
  assert.match(root, /^\/app\/online-runtime-acceptance\/coherent-seal-[a-f0-9]{32}$/);
  assert.equal(fs.realpathSync(root), root);
  const directory = fs.lstatSync(root);
  assert.ok(directory.isDirectory() && directory.uid === process.getuid() && !(directory.mode & 0o077));
  const held = fs.fstatSync(9, { bigint: true }), named = fs.lstatSync(root + '/seal.lock', { bigint: true });
  assert.ok(named.isFile() && named.nlink === 1n && named.uid === BigInt(process.getuid()) && !(named.mode & 0o077n)
    && held.dev === named.dev && held.ino === named.ino);
  assert.ok(fs.readFileSync('/proc/self/fdinfo/9', 'utf8').split('\n').some(row =>
    new RegExp('^lock:\\s+\\d+:\\s+FLOCK\\s+ADVISORY\\s+WRITE\\s+\\S+\\s+[0-9a-f]+:[0-9a-f]+:' + named.ino + '\\s+0\\s+EOF\\s*$').test(row)));
  const proofBytes = read(root + '/package-proof.json', 65536), proof = JSON.parse(proofBytes);
  assert.equal(hash(proofBytes), expectedProof);
  assert.equal(proof.format, 'sabalan-private-coherent-package/v1');
  assert.equal(proof.productionRecoveryPoint, false);
  const plaintext = read(root + '/component.tar', 64 * 1024 ** 2);
  assert.equal(hash(plaintext), proof.packageSha256);
  assert.equal(plaintext.length, proof.packageBytes);
  const publicKey = crypto.createPublicKey(read(root + '/independent-public.pem', 65536));
  const publicSha = hash(publicKey.export({ type: 'spki', format: 'der' }));
  assert.equal(publicSha, '455e5a7ba5990866ca6992c0fd177fa0df5b22b5d3e985c41ee306e3a779b8af');
  const codecPath = root + '/recoveryCrypto.cjs';
  const codecSha = hash(read(codecPath, 1024 ** 2));
  const { encryptRecoveryArchiveForRecipients, decryptRecoveryArchive, sha256File } = require(codecPath);
  const testKey = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(root + '/test-local-rollback-key', testKey, { flag: 'wx', mode: 0o400 });
  sync(root + '/test-local-rollback-key');
  const active = { format: 'sabalan-private-coherent-seal/v1', phase: 'ACTIVE', productionRecoveryPoint: false,
    packageProofSha256: expectedProof, independentPublicKeySha256: publicSha, localKeyIsTestAuthority: true, codecSha256: codecSha };
  fs.writeFileSync(root + '/seal-intent.json', JSON.stringify(active), { flag: 'wx', mode: 0o400 });
  sync(root + '/seal-intent.json'); sync(root);
  const encrypted = root + '/component.sabrec', checked = root + '/local-readback.tar';
  await encryptRecoveryArchiveForRecipients(root + '/component.tar', encrypted, [
    { keyId: 'local-rollback', passphrase: testKey },
    { keyId: 'independent-recovery', publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() },
  ]);
  sync(encrypted);
  await decryptRecoveryArchive(encrypted, checked, testKey);
  assert.equal(await sha256File(checked), proof.packageSha256);
  sync(checked);
  const encoded = read(encrypted, 65 * 1024 ** 2), damaged = Buffer.from(encoded);
  damaged[damaged.length - 32] ^= 1;
  fs.writeFileSync(root + '/damaged.sabrec', damaged, { flag: 'wx', mode: 0o400 });
  await assert.rejects(() => decryptRecoveryArchive(root + '/damaged.sabrec', root + '/damaged-readback.tar', testKey));
  assert.equal(fs.existsSync(root + '/damaged-readback.tar'), false);
  assert.equal(hash(read(encrypted, 65 * 1024 ** 2)), hash(encoded));
  assert.deepEqual(read(root + '/package-proof.json', 65536), proofBytes);
  assert.equal(hash(read(root + '/component.tar', 64 * 1024 ** 2)), proof.packageSha256);
  const result = { ...active, phase: 'SEALED', encryptedBytes: encoded.length, encryptedSha256: hash(encoded),
    packageSha256: proof.packageSha256, packageBytes: proof.packageBytes, localReadbackVerified: true, corruptionRejected: true };
  fs.writeFileSync(root + '/seal-proof.json', JSON.stringify(result), { flag: 'wx', mode: 0o400 });
  sync(root + '/seal-proof.json'); sync(root);
  process.stdout.write(JSON.stringify(result) + '\n');
}
main().catch(() => { process.stderr.write('PRIVATE_COHERENT_SEAL_FAILED\n'); process.exitCode = 1; });
