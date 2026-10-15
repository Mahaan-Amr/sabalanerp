import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { once } from 'node:events';
import { createPartnerCaseRouter } from '../partner-cases';
import { PARTNER_TECHNICAL_RECOVERY_KIND } from '../../services/contractRecoveryProtection';

test('a saved technical draft without a wizard is absent, while a corrupt wizard fails closed', async () => {
  let wizardDraft: unknown = undefined;
  const database = { salesContractEditSession: { findUnique: async () => ({ ownerUserId: 'partner-test', purpose: 'PARTNER_TECHNICAL',
    recovery: { kind: PARTNER_TECHNICAL_RECOVERY_KIND, version: 1, recoveryRevision: 1, updatedAt: Date.now(),
      draft: { schemaVersion: 1, inputRevision: 1, rows: [] }, ...(wizardDraft === undefined ? {} : { wizardDraft }) } }) } };
  const app = express();
  app.use('/cases', createPartnerCaseRouter({ database: database as never, authenticate: (request, _response, next) => {
    (request as any).user = { id: 'partner-test' }; next();
  } }));
  const server = app.listen(0); await once(server, 'listening');
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing address');
    const url = `http://127.0.0.1:${address.port}/cases/drafts/recovery-test/wizard`;
    const absent = await fetch(url);
    assert.equal(absent.status, 404);
    wizardDraft = { corrupt: true };
    const corrupt = await fetch(url);
    assert.equal(corrupt.status, 409);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

 test('wizard read retains its validated draft across newer checkpoints and rejects foreign owners or corrupted history', async () => {
  const { canonicalHash, PartnerTechnicalDraftSchema } = await import('@sabalanerp/partner-sales-contracts');
  const { createPartnerFixtures, createPartnerTechnicalCatalogFixtures } = await import('@sabalanerp/partner-sales-contracts/testing');
  const { compilePartnerTechnicalGraph } = await import('../../services/partnerSales/cases/technicalGraph');
  const { encodeTechnicalSavedSnapshot } = await import('../../services/partnerSales/cases/technicalSavedRecords');
  const catalog = createPartnerTechnicalCatalogFixtures(); const product = catalog.products[0];
  const context = { catalog, policy: { calculation: 'calc', packing: 'packing', pricing: 'pricing', rounding: 'rounding' },
    products: [{ catalogItemId: product.catalogItemId, catalogSnapshotVersion: product.catalogSnapshotVersion,
      preparedRates: [{ kind: 'readyPiece' as const, unit: 'count' as const, rateToman: '12345' }] }] };
  const draft = PartnerTechnicalDraftSchema.parse({ schemaVersion: 1, inputRevision: 12, rows: [{
    productRowId: 'row', catalogItemId: product.catalogItemId, catalogSnapshotVersion: product.catalogSnapshotVersion,
    family: 'prepared', configuration: { kind: 'readyPiece', unit: 'count', quantity: '2' } }] });
  const compiled = compilePartnerTechnicalGraph(draft, context); assert.ok(compiled.ok);
  const graphHash = await canonicalHash({ purpose: 'PARTNER_CASE_GRAPH', schemaVersion: 1, graph: compiled.value.graph });
  const record = await encodeTechnicalSavedSnapshot({ version: 1, sessionId: 'session', draft, context,
    graph: compiled.value.graph, identities: [{ productRowId: 'row', identity: {
      schemaVersion: 1, partnerSellerId: 'partner-test', catalogProductId: product.catalogItemId, family: 'prepared', unit: 'count',
      configuration: [{ key: 'quantity', value: '2' }], materialRateEvidenceId: 'rate',
      materialRateHash: 'sha256-v1:' + 'a'.repeat(64), components: [], currency: 'IRT',
      calculationPolicyVersion: 'calc', roundingPolicyVersion: 'rounding' } }],
    view: { schemaVersion: 1, recoveryId: 'recovery-test', recoveryRevision: 12, inputRevision: 12, graphHash,
      updatedAt: '2026-10-11T10:00:00.000Z', rows: [{ configurationRef: {
        recoveryId: 'recovery-test', recoveryRevision: 12, productRowId: 'row' }, quantity: '2', unit: 'count', configurationChange: 'NEW' }] } });
  const fixture = createPartnerFixtures();
  const intent = { ...fixture.draftSubmissionReference, recoveryId: 'recovery-test', recoveryRevision: 12, graphHash,
    contractDate: '2026-10-11', preparationCompleted: false,
    rows: [{ productRowId: 'row', retailUnitPrice: { amount: '12345', currency: 'IRT' } }],
    customerPaymentPlan: { planId: 'retained-plan', version: 1, effectiveDate: '2026-10-11', installments: [] },
    deliveries: [],
    retailDiscount: { amount: '0', currency: 'IRT' }, belowCostConfirmed: false };
  let ownerUserId = 'partner-test';
  const recovery = { kind: PARTNER_TECHNICAL_RECOVERY_KIND, version: 1, recoveryRevision: 16, updatedAt: Date.now(),
    draft: { ...draft, inputRevision: 16, editingValues: [{ entityId: 'row', field: 'quantity', text: '۳٫' }] },
    validatedSnapshots: [record], wizardDraft: { schemaVersion: 1, wizardRevision: 3, step: 'delivery', intent,
      reviewedCorrectionRequestId: 'reviewed-request-1',
      updatedAt: '2026-10-11T10:00:00.000Z' } };
  const before = JSON.stringify(recovery);
  const { PartnerWizardRecoverySnapshotSchema } = await import('@sabalanerp/partner-sales-contracts');
  const decodedWizard = PartnerWizardRecoverySnapshotSchema.safeParse(recovery.wizardDraft);
  assert.ok(decodedWizard.success, JSON.stringify(decodedWizard.success ? null : decodedWizard.error.issues));
  const { decodeTechnicalSavedSnapshot } = await import('../../services/partnerSales/cases/technicalSavedRecords');
  assert.ok(await decodeTechnicalSavedSnapshot(record), 'snapshot fixture must pass immutable graph decoding');
  const database = { salesContractEditSession: { findUnique: async () => ({ id: 'session', ownerUserId,
    purpose: 'PARTNER_TECHNICAL', recovery }) } };
  const app = express(); app.use('/cases', createPartnerCaseRouter({ database: database as never,
    authenticate: (request, _response, next) => { (request as any).user = { id: 'partner-test' }; next(); } }));
  const server = app.listen(0); await once(server, 'listening');
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing address');
    const url = `http://127.0.0.1:${address.port}/cases/drafts/recovery-test/wizard`;
    const response = await fetch(url); assert.equal(response.status, 200);
    const body = await response.json() as { data: { validatedDraft: unknown; step: string; intent: unknown; reviewedCorrectionRequestId: string } };
    assert.equal(body.data.reviewedCorrectionRequestId, 'reviewed-request-1');
    assert.deepEqual(body.data.validatedDraft, draft); assert.deepEqual(body.data.intent, intent);
    assert.equal(body.data.step, 'delivery'); assert.equal(JSON.stringify(recovery), before);
    ownerUserId = 'other-owner'; assert.equal((await fetch(url)).status, 404);
    ownerUserId = 'partner-test'; record.integrityHash = 'corrupted'; assert.equal((await fetch(url)).status, 409);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
 });
