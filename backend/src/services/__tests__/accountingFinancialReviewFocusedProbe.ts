import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { prisma } from '../../lib/prisma';
import { listFinancialRecords, listAuditLogs } from '../accountingService';

async function run() {
  const url = new URL(process.env.DATABASE_URL || '');
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '55432');
  assert.match(url.pathname, /^\/sabalanerp_concurrency_[a-f0-9]{16}$/);
  const recordId = process.env.ACCOUNTING_REVIEW_RECORD_ID!;
  const actor = { userId: 'historical-admin' };
  const query = { kind: 'INVOICE_CANDIDATE', recordId, page: 1, pageSize: 1 };
  const history = async () => JSON.stringify({
    cases: await prisma.partnerSaleCase.findMany({ orderBy: { id: 'asc' } }),
    contracts: await prisma.salesContract.findMany({ orderBy: { id: 'asc' } }),
    internalRecords: await prisma.sabalanToPartnerSaleRecord.findMany({ orderBy: { id: 'asc' } }),
    records: await prisma.accountingFinancialRecord.findMany({ orderBy: { id: 'asc' } }),
    invoiceItems: await prisma.accountingInvoiceCandidateItem.findMany({ orderBy: { id: 'asc' } }),
    revisions: await prisma.partnerCaseRevision.findMany({ orderBy: [{ caseId: 'asc' }, { revision: 'asc' }] }),
    plans: await prisma.partnerPaymentPlan.findMany({ orderBy: { id: 'asc' } }),
    receivables: await prisma.accountingReceivable.findMany({ orderBy: { id: 'asc' } }),
    payments: await prisma.accountingPaymentStatus.findMany({ orderBy: { id: 'asc' } }),
    taxes: await prisma.accountingTaxRecord.findMany({ orderBy: { id: 'asc' } }),
    audit: await prisma.accountingAuditLog.findMany({ orderBy: { id: 'asc' } }),
  }, (_key, value) => typeof value === 'bigint' ? value.toString() : value);
  try {
    const before = await history();
    const start = performance.now();
    const financial = await listFinancialRecords(query, actor);
    assert.equal(financial.total, 1); assert.equal(financial.items[0].id, recordId);
    assert.equal(financial.items[0].partnerContext?.customerContractNumber, '100999');
    const audit = await listAuditLogs({ recordId, pageSize: 100 }, actor);
    assert.deepEqual(new Set(audit.items.map(row => row.id)), new Set(['review-valid', 'review-legacy-unknown']));
    const elapsedMs = Math.round(performance.now() - start);
    assert(elapsedMs < 5000, `exact record + history exceeded local review budget: ${elapsedMs} ms`);
    assert.equal(await history(), before, 'reads must preserve every financial record, revision, plan, receipt, tax and audit snapshot');
    const decisions = await prisma.effectiveAuthorizationAudit.findMany({ where: { purpose: 'ACCOUNTING', channel: 'LIST' },
      select: { rootId: true, action: true, allowed: true } });
    assert.equal(decisions.length, 4, 'record and audit each retain their live read/write decisions');
    assert(decisions.every(row => row.rootId === 'historical-case' && row.allowed), 'unrelated Cases must not be authorized or validated');
    if (process.env.ACCOUNTING_REVIEW_FIXTURE_OUTPUT) writeFileSync(process.env.ACCOUNTING_REVIEW_FIXTURE_OUTPUT,
      JSON.stringify({ financial: { success: true, data: { ...financial, actionAvailability: { approve: true } } },
        audit: { success: true, data: audit } }), { mode: 0o600 });
    const ordinary = await listFinancialRecords({ ...query, recordId: 'ordinary-review-invoice' }, actor);
    assert.equal(ordinary.total, 1, 'the historical ordinary root-null provenance exception remains readable');
    const ordinaryReceivable = ordinary.items[0].receivables[0];
    assert('paymentStatuses' in ordinaryReceivable && Array.isArray(ordinaryReceivable.paymentStatuses));
    assert.equal(ordinaryReceivable.paymentStatuses[0].id, 'review-ordinary-payment');
    assert.equal(ordinaryReceivable.paymentStatuses[0].currency, 'IRT', 'nested currencies are never relabeled');
    const percent = await listFinancialRecords({ ...query, recordId: 'ordinary%3Aidentity' }, actor);
    assert.equal(percent.items[0].id, 'ordinary%3Aidentity', 'the API preserves literal percent sequences in stored IDs');
    assert.equal(await history(), before, 'ordinary reads also preserve all stored financial data');
    const missing = await listFinancialRecords({ ...query, recordId: encodeURIComponent(recordId) }, actor);
    assert.equal(missing.total, 0, 'API identifiers remain exact; the server must not reinterpret stored percent escapes');
    for (const id of ['disguised-ordinary', 'hidden-orphan', 'missing-financial-record']) {
      assert.equal((await listFinancialRecords({ ...query, recordId: id }, actor)).total, 0);
    }
    assert.equal((await listAuditLogs({ recordId: 'missing-financial-record' }, actor)).total, 0);

    // Even a read-only review retains all integrity checks for the owning Case.
    const original = await prisma.accountingFinancialRecord.findUniqueOrThrow({ where: { id: recordId } });
    await prisma.accountingFinancialRecord.update({ where: { id: recordId }, data: { amount: original.amount.add(1) } });
    try {
      await assert.rejects(listFinancialRecords(query, actor), /شواهد/);
      await assert.rejects(listAuditLogs({ recordId }, actor), /شواهد/);
    } finally { await prisma.accountingFinancialRecord.update({ where: { id: recordId }, data: { amount: original.amount } }); }
    await prisma.accountingAuditLog.create({ data: { id: 'review-wrong-witness', recordId, entityId: recordId,
      action: 'REVIEW_FIXTURE', actorId: actor.userId, afterState: { nested: { partnerCaseId: 'wrong-case' } } } });
    try { await assert.rejects(listAuditLogs({ recordId }, actor), /شواهد/); }
    finally { await prisma.accountingAuditLog.delete({ where: { id: 'review-wrong-witness' } }); }
    await prisma.user.update({ where: { id: actor.userId }, data: { isActive: false } });
    assert.equal((await listFinancialRecords(query, actor)).total, 0, 'revoked authority is never reused');
    assert.equal((await listAuditLogs({ recordId }, actor)).total, 0, 'hidden owner history remains hidden');
    console.log(JSON.stringify({ result: 'focused-financial-review-passed', cases: 43, elapsedMs,
      id: recordId, persistedFinancialHistoryUnchanged: true }));
  } finally { await prisma.$disconnect(); }
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
