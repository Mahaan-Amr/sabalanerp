import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient, type AccountingAuditLog } from '@prisma/client';
import { attachAccountingTrendAuditState, readAuthorizedPartnerAuditWitnesses } from '../accountingReadProjection';
import { buildAccountingFinancialTrend } from '../accountingFinancialTrend';
import { assertPartnerAccountingWitnesses } from '../partnerSales/accounting/receivableEvidence';

test('chart projections preserve movement replay and private audit owners are rejected before body reads', async () => {
  const url = new URL(process.env.DATABASE_URL || '');
  assert(['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '55432');
  const db = new PrismaClient();
  const rollback = new Error('rollback projection fixtures');
  try {
    await assert.rejects(db.$transaction(async tx => {
      const now = new Date('2026-08-08T12:00:00Z');
      const heavy = { history: 'snapshot'.repeat(100_000) };
      const definitions = [
        { action: 'APPROVE_FINANCIAL_INVOICE', entityType: 'AccountingFinancialRecord', entityId: 'invoice', afterState: heavy },
        { action: 'REGISTER_RECEIPT', entityType: 'AccountingPaymentStatus', entityId: 'cash', afterState: heavy },
        { action: 'UPDATE_CHECK_STATUS', entityType: 'AccountingPaymentStatus', entityId: 'check', afterState: { ...heavy, checkStatus: 'CLEARED' } },
        { action: 'UPDATE_CHECK_STATUS', entityType: 'AccountingPaymentStatus', entityId: 'check', afterState: { ...heavy, checkStatus: 'BOUNCED' } },
        { action: 'UPDATE_CHECK_STATUS', entityType: 'AccountingPaymentStatus', entityId: 'malformed', afterState: { checkStatus: heavy } },
      ];
      const rows: AccountingAuditLog[] = [];
      for (let i = 0; i < definitions.length; i++) rows.push(await tx.accountingAuditLog.create({ data: {
        ...definitions[i], actorId: 'projection-test', createdAt: new Date(`2026-08-0${i + 1}T08:00:00Z`),
      } }));
      const headers = await tx.accountingAuditLog.findMany({ where: { id: { in: rows.map(row => row.id) } },
        select: { id: true, entityId: true, entityType: true, action: true, createdAt: true }, orderBy: { createdAt: 'asc' } });
      const projected = await attachAccountingTrendAuditState(tx, headers);
      const input = { range: '1m' as const, now,
        invoices: [{ id: 'invoice', contractId: 'contract', status: 'ISSUED', amount: 500,
          financiallyApprovedAt: now, createdAt: now }],
        payments: [{ id: 'cash', contractId: 'contract', method: 'CASH', status: 'RECEIVED', amount: 100,
          createdAt: now }, { id: 'check', contractId: 'contract', method: 'CHECK', status: 'RECONCILED',
          checkStatus: 'BOUNCED', amount: 200, createdAt: now, updatedAt: now }] };
      assert.deepEqual(buildAccountingFinancialTrend({ ...input, auditEvents: projected }),
        buildAccountingFinancialTrend({ ...input, auditEvents: rows }));
      assert(Buffer.byteLength(JSON.stringify(projected)) < 3000);
      assert(Buffer.byteLength(JSON.stringify(rows)) > 3_000_000);
      const ownerCases = [
        { recordId: 'allowed-invoice', entityId: 'allowed-payment', contractId: null },
        { recordId: 'hidden-invoice', entityId: null, contractId: null },
        { recordId: 'allowed-invoice', entityId: 'other-invoice', contractId: null },
        { recordId: null, entityId: null, contractId: null },
        { recordId: 'allowed-invoice', entityId: null, contractId: 'ordinary-contract' },
      ];
      const audits: AccountingAuditLog[] = [];
      for (const owner of ownerCases) audits.push(await tx.accountingAuditLog.create({ data: {
        ...owner, action: 'TEST_PRIVATE_WITNESS', actorId: 'projection-test',
        afterState: { ...heavy, evidence: { partnerCaseId: 'wrong-owner' } },
      } }));
      const bodyReads: string[] = [];
      const delegate = { accountingAuditLog: { findMany: async (args: any) => {
        if (args.select?.afterState) bodyReads.push(...args.where.id.in);
        return tx.accountingAuditLog.findMany(args);
      } } } as unknown as Pick<typeof tx, 'accountingAuditLog'>;
      const result = await readAuthorizedPartnerAuditWitnesses(delegate, audits.map(row => row.id), new Map([
        ['allowed-invoice', 'allowed-invoice'], ['allowed-payment', 'allowed-invoice'], ['other-invoice', 'other-invoice'],
      ]));
      assert.deepEqual(bodyReads, [audits[0].id]);
      assert.deepEqual(new Set(result.rejectedIds), new Set(audits.slice(1).map(row => row.id)));
      assert.deepEqual(result.witnesses[0].afterState, audits[0].afterState);
      assert.throws(() => assertPartnerAccountingWitnesses(result.witnesses[0].afterState,
        { owner: { caseId: 'expected-owner' }, debtor: {} } as any), 'authorized bodies still reject conflicting nested evidence');
      throw rollback;
    }, { timeout: 30_000 }), error => error === rollback);
  } finally { await db.$disconnect(); }
});
