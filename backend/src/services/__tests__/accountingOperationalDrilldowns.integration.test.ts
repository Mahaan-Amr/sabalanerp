import assert from 'node:assert/strict';
import {
  getAccountantPerformanceReport,
  getAccountingWorkspace,
  listAuditLogs,
  listCorrectionRequests,
  listTaxRecords,
} from '../accountingService';

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
