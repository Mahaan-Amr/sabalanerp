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
import { withAccountingReadScope } from '../partnerSales/accounting/readScope';

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
  const noClientHint = await getAccountingDashboardChange({ range: '3m',
    partnerIncluded: 'false',
    accessRevision: dashboard.revisions.access,
    workspaceRevision: dashboard.revisions.workspace,
    trendRevision: dashboard.revisions.trend }, { userId: actor.id });
  assert.deepEqual(noClientHint.revisions, dashboard.revisions,
    'server authority must not depend on a stale client Partner hint');
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

test('dashboard change detects an edit to existing evidence without a timestamp change', async () => {
  const actor = await prisma.user.findFirst({ select: { id: true } });
  assert.ok(actor);
  const audit = await prisma.accountingAuditLog.create({ data: {
    actorId: actor.id, action: 'DASHBOARD_REVISION_BEFORE', note: 'temporary revision edit probe',
  } });
  try {
    const first = await getAccountingDashboardChange({ range: '3m' }, { userId: actor.id });
    await prisma.accountingAuditLog.update({ where: { id: audit.id },
      data: { action: 'DASHBOARD_REVISION_AFTER' } });
    const changed = await getAccountingDashboardChange({ range: '3m',
      accessRevision: first.revisions.access, workspaceRevision: first.revisions.workspace,
      trendRevision: first.revisions.trend }, { userId: actor.id });
    assert.equal(changed.workspaceChanged, true);
    assert.equal(changed.trendChanged, true);
  } finally {
    await prisma.accountingAuditLog.delete({ where: { id: audit.id } });
  }
});

test('financial, collection, tax and correction edits advance the relevant dashboard sections', async () => {
  const actor = await prisma.user.findFirst({ select: { id: true } });
  assert.ok(actor);
  const financial = await prisma.accountingFinancialRecord.create({ data: {
    kind: 'INVOICE_CANDIDATE', sourceKind: 'MANUAL', createdBy: actor.id, amount: 10,
  } });
  const receivable = await prisma.accountingReceivable.create({ data: {
    invoiceRecordId: financial.id, originalAmount: 10, remainingAmount: 10,
    dueDate: new Date('2027-01-01'), createdBy: actor.id,
  } });
  const payment = await prisma.accountingPaymentStatus.create({ data: {
    receivableId: receivable.id, method: 'CASH', amount: 1, createdBy: actor.id,
  } });
  const tax = await prisma.accountingTaxRecord.create({ data: {
    invoiceRecordId: financial.id, missingFields: [], createdBy: actor.id,
  } });
  const correction = await prisma.accountingCorrectionRequest.create({ data: {
    category: 'OTHER', accountantNote: 'temporary dashboard revision probe', createdBy: actor.id,
  } });
  try {
    for (const [update, trendExpected] of [
      [() => prisma.accountingFinancialRecord.update({ where: { id: financial.id },
        data: { currency: 'تومان', updatedAt: financial.updatedAt } }), true],
      [() => prisma.accountingReceivable.update({ where: { id: receivable.id },
        data: { currency: 'تومان', updatedAt: receivable.updatedAt } }), true],
      [() => prisma.accountingPaymentStatus.update({ where: { id: payment.id },
        data: { currency: 'تومان', updatedAt: payment.updatedAt } }), true],
      [() => prisma.accountingTaxRecord.update({ where: { id: tax.id },
        data: { notes: 'changed', updatedAt: tax.updatedAt } }), false],
      [() => prisma.accountingCorrectionRequest.update({ where: { id: correction.id },
        data: { accountantNote: 'changed', updatedAt: correction.updatedAt } }), false],
    ] as const) {
      const first = await getAccountingDashboardChange({ range: '3m' }, { userId: actor.id });
      await update();
      const changed = await getAccountingDashboardChange({ range: '3m',
        accessRevision: first.revisions.access, workspaceRevision: first.revisions.workspace,
        trendRevision: first.revisions.trend }, { userId: actor.id });
      assert.equal(changed.workspaceChanged, true);
      assert.equal(changed.trendChanged, trendExpected);
    }
  } finally {
    await prisma.accountingCorrectionRequest.delete({ where: { id: correction.id } });
    await prisma.accountingTaxRecord.delete({ where: { id: tax.id } });
    await prisma.accountingPaymentStatus.delete({ where: { id: payment.id } });
    await prisma.accountingReceivable.delete({ where: { id: receivable.id } });
    await prisma.accountingFinancialRecord.delete({ where: { id: financial.id } });
  }
});

test('deleting Accounting evidence advances the change signal', async () => {
  const actor = await prisma.user.findFirst({ select: { id: true } });
  assert.ok(actor);
  const audit = await prisma.accountingAuditLog.create({ data: {
    actorId: actor.id, action: 'DASHBOARD_DELETE_TEST',
  } });
  try {
    const first = await getAccountingDashboardChange({ range: '3m' }, { userId: actor.id });
    await prisma.accountingAuditLog.delete({ where: { id: audit.id } });
    const changed = await getAccountingDashboardChange({ range: '3m',
      accessRevision: first.revisions.access, workspaceRevision: first.revisions.workspace,
      trendRevision: first.revisions.trend }, { userId: actor.id });
    assert.equal(changed.workspaceChanged, true);
    assert.equal(changed.trendChanged, true);
  } finally {
    await prisma.accountingAuditLog.deleteMany({ where: { id: audit.id } });
  }
});

test('customer presentation changes refresh the visible dashboard contract row', async () => {
  const actor = await prisma.user.findFirst({ select: { id: true } });
  const contract = await prisma.salesContract.findFirst({ where: { partnerCaseId: null, partnerKind: null },
    select: { customerId: true } });
  assert.ok(actor && contract);
  const customer = await prisma.crmCustomer.findUnique({ where: { id: contract.customerId },
    select: { firstName: true } });
  assert.ok(customer);
  const first = await getAccountingDashboardChange({ range: '3m' }, { userId: actor.id });
  try {
    await prisma.crmCustomer.update({ where: { id: contract.customerId },
      data: { firstName: `${customer.firstName} (dashboard revision probe)` } });
    const changed = await getAccountingDashboardChange({ range: '3m',
      accessRevision: first.revisions.access, workspaceRevision: first.revisions.workspace,
      trendRevision: first.revisions.trend }, { userId: actor.id });
    assert.equal(changed.workspaceChanged, true);
    assert.equal(changed.trendChanged, false);
  } finally {
    await prisma.crmCustomer.update({ where: { id: contract.customerId },
      data: { firstName: customer.firstName } });
  }
});

test('an authorized Partner Case without an invoice is tracked despite a false client hint', async () => {
  const actor = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
  assert.ok(actor);
  const cases = await prisma.partnerSaleCase.findMany({ where: {
    internalRecordId: { not: null }, customerContractId: { not: null },
  }, select: { id: true, internalRecordId: true, caseNumber: true } });
  const invoices = await prisma.accountingFinancialRecord.findMany({ where: {
    sourceKind: 'PARTNER_INTERNAL_RECORD', sourceId: { in: cases.flatMap(row => row.internalRecordId ? [row.internalRecordId] : []) },
  }, select: { sourceId: true } });
  const invoiced = new Set(invoices.map(row => row.sourceId));
  const invoiceFree = cases.filter(row => row.internalRecordId && !invoiced.has(row.internalRecordId));
  let selected: typeof cases[number] | undefined;
  for (const row of invoiceFree) {
    const scope = await withAccountingReadScope(prisma, { userId: actor.id }, async current => ({
      ids: current.authorizedPartnerInternalIds, invoiceIncluded: current.partnerAccountingIncluded,
    }), { focusedCaseId: row.id });
    if (scope.ids.includes(row.internalRecordId!)) {
      assert.equal(scope.invoiceIncluded, false);
      selected = row;
      break;
    }
  }
  assert.ok(selected, 'local Accounting verification needs an authorized committed Case without an invoice');
  const withoutHint = await getAccountingDashboardChange({ range: '3m', partnerIncluded: 'false' }, { userId: actor.id });
  const withHint = await getAccountingDashboardChange({ range: '3m', partnerIncluded: 'true' }, { userId: actor.id });
  assert.deepEqual(withoutHint.revisions, withHint.revisions,
    'authorized pre-invoice Cases remain in the actor-scoped revision');
});
