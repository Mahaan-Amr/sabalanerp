import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { auditArchiveEvidence } from '../lib/accountingArchiveAudit';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const ref = (id: string, storageKey: string, bytes: string) => ({ id, storageKey, contentHash: hash(bytes), sizeBytes: BigInt(Buffer.byteLength(bytes)) });
test('inventory detects legacy-only, missing, corrupt, conflicting and unsafe references', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-inventory-'));
  const protectedRoot = path.join(root, 'protected'); const legacyRoot = path.join(root, 'legacy');
  try {
    await fs.mkdir(protectedRoot); await fs.mkdir(legacyRoot);
    await fs.writeFile(path.join(protectedRoot, 'ok'), 'ok');
    await fs.writeFile(path.join(legacyRoot, 'old'), 'old');
    await fs.writeFile(path.join(protectedRoot, 'bad'), 'changed');
    await fs.writeFile(path.join(protectedRoot, 'conflict'), 'expected');
    await fs.writeFile(path.join(legacyRoot, 'conflict'), 'different');
    const items = [ref('1','ok','ok'),ref('2','old','old'),ref('3','missing','missing'),ref('4','bad','expected'),
      ref('5','conflict','expected'),ref('6','../escape','x')];
    const result = await auditArchiveEvidence(items, { protectedRoot, legacyRoot });
    assert.equal(result.ready, false);
    assert.deepEqual(result.counts, { PROTECTED: 1, LEGACY_ONLY: 1, MISSING: 1, CORRUPT: 1, CONFLICT: 1, UNSAFE: 1 });
    assert.equal((await fs.readFile(path.join(legacyRoot, 'old'))).toString(), 'old');
    assert.equal((await auditArchiveEvidence([ref('1','ok','ok')], { protectedRoot })).ready, true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('a symlinked evidence file is never followed', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-inventory-symlink-'));
  try {
    await fs.writeFile(path.join(root, 'outside'), 'secret');
    await fs.mkdir(path.join(root, 'protected'));
    try { await fs.symlink(path.join(root, 'outside'), path.join(root, 'protected', 'link')); }
    catch (error: any) { if (error?.code === 'EPERM') { context.skip('Windows symlink permission unavailable'); return; } throw error; }
    const result = await auditArchiveEvidence([ref('1','link','secret')], { protectedRoot: path.join(root, 'protected') });
    assert.equal(result.items[0].status, 'UNSAFE'); assert.equal(result.ready, false);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('legacy migration plan is deterministic, deduplicated, fails closed, and idempotent in an isolated fixture', async () => {
  const { planLegacyArchiveMigration } = await import('../lib/accountingArchiveAudit');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-migration-plan-'));
  const protectedRoot = path.join(root, 'protected'); const legacyRoot = path.join(root, 'legacy');
  try {
    await fs.mkdir(protectedRoot); await fs.mkdir(legacyRoot);
    await fs.writeFile(path.join(legacyRoot, 'document'), 'same immutable evidence');
    const refs = [ref('b','document','same immutable evidence'), ref('a','document','same immutable evidence')];
    const first = await planLegacyArchiveMigration(refs, { protectedRoot, legacyRoot });
    const again = await planLegacyArchiveMigration([...refs].reverse(), { protectedRoot, legacyRoot });
    assert.equal(first.sha256, again.sha256);
    assert.equal(first.actionCount, 1);
    assert.deepEqual(first.actions[0].referenceIds, ['a','b']);
    // This is an isolated test fixture, not a production migration port.
    const source = await fs.readFile(path.join(legacyRoot, 'document'));
    assert.equal(createHash('sha256').update(source).digest('hex'), first.actions[0].contentHash);
    await fs.writeFile(path.join(protectedRoot, 'document'), source, { flag: 'wx' });
    assert.equal((await planLegacyArchiveMigration(refs, { protectedRoot, legacyRoot })).actionCount, 0);
    assert.deepEqual(await fs.readFile(path.join(legacyRoot, 'document')), source);
    await fs.writeFile(path.join(protectedRoot, 'document'), 'tampered');
    await assert.rejects(() => planLegacyArchiveMigration(refs, { protectedRoot, legacyRoot }), { code: 'ARCHIVE_PLAN_BLOCKED' });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});


test('archive keys normalize both separators and never inspect traversal or absolute paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-separator-'));
  const protectedRoot = path.join(root, 'protected');
  try {
    await fs.mkdir(path.join(protectedRoot, 'nested'), { recursive: true });
    await fs.writeFile(path.join(root, 'outside'), 'secret');
    await fs.writeFile(path.join(protectedRoot, 'nested', 'inside'), 'safe');
    const slash = String.fromCharCode(92); const unsafe = [`..${slash}outside`, `..${slash}${slash}outside`, `${slash}${slash}server${slash}share${slash}file`, `C:${slash}outside`, '../outside'];
    const result = await auditArchiveEvidence(unsafe.map((key, i) => ref(String(i), key, 'secret')), { protectedRoot });
    assert.deepEqual(result.items.map(item => item.status), unsafe.map(() => 'UNSAFE'));
    for (const key of ['nested/inside', `nested${slash}inside`]) {
      const safe = await auditArchiveEvidence([ref('safe', key, 'safe')], { protectedRoot });
      assert.equal(safe.items[0].status, 'PROTECTED', key);
    }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
