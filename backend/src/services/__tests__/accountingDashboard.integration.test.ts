import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
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
  const contracts = await listAccountingContracts({ view: 'reviewable', sort: 'work_queue', page: 1, pageSize: 12 }, { userId: actor.id });

  assert.equal(dashboard.trendError, false);
  assert.deepEqual(dashboard.workspace.commandCenter, workspace.commandCenter);
  const reviewable = await listAccountingContracts({ view: 'reviewable', page: 1, pageSize: 12 }, { userId: actor.id });
  assert.equal(dashboard.workspace.commandCenter.reviewableContracts.count, reviewable.total,
    'dashboard reviewable count must match the complete authorized ordinary and Partner list');
  assert.deepEqual(dashboard.workspace.deadlines.typeCounts, workspace.deadlines.typeCounts);
  assert.deepEqual(dashboard.trend, trend);
  assert.deepEqual(dashboard.workspace.queues.contracts.map(row => row.contractId), contracts.items.map(row => row.contractId),
    'the dashboard must use the same authorized Partner and ordinary work population before pagination');
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

test('Partner correction, flag and audit changes stay out of ordinary revisions', async () => {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
  assert.ok(admin);
  const authorized = await withAccountingReadScope(prisma, { userId: admin.id },
    async scope => scope.authorizedPartnerInternalIds);
  const invoice = await prisma.accountingFinancialRecord.findFirst({ where: {
    sourceKind: 'PARTNER_INTERNAL_RECORD', sourceId: { in: authorized },
  }, select: { id: true, sourceId: true } });
  assert.ok(invoice?.sourceId);
  const partnerCase = await prisma.partnerSaleCase.findFirst({ where: {
    internalRecordId: invoice.sourceId,
  }, select: { customerContractId: true } });
  assert.ok(partnerCase?.customerContractId);
  const candidates = await prisma.user.findMany({ where: { id: { not: admin.id } }, select: { id: true } });
  let ordinaryActor: string | undefined;
  for (const candidate of candidates) {
    const ids = await withAccountingReadScope(prisma, { userId: candidate.id },
      async scope => scope.authorizedPartnerInternalIds);
    if (!ids.includes(invoice.sourceId)) { ordinaryActor = candidate.id; break; }
  }
  assert.ok(ordinaryActor, 'local Accounting verification needs an actor denied this Partner Case');
  const revision = async (userId: string) => (await getAccountingDashboardChange({ range: '3m' }, { userId })).revisions;
  const assertPrivateWrite = async (write: () => Promise<unknown>, remove: () => Promise<unknown>) => {
    const beforeAdmin = await revision(admin.id);
    const beforeOrdinary = await revision(ordinaryActor);
    await write();
    const afterAdmin = await revision(admin.id);
    const afterOrdinary = await revision(ordinaryActor);
    assert.notEqual(afterAdmin.workspace, beforeAdmin.workspace);
    assert.equal(afterOrdinary.workspace, beforeOrdinary.workspace);
    assert.equal(afterOrdinary.trend, beforeOrdinary.trend);
    await remove();
    const deletedAdmin = await revision(admin.id);
    const deletedOrdinary = await revision(ordinaryActor);
    assert.notEqual(deletedAdmin.workspace, afterAdmin.workspace);
    assert.equal(deletedOrdinary.workspace, afterOrdinary.workspace);
  };
  let correctionId: string | undefined;
  let flagId: string | undefined;
  let auditId: string | undefined;
  let receivableId: string | undefined;
  let paymentId: string | undefined;
  let taxId: string | undefined;
  let mixedFinancialId: string | undefined;
  const auditEntityIds: string[] = [];
  try {
    await assertPrivateWrite(async () => {
      correctionId = (await prisma.accountingCorrectionRequest.create({ data: {
        recordId: invoice.id, category: 'OTHER', accountantNote: 'temporary private revision probe',
        createdBy: admin.id,
      } })).id;
    }, async () => { await prisma.accountingCorrectionRequest.delete({ where: { id: correctionId! } }); });
    correctionId = undefined;
    await assertPrivateWrite(async () => {
      flagId = (await prisma.accountingContractFlag.create({ data: {
        contractId: partnerCase.customerContractId!, sourceFinancialRecordId: invoice.id,
        category: 'OTHER', title: 'temporary private revision probe', createdBy: admin.id,
      } })).id;
    }, async () => { await prisma.accountingContractFlag.delete({ where: { id: flagId! } }); });
    flagId = undefined;
    await assertPrivateWrite(async () => {
      auditId = (await prisma.accountingAuditLog.create({ data: {
        actorId: admin.id, action: 'DASHBOARD_PRIVATE_REVISION_TEST', recordId: invoice.id,
        entityType: 'AccountingFinancialRecord', entityId: invoice.id,
      } })).id;
    }, async () => { await prisma.accountingAuditLog.delete({ where: { id: auditId! } }); });
    auditId = undefined;
    await assertPrivateWrite(async () => {
      receivableId = (await prisma.accountingReceivable.create({ data: {
        contractId: partnerCase.customerContractId!, originalAmount: 1, remainingAmount: 1,
        dueDate: new Date('2027-01-01'), createdBy: admin.id,
      } })).id;
    }, async () => { await prisma.accountingReceivable.delete({ where: { id: receivableId! } }); });
    receivableId = undefined;
    await assertPrivateWrite(async () => {
      paymentId = (await prisma.accountingPaymentStatus.create({ data: {
        contractId: partnerCase.customerContractId!, method: 'CASH', amount: 1, createdBy: admin.id,
      } })).id;
    }, async () => { await prisma.accountingPaymentStatus.delete({ where: { id: paymentId! } }); });
    paymentId = undefined;
    await assertPrivateWrite(async () => {
      taxId = (await prisma.accountingTaxRecord.create({ data: {
        contractId: partnerCase.customerContractId!, missingFields: [], createdBy: admin.id,
      } })).id;
    }, async () => { await prisma.accountingTaxRecord.delete({ where: { id: taxId! } }); });
    taxId = undefined;
    const ordinaryBeforeMixedSource = await revision(ordinaryActor);
    mixedFinancialId = (await prisma.accountingFinancialRecord.create({ data: {
      kind: 'INVOICE_CANDIDATE', sourceKind: 'MANUAL', contractId: partnerCase.customerContractId!,
      amount: 1, createdBy: admin.id,
    } })).id;
    assert.deepEqual(await revision(ordinaryActor), ordinaryBeforeMixedSource,
      'a financial row tied to a Partner contract cannot signal ordinary actors');
    await prisma.accountingFinancialRecord.delete({ where: { id: mixedFinancialId } });
    mixedFinancialId = undefined;
    const ordinaryBeforeMarkedFinancial = await revision(ordinaryActor);
    mixedFinancialId = (await prisma.accountingFinancialRecord.create({ data: {
      kind: 'INVOICE_CANDIDATE', sourceKind: 'MANUAL', amount: 1, createdBy: admin.id,
      metadata: { partnerPreparation: { retained: true } },
    } })).id;
    assert.deepEqual(await revision(ordinaryActor), ordinaryBeforeMarkedFinancial,
      'an unresolved marked financial record cannot signal ordinary actors');
    await prisma.accountingFinancialRecord.delete({ where: { id: mixedFinancialId } });
    mixedFinancialId = undefined;
    const ordinaryBeforeMarker = await revision(ordinaryActor);
    auditId = (await prisma.accountingAuditLog.create({ data: {
      actorId: admin.id, action: 'DASHBOARD_UNKNOWN_PRIVATE_MARKER_TEST',
      beforeState: { partnerPreparation: { retained: true } },
    } })).id;
    assert.deepEqual(await revision(ordinaryActor), ordinaryBeforeMarker,
      'unresolved retained private snapshot must not signal ordinary actors');
    await prisma.accountingAuditLog.delete({ where: { id: auditId } });
    auditId = undefined;
    const ordinaryBeforeMove = await revision(ordinaryActor);
    correctionId = (await prisma.accountingCorrectionRequest.create({ data: {
      recordId: invoice.id, category: 'OTHER', accountantNote: 'temporary source move probe', createdBy: admin.id,
    } })).id;
    assert.deepEqual(await revision(ordinaryActor), ordinaryBeforeMove);
    await prisma.accountingCorrectionRequest.update({ where: { id: correctionId }, data: { recordId: null } });
    assert.notEqual((await revision(ordinaryActor)).workspace, ordinaryBeforeMove.workspace,
      'moving a row into ordinary scope must signal ordinary actors');
    await prisma.accountingCorrectionRequest.update({ where: { id: correctionId }, data: { recordId: invoice.id } });
    await prisma.accountingCorrectionRequest.delete({ where: { id: correctionId } });
    correctionId = undefined;
    correctionId = (await prisma.accountingCorrectionRequest.create({ data: {
      recordId: invoice.id, category: 'OTHER', accountantNote: 'private audit entity probe', createdBy: admin.id,
    } })).id;
    flagId = (await prisma.accountingContractFlag.create({ data: {
      contractId: partnerCase.customerContractId!, sourceFinancialRecordId: invoice.id,
      category: 'OTHER', title: 'private audit entity probe', createdBy: admin.id,
    } })).id;
    auditEntityIds.push((await prisma.accountingAuditLog.create({ data: {
      actorId: admin.id, action: 'PRIVATE_CORRECTION_ENTITY_TEST',
      entityType: 'AccountingCorrectionRequest', entityId: correctionId,
    } })).id);
    auditEntityIds.push((await prisma.accountingAuditLog.create({ data: {
      actorId: admin.id, action: 'PRIVATE_FLAG_ENTITY_TEST',
      entityType: 'AccountingContractFlag', entityId: flagId,
    } })).id);
    const visibleAuditIds = async (userId: string) => withAccountingReadScope(prisma, { userId },
      async scope => (await scope.database.accountingAuditLog.findMany({
        where: scope.audit({ id: { in: auditEntityIds } }), select: { id: true },
      })).map(row => row.id));
    assert.deepEqual(await visibleAuditIds(ordinaryActor), [],
      'an ordinary actor cannot read audit rows whose only reference is a private correction or flag');
    assert.deepEqual((await visibleAuditIds(admin.id)).sort(), [...auditEntityIds].sort());
  } finally {
    if (auditEntityIds.length) await prisma.accountingAuditLog.deleteMany({ where: { id: { in: auditEntityIds } } });
    if (mixedFinancialId) await prisma.accountingFinancialRecord.deleteMany({ where: { id: mixedFinancialId } });
    if (taxId) await prisma.accountingTaxRecord.deleteMany({ where: { id: taxId } });
    if (paymentId) await prisma.accountingPaymentStatus.deleteMany({ where: { id: paymentId } });
    if (receivableId) await prisma.accountingReceivable.deleteMany({ where: { id: receivableId } });
    if (auditId) await prisma.accountingAuditLog.deleteMany({ where: { id: auditId } });
    if (flagId) await prisma.accountingContractFlag.deleteMany({ where: { id: flagId } });
    if (correctionId) await prisma.accountingCorrectionRequest.deleteMany({ where: { id: correctionId } });
  }
});

test('ordinary contract summary excludes a Partner-source flag while Partner review retains it', async () => {
  const actor = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
  assert.ok(actor);
  const ordinary = await prisma.salesContract.findFirst({ where: {
    partnerCaseId: null, partnerKind: null, isInactive: false,
  }, select: { id: true, contractNumber: true } });
  assert.ok(ordinary);
  const authorized = await withAccountingReadScope(prisma, { userId: actor.id },
    async scope => scope.authorizedPartnerInternalIds);
  const invoice = await prisma.accountingFinancialRecord.findFirst({ where: {
    sourceKind: 'PARTNER_INTERNAL_RECORD', sourceId: { in: authorized },
  }, select: { id: true } });
  assert.ok(invoice);
  const ordinaryRow = async () => {
    const list = await listAccountingContracts({ sourceKind: 'SALES_CONTRACT', search: ordinary.contractNumber,
      page: 1, pageSize: 100 }, { userId: actor.id });
    const row = list.items.find(item => item.contractId === ordinary.id);
    assert.ok(row);
    return row;
  };
  const partnerRow = async () => {
    const list = await listAccountingContracts({ sourceKind: 'PARTNER_INTERNAL_RECORD',
      page: 1, pageSize: 100 }, { userId: actor.id });
    const row = list.items.find(item => item.contractId === `partner:${invoice.id}`);
    assert.ok(row);
    return row;
  };
  const baseOrdinary = await ordinaryRow();
  const basePartner = await partnerRow();
  let privateFlagId: string | undefined;
  let ordinaryFlagId: string | undefined;
  try {
    privateFlagId = (await prisma.accountingContractFlag.create({ data: {
      contractId: ordinary.id, sourceFinancialRecordId: invoice.id,
      category: 'OTHER', title: 'temporary mixed-source flag', createdBy: actor.id,
    } })).id;
    assert.equal((await ordinaryRow()).accounting.openFlags, baseOrdinary.accounting.openFlags);
    assert.equal((await partnerRow()).accounting.openFlags, basePartner.accounting.openFlags + 1);
    ordinaryFlagId = (await prisma.accountingContractFlag.create({ data: {
      contractId: ordinary.id, category: 'OTHER', title: 'temporary ordinary flag', createdBy: actor.id,
    } })).id;
    assert.equal((await ordinaryRow()).accounting.openFlags, baseOrdinary.accounting.openFlags + 1);
  } finally {
    if (ordinaryFlagId) await prisma.accountingContractFlag.deleteMany({ where: { id: ordinaryFlagId } });
    if (privateFlagId) await prisma.accountingContractFlag.deleteMany({ where: { id: privateFlagId } });
  }
});

test('unrelated user display edits do not refresh ordinary Accounting evidence', async () => {
  const actor = await prisma.user.findFirst({ select: { id: true } });
  assert.ok(actor);
  const unique = randomUUID();
  const user = await prisma.user.create({ data: {
    email: `dashboard-probe-${unique}@example.test`, username: `dashboard-probe-${unique}`,
    password: 'temporary-fixture', firstName: 'Before', lastName: 'Probe',
  } });
  try {
    const first = await getAccountingDashboardChange({ range: '3m' }, { userId: actor.id });
    await prisma.user.update({ where: { id: user.id }, data: { firstName: 'After' } });
    const changed = await getAccountingDashboardChange({ range: '3m',
      accessRevision: first.revisions.access, workspaceRevision: first.revisions.workspace,
      trendRevision: first.revisions.trend }, { userId: actor.id });
    assert.equal(changed.workspaceChanged, false);
    assert.equal(changed.trendChanged, false);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});
