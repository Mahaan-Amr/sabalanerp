import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '../../lib/prisma';
import {
  getAccountingDashboard,
  getAccountingFinancialTrend,
  getAccountingWorkspace,
  listAccountingContracts,
} from '../accountingService';

test('complete Accounting dashboard preserves authorized workspace and fresh chart results', async () => {
  const actor = await prisma.user.findFirst({ select: { id: true } });
  assert.ok(actor, 'local Accounting verification needs an existing user');
  const now = new Date();
  const dashboard = await getAccountingDashboard({}, '3m', now, { userId: actor.id });
  const workspace = await getAccountingWorkspace({}, { userId: actor.id });
  const trend = await getAccountingFinancialTrend('3m', now, { userId: actor.id });
  const contracts = await listAccountingContracts({ view: 'reviewable', sort: 'work_queue', page: 1, pageSize: 12 }, { userId: actor.id });

  assert.equal(dashboard.trendError, false);
  assert.deepEqual(dashboard.workspace.commandCenter, workspace.commandCenter);
  assert.deepEqual(dashboard.workspace.deadlines.typeCounts, workspace.deadlines.typeCounts);
  assert.deepEqual(dashboard.trend, trend);
  assert.deepEqual(dashboard.workspace.queues.contracts.map(row => row.contractId), contracts.items.map(row => row.contractId),
    'the dashboard must use the same authorized Partner and ordinary work population before pagination');
});
