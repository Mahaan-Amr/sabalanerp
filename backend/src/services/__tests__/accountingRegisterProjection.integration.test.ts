import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '../../lib/prisma';
import { listFinancialRecords, listAuditLogs, getAccountantPerformanceReport } from '../accountingService';

test('bounded register and report reads preserve results from complete legacy rows', async () => {
  const url = new URL(process.env.DATABASE_URL || '');
  assert(['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '55432');
  let legacy = false;
  const observations: Array<{ model: string | undefined; select: any }> = [];
  prisma.$use(async (params, next) => {
    const select = params.args?.select;
    const report = select && !select.id && select.contractId && (select.actorId || select.createdBy);
    const register = select && (params.model === 'AccountingAuditLog' && select.note ||
      params.model === 'AccountingFinancialRecord' && select.invoiceItems);
    const context = params.model === 'SalesContract' && select?.customer && select.createdAt && !select.totalAmount;
    if (report || register || context) {
      if (!legacy) observations.push({ model: params.model, select });
      if (legacy) {
        delete params.args.select;
        if (context) params.args.include = { customer: true };
        if (params.model === 'AccountingFinancialRecord' && select.invoiceItems) params.args.include = {
          invoiceItems: select.invoiceItems, taxRecords: select.taxRecords, receivables: select.receivables,
        };
      }
    }
    return next(params);
  });
  try {
    const query = { page: 1, pageSize: 50, dateFrom: '2020-01-01', dateTo: '2099-01-01' };
    legacy = true;
    const fullFinancial = await listFinancialRecords({ ...query, kind: 'INVOICE_CANDIDATE' });
    const fullAudit = await listAuditLogs(query);
    const fullReport = await getAccountantPerformanceReport(query);
    legacy = false;
    const financial = await listFinancialRecords({ ...query, kind: 'INVOICE_CANDIDATE' });
    const audit = await listAuditLogs(query);
    const report = await getAccountantPerformanceReport(query);
    assert(financial.total > 0 && audit.total > 0 && report.total > 0, 'local accounting fixtures required');
    assert.deepEqual(financial, fullFinancial);
    assert.deepEqual(audit, { ...fullAudit, items: fullAudit.items.map(({ beforeState, afterState, ...row }: any) => row) });
    assert.deepEqual(report, fullReport);
    assert(observations.some(row => row.model === 'AccountingFinancialRecord'));
    for (const { model, select } of observations) {
      assert(!select.sourceSnapshot && !select.beforeState && !select.afterState,
        `${model} fetched historical evidence for a summary`);
      if (model === 'SalesContract') assert(!select.contractData && !select.content);
    }
    console.log(JSON.stringify({ financialBytes: Buffer.byteLength(JSON.stringify(financial)),
      auditBytes: Buffer.byteLength(JSON.stringify(audit)), reportRows: report.total }));
  } finally { await prisma.$disconnect(); }
});
