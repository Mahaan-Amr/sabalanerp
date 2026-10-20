import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { decryptRecoveryArchive, encryptRecoveryArchive, encryptRecoveryArchiveForRecipients } from '../recoveryCrypto';

for (const version of [1, 2]) test(`empty user file authenticates and restores through recovery envelope v${version}`, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sabalan-empty-recovery-'));
  try {
    const source = path.join(root, 'empty.bin'), cipher = path.join(root, 'empty.sabrec');
    const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const local = 'isolated-empty-file-test-key';
    await fs.writeFile(source, Buffer.alloc(0));
    if (version === 1) await encryptRecoveryArchive(source, cipher, local);
    else await encryptRecoveryArchiveForRecipients(source, cipher, [{ keyId: 'local', passphrase: local }, { keyId: 'independent', publicKeyPem }]);
    for (const [index, key] of (version === 1 ? [local] : [local, privateKey]).entries()) {
      const restored = path.join(root, `restored-${index}`);
      await decryptRecoveryArchive(cipher, restored, key);
      assert.equal((await fs.stat(restored)).size, 0);
    }
    const good = await fs.readFile(cipher);
    const corrupt = Buffer.from(good); corrupt[corrupt.length - 1] ^= 1;
    const tampered = path.join(root, 'tampered.sabrec'); await fs.writeFile(tampered, corrupt);
    const rejected = path.join(root, 'must-not-survive');
    await assert.rejects(decryptRecoveryArchive(tampered, rejected, local), (error: any) => error.code === 'RECOVERY_DECRYPTION_FAILED');
    await assert.rejects(fs.stat(rejected), (error: any) => error.code === 'ENOENT');
    await assert.rejects(decryptRecoveryArchive(cipher, rejected, 'wrong-test-key'), (error: any) => error.code === 'RECOVERY_DECRYPTION_FAILED');
    const truncated = path.join(root, 'truncated.sabrec'); await fs.writeFile(truncated, good.subarray(0, good.length - 1));
    await assert.rejects(decryptRecoveryArchive(truncated, rejected, local), (error: any) => error.code === 'INVALID_RECOVERY_PACKAGE');
    await assert.rejects(fs.stat(rejected), (error: any) => error.code === 'ENOENT');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
