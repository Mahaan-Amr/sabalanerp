import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '../../lib/prisma';
import {
  getAccountingDashboard,
  getAccountingDashboardChange,
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

  assert.equal(dashboard.trendError, false);
  assert.deepEqual(dashboard.workspace.commandCenter, workspace.commandCenter);
  const reviewable = await listAccountingContracts({ view: 'reviewable', page: 1, pageSize: 12 }, { userId: actor.id });
  assert.equal(dashboard.workspace.commandCenter.reviewableContracts.count, reviewable.total,
    'dashboard reviewable count must match the complete authorized ordinary and Partner list');
  assert.deepEqual(dashboard.workspace.deadlines.typeCounts, workspace.deadlines.typeCounts);
  assert.deepEqual(dashboard.trend, trend);
  assert.ok(dashboard.revisions);
  const freshCheck = await getAccountingDashboardChange({ range: '3m',
    partnerIncluded: String(dashboard.workspace.partnerAccountingIncluded),
    accessRevision: dashboard.revisions.access,
    workspaceRevision: dashboard.revisions.workspace,
    trendRevision: dashboard.revisions.trend }, { userId: actor.id });
  assert.equal(freshCheck.accessChanged, false);
  assert.equal(freshCheck.workspaceChanged, false);
  assert.equal(freshCheck.trendChanged, false);
  for (const row of dashboard.workspace.queues.invoiceCandidates) {
    assert.equal('sourceSnapshot' in row, false, 'dashboard summaries must not expose complete invoice snapshots');
  }
  for (const row of dashboard.workspace.queues.audit) {
    assert.equal('beforeState' in row, false, 'dashboard summaries must not include audit snapshots');
    assert.equal('afterState' in row, false, 'dashboard summaries must not include audit snapshots');
  }
});

test('dashboard change check stays unchanged until authorized Accounting evidence changes', async () => {
  const actor = await prisma.user.findFirst({ select: { id: true } });
  assert.ok(actor);
  const first = await getAccountingDashboardChange({ range: '3m' }, { userId: actor.id });
  const unchanged = await getAccountingDashboardChange({ range: '3m',
    accessRevision: first.revisions.access,
    workspaceRevision: first.revisions.workspace, trendRevision: first.revisions.trend }, { userId: actor.id });
  assert.equal(unchanged.accessChanged, false);
  assert.equal(unchanged.workspaceChanged, false);
  assert.equal(unchanged.trendChanged, false);
  const anotherActor = await prisma.user.findFirst({ where: { id: { not: actor.id } }, select: { id: true } });
  if (anotherActor) {
    const other = await getAccountingDashboardChange({ range: '3m' }, { userId: anotherActor.id });
    assert.notEqual(other.revisions.workspace, first.revisions.workspace);
    assert.notEqual(other.revisions.trend, first.revisions.trend);
  }
  const audit = await prisma.accountingAuditLog.create({ data: {
    actorId: actor.id, action: 'DASHBOARD_CHANGE_TEST', note: 'temporary isolated revision probe',
  } });
  try {
    const changed = await getAccountingDashboardChange({ range: '3m',
      accessRevision: first.revisions.access,
      workspaceRevision: first.revisions.workspace, trendRevision: first.revisions.trend }, { userId: actor.id });
    assert.equal(changed.accessChanged, false);
    assert.equal(changed.workspaceChanged, true);
    assert.equal(changed.trendChanged, true);
  } finally {
    await prisma.accountingAuditLog.delete({ where: { id: audit.id } });
  }
});
