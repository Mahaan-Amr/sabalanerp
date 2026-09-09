import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { Prisma, PrismaClient } from '@prisma/client';
import { cleanupExpiredPerformanceExports } from '../personnelPerformanceDisclosureStore';
import { findPerformanceExportLegalHold } from '../personnelPerformanceExportLineage';
import { persistPerformancePayload, performanceVaultKeyFromEnvironment } from '../personnelPerformancePayloadStore';
import { PERFORMANCE_RETENTION_SCHEDULE_V1 } from '../personnelPerformanceRetention';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const failure = (code: string) => Object.assign(new Error(code), { code });
const subjectScope = { aggregateType: 'PERFORMANCE_SUBJECT', aggregateIdHash: hash('subject') };

// Exercise public cleanup and the real encrypted-payload readers without opening a
// database, writing an artifact, or invoking an external adapter.
const fixture = async () => {
  const rows = new Map<string, any>();
  const journal: Array<{ status: string; lastFailureCode: string }> = [];
  const attempt = { id: 'attempt', status: 'PENDING' };
  const hold = { id: 'hold', aggregateId: 'handoff' };
  let artifactReads = 0;
  const client = {
    performanceEncryptedPayload: {
      create: async ({ data }: any) => { rows.set(data.id, data); return data; },
      findUnique: async ({ where }: any) => rows.get(where.id) ?? null,
    },
    performanceExportReceipt: {
      findMany: async ({ cursor }: any) => cursor ? [] : [{ id: 'export' }],
      findUnique: async () => ({ id: 'export', status: 'READY', expiresAt: new Date(0),
        downloadedAt: null, encryptedPayloadId: null, scopeHash: hash('scope'), artifactHash: hash('artifact') }),
    },
    performanceExportCleanupAttempt: {
      upsert: async () => attempt,
      findUnique: async () => attempt,
      update: async ({ data }: any) => { journal.push(data); Object.assign(attempt, data); return attempt; },
    },
    performanceExportArtifact: {
      findMany: async () => { artifactReads += 1; throw new Error('Must not reach artifact deletion'); },
    },
    performancePolicyVersion: { findFirst: async (): Promise<any> => null },
    performanceExportLineage: { findUnique: async (): Promise<any> => null },
    performanceExportDependency: { findMany: async () => [subjectScope] },
    performanceLegalHold: { findFirst: async () => null, findMany: async () => [hold] },
    performanceConsequenceHandoff: { findUnique: async (): Promise<any> => ({ subjectId: 'subject',
      packageId: null, encryptedPayloadId: null, snapshotHash: '' }) },
    $queryRaw: async (sql: TemplateStringsArray) => sql.join('').includes('SHOW transaction_isolation')
      ? [{ transaction_isolation: 'read committed' }]
      : sql.join('').includes('SELECT revision') ? [{ revision: 1n }] : [],
    $executeRaw: async () => 1,
    $transaction: async (work: (tx: Prisma.TransactionClient) => Promise<unknown>): Promise<unknown> => work(client as unknown as Prisma.TransactionClient),
  };
  const payload = (value: unknown) => persistPerformancePayload(client as unknown as Prisma.TransactionClient, {
    aggregateType: 'TEST_LINEAGE', aggregateId: 'fixture', payloadKind: 'TEST', schemaVersion: 1,
    payload: value, keyring: performanceVaultKeyFromEnvironment(),
  });
  const policy = await payload(PERFORMANCE_RETENTION_SCHEDULE_V1);
  client.performancePolicyVersion.findFirst = async () => ({ id: 'policy', encryptedPayloadId: policy.id, contentHash: policy.contentHash });
  const manifestHash = hash(`${subjectScope.aggregateType}:${subjectScope.aggregateIdHash}`);
  const reconstruction = await payload({ schemaVersion: 1, scopes: [subjectScope], dependencyHash: manifestHash });
  const lineage = { schemaVersion: 1, reconstructionId: reconstruction.id, dependencyCount: 1, dependencyHash: manifestHash };
  client.performanceExportLineage.findUnique = async () => lineage;
  return { client, rows, journal, hold, payload, lineage,
    assertPreserved: () => assert.equal(artifactReads, 0, 'failure must precede artifact inventory/deletion'),
    cleanup: () => cleanupExpiredPerformanceExports(client as unknown as PrismaClient),
    findHold: () => findPerformanceExportLegalHold(client as unknown as Prisma.TransactionClient, 'export', [subjectScope]),
  };
};

test('historical and invalid export evidence remains held without reporting cleanup failure', async (t) => {
  for (const scenario of ['historical', 'manifest', 'missing-payload', 'unauthenticated-payload']) {
    await t.test(scenario, async () => {
      const f = await fixture();
      if (scenario === 'historical') f.client.performanceExportLineage.findUnique = async () => null;
      if (scenario === 'manifest') f.lineage.dependencyCount += 1;
      if (scenario === 'missing-payload') f.rows.delete(f.lineage.reconstructionId);
      if (scenario === 'unauthenticated-payload') f.rows.get(f.lineage.reconstructionId).aadHash = 'corrupt';
      assert.equal(await f.cleanup(), 0);
      assert.equal(f.journal.at(-1)?.status, 'HELD');
      assert.equal(f.journal.at(-1)?.lastFailureCode, 'PERFORMANCE_EXPORT_LINEAGE_UNVERIFIED');
      f.assertPreserved();
    });
  }
});

test('unexpected export lineage failures journal retry and fail the cleanup report', async (t) => {
  for (const error of [failure('P1001'), new TypeError('resolver defect'), failure('PERFORMANCE_ENCRYPTION_CONFIGURATION_INVALID')]) {
    await t.test(error.message, async () => {
      const f = await fixture();
      f.client.performanceExportLineage.findUnique = async () => { throw error; };
      await assert.rejects(f.cleanup, { code: 'PERFORMANCE_CLEANUP_RETRY_REQUIRED', status: 503 });
      assert.equal(f.journal.at(-1)?.status, 'RETRY_REQUIRED');
      assert.equal(f.journal.at(-1)?.lastFailureCode, 'PERFORMANCE_CLEANUP_STORAGE_OR_DATABASE_FAILURE');
      assert.ok(f.journal.every(({ status }) => status !== 'HELD'));
      f.assertPreserved();
    });
  }
  await t.test('real unavailable vault key', async () => {
    const f = await fixture();
    f.rows.get(f.lineage.reconstructionId).keyId = 'unavailable-key';
    await assert.rejects(f.cleanup, { code: 'PERFORMANCE_CLEANUP_RETRY_REQUIRED', status: 503 });
    assert.equal(f.journal.at(-1)?.status, 'RETRY_REQUIRED');
    f.assertPreserved();
  });
});

test('unknown or unverifiable consequence evidence preserves its active hold', async (t) => {
  for (const scenario of ['historical', 'missing-payload', 'snapshot-mismatch', 'unauthenticated-payload']) {
    await t.test(scenario, async () => {
      const f = await fixture();
      if (scenario !== 'historical') {
        const record = await f.payload({ selectedResults: [], recentTrend: [], projectionResultIds: [] });
        f.client.performanceConsequenceHandoff.findUnique = async () => ({ subjectId: 'subject', packageId: null,
          encryptedPayloadId: record.id, snapshotHash: scenario === 'snapshot-mismatch' ? 'wrong' : record.contentHash });
        if (scenario === 'missing-payload') f.rows.delete(record.id);
        if (scenario === 'unauthenticated-payload') f.rows.get(record.id).aadHash = 'corrupt';
      }
      assert.equal(await f.findHold(), f.hold);
      assert.equal(await f.cleanup(), 0);
      assert.equal(f.journal.at(-1)?.lastFailureCode, 'PERFORMANCE_LEGAL_HOLD_ACTIVE');
      f.assertPreserved();
    });
  }
});

test('consequence resolver failures propagate unchanged and reach cleanup retry reporting', async (t) => {
  for (const error of [failure('P1001'), new TypeError('payload reader defect'), failure('PERFORMANCE_ENCRYPTION_CONFIGURATION_INVALID')]) {
    await t.test(error.message, async () => {
      const f = await fixture();
      f.client.performanceConsequenceHandoff.findUnique = async () => ({ subjectId: 'subject',
        packageId: null, encryptedPayloadId: 'broken-handoff', snapshotHash: '' });
      const read = f.client.performanceEncryptedPayload.findUnique;
      f.client.performanceEncryptedPayload.findUnique = async (input: any) => {
        if (input.where.id === 'broken-handoff') throw error;
        return read(input);
      };
      await assert.rejects(f.findHold, (actual) => actual === error);
      await assert.rejects(f.cleanup, { code: 'PERFORMANCE_CLEANUP_RETRY_REQUIRED', status: 503 });
      assert.equal(f.journal.at(-1)?.status, 'RETRY_REQUIRED');
      f.assertPreserved();
    });
  }
  await t.test('real unavailable vault key', async () => {
    const f = await fixture();
    const record = await f.payload({ selectedResults: [] });
    f.rows.get(record.id).keyId = 'unavailable-key';
    f.client.performanceConsequenceHandoff.findUnique = async () => ({ subjectId: 'subject', packageId: null,
      encryptedPayloadId: record.id, snapshotHash: record.contentHash });
    await assert.rejects(f.findHold, { code: 'PERFORMANCE_ENCRYPTION_KEY_UNAVAILABLE' });
    await assert.rejects(f.cleanup, { code: 'PERFORMANCE_CLEANUP_RETRY_REQUIRED', status: 503 });
    assert.equal(f.journal.at(-1)?.status, 'RETRY_REQUIRED');
    f.assertPreserved();
  });
});

test('failure to persist a preservation hold is reported as a cleanup failure', async () => {
  const f = await fixture();
  f.client.performanceExportLineage.findUnique = async () => null;
  const update = f.client.performanceExportCleanupAttempt.update;
  f.client.performanceExportCleanupAttempt.update = async (input: any) => {
    if (input.data.status === 'HELD') throw failure('P1001');
    return update(input);
  };
  await assert.rejects(f.cleanup, { code: 'PERFORMANCE_CLEANUP_RETRY_REQUIRED', status: 503 });
  assert.equal(f.journal.at(-1)?.status, 'RETRY_REQUIRED');
  f.assertPreserved();
});

test('failure to persist the retry journal cannot turn cleanup into success', async () => {
  const f = await fixture();
  f.client.performanceExportLineage.findUnique = async () => { throw new TypeError('resolver defect'); };
  f.client.performanceExportCleanupAttempt.update = async () => { throw failure('P1001'); };
  await assert.rejects(f.cleanup, { code: 'PERFORMANCE_CLEANUP_RETRY_REQUIRED', status: 503 });
  assert.deepEqual(f.journal, []);
  f.assertPreserved();
});
