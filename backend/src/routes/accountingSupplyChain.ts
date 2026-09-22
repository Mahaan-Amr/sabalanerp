import express, { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { protect } from '../middleware/auth';
import {
  requireWorkspaceAccessWithClient,
  WORKSPACES,
  type WorkspaceRequest,
} from '../middleware/workspace';
import {
  SupplyChainAccountingError,
  createAccountingSupplyChainApplication,
  hashSupplyChainEvidence,
  type ImmutableEvidence,
} from '../services/accountingSupplyChain';
import { resolveAccountingOperationalEvidence } from '../services/accountingOperationalEvidence';
import { accountingAccessProfileFromPermission } from '../services/accountingLedgerFoundation';
import { createAccountingSupplyChainPrismaRepository } from '../services/accountingSupplyChainPrismaRepository';
import { createSupplyChainLedgerPosting } from '../services/accountingSupplyChainPosting';

const router = express.Router();
const repository = createAccountingSupplyChainPrismaRepository(prisma);

const auditDeniedRequest = async (req: WorkspaceRequest, reason: string, effectiveProfile = 'UNAUTHORIZED') => {
  await repository.saveCommandAudit({
    id: randomUUID(), commandName: `${req.method} ${req.baseUrl}${req.path}`, result: 'DENIED',
    actorId: req.user?.id ?? 'anonymous', effectiveProfile,
    commandHash: hashSupplyChainEvidence({ method: req.method, path: `${req.baseUrl}${req.path}` }),
    reason, createdAt: new Date(),
  });
};

const access = (permission: 'view' | 'edit' | 'admin') => [
  protect,
  requireWorkspaceAccessWithClient(prisma, WORKSPACES.ACCOUNTING, permission, async ({ req, effectivePermission, reason }) => {
    await auditDeniedRequest(req, reason, effectivePermission ?? 'UNAUTHORIZED');
  }),
];
const actorOf = (req: WorkspaceRequest) => ({
  id: req.user!.id,
  profile: accountingAccessProfileFromPermission(req.workspacePermission),
  isGlobalAdmin: req.user?.role === 'ADMIN',
});
const serialize = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) => (
  typeof item === 'bigint' ? item.toString() : item
)));
const wholeRials = (value: unknown) => {
  const normalized = String(value ?? '').trim();
  if (!/^\d+$/.test(normalized)) throw new SupplyChainAccountingError('INVALID_RIAL_AMOUNT', 'مبلغ ریال باید عدد صحیح و نامنفی باشد.', 400);
  return BigInt(normalized);
};
const date = (value: unknown, label = 'تاریخ') => {
  const parsed = new Date(String(value ?? ''));
  if (Number.isNaN(parsed.getTime())) throw new SupplyChainAccountingError('INVALID_DATE', `${label} معتبر نیست.`, 400);
  return parsed;
};
const evidence = async (value: any, allowedTypes: readonly string[] = [String(value?.type ?? '')]): Promise<ImmutableEvidence> => {
  return resolveAccountingOperationalEvidence(prisma, {
    type: String(value?.type ?? ''), id: String(value?.id ?? ''), version: Number(value?.version ?? 0),
  }, allowedTypes);
};
const application = createAccountingSupplyChainApplication(repository, {
  now: () => new Date(),
  post: createSupplyChainLedgerPosting(prisma),
  resolveEvidence: (item, allowedTypes) => evidence(item, allowedTypes),
});
const ledgerContext = (body: any) => ({
  bookId: String(body.bookId ?? ''), fiscalYearId: String(body.fiscalYearId ?? ''),
  periodId: String(body.periodId ?? ''), documentDate: date(body.documentDate, 'تاریخ سند'),
});
const purchaseLines = (value: any) => Promise.all((value ?? []).map(async (line: any) => ({
  id: String(line.id), kind: line.kind, description: String(line.description), quantity: String(line.quantity), unit: String(line.unit),
  unitPriceRials: wholeRials(line.unitPriceRials), grossRials: wholeRials(line.grossRials), discountRials: wholeRials(line.discountRials),
  attributableFreightRials: wholeRials(line.attributableFreightRials), recoverableTaxRials: wholeRials(line.recoverableTaxRials),
  nonRecoverableTaxRials: wholeRials(line.nonRecoverableTaxRials), deductionRials: wholeRials(line.deductionRials),
  retentionRials: wholeRials(line.retentionRials), roundingRials: wholeRials(line.roundingRials),
  orderEvidence: line.orderEvidence ? await evidence(line.orderEvidence, ['PURCHASE_ORDER_APPROVAL']) : undefined,
  receiptEvidence: line.receiptEvidence ? await evidence(line.receiptEvidence, ['GUARD_INBOUND_MOVEMENT']) : undefined,
  acceptedServiceEvidence: line.acceptedServiceEvidence ? await evidence(line.acceptedServiceEvidence, ['SERVICE_ACCEPTANCE']) : undefined,
  nonOrderException: line.nonOrderException,
  inventory: line.inventory,
})));
const handle = (handler: (req: WorkspaceRequest) => Promise<unknown>, created = false) => async (req: WorkspaceRequest, res: Response) => {
  try {
    const result = await handler(req);
    return res.status(created ? 201 : 200).json({ success: true, data: serialize(result) });
  } catch (error) {
    if (req.user && !(error && typeof error === 'object' && 'supplyChainAuditRecorded' in error)) {
      await auditDeniedRequest(req, error instanceof Error ? error.message : 'خطای ناشناخته', req.workspacePermission ?? 'UNAUTHORIZED');
    }
    if (error instanceof SupplyChainAccountingError) return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    const trackingId = `ACC-SC-${randomUUID().slice(0, 8).toUpperCase()}`;
    console.error('Accounting supply-chain operation failed.', { trackingId, error });
    return res.status(500).json({ success: false, message: `عملیات حسابداری خرید کامل نشد. کد پیگیری ${trackingId} را به پشتیبانی اعلام کنید.`, trackingId });
  }
};

router.get('/workspace', access('view'), handle(async (req) => {
  const [exceptions, invoices, openItems, transactions, checks, identities, migrations, postingRules] = await Promise.all([
    prisma.accountingSupplyChainException.findMany({ where: { resolvedAt: null }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.accountingSupplierInvoice.findMany({ include: { supplierParty: { select: { displayName: true } }, lines: true, openItem: true }, orderBy: { documentDate: 'desc' }, take: 100 }),
    prisma.accountingSupplierOpenItem.findMany({ include: { supplierParty: { select: { displayName: true } }, allocations: true }, orderBy: { dueDate: 'asc' }, take: 100 }),
    prisma.accountingSupplierSettlementTransaction.findMany({ include: { allocations: true }, orderBy: { occurredAt: 'desc' }, take: 100 }),
    prisma.accountingPayableCheck.findMany({ include: { events: { orderBy: { occurredAt: 'asc' } }, supplierParty: { select: { displayName: true } } }, orderBy: { dueDate: 'asc' }, take: 100 }),
    prisma.accountingInventoryIdentity.findMany({ include: { layers: { include: { consumptions: true } }, events: { orderBy: { occurredAt: 'desc' }, take: 20 }, reservations: { where: { status: 'ACTIVE' } } }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.accountingInventoryMigrationRun.findMany({ include: { _count: { select: { items: true } } }, orderBy: { createdAt: 'desc' }, take: 30 }),
    prisma.accountingSupplyChainPostingRule.findMany({ include: { account: { select: { code: true, titlePersian: true } } }, orderBy: [{ accountRole: 'asc' }, { version: 'desc' }] }),
  ]);
  const result = { exceptions, invoices, openItems, transactions, checks, identities, migrations, postingRules };
  await repository.saveCommandAudit({
    id: randomUUID(), commandName: 'readSupplyChainWorkspace', result: 'SUCCEEDED', actorId: req.user!.id,
    effectiveProfile: actorOf(req).profile, commandHash: hashSupplyChainEvidence({
      exceptionIds: exceptions.map((item) => item.id), invoiceIds: invoices.map((item) => item.id),
      transactionIds: transactions.map((item) => item.id), checkIds: checks.map((item) => item.id),
    }), createdAt: new Date(),
  });
  return result;
}));

router.get('/suppliers/:id/aging', access('view'), handle((req) => application.getSupplierAging(
  req.params.id, date(req.query.asOf ?? new Date().toISOString(), 'تاریخ گزارش'),
)));

router.post('/posting-rules', access('admin'), handle(async (req) => {
  const body = req.body ?? {};
  const effectiveFrom = date(body.effectiveFrom, 'تاریخ اثر قاعده');
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${String(body.bookId)} || ':' || ${String(body.accountRole)}))`;
    const account = await tx.accountingLedgerAccount.findFirst({ where: { id: String(body.accountId), bookId: String(body.bookId), level: 'MOIN', retiredAt: null } });
    if (!account) throw new SupplyChainAccountingError('POSTING_ACCOUNT_INVALID', 'حساب معین فعال برای قاعده ثبت یافت نشد.', 400);
    const previous = await tx.accountingSupplyChainPostingRule.findFirst({ where: { bookId: String(body.bookId), accountRole: String(body.accountRole), effectiveTo: null }, orderBy: { version: 'desc' } });
    if (previous && previous.effectiveFrom >= effectiveFrom) throw new SupplyChainAccountingError('POSTING_RULE_EFFECTIVE_DATE_CONFLICT', 'تاریخ نسخه جدید باید بعد از نسخه فعال باشد.', 409);
    if (previous) await tx.accountingSupplyChainPostingRule.update({ where: { id: previous.id }, data: { effectiveTo: new Date(effectiveFrom.getTime() - 1) } });
    return tx.accountingSupplyChainPostingRule.create({ data: {
      bookId: String(body.bookId), accountRole: String(body.accountRole), accountId: account.id,
      version: (previous?.version ?? 0) + 1, effectiveFrom, createdBy: req.user!.id,
    } });
  });
}, true));

router.post('/supplier-relationships', access('edit'), handle(async (req) => application.approveSupplierRelationship({
  partyId: String(req.body.partyId), evidence: await evidence(req.body.evidence), actor: actorOf(req),
}), true));

router.post('/supplier-invoices', access('edit'), handle(async (req) => application.recognizeSupplierInvoice({
  ...ledgerContext(req.body), idempotencyKey: String(req.body.idempotencyKey || req.get('Idempotency-Key') || ''),
  correlationId: String(req.body.correlationId || req.get('X-Correlation-ID') || randomUUID()),
  supplierPartyId: String(req.body.supplierPartyId), supplierInvoiceNumber: String(req.body.supplierInvoiceNumber),
  dueDate: date(req.body.dueDate, 'سررسید فاکتور'), actor: actorOf(req), evidence: await evidence(req.body.evidence),
  lines: await purchaseLines(req.body.lines),
}), true));

router.post('/supplier-invoices/:id/corrections', access('edit'), handle(async (req) => application.recordSupplierCorrection({
  ...ledgerContext(req.body), correctionOfInvoiceId: req.params.id, dueDate: date(req.body.dueDate, 'سررسید سند اصلاحی'),
  supplierInvoiceNumber: String(req.body.supplierInvoiceNumber), reason: String(req.body.reason),
  idempotencyKey: String(req.body.idempotencyKey || req.get('Idempotency-Key') || ''),
  correlationId: String(req.body.correlationId || req.get('X-Correlation-ID') || randomUUID()),
  evidence: await evidence(req.body.evidence), actor: actorOf(req), lines: await purchaseLines(req.body.lines),
  inventoryReturns: await Promise.all((req.body.inventoryReturns ?? []).map(async (item: any) => ({
    identityId: String(item.identityId), quantity: String(item.quantity), unit: String(item.unit),
    sourceWarehouseId: String(item.sourceWarehouseId), sourceLocationId: String(item.sourceLocationId),
    warehouseId: String(item.warehouseId), locationId: String(item.locationId), evidence: await evidence(item.evidence),
  }))),
}), true));

router.post('/supplier-payments', access('edit'), handle(async (req) => application.recordSupplierPayment({
  ...ledgerContext(req.body), supplierPartyId: String(req.body.supplierPartyId), financialAccountId: String(req.body.financialAccountId), amountRials: wholeRials(req.body.amountRials),
  occurredAt: date(req.body.occurredAt, 'زمان پرداخت'), idempotencyKey: String(req.body.idempotencyKey || req.get('Idempotency-Key') || ''),
  evidence: await evidence(req.body.evidence), actor: actorOf(req), allocations: (req.body.allocations ?? []).map((item: any) => ({ openItemId: String(item.openItemId), amountRials: wholeRials(item.amountRials) })),
}), true));

router.post('/allocations/:id/reversal', access('admin'), handle(async (req) => application.reverseAllocation({
  ...ledgerContext(req.body), allocationId: req.params.id, reason: String(req.body.reason),
  idempotencyKey: String(req.body.idempotencyKey || req.get('Idempotency-Key') || ''),
  evidence: await evidence(req.body.evidence), actor: actorOf(req),
}), true));
router.post('/inventory/movements', access('edit'), handle(async (req) => application.recordPhysicalMovement({
  identityId: String(req.body.identityId), quantity: String(req.body.quantity), unit: String(req.body.unit),
  sourceWarehouseId: String(req.body.sourceWarehouseId), sourceLocationId: String(req.body.sourceLocationId),
  warehouseId: String(req.body.warehouseId), locationId: String(req.body.locationId),
  occurredAt: date(req.body.occurredAt, 'زمان جابه‌جایی'), evidence: await evidence(req.body.evidence), actor: actorOf(req),
}), true));
router.post('/inventory/reservations', access('edit'), handle(async (req) => application.reserveInventory({
  identityId: String(req.body.identityId), quantity: String(req.body.quantity), unit: String(req.body.unit), purposeId: String(req.body.purposeId),
  idempotencyKey: String(req.body.idempotencyKey || req.get('Idempotency-Key') || ''), evidence: await evidence(req.body.evidence), actor: actorOf(req),
}), true));
router.post('/inventory/reservations/:id/release', access('edit'), handle(async (req) => application.releaseInventoryReservation({
  reservationId: req.params.id, evidence: await evidence(req.body.evidence), actor: actorOf(req),
}), true));
router.post('/inventory/consumptions', access('edit'), handle(async (req) => application.consumeInventory({
  ...ledgerContext(req.body), identityId: String(req.body.identityId), quantity: String(req.body.quantity), unit: String(req.body.unit),
  sourceWarehouseId: String(req.body.sourceWarehouseId), sourceLocationId: String(req.body.sourceLocationId),
  purpose: req.body.purpose, idempotencyKey: String(req.body.idempotencyKey || req.get('Idempotency-Key') || ''), evidence: await evidence(req.body.evidence), actor: actorOf(req),
  reservationId: req.body.reservationId ? String(req.body.reservationId) : undefined,
  reservationPurposeId: req.body.reservationPurposeId ? String(req.body.reservationPurposeId) : undefined,
}), true));

router.post('/production', access('edit'), handle(async (req) => application.completeProduction({
  ...ledgerContext(req.body), batchId: String(req.body.batchId), idempotencyKey: String(req.body.idempotencyKey || req.get('Idempotency-Key') || ''),
  evidence: await evidence(req.body.evidence), actor: actorOf(req), inputs: req.body.inputs ?? [], outputs: req.body.outputs ?? [],
  costPools: (req.body.costPools ?? []).map((item: any) => ({ ...item, amountRials: wholeRials(item.amountRials) })),
  normalWaste: req.body.normalWaste, abnormalWaste: req.body.abnormalWaste,
}), true));

router.post('/checks', access('edit'), handle(async (req) => application.issuePayableCheck({
  ...ledgerContext(req.body), sayadId: String(req.body.sayadId), amountRials: wholeRials(req.body.amountRials), supplierPartyId: String(req.body.supplierPartyId),
  financialAccountId: String(req.body.financialAccountId), dueDate: date(req.body.dueDate, 'سررسید چک'),
  idempotencyKey: String(req.body.idempotencyKey || req.get('Idempotency-Key') || ''), evidence: await evidence(req.body.evidence), actor: actorOf(req),
  allocations: (req.body.allocations ?? []).map((item: any) => ({ openItemId: String(item.openItemId), amountRials: wholeRials(item.amountRials) })),
  replacesCheckId: req.body.replacesCheckId ? String(req.body.replacesCheckId) : undefined,
}), true));
router.post('/checks/assigned-customer', access('edit'), handle(async (req) => application.assignCustomerCheck({
  ...ledgerContext(req.body), sayadId: String(req.body.sayadId), amountRials: wholeRials(req.body.amountRials), supplierPartyId: String(req.body.supplierPartyId),
  financialAccountId: String(req.body.financialAccountId), dueDate: date(req.body.dueDate, 'سررسید چک'), sourceCustomerPaymentId: String(req.body.sourceCustomerPaymentId),
  idempotencyKey: String(req.body.idempotencyKey || req.get('Idempotency-Key') || ''), receiptEvidence: await evidence(req.body.receiptEvidence),
  endorsementEvidence: await evidence(req.body.endorsementEvidence), actor: actorOf(req),
  allocations: (req.body.allocations ?? []).map((item: any) => ({ openItemId: String(item.openItemId), amountRials: wholeRials(item.amountRials) })),
  replacesCheckId: req.body.replacesCheckId ? String(req.body.replacesCheckId) : undefined,
}), true));
router.post('/checks/:id/transitions', access('edit'), handle(async (req) => application.transitionCheck({
  ...ledgerContext(req.body), checkId: req.params.id, to: req.body.to, reason: String(req.body.reason), evidence: await evidence(req.body.evidence), actor: actorOf(req),
}), true));

router.post('/opening-inventory/preview', access('admin'), handle((req) => application.previewOpeningInventory({
  sourcePackageHash: String(req.body.sourcePackageHash), mappingVersion: Number(req.body.mappingVersion), toolVersion: String(req.body.toolVersion), scope: req.body.scope, actor: actorOf(req),
  sepidarControlRials: wholeRials(req.body.sepidarControlRials), predecessorRunId: req.body.predecessorRunId ? String(req.body.predecessorRunId) : undefined,
  items: (req.body.items ?? []).map((item: any) => item.disposition === 'REJECTED' ? ({
    sourceId: String(item.sourceId ?? ''), identityId: String(item.identityId || `rejected:${item.sourceId ?? randomUUID()}`),
    warehouseId: String(item.warehouseId || 'REJECTED'), locationId: String(item.locationId || 'REJECTED'),
    unit: String(item.unit || 'UNKNOWN'), quantity: '0.000001', valueRials: 0n,
    valuationMethod: ['SPECIFIC_IDENTIFICATION', 'MOVING_WEIGHTED_AVERAGE'].includes(item.valuationMethod) ? item.valuationMethod : 'SPECIFIC_IDENTIFICATION',
    disposition: 'REJECTED', rejectionReason: String(item.rejectionReason ?? ''), rawPayload: item,
  }) : ({ ...item, valueRials: wholeRials(item.valueRials) })),
}), true));
router.post('/opening-inventory/:id/commit', access('admin'), handle((req) => application.commitOpeningInventory({
  ...ledgerContext(req.body), runId: req.params.id, idempotencyKey: String(req.body.idempotencyKey || req.get('Idempotency-Key') || ''), actor: actorOf(req),
}), true));

export default router;
