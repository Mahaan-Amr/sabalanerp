import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAccountingReplacementApplication,
  createInMemoryAccountingReplacementRepository,
  hashAccountingReplacementEvidence,
  verifyAccountingReplacementAuditChain,
} from '../accountingReplacement';

const now = new Date('2026-09-21T16:00:00.000Z');
const manager = { id: 'manager-1', profile: 'ACCOUNTING_MANAGER' as const };

const sourceRecords = [
  { sourceId: 'opening-cash', kind: 'OPENING_BALANCE' as const, debitRials: 1_000n, creditRials: 0n, targetIdentity: '1101', payload: { account: '10101' } },
  { sourceId: 'opening-equity', kind: 'OPENING_BALANCE' as const, debitRials: 0n, creditRials: 1_000n, targetIdentity: '3101', payload: { account: '30101' } },
  { sourceId: 'bad-party', kind: 'OPEN_ITEM' as const, debitRials: 0n, creditRials: 0n, rejectionReason: 'شناسه طرف حساب در منبع کامل نیست.', payload: { party: null } },
  { sourceId: 'legacy-1403-44', kind: 'LEGACY_ARCHIVE' as const, debitRials: 0n, creditRials: 0n, targetIdentity: 'archive:1403:44', payload: { description: 'سند قدیمی سپیدار' } },
];

test('hashed Sepidar package previews deterministically and refuses fictional operational reconciliation', async () => {
  const repository = createInMemoryAccountingReplacementRepository();
  const application = createAccountingReplacementApplication(repository, { now: () => now });
  const packagePayload = { exportId: 'sepidar-1405-opening', records: sourceRecords };
  const sourcePackageHash = hashAccountingReplacementEvidence(packagePayload);

  const preview = await application.previewMigration({
    bookId: 'book-1', sourceSystem: 'SEPIDAR', sourcePackageHash, packagePayload,
    toolVersion: 'sepidar-extractor/1.0.0', mappingVersion: 7,
    scope: { fiscalYear: '1405', includesCurrentYear: false }, records: sourceRecords, actor: manager,
  });
  const retry = await application.previewMigration({
    bookId: 'book-1', sourceSystem: 'SEPIDAR', sourcePackageHash, packagePayload,
    toolVersion: 'sepidar-extractor/1.0.0', mappingVersion: 7,
    scope: { fiscalYear: '1405', includesCurrentYear: false }, records: sourceRecords, actor: manager,
  });

  assert.equal(preview.id, retry.id);
  assert.equal(preview.inputCount, 4);
  assert.equal(preview.acceptedCount, 3);
  assert.equal(preview.rejectedCount, 1);
  assert.equal(preview.dispositions.find((item) => item.sourceId === 'bad-party')?.disposition, 'REJECTED');
  assert.match(preview.outputHash, /^[a-f0-9]{64}$/);

  await assert.rejects(() => application.commitMigration({
    runId: preview.id, expectedOutputHash: preview.outputHash, acceptanceReason: 'کنترل رکوردی و تراز افتتاحیه تأیید شد.', actor: manager,
  }), /هنوز در دفتر مقصد ساخته/);
  assert.equal((await application.getMigrationRun(preview.id))?.status, 'PREVIEWED');

  const archivePayload = { exportId: 'archive-only', records: sourceRecords.slice(3) };
  const archivePreview = await application.previewMigration({
    bookId: 'book-1', sourceSystem: 'SEPIDAR', sourcePackageHash: hashAccountingReplacementEvidence(archivePayload), packagePayload: archivePayload,
    toolVersion: 'sepidar-extractor/1.0.0', mappingVersion: 7, scope: { kind: 'ARCHIVE' }, records: sourceRecords.slice(3), actor: manager,
  });
  const committed = await application.commitMigration({
    runId: archivePreview.id, expectedOutputHash: archivePreview.outputHash, acceptanceReason: 'بایگانی منبع کنترل شد.', actor: manager,
  });
  const committedRetry = await application.commitMigration({
    runId: archivePreview.id, expectedOutputHash: archivePreview.outputHash, acceptanceReason: 'بایگانی منبع کنترل شد.', actor: manager,
  });
  assert.deepEqual(committedRetry, committed);
  assert.equal(committed.status, 'ARCHIVED');
  assert.deepEqual(committed.reconciliation, {
    sourceDebitRials: 0n, sourceCreditRials: 0n,
    targetDebitRials: 0n, targetCreditRials: 0n,
    sourceCount: 1, targetCount: 1, rejectedCount: 0, exact: true,
  });

  const archiveHit = await application.searchLegacyArchive({ bookId: 'book-1', query: 'قدیمی سپیدار' });
  assert.equal(archiveHit.length, 1);
  assert.equal(archiveHit[0].readOnly, true);
  assert.equal(archiveHit[0].postedVoucherId, null);

  const correctedPayload = { exportId: 'sepidar-1405-opening', records: sourceRecords, correction: 1 };
  const successor = await application.previewMigration({
    bookId: 'book-1', sourceSystem: 'SEPIDAR', sourcePackageHash: hashAccountingReplacementEvidence(correctedPayload),
    packagePayload: correctedPayload, toolVersion: 'sepidar-extractor/1.0.0', mappingVersion: 8,
    predecessorRunId: preview.id, scope: { fiscalYear: '1405', includesCurrentYear: false }, records: sourceRecords, actor: manager,
  });
  assert.equal(successor.predecessorRunId, preview.id);
  assert.equal((await application.getMigrationRun(preview.id))?.successorRunId, successor.id);
});

test('invalid package, implicit fallback and changed preview fail closed', async () => {
  const application = createAccountingReplacementApplication(createInMemoryAccountingReplacementRepository(), { now: () => now });
  const packagePayload = { records: sourceRecords };
  await assert.rejects(() => application.previewMigration({
    bookId: 'book-1', sourceSystem: 'SEPIDAR', sourcePackageHash: '0'.repeat(64), packagePayload,
    toolVersion: 'extractor/1', mappingVersion: 1, scope: {}, records: sourceRecords, actor: manager,
  }), /اثر انگشت بسته منبع/);
  await assert.rejects(() => application.previewMigration({
    bookId: 'book-1', sourceSystem: 'SEPIDAR', sourcePackageHash: hashAccountingReplacementEvidence({ records: [{ sourceId: 'x' }] }),
    packagePayload: { records: [{ sourceId: 'x' }] }, toolVersion: 'extractor/1', mappingVersion: 1, scope: {},
    records: [{ sourceId: 'x', kind: 'OPEN_ITEM', debitRials: 1n, creditRials: 0n, payload: {} }], actor: manager,
  }), /نگاشت مقصد یا دلیل رد/);
});

test('archive-only final delta cannot satisfy the authority transfer gate', async () => {
  const repository = createInMemoryAccountingReplacementRepository();
  const application = createAccountingReplacementApplication(repository, { now: () => now });
  const deltaPayload = { exportId: 'final-delta', records: sourceRecords.slice(3) };
  const deltaPreview = await application.previewMigration({ bookId: 'book-1', sourceSystem: 'SEPIDAR', sourcePackageHash: hashAccountingReplacementEvidence(deltaPayload),
    packagePayload: deltaPayload, toolVersion: 'extractor/1', mappingVersion: 10, scope: { kind: 'FINAL_DELTA' }, records: sourceRecords.slice(3), actor: manager });
  await application.commitMigration({ runId: deltaPreview.id, expectedOutputHash: deltaPreview.outputHash, acceptanceReason: 'دلتا نهایی تطبیق شد.', actor: manager });
  await assert.rejects(() => application.recordParallelRun({ bookId: 'book-1', periodIdentity: '1405-05', completeMonth: true, fullClose: false, differences: [], actor: manager }), /رویدادهای واقعی/);
  await assert.rejects(() => application.recordRecoveryProof({
    bookId: 'book-1', checkpointIdentity: 'checkpoint-final', databaseHash: 'b'.repeat(64), filesHash: 'c'.repeat(64), configurationHash: 'd'.repeat(64),
    encryptedOffsite: true, immutableRecoveryPoint: true, restoreVerified: true, repeatedRestoreVerified: true,
    rpoMinutes: 10, rtoMinutes: 180, drillKind: 'QUARTERLY_FULL', actor: manager,
  }), /مشاهده‌شده/);
  await assert.rejects(() => application.prepareCutover({
    bookId: 'book-1', checkpointIdentity: 'checkpoint-final', writesBlocked: true, servicesDrained: true,
    finalDeltaRunId: deltaPreview.id, exactReconciliationHash: 'e'.repeat(64), acceptanceHash: 'f'.repeat(64), actor: manager,
  }), /انتقال مرجعیت/);
  await assert.rejects(() => application.transferAuthority({ cutoverId: 'pretend', confirmed: true, reason: 'manual assertion', actor: manager }), /مسدود است/);
});

test('audit verification detects changed, missing and reordered evidence', () => {
  const first = { sequence: 1n, action: 'MIGRATION_PREVIEW', payloadHash: 'a'.repeat(64), previousHash: null as string | null };
  const firstHash = hashAccountingReplacementEvidence(first);
  const second = { sequence: 2n, action: 'MIGRATION_COMMIT', payloadHash: 'b'.repeat(64), previousHash: firstHash };
  const entries = [{ ...first, entryHash: firstHash }, { ...second, entryHash: hashAccountingReplacementEvidence(second) }];
  assert.equal(verifyAccountingReplacementAuditChain(entries).valid, true);
  assert.equal(verifyAccountingReplacementAuditChain([entries[1], entries[0]]).valid, false);
  assert.equal(verifyAccountingReplacementAuditChain([{ ...entries[0], action: 'FORGED' }, entries[1]]).valid, false);
  assert.equal(verifyAccountingReplacementAuditChain([entries[1]]).valid, false);
});
