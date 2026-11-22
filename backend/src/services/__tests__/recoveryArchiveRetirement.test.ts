import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-recovery-archive-retirement-'));
process.env.RECOVERY_STORAGE_DIR = path.join(root, 'recovery');
process.env.RECOVERY_COORDINATION_DIR = path.join(root, 'coordination');
const sha = (raw: Buffer) => crypto.createHash('sha256').update(raw).digest('hex');

async function main() {
  const { validateRecoveryPackage } = await import('../systemRecoveryEngine');
  const { encryptRecoveryArchive } = await import('../recoveryCrypto');
  // This test targets actual archive extraction + component verification. The
  // only SQL port is a fixed version observation; no database restore or HEALTHY
  // application point is manufactured by these archive-only cases.
  const prisma = { $queryRawUnsafe: async (query: string) => {
    assert.equal(query, 'SHOW server_version'); return [{ version: '16.4' }];
  } } as any;
  const passphrase = 'OwnedArchiveRegression2026';
  const originalRead = fs.promises.readFile;
  let manifestReads = 0;
  (fs.promises as any).readFile = async (...args: any[]) => {
    const file = String(args[0]);
    if (file.endsWith(path.join('payload', 'manifest.json')) && file.startsWith(process.env.RECOVERY_STORAGE_DIR!)) {
      manifestReads += 1;
      assert.equal(fs.existsSync(path.join(path.dirname(path.dirname(file)), 'payload.tar.gz')), false,
        'owned decrypted compressed archive must retire after complete extraction, before validation/restoration');
    }
    return (originalRead as any)(...args);
  };
  try {
    const payload = path.join(root, 'source');
    fs.mkdirSync(path.join(payload, 'database'), { recursive: true });
    fs.mkdirSync(path.join(payload, 'inquiry'), { recursive: true });
    const bytes = Buffer.from([0, 255, 13, 10, 42]);
    fs.writeFileSync(path.join(payload, 'database/main.dump'), bytes);
    fs.writeFileSync(path.join(payload, 'inquiry/inquiry.db'), bytes);
    const manifest = { format: 'sabalan-recovery', formatVersion: 1, packageType: 'COMPLETE', appVersion: '1.0.0', postgresVersion: '16.4',
      components: ['database/main.dump', 'inquiry/inquiry.db'].map(file => ({ path: file, size: bytes.length, sha256: sha(bytes) })) };
    async function encrypted(name: string, invalidDigest = false) {
      const value = structuredClone(manifest);
      if (invalidDigest) value.components[0].sha256 = 'f'.repeat(64);
      fs.writeFileSync(path.join(payload, 'manifest.json'), JSON.stringify(value));
      const archive = path.join(root, name + '.tar.gz'), source = path.join(root, name + '.sabrec');
      execFileSync('tar', ['-czf', archive, '-C', payload, '.']);
      await encryptRecoveryArchive(archive, source, passphrase);
      return { source, sourceSha256: sha(fs.readFileSync(source)) };
    }
    const valid = await encrypted('valid');
    const result = await validateRecoveryPackage({ sourcePath: valid.source, passphrase, prisma, verifyRestore: false });
    assert.deepEqual(result.manifest.components, manifest.components);
    assert.equal(sha(fs.readFileSync(valid.source)), valid.sourceSha256);
    const tampered = await encrypted('bad-component', true);
    await assert.rejects(validateRecoveryPackage({ sourcePath: tampered.source, passphrase, prisma, verifyRestore: false }),
      (error: any) => error.code === 'RECOVERY_INTEGRITY_FAILED');
    assert.equal(sha(fs.readFileSync(tampered.source)), tampered.sourceSha256);
    const invalid = path.join(root, 'invalid.tar.gz'), source = path.join(root, 'invalid.sabrec');
    fs.writeFileSync(invalid, 'not a complete gzip archive');
    await encryptRecoveryArchive(invalid, source, passphrase);
    const before = sha(fs.readFileSync(source)), reads = manifestReads;
    await assert.rejects(validateRecoveryPackage({ sourcePath: source, passphrase, prisma, verifyRestore: false }));
    assert.equal(manifestReads, reads, 'failed extraction cannot proceed into validation or false success');
    assert.equal(sha(fs.readFileSync(source)), before);
    assert.equal(manifestReads, 2);
    assert.deepEqual(fs.readdirSync(path.join(process.env.RECOVERY_STORAGE_DIR!, 'work')), []);
    console.log('recovery archive retirement actual extraction/integrity/failure tests passed');
  } finally {
    fs.promises.readFile = originalRead;
    assert.ok(root.startsWith(os.tmpdir() + path.sep) && path.basename(root).startsWith('sabalan-recovery-archive-retirement-'));
    fs.rmSync(root, { recursive: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
