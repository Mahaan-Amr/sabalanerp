import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { createAccountingLedgerAdministration } from '../accountingLedgerAdministration';
import { readLedgerVoucherEvidence } from '../accountingLedgerPrismaRepository';

const url = process.env.ACCOUNTING_LEDGER_TEST_DATABASE_URL;
test('two financial accounts may omit optional bank fields without a unique-IBAN failure', { skip: !url }, async () => {
  const client = new PrismaClient({ datasources: { db: { url } } });
  const rollback = new Error('ROLLBACK_QA_FINANCIAL_ACCOUNTS');
  try {
    await assert.rejects(client.$transaction(async (tx) => {
      const entity = await tx.accountingLegalEntity.findFirstOrThrow({ where: { activeTo: null } });
      const actor = await tx.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
      const administration = createAccountingLedgerAdministration({ $transaction: (work: any) => work(tx) } as any);
      const voucherCount = await tx.accountingLedgerVoucher.count();
      const accounts: Awaited<ReturnType<typeof administration.createFinancialAccount>>[] = [];
      for (let index = 0; index < 2; index += 1) {
        const account = await administration.createFinancialAccount({ legalEntityId: entity.id, kind: 'BANK',
          titlePersian: `آزمون تراکنشی حساب بدون شبا ${index}`, institutionName: ' بانک آزمایشی ',
          branchName: '', accountNumber: '', iban: '', currency: 'IRR',
          activeFrom: new Date('2026-03-21T00:00:00Z'), actorId: actor.id });
        accounts.push(account);
      }
      for (const account of accounts) {
        assert.equal(account.iban, null);
        assert.equal(account.accountNumber, null);
        assert.equal(account.branchName, null);
        assert.equal(account.institutionName, 'بانک آزمایشی');
      }
      assert.equal(await tx.accountingLedgerVoucher.count(), voucherCount);
      throw rollback;
    }, { timeout: 20000 }), (error: unknown) => error === rollback);
  } finally { await client.$disconnect(); }
});

test('a duplicate nonblank IBAN returns a recoverable domain conflict', { skip: !url }, async () => {
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    await assert.rejects(client.$transaction(async (tx) => {
      const entity = await tx.accountingLegalEntity.findFirstOrThrow({ where: { activeTo: null } });
      const actor = await tx.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
      const administration = createAccountingLedgerAdministration({ $transaction: (work: any) => work(tx) } as any);
      const input = { legalEntityId: entity.id, kind: 'BANK' as const, titlePersian: 'آزمون تراکنشی شبا تکراری',
        iban: `QA-${Date.now()}`, activeFrom: new Date('2026-03-21T00:00:00Z'), actorId: actor.id };
      await administration.createFinancialAccount(input);
      await administration.createFinancialAccount(input);
    }, { timeout: 20000 }), (error: any) => error.code === 'FINANCIAL_ACCOUNT_ALREADY_EXISTS' && error.status === 409);
  } finally { await client.$disconnect(); }
});

test('audited evidence read includes accounting facts without rewriting frozen source payload', { skip: !url }, async () => {
  const client = new PrismaClient({ datasources: { db: { url } } });
  const rollback = new Error('ROLLBACK_QA_EVIDENCE_READ');
  try {
    await assert.rejects(client.$transaction(async (tx) => {
      const voucher = await tx.accountingLedgerVoucher.findFirstOrThrow({ where: { status: 'POSTED' } });
      const actor = await tx.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
      const evidence = await readLedgerVoucherEvidence({ $transaction: (work: any) => work(tx) } as any,
        { voucherId: voucher.id, actorId: actor.id, effectiveProfile: 'ACCOUNTING_MANAGER',
          correlationId: 'qa-evidence-read', reason: 'آزمون نمایش خوانای شواهد' });
      assert.equal(evidence.description, voucher.description);
      assert.equal(evidence.documentDate.getTime(), voucher.documentDate.getTime());
      assert.ok(evidence.lines[0].account.code);
      assert.deepEqual(evidence.sourcePayload, voucher.sourcePayload);
      assert.equal(evidence.sourceHash, voucher.sourceHash);
      throw rollback;
    }, { timeout: 20000 }), (error: unknown) => error === rollback);
  } finally { await client.$disconnect(); }
});
