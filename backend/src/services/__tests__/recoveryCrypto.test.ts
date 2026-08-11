import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decryptRecoveryArchive, encryptRecoveryArchive, encryptRecoveryArchiveForRecipients } from '../recoveryCrypto';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-recovery-crypto-'));
const source = path.join(root, 'source.bin');
const encrypted = path.join(root, 'encrypted.sabrec');
const restored = path.join(root, 'restored.bin');
const wrong = path.join(root, 'wrong.bin');
const envelope = path.join(root, 'envelope.sabrec');
const localRestored = path.join(root, 'local-restored.bin');
const remoteRestored = path.join(root, 'remote-restored.bin');
const tamperedEnvelope = path.join(root, 'tampered-envelope.sabrec');

const main = async () => {
  try {
    const remoteKeyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const remotePublicKey = remoteKeyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const remotePrivateKey = remoteKeyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const content = Buffer.concat([Buffer.from('Sabalan recovery test\n'), Buffer.alloc(256 * 1024, 7)]);
    fs.writeFileSync(source, content);
    await encryptRecoveryArchive(source, encrypted, 'StoneRecovery2026');
    assert.notDeepEqual(fs.readFileSync(encrypted).subarray(0, 16), content.subarray(0, 16));
    await decryptRecoveryArchive(encrypted, restored, 'StoneRecovery2026');
    assert.deepEqual(fs.readFileSync(restored), content);
    await assert.rejects(
      decryptRecoveryArchive(encrypted, wrong, 'WrongRecovery2026'),
      (error: any) => error.code === 'RECOVERY_DECRYPTION_FAILED',
    );

    await encryptRecoveryArchiveForRecipients(source, envelope, [
      { keyId: 'local-rollback', passphrase: 'LocalRollback2026' },
      { keyId: 'remote-recovery', publicKeyPem: remotePublicKey },
    ]);
    await decryptRecoveryArchive(envelope, localRestored, 'LocalRollback2026');
    await decryptRecoveryArchive(envelope, remoteRestored, remotePrivateKey);
    assert.deepEqual(fs.readFileSync(localRestored), content);
    assert.deepEqual(fs.readFileSync(remoteRestored), content);
    const changedEnvelope = fs.readFileSync(envelope);
    changedEnvelope[Math.floor(changedEnvelope.length / 2)] ^= 1;
    fs.writeFileSync(tamperedEnvelope, changedEnvelope);
    await assert.rejects(
      decryptRecoveryArchive(tamperedEnvelope, path.join(root, 'tampered-envelope.bin'), remotePrivateKey),
      (error: any) => error.code === 'RECOVERY_DECRYPTION_FAILED',
    );
    const tampered = fs.readFileSync(encrypted);
    tampered[Math.floor(tampered.length / 2)] ^= 1;
    fs.writeFileSync(encrypted, tampered);
    await assert.rejects(
      decryptRecoveryArchive(encrypted, wrong, 'StoneRecovery2026'),
      (error: any) => error.code === 'RECOVERY_DECRYPTION_FAILED',
    );
    console.log('recoveryCrypto tests passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
