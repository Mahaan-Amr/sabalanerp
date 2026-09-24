import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { createAccountingReplacementApplication, hashAccountingReplacementEvidence } from '../accountingReplacement';
import { createAccountingReplacementPrismaRepository } from '../accountingReplacementPrismaRepository';

const databaseUrl = process.env.ACCOUNTING_REPLACEMENT_TEST_DATABASE_URL;
const rollback = new Error('ROLLBACK_ACCOUNTING_REPLACEMENT_TEST');

test('بسته مهاجرت و زنجیره ممیزی در PostgreSQL به‌صورت اتمیک و قابل‌بازآزمایی ذخیره می‌شوند', { skip: !databaseUrl }, async () => {
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    await assert.rejects(database.$transaction(async (tx) => {
      const legalEntity = await tx.accountingLegalEntity.create({ data: {
        code: `replacement-${randomUUID()}`, namePersian: 'شخص حقوقی آزمون جایگزینی', activeFrom: new Date('2026-03-21'), createdBy: 'test-manager',
      } });
      const book = await tx.accountingBook.create({ data: { legalEntityId: legalEntity.id, code: 'اصلی', namePersian: 'دفتر اصلی', createdBy: 'test-manager' } });
      const repository = createAccountingReplacementPrismaRepository(tx);
      const application = createAccountingReplacementApplication(repository, { now: () => new Date('2026-09-21T16:00:00.000Z') });
      const records = [
        { sourceId: 'cash', kind: 'OPENING_BALANCE' as const, debitRials: 10n, creditRials: 0n, targetIdentity: '1101', payload: { title: 'بانک' } },
        { sourceId: 'capital', kind: 'OPENING_BALANCE' as const, debitRials: 0n, creditRials: 10n, targetIdentity: '3101', payload: { title: 'سرمایه' } },
        { sourceId: 'old-1', kind: 'LEGACY_ARCHIVE' as const, debitRials: 0n, creditRials: 0n, targetIdentity: 'archive:old-1', payload: { description: 'سند قدیمی قابل جست‌وجو' } },
      ];
      const packagePayload = { exportId: 'db-test', records };
      const preview = await application.previewMigration({ bookId: book.id, sourceSystem: 'SEPIDAR', packagePayload,
        sourcePackageHash: hashAccountingReplacementEvidence(packagePayload), toolVersion: 'test/1', mappingVersion: 1, scope: { fiscalYear: '1405' },
        records, actor: { id: 'test-manager', profile: 'ACCOUNTING_MANAGER' } });
      await assert.rejects(() => application.commitMigration({ runId: preview.id, expectedOutputHash: preview.outputHash, acceptanceReason: 'آزمون تطبیق کامل', actor: { id: 'test-manager', profile: 'ACCOUNTING_MANAGER' } }), /هنوز در دفتر مقصد ساخته/);
      const archiveRecords = records.slice(2);
      const archivePayload = { exportId: 'db-archive-test', records: archiveRecords };
      const archivePreview = await application.previewMigration({ bookId: book.id, sourceSystem: 'SEPIDAR', packagePayload: archivePayload,
        sourcePackageHash: hashAccountingReplacementEvidence(archivePayload), toolVersion: 'test/1', mappingVersion: 1, scope: { kind: 'ARCHIVE' },
        records: archiveRecords, actor: { id: 'test-manager', profile: 'ACCOUNTING_MANAGER' } });
      const committed = await application.commitMigration({ runId: archivePreview.id, expectedOutputHash: archivePreview.outputHash, acceptanceReason: 'آزمون بایگانی', actor: { id: 'test-manager', profile: 'ACCOUNTING_MANAGER' } });

      assert.equal(committed.status, 'ARCHIVED');
      assert.equal(await tx.accountingReplacementMigrationRecord.count({ where: { runId: preview.id } }), 3);
      assert.equal((await application.searchLegacyArchive({ bookId: book.id, query: 'قابل جست‌وجو' })).length, 1);
      assert.equal((await application.verifyAudit()).valid, true);
      throw rollback;
    }), (error) => error === rollback);
  } finally { await database.$disconnect(); }
});
