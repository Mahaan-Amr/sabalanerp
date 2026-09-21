import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createAccountingLedgerAdministration } from '../accountingLedgerAdministration';
import { createAccountingLedgerApplication, hashAccountingEvidence } from '../accountingLedgerFoundation';
import { createAccountingLedgerPrismaRepository, listLedgerVouchers, listPostedJournal, listPostedTrialBalance, readLedgerVoucherEvidence, verifyLedgerAuditChain } from '../accountingLedgerPrismaRepository';

const databaseUrl = process.env.ACCOUNTING_LEDGER_TEST_DATABASE_URL;

test('دفترکل واقعی در رقابت شماره یکتا، توازن و تغییرناپذیری را حفظ می‌کند', { skip: !databaseUrl }, async () => {
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const actorId = `حسابدار-${randomUUID()}`;
    const administration = createAccountingLedgerAdministration(database);
    const setupInput = {
      legalEntity: { code: 'سبلان', namePersian: 'شرکت سبلان', activeFrom: new Date('2026-03-21T00:00:00.000Z') },
      book: { code: 'اصلی', namePersian: 'دفتر اصلی' },
      scheme: { groupLength: 1, kolLength: 2, moinLength: 3 },
      actorId,
    };
    const setupRace = await Promise.allSettled([
      administration.setup(setupInput),
      administration.setup({ ...setupInput, legalEntity: { ...setupInput.legalEntity, code: 'سبلان-رقیب' } }),
    ]);
    assert.equal(setupRace.filter((result) => result.status === 'fulfilled').length, 1, 'راه‌اندازی هم‌زمان فقط باید یک واحد گزارشگر بسازد');
    assert.equal(await database.accountingLegalEntity.count(), 1);
    const entity = setupRace.find((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof administration.setup>>> => result.status === 'fulfilled')!.value;
    const book = entity.books[0];
    const scheme = book.codeSchemes[0];
    const fiscalInput = {
      bookId: book.id, code: '۱۴۰۵', titlePersian: 'سال مالی ۱۴۰۵', actorId,
      startsAt: new Date('2026-03-21T00:00:00.000Z'), endsAt: new Date('2027-03-20T23:59:59.999Z'),
      periods: [{ code: '۱', titlePersian: 'دوره نخست', sequence: 1, isAdjustment: false, startsAt: new Date('2026-03-21T00:00:00.000Z'), endsAt: new Date('2027-03-20T23:59:59.999Z') }],
    };
    const fiscalRace = await Promise.allSettled([
      administration.createFiscalYear(fiscalInput),
      administration.createFiscalYear({ ...fiscalInput, code: '۱۴۰۵-رقیب', titlePersian: 'سال مالی هم‌پوشان' }),
    ]);
    assert.equal(fiscalRace.filter((result) => result.status === 'fulfilled').length, 1, 'سال‌های مالی هم‌پوشان در رقابت نباید هر دو ساخته شوند');
    assert.equal(await database.accountingFiscalYear.count({ where: { bookId: book.id } }), 1);
    const fiscal = fiscalRace.find((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof administration.createFiscalYear>>> => result.status === 'fulfilled')!.value;
    const group = await administration.createAccount({ bookId: book.id, codeSchemeId: scheme.id, code: '1', titlePersian: 'دارایی‌ها', level: 'GROUP', normalSide: 'DEBIT', statementRole: 'ASSET', currencyBehavior: 'BASE_ONLY', effectiveFrom: fiscal.startsAt, actorId });
    const kol = await administration.createAccount({ bookId: book.id, codeSchemeId: scheme.id, code: '101', titlePersian: 'وجوه نقد', level: 'KOL', parentId: group.id, normalSide: 'DEBIT', statementRole: 'ASSET', currencyBehavior: 'BASE_ONLY', effectiveFrom: fiscal.startsAt, actorId });
    const cash = await administration.createAccount({ bookId: book.id, codeSchemeId: scheme.id, code: '101001', titlePersian: 'صندوق', level: 'MOIN', parentId: kol.id, normalSide: 'DEBIT', statementRole: 'ASSET', currencyBehavior: 'BASE_ONLY', effectiveFrom: fiscal.startsAt, actorId });
    const capitalGroup = await administration.createAccount({ bookId: book.id, codeSchemeId: scheme.id, code: '3', titlePersian: 'حقوق مالکانه', level: 'GROUP', normalSide: 'CREDIT', statementRole: 'EQUITY', currencyBehavior: 'BASE_ONLY', effectiveFrom: fiscal.startsAt, actorId });
    const capitalKol = await administration.createAccount({ bookId: book.id, codeSchemeId: scheme.id, code: '301', titlePersian: 'سرمایه', level: 'KOL', parentId: capitalGroup.id, normalSide: 'CREDIT', statementRole: 'EQUITY', currencyBehavior: 'BASE_ONLY', effectiveFrom: fiscal.startsAt, actorId });
    const capital = await administration.createAccount({ bookId: book.id, codeSchemeId: scheme.id, code: '301001', titlePersian: 'سرمایه ثبت‌شده', level: 'MOIN', parentId: capitalKol.id, normalSide: 'CREDIT', statementRole: 'EQUITY', currencyBehavior: 'BASE_ONLY', effectiveFrom: fiscal.startsAt, actorId });

    const ledger = createAccountingLedgerApplication(createAccountingLedgerPrismaRepository(database), {
      now: () => new Date('2026-09-21T09:00:00.000Z'), nextReference: () => `عطف-${randomUUID()}`,
    });
    const command = (idempotencyKey: string) => {
      const sourcePayload = { kind: 'MANUAL_VOUCHER', request: idempotencyKey, version: 1 };
      return ({
      bookId: book.id, fiscalYearId: fiscal.id, periodId: fiscal.periods[0].id,
      idempotencyKey, correlationId: `پیگیری-${idempotencyKey}`, description: 'ثبت سرمایه',
      documentDate: new Date('2026-09-21T00:00:00.000Z'), occurredAt: new Date('2026-09-21T00:00:00.000Z'),
      source: { type: 'سند دستی', id: idempotencyKey, version: 1, payload: sourcePayload, hash: hashAccountingEvidence(sourcePayload) },
      actor: { id: actorId, profile: 'ACCOUNTANT' as const },
      lines: [1, 2].map((index) => {
        const payload = { kind: 'MANUAL_LINE', request: idempotencyKey, index, amount: '1000' };
        return {
          accountId: index === 1 ? cash.id : capital.id,
          debitRials: index === 1 ? 1_000n : 0n,
          creditRials: index === 2 ? 1_000n : 0n,
          dimensions: [], rawAmountBeforeRounding: '1000.00000000', roundingRuleVersion: 'ریال-صحیح-نیم-به-بالا-نسخه-۱',
          evidence: { type: 'سند دستی', id: `${idempotencyKey}-${index}`, version: 1, payload, hash: hashAccountingEvidence(payload) },
        };
      }),
      });
    };

    const [sameA, sameB] = await Promise.all([
      ledger.createManualDraft(command('درخواست-یکسان-۱۲۳۴۵۶')),
      ledger.createManualDraft(command('درخواست-یکسان-۱۲۳۴۵۶')),
    ]);
    assert.equal(sameA.id, sameB.id);
    const excessiveScale = command('درخواست-اعشار-نامعتبر-۱۲۳۴۵۶');
    excessiveScale.lines[0].rawAmountBeforeRounding = '1000.000000001';
    await assert.rejects(
      () => ledger.createManualDraft(excessiveScale),
      (error: any) => error?.code === 'INVALID_RAW_AMOUNT',
    );
    assert.equal(await database.accountingLedgerVoucher.count({ where: { sourceId: excessiveScale.source.id } }), 0);
    const other = await ledger.createManualDraft(command('درخواست-دوم-۱۲۳۴۵۶۷'));
    const [postedA, postedB] = await Promise.all([
      ledger.postVoucher({ voucherId: sameA.id, actor: command('').actor, reason: 'تأیید سند نخست' }),
      ledger.postVoucher({ voucherId: other.id, actor: command('').actor, reason: 'تأیید سند دوم' }),
    ]);
    assert.deepEqual(new Set([postedA.statutoryNumber, postedB.statutoryNumber]).size, 2);
    const trial = await listPostedTrialBalance(database, { bookId: book.id, fiscalYearId: fiscal.id });
    assert.equal(trial.length, 2);
    const [journalProjection, voucherProjection] = await Promise.all([
      listPostedJournal(database, { bookId: book.id, fiscalYearId: fiscal.id }),
      listLedgerVouchers(database, { bookId: book.id, fiscalYearId: fiscal.id }),
    ]);
    for (const projection of [journalProjection[0], voucherProjection[0]]) {
      assert.ok(projection);
      assert.equal('sourcePayload' in projection, false);
      assert.equal('sourceHash' in projection, false);
      assert.equal('evidencePayload' in projection.lines[0], false);
      assert.equal('evidenceHash' in projection.lines[0], false);
      assert.equal('evidenceId' in projection.lines[0], false);
    }
    const evidence = await readLedgerVoucherEvidence(database, {
      voucherId: postedA.id,
      actorId,
      effectiveProfile: 'ACCOUNTING_MANAGER',
      correlationId: 'بازبینی-شواهد-آزمون',
      reason: 'کنترل شواهد قطعی دفترکل',
    });
    assert.ok(evidence.sourcePayload);
    assert.ok(evidence.lines[0].evidencePayload);
    assert.equal(await database.accountingLedgerAuditEntry.count({
      where: { action: 'LEDGER_EVIDENCE_VIEWED', entityId: postedA.id, actorId },
    }), 1, 'مشاهده شواهد حساس باید در زنجیره حسابرسی ثبت شود');
    await assert.rejects(() => database.$executeRaw`UPDATE "accounting_ledger_vouchers" SET "description" = 'دستکاری' WHERE "id" = ${postedA.id}`, /تغییرناپذیر/);
    await assert.rejects(() => database.$executeRaw`
      UPDATE "accounting_ledger_vouchers"
      SET "status" = 'REVERSED', "reversedAt" = NOW(), "sourcePayload" = '{"tampered":true}'::jsonb
      WHERE "id" = ${postedA.id}`, /تغییرناپذیر/);
    await assert.rejects(() => database.$executeRaw`
      INSERT INTO "accounting_ledger_lines" ("id", "voucherId", "sequence", "accountId", "debitRials", "creditRials", "rawAmountBeforeRounding", "roundingRuleVersion")
      VALUES (${`line-${randomUUID()}`}, ${postedA.id}, 99, ${cash.id}, 1, 0, 1, 'آزمون')`, /immutable/i);
    await assert.rejects(() => database.$executeRaw`UPDATE "accounting_ledger_accounts" SET "code" = '101999' WHERE "id" = ${cash.id}`, /بازتعریف/);
    const lockedDimension = await administration.createDimensionType({ bookId: book.id, code: 'مرکز', titlePersian: 'مرکز هزینه', sourceKind: 'آزمون', effectiveFrom: fiscal.startsAt, actorId });
    await assert.rejects(
      () => database.accountingLedgerAccountDimensionRule.create({ data: { accountId: cash.id, dimensionTypeId: lockedDimension.id, requirement: 'OPTIONAL' } }),
      /cannot be redefined/i,
    );
    const tamperedDraft = await ledger.createManualDraft(command('درخواست-دستکاری-۱۲۳۴۵۶'));
    await database.accountingLedgerVoucher.update({ where: { id: tamperedDraft.id }, data: { description: 'شرح دستکاری‌شده' } });
    await assert.rejects(
      () => ledger.postVoucher({ voucherId: tamperedDraft.id, actor: command('').actor, reason: 'تلاش قطعی‌سازی' }),
      (error: any) => error?.code === 'VOUCHER_CONTENT_CHANGED',
    );
    await database.accountingLedgerVoucher.update({ where: { id: tamperedDraft.id }, data: { description: 'ثبت سرمایه' } });
    await ledger.postVoucher({ voucherId: tamperedDraft.id, actor: command('').actor, reason: 'قطعی‌سازی پس از رفع دستکاری' });

    const childRaceDraft = await ledger.createManualDraft(command('درخواست-رقابت-آرتیکل-۱۲۳۴۵۶'));
    const [childInsertRace, childPostRace] = await Promise.allSettled([
      database.$transaction(async (tx) => {
        await tx.$executeRaw`
          INSERT INTO "accounting_ledger_lines" ("id", "voucherId", "sequence", "accountId", "debitRials", "creditRials", "rawAmountBeforeRounding", "roundingRuleVersion", "evidenceType", "evidenceId", "evidenceVersion", "evidenceHash", "evidencePayload")
          VALUES (${`line-${randomUUID()}`}, ${childRaceDraft.id}, 99, ${cash.id}, 1, 0, 1, 'آزمون', 'آزمون رقابت', ${randomUUID()}, 1, ${'ر'.repeat(64)}, '{}'::jsonb)`;
        await tx.$executeRaw`SELECT pg_sleep(0.1)`;
      }),
      ledger.postVoucher({ voucherId: childRaceDraft.id, actor: command('').actor, reason: 'قطعی‌سازی هم‌زمان با آرتیکل' }),
    ]);
    assert.notEqual(childInsertRace.status === 'fulfilled' && childPostRace.status === 'fulfilled', true);
    const childRacePersisted = await database.accountingLedgerVoucher.findUniqueOrThrow({ where: { id: childRaceDraft.id } });
    if (childInsertRace.status === 'fulfilled') {
      assert.equal(childRacePersisted.status, 'DRAFT');
      await database.accountingLedgerLine.deleteMany({ where: { voucherId: childRaceDraft.id, sequence: 99 } });
      await ledger.postVoucher({ voucherId: childRaceDraft.id, actor: command('').actor, reason: 'قطعی‌سازی پس از حذف آرتیکل رقابتی' });
    } else {
      assert.equal(childRacePersisted.status, 'POSTED');
    }

    await administration.updatePeriodStatus({ periodId: fiscal.periods[0].id, status: 'SOFT_CLOSED', actorId, reason: 'آماده‌سازی آزمون رقابت' });
    const closeRaceDraft = await ledger.createManualDraft({
      ...command('درخواست-رقابت-بستن-۱۲۳۴۵۶'),
      actor: { id: actorId, profile: 'ACCOUNTING_MANAGER' as const },
      override: { confirmed: true, reason: 'ثبت کنترل‌شده آزمون رقابت' },
    });
    const [postRace, closeRace] = await Promise.allSettled([
      ledger.postVoucher({ voucherId: closeRaceDraft.id, actor: { id: actorId, profile: 'ACCOUNTING_MANAGER' }, reason: 'ثبت هم‌زمان کنترل‌شده', override: { confirmed: true, reason: 'ثبت کنترل‌شده آزمون رقابت' } }),
      administration.updatePeriodStatus({ periodId: fiscal.periods[0].id, status: 'HARD_CLOSED', actorId, reason: 'بستن قطعی هم‌زمان آزمون' }),
    ]);
    const persistedPeriod = await database.accountingPostingPeriod.findUniqueOrThrow({ where: { id: fiscal.periods[0].id } });
    const persistedRaceVoucher = await database.accountingLedgerVoucher.findUniqueOrThrow({ where: { id: closeRaceDraft.id } });
    assert.equal(postRace.status, 'fulfilled');
    assert.equal(closeRace.status, 'rejected');
    assert.equal(persistedPeriod.status, 'SOFT_CLOSED');
    assert.equal(persistedRaceVoucher.status, 'POSTED');
    const audit = await database.accountingLedgerAuditEntry.findFirstOrThrow({ orderBy: { sequence: 'desc' } });
    assert.deepEqual(await verifyLedgerAuditChain(database), {
      valid: true,
      checkedEntries: await database.accountingLedgerAuditEntry.count(),
      failedSequence: null,
    });
    await assert.rejects(() => database.$executeRaw`UPDATE "accounting_ledger_audit_entries" SET "action" = 'دستکاری' WHERE "id" = ${audit.id}`, /تغییرناپذیر/);
    assert.ok(await database.accountingLedgerAuditEntry.count({ where: { action: { in: ['LEDGER_DRAFT_CREATED', 'LEDGER_VOUCHER_POSTED'] } } }) >= 6);
  } finally {
    await database.$disconnect();
  }
});
