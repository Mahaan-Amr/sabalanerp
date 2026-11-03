import assert from 'node:assert/strict';
import { getAccountingWorkspaceResponse } from '../../routes/accounting';
import {
  getAccountantPerformanceReport,
  getAccountingWorkspace,
  listAuditLogs,
  listCorrectionRequests,
  listPaymentStatuses,
  listReceivables,
  listTaxRecords,
} from '../accountingService';

const requestWorkspace = async (query: Record<string, string>) => {
  let responseBody: any;
  let statusCode = 200;
  const response = {
    status(code: number) { statusCode = code; return this; },
    json(body: unknown) { responseBody = body; return this; },
  };
  await getAccountingWorkspaceResponse({ query } as never, response as never);
  assert.equal(statusCode, 200);
  assert.equal(responseBody?.success, true);
  return responseBody.data;
};

const verifyOperationalDrilldowns = async () => {
  const workspace = await getAccountingWorkspace();
  const [tax, corrections, audit, performance] = await Promise.all([
    listTaxRecords({ view: 'needs-attention', page: 1, pageSize: 1 }),
    listCorrectionRequests({ view: 'active', page: 1, pageSize: 1 }),
    listAuditLogs({ page: 1, pageSize: 100 }),
    getAccountantPerformanceReport({ view: 'last30days', page: 1, pageSize: 1 }),
  ]);

  assert.equal(workspace.commandCenter.taxNotReady.count, tax.total);
  assert.equal(workspace.commandCenter.correctionRequests.count, corrections.total);
  assert.equal(workspace.commandCenter.auditHistory.count, audit.total);
  assert.equal(workspace.commandCenter.accountantPerformance.count, performance.total);

  for (let index = 1; index < audit.items.length; index += 1) {
    const previous = audit.items[index - 1];
    const current = audit.items[index];
    const previousTime = new Date(previous.createdAt).getTime();
    const currentTime = new Date(current.createdAt).getTime();
    assert.equal(
      previousTime > currentTime || (previousTime === currentTime && previous.id >= current.id),
      true,
    );
  }

  for (const due of ['overdue', 'next7', 'days8to30', 'later30'] as const) {
    const [deadlineWorkspace, receivables, checks] = await Promise.all([
      getAccountingWorkspace({ due }),
      listReceivables({ view: 'open', due, page: 1, pageSize: 1 }),
      listPaymentStatuses({ view: 'unsettled-checks', due, page: 1, pageSize: 1 }),
    ]);
    assert.equal(deadlineWorkspace.deadlines.bucketCounts[due].receivable, receivables.total);
    assert.equal(deadlineWorkspace.deadlines.bucketCounts[due].check, checks.total);
    assert.equal(deadlineWorkspace.deadlines.total, receivables.total + checks.total);

    const receivableWorkspace = await getAccountingWorkspace({ due, deadlineType: 'receivable' });
    const checkWorkspace = await getAccountingWorkspace({ due, deadlineType: 'check' });
    assert.equal(receivableWorkspace.deadlines.total, receivables.total);
    assert.equal(checkWorkspace.deadlines.total, checks.total);

    if (due === 'next7') {
      const apiWorkspace = await requestWorkspace({ due, deadlineType: 'receivable' });
      assert.equal(apiWorkspace.deadlines.selection.due, due);
      assert.equal(apiWorkspace.deadlines.selection.deadlineType, 'receivable');
      assert.equal(apiWorkspace.deadlines.total, receivables.total);
      assert.equal(apiWorkspace.deadlines.items.every((item: any) => item.type === 'receivable'), true);
    }
  }
};

verifyOperationalDrilldowns()
  .then(() => {
    console.log('accounting operational drilldown integration passed');
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
