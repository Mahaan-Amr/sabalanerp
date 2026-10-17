import assert from 'node:assert/strict';
import type { Prisma, PrismaClient } from '@prisma/client';
import { canonicalHash, PaymentPlanSchema } from '@sabalanerp/partner-sales-contracts';
import { createPartnerFixtures } from '@sabalanerp/partner-sales-contracts/testing';
import { parseCanonicalProductGraph } from '@sabalanerp/contract-product-graph';
import { buildCaseProjections } from '../partnerSales/cases/projections';
import { projectionEvidence } from '../partnerSales/cases/lifecycle';
import { withAccountingReadScope } from '../partnerSales/accounting/readScope';
import { PARTNER_INTERNAL_ACCOUNTING_SOURCE, preparePartnerFinancialSource } from '../partnerSales/accounting/source';

/** Fake persistence only: authorization, projection reconstruction, preparation,
 * current plan validation and accounting read scope all execute production code. */
export async function historicalAccountingFixture(status = 'DRAFT') {
  const base = createPartnerFixtures();
  const plan: ReturnType<typeof PaymentPlanSchema.parse> = { ...base.accounting.sabalanPaymentPlan, planId: 'historical-plan-3', version: 3,
    predecessorPlanId: 'historical-plan-2', installments: [] };
  const product = { ...base.accounting.products[0], configurationHash: `sha256-v1:${'a'.repeat(64)}` };
  const graph = parseCanonicalProductGraph({ schemaVersion: 1, revision: 1,
    calculationPolicy: { calculation: 'calculation-v1', packing: 'packing-v1', pricing: 'pricing-v1', rounding: 'rounding-v1' },
    catalogSnapshots: [{ catalogProductId: 'fixture-stone', snapshotVersion: 'catalog-v1', facts: {} }],
    rows: [{ productRowId: product.productRowId, catalogProductId: 'fixture-stone', catalogSnapshotVersion: 'catalog-v1',
      productType: 'longitudinal', contractualTitle: product.description, commercial: { requestedLengthMeters: '1',
        requestedQuantity: '2', requestedAreaSquareMeters: '1', totalAmountToman: '200', calculationSnapshot: { quantityMode: 'piece-count' } } }],
    stairSystems: [], layerConfigurations: [], sourceBatches: [], remainingStones: [], allocations: [], operationGroups: [], toolSelections: [], finishingSelections: [] });
  const evidence = { graphHash: await canonicalHash({ purpose: 'PARTNER_CASE_GRAPH', schemaVersion: 1, graph }), graph,
    partySnapshots: { partner: base.accounting.debtor, customer: base.customer.customer },
    wholesaleEnvelope: { schemaVersion: 1, products: [product], totals: base.accounting.totals, termsVersionId: 'fixture-terms' },
    retailEnvelope: { schemaVersion: 1, products: base.customer.products, totals: base.customer.totals, belowCostConfirmed: false },
    paymentEvidence: { customerPaymentPlan: base.customer.customerPaymentPlan, sabalanPaymentPlan: plan },
    customerContent: { contractDate: base.customer.contractDate, legalText: base.customer.legalText,
      deliveries: base.customer.deliveries, confirmation: 'NOT_SENT', signatures: [] } };
  const integrityHash = await canonicalHash({ purpose: 'PARTNER_CASE_REVISION', schemaVersion: 1, ...evidence });
  const projected = await buildCaseProjections({ caseId: 'historical-case', revision: 1, integrityHash,
    caseNumber: 'historical-case-number', internalRecordId: 'historical-internal', internalRecordNumber: 'historical-internal-number',
    customerContractNumber: 'historical-contract-number', commercialAccountId: 'historical-account', state: 'DRAFT',
    evidence: projectionEvidence(evidence as never)! });
  assert.ok(projected.ok);
  assert.ok(projected.value.accounting);
  const prepared = await preparePartnerFinancialSource({ view: { ...projected.value.accounting, state: 'COMMITTED' },
    partnerSellerId: 'historical-partner' }, projected.value.accounting.owner);
  assert.ok(prepared.ok);
  const revision = { ...evidence, integrityHash, pricingState: 'READY_TO_FINALIZE', predecessorRevision: null,
    internalProjection: { partner: projected.value.partner, accounting: projected.value.accounting, fulfillment: projected.value.fulfillment },
    customerProjection: projected.value.customer };
  const row = { id: 'historical-case', profileId: 'historical-profile', state: 'COMMITTED', headRevision: 1,
    integrityHash, pricingState: 'READY_TO_FINALIZE', caseNumber: 'historical-case-number', head: revision,
    customerConfirmationState: 'NOT_SENT', internalRecordId: 'historical-internal', customerContractId: 'historical-contract',
    profile: { userId: 'historical-partner' }, customer: { firstName: 'Fixture', lastName: 'Customer', companyName: null },
    internalRecord: { recordNumber: 'historical-internal-number', commercialAccountId: 'historical-account',
      pricingState: 'READY_TO_FINALIZE', expectedRevision: 1, integrityHash },
    customerContract: { contractNumber: 'historical-contract-number', partnerRevision: 1, partnerIntegrityHash: integrityHash } };
  const currentPlan = { ...structuredClone(plan), planId: 'current-plan-4', version: 4, predecessorPlanId: plan.planId };
  const persistedPlan = { id: currentPlan.planId, caseId: row.id, caseRevision: 1, purpose: 'SABALAN', version: 4,
    predecessorId: plan.planId, effectiveDate: new Date(currentPlan.effectiveDate), evidence: currentPlan, installments: [],
    predecessor: { id: plan.planId, caseId: row.id, purpose: 'SABALAN', version: 3 },
    integrityHash: await canonicalHash({ purpose: 'PARTNER_SABALAN_PAYMENT_PLAN', schemaVersion: 1, caseId: row.id, revision: 1, plan: currentPlan }) };
  const storedPlans = new Map([[persistedPlan.id, persistedPlan]]);
  const invoice = { id: 'historical-invoice', kind: 'INVOICE_CANDIDATE', sourceId: row.internalRecordId, sourceKind: PARTNER_INTERNAL_ACCOUNTING_SOURCE,
    status, amount: prepared.value.amount.amount, currency: prepared.value.amount.currency,
    sourceSnapshot: { partnerPreparation: prepared.value }, metadata: { partnerCaseId: row.id } };
  const writes: string[] = [];
  const emptyModel = new Proxy({}, { get: (_target, method) => async () => {
    if (method === 'findMany') return [];
    if (method === 'findFirst' || method === 'findUnique') return null;
    throw new Error(`Unexpected persistence mutation: ${String(method)}`);
  } });
  const persistence: Record<string, unknown> = {
    partnerSaleCase: { findMany: async () => [row], findUnique: async () => row },
    partnerCaseRevision: { findUnique: async () => revision },
    partnerProfile: { findUnique: async () => ({ id: row.profileId, userId: row.profile.userId, state: 'ACTIVE', revision: 1 }) },
    user: { findUnique: async () => ({ id: 'historical-admin', role: 'ADMIN', isActive: true, partnerProfile: null }) },
    accountingFinancialRecord: { findMany: async (args: { where?: { NOT?: unknown; sourceId?: { in?: string[] } } }) =>
      args.where?.NOT || args.where?.sourceId?.in?.length === 0 ? [] : [invoice] },
    partnerPaymentPlan: { findFirst: async () => persistedPlan,
      findUnique: async (args: { where: { id: string } }) => storedPlans.get(args.where.id) ?? null },
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('SELECT clock_timestamp()')) return [{ now: new Date('2026-10-12T08:00:00Z') }];
      if (sql.includes('SELECT revision FROM effective_authorization_state')) return [{ revision: 1 }];
      return [];
    },
    $executeRaw: async (strings: TemplateStringsArray) => {
      assert.match(strings.join('?'), /INSERT INTO effective_authorization_audit/);
      writes.push('AUTHORIZATION_AUDIT'); return 1;
    },
  };
  const tx = new Proxy(persistence, { get: (target, key: string) => target[key] ?? emptyModel });
  const database = { $transaction: async (read: (value: unknown) => unknown) => read(tx) } as unknown as PrismaClient;
  const read = () => withAccountingReadScope(database, { userId: 'historical-admin' }, async scope => {
    assert.equal(scope.partnerAccountingIncluded, true);
    const contexts = await Promise.all([
      scope.contextualize('FINANCIAL', [invoice]),
      scope.contextualize('RECEIVABLE', [{ id: 'historical-receivable', invoiceRecordId: invoice.id }]),
      scope.contextualize('PAYMENT', [{ id: 'historical-payment', invoiceRecordId: invoice.id }]),
      scope.contextualize('TAX', [{ id: 'historical-tax', invoiceRecordId: invoice.id, submissionStatus: 'READY' }]),
      scope.contextualize('AUDIT', [{ id: 'historical-audit', entityType: 'AccountingFinancialRecord', entityId: invoice.id }]),
    ]);
    for (const [context] of contexts) assert.equal(context.partnerContext?.caseId, row.id);
    return contexts;
  });
  return { read, invoice, row, revision, persistedPlan, storedPlans, tx: tx as unknown as Prisma.TransactionClient, writes };
}

/** Shape emitted by setSabalanPaymentPlan: revision has an empty v3 plan,
 * while the invoice preparation binds a separately persisted nonempty v4. */
export async function writerBoundAccountingFixture(advanceCurrentPlan = false) {
  const f = await historicalAccountingFixture();
  const plan = f.persistedPlan.evidence;
  const installment = { installmentId: 'bound-plan-installment', dueDate: plan.effectiveDate,
    amount: { amount: f.invoice.amount, currency: f.invoice.currency }, method: 'CASH' as const,
    notes: 'operational note retained only in plan history' };
  plan.installments.push(installment as never);
  f.persistedPlan.installments.push({ id: installment.installmentId, dueDate: new Date(installment.dueDate),
    amount: installment.amount.amount, currency: installment.amount.currency, method: installment.method,
    evidence: installment } as never);
  f.persistedPlan.integrityHash = await canonicalHash({ purpose: 'PARTNER_SABALAN_PAYMENT_PLAN', schemaVersion: 1,
    caseId: f.row.id, revision: 1, plan });
  const prepared = await preparePartnerFinancialSource({ view: { ...f.revision.internalProjection.accounting!,
    state: 'COMMITTED', sabalanPaymentPlan: plan }, partnerSellerId: f.row.profile.userId }, f.invoice.sourceSnapshot.partnerPreparation.owner);
  assert.ok(prepared.ok);
  f.invoice.sourceSnapshot.partnerPreparation = prepared.value;
  const boundPlan = structuredClone(f.persistedPlan);
  f.storedPlans.set(boundPlan.id, boundPlan);
  if (advanceCurrentPlan) {
    const current = { ...plan, planId: 'current-plan-5', version: 5, predecessorPlanId: plan.planId,
      installments: [{ ...installment, installmentId: 'later-plan-installment', notes: 'later operational note' }] };
    Object.assign(f.persistedPlan, { id: current.planId, version: 5, predecessorId: plan.planId, evidence: current,
      predecessor: { id: plan.planId, caseId: f.row.id, purpose: 'SABALAN', version: 4 },
      installments: [{ ...boundPlan.installments[0] as object, id: current.installments[0].installmentId, evidence: current.installments[0] }],
      integrityHash: await canonicalHash({ purpose: 'PARTNER_SABALAN_PAYMENT_PLAN', schemaVersion: 1,
        caseId: f.row.id, revision: 1, plan: current }) });
    f.storedPlans.set(f.persistedPlan.id, f.persistedPlan);
  }
  return { ...f, boundPlan };
}
