/** Synthetic rollback-only fixture. It is not Sepidar acceptance or real source evidence. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import { createAccountingLedgerApplication, hashAccountingEvidence, voucherContentHash, IRR_ROUNDING_RULE_V1 } from '../accountingLedgerFoundation';
import { createAccountingLedgerPrismaRepository } from '../accountingLedgerPrismaRepository';
import { parseSepidarLocalDateTime } from '../sepidarCalendar';

const databaseUrl = process.env.ACCOUNTING_SEPIDAR_POSTING_TEST_DATABASE_URL;
const bookId = 'cmub2hd63007zrqlphrzi5eey';
const rollback = new Error('ROLLBACK_SYNTHETIC_SEPIDAR_POSTING_REGRESSION');
const rawHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('PostgreSQL source posting hook rejects balanced amount and account substitutions before posting, then accepts exact synthetic draft',
  { skip: !databaseUrl }, async () => {
  const originalNodeEnvironment = process.env.NODE_ENV;
  const originalDatabaseEnvironment = process.env.DATABASE_URL;
  // The client owns an explicit test connection; the policy environment is the
  // local runtime identity under test, independently of that injected connection.
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const fixtureTag = `QA-SEPIDAR-POSTING-${randomUUID()}`;
  process.env.NODE_ENV = 'development';
  process.env.DATABASE_URL = 'postgresql://postgres:local@127.0.0.1:55432/sabalanerp?application_name=sabalanerp-backend-local';
  try {
    await assert.rejects(database.$transaction(async (tx) => {
      const fiscalYear = await tx.accountingFiscalYear.findUniqueOrThrow({ where: { bookId_code: { bookId, code: '1405' } }, include: { periods: true } });
      const documentDate = parseSepidarLocalDateTime('2026-03-21T00:00:00');
      const period = fiscalYear.periods.find((row) => row.status === 'OPEN' && row.startsAt <= documentDate && row.endsAt >= documentDate);
      assert.ok(period, 'The rollback fixture needs an existing open local 1405 period');
      const accounts = await tx.accountingLedgerAccount.findMany({ where: { bookId, level: 'MOIN', retiredAt: null,
        effectiveFrom: { lte: documentDate }, effectiveTo: null, partyRequirement: { not: 'REQUIRED' }, financialAccountRequirement: { not: 'REQUIRED' },
        dimensionRules: { none: { requirement: 'REQUIRED' } } }, orderBy: { code: 'asc' }, take: 3 });
      assert.equal(accounts.length, 3, 'The rollback fixture needs three valid local accounts');
      const snapshotId = randomUUID();
      const sourceKey = String(1_000_000_000 + Math.floor(Math.random() * 1_000_000_000));
      const sourceYearKey = '1405000001';
      const accountKeys = [sourceKey + '1', sourceKey + '2'];
      const voucherPayload = { Number: 1, Version: 1, Date: '2026-03-21T00:00:00', FiscalYearRef: Number(sourceYearKey), Description: fixtureTag };
      const itemPayloads = [
        { VoucherRef: Number(sourceKey), RowNumber: 1, Version: 1, AccountSLRef: Number(accountKeys[0]), DLRef: null, Debit: '101', Credit: '0' },
        { VoucherRef: Number(sourceKey), RowNumber: 2, Version: 1, AccountSLRef: Number(accountKeys[1]), DLRef: null, Debit: '0', Credit: '101' },
      ];
      const sources = [
        { sourceTable: 'ACC.Voucher', sourceKey, payload: voucherPayload },
        ...itemPayloads.map((payload, index) => ({ sourceTable: 'ACC.VoucherItem', sourceKey: sourceKey + String(index + 3), payload })),
        ...accountKeys.map((key, index) => ({ sourceTable: 'ACC.Account', sourceKey: key, payload: { Code: accounts[index].code, Title: fixtureTag } })),
        { sourceTable: 'FMK.FiscalYear', sourceKey: sourceYearKey, payload: { Title: '1405' } },
      ];
      await tx.accountingSepidarSourceSnapshot.create({ data: { id: snapshotId, bookId,
        sourcePackageHash: rawHash(fixtureTag), sourceDatabase: 'SYNTHETIC_QA_NOT_SEPIDAR', schemaManifestHash: rawHash(sources),
        schemaManifest: [], sourceMetadata: { exportFormat: 'sepidar-source-jsonl-v1', syntheticRegressionOnly: true },
        tableCount: 4, expectedRecordCount: sources.length, importedRecordCount: sources.length, status: 'COMPLETE', completedAt: new Date() } });
      await tx.accountingSepidarSourceRecord.createMany({ data: sources.map((source) => ({ ...source, id: randomUUID(), snapshotId,
        sourceHash: rawHash(source.payload), payload: source.payload as Prisma.InputJsonValue, searchText: fixtureTag })) });
      for (const [index, key] of accountKeys.entries()) {
        const source = sources.find((row) => row.sourceTable === 'ACC.Account' && row.sourceKey === key)!;
        await tx.accountingSepidarTargetLink.create({ data: { id: randomUUID(), bookId, sourceTable: source.sourceTable, sourceKey: key,
          sourceHash: rawHash(source.payload), firstSnapshotId: snapshotId, latestSnapshotId: snapshotId, targetKind: 'LEDGER_ACCOUNT',
          targetId: accounts[index].id, mappingVersion: 1, reviewStatus: 'USER_APPROVED', reviewedBy: fixtureTag, reviewEvidence: snapshotId } });
      }
      const repository = createAccountingLedgerPrismaRepository(tx, true);
      const ledger = createAccountingLedgerApplication(repository, { now: () => new Date(), nextReference: () => fixtureTag });
      const sourcePayload = { snapshotId, sourceRecordHash: rawHash(voucherPayload), voucher: voucherPayload };
      const draft = await ledger.createManualDraft({ bookId, fiscalYearId: fiscalYear.id, periodId: period.id,
        idempotencyKey: fixtureTag, correlationId: fixtureTag, description: fixtureTag, documentDate, occurredAt: documentDate,
        actor: { id: fixtureTag, profile: 'ACCOUNTING_MANAGER' }, source: { type: 'SEPIDAR_ACC_VOUCHER', id: sourceKey,
          version: 1, hash: hashAccountingEvidence(sourcePayload), payload: sourcePayload },
        lines: itemPayloads.map((row, index) => {
          const payload = { snapshotId, sourceRecordHash: rawHash(row), row };
          return { accountId: accounts[index].id, debitRials: BigInt(row.Debit), creditRials: BigInt(row.Credit), dimensions: [], rawAmountBeforeRounding: '101', roundingRuleVersion: IRR_ROUNDING_RULE_V1,
            evidence: { type: 'SEPIDAR_ACC_VOUCHER_ITEM', id: sourceKey + String(index + 3), version: 1,
              hash: hashAccountingEvidence(payload), payload } };
        }),
      });
      await tx.accountingSepidarTargetLink.create({ data: { id: randomUUID(), bookId, sourceTable: 'ACC.Voucher', sourceKey,
        sourceHash: rawHash(voucherPayload), firstSnapshotId: snapshotId, latestSnapshotId: snapshotId, targetKind: 'LEDGER_DRAFT',
        targetId: draft.id, mappingVersion: 1, reviewStatus: 'USER_APPROVED', reviewedBy: fixtureTag, reviewEvidence: snapshotId } });
      await repository.confirmSepidarPostingSource!(draft);
      const lines = await tx.accountingLedgerLine.findMany({ where: { voucherId: draft.id }, orderBy: { sequence: 'asc' } });
      const auditBefore = await tx.accountingLedgerAuditEntry.count();
      const sequenceBefore = await tx.accountingVoucherSequence.findUnique({ where: { bookId_fiscalYearId: { bookId, fiscalYearId: fiscalYear.id } } });
      const post = () => ledger.postVoucher({ voucherId: draft.id, actor: { id: fixtureTag, profile: 'ACCOUNTING_MANAGER' }, reason: 'آزمون مصنوعی بازگشت‌پذیر، بدون پذیرش منبع واقعی' });
      const refreshHash = async () => {
        const changed = await repository.getVoucherForUpdate(draft.id); assert.ok(changed);
        await tx.accountingLedgerVoucher.update({ where: { id: draft.id }, data: { contentHash: voucherContentHash(changed) } });
      };
      await tx.accountingLedgerLine.update({ where: { id: lines[0].id }, data: { debitRials: 102 } });
      await tx.accountingLedgerLine.update({ where: { id: lines[1].id }, data: { creditRials: 102 } });
      await tx.accountingLedgerVoucher.update({ where: { id: draft.id }, data: { debitTotalRials: 102, creditTotalRials: 102 } });
      await refreshHash();
      await assert.rejects(post(), (error: unknown) => (error as { code?: string }).code === 'SEPIDAR_SOURCE_NOT_VERIFIED');
      await tx.accountingLedgerLine.update({ where: { id: lines[0].id }, data: { debitRials: 101, accountId: accounts[2].id } });
      await tx.accountingLedgerLine.update({ where: { id: lines[1].id }, data: { creditRials: 101 } });
      await tx.accountingLedgerVoucher.update({ where: { id: draft.id }, data: { debitTotalRials: 101, creditTotalRials: 101 } });
      await refreshHash();
      await assert.rejects(post(), (error: unknown) => (error as { code?: string }).code === 'SEPIDAR_SOURCE_NOT_VERIFIED');
      assert.equal((await tx.accountingLedgerVoucher.findUniqueOrThrow({ where: { id: draft.id } })).status, 'DRAFT');
      assert.equal(await tx.accountingLedgerAuditEntry.count(), auditBefore);
      assert.deepEqual(await tx.accountingVoucherSequence.findUnique({ where: { bookId_fiscalYearId: { bookId, fiscalYearId: fiscalYear.id } } }), sequenceBefore);
      await tx.accountingLedgerLine.update({ where: { id: lines[0].id }, data: { accountId: accounts[0].id } });
      await refreshHash();
      assert.equal((await post()).status, 'POSTED');
      throw rollback;
    }, { maxWait: 20_000, timeout: 180_000 }), (error) => error === rollback);
    assert.equal(await database.accountingLedgerVoucher.count({ where: { idempotencyKey: fixtureTag } }), 0);
  } finally {
    await database.$disconnect();
    if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalNodeEnvironment;
    if (originalDatabaseEnvironment === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalDatabaseEnvironment;
  }
});
