import assert from 'node:assert/strict';
import test from 'node:test';
import { PartnerTechnicalDraftSchema, partnerError } from '@sabalanerp/partner-sales-contracts';
import { createPartnerTechnicalCatalogFixtures } from '@sabalanerp/partner-sales-contracts/testing';
import { compilePartnerTechnicalGraph, type PartnerTechnicalGraphContext } from '../partnerSales/cases/technicalGraph';
import { compileOrReuseTechnicalSavedGraph } from '../partnerSales/cases/technicalSavedGraph';
import type { TechnicalSavedSnapshot } from '../partnerSales/cases/technicalSavedRecords';
import { createPrismaPartnerTechnicalSaveService } from '../partnerSales/cases/technicalSave';

function fixture() {
  const catalog = createPartnerTechnicalCatalogFixtures();
  const product = catalog.products[0];
  const context: PartnerTechnicalGraphContext = { catalog,
    policy: { calculation: 'calc-v1', packing: 'packing-v1', pricing: 'pricing-v1', rounding: 'rounding-v1' },
    products: [{ catalogItemId: product.catalogItemId, catalogSnapshotVersion: product.catalogSnapshotVersion,
      preparedRates: [{ kind: 'readyPiece', unit: 'count', rateToman: '12345' }] }] };
  const draft = PartnerTechnicalDraftSchema.parse({ schemaVersion: 1, inputRevision: 1, rows: [{
    productRowId: 'prepared-row', catalogItemId: product.catalogItemId, catalogSnapshotVersion: product.catalogSnapshotVersion,
    family: 'prepared', configuration: { kind: 'readyPiece', unit: 'count', quantity: '2' },
  }] });
  const compiled = compilePartnerTechnicalGraph(draft, context);
  if (!compiled.ok) throw new Error(compiled.error.code);
  const previous: TechnicalSavedSnapshot = { version: 1, sessionId: 'session', draft, context,
    graph: compiled.value.graph, identities: [], view: { schemaVersion: 1, recoveryId: 'recovery', recoveryRevision: 1,
      inputRevision: 1, graphHash: 'sha256-v1:' + 'a'.repeat(64), updatedAt: '2026-10-06T00:00:00.000Z',
      rows: [{ configurationRef: { recoveryId: 'recovery', recoveryRevision: 1, productRowId: 'prepared-row' },
        quantity: '2', unit: 'count', configurationChange: 'NEW' }] } };
  return { draft, context, previous };
}

test('validated unchanged graph is reused when only input correlation advances', () => {
  const { draft, context, previous } = fixture();
  const result = compileOrReuseTechnicalSavedGraph({ ...draft, inputRevision: 2 }, structuredClone(context), previous);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.graph, previous.graph);
  assert.deepEqual(result.value.measures, [{ productRowId: 'prepared-row', quantity: '2', unit: 'count' }]);
});

test('quantity, retail price and display intent changes compile fresh canonical output', () => {
  const { draft, context, previous } = fixture();
  for (const change of [{ configuration: { ...draft.rows[0].configuration, quantity: '3' } },
    { retailUnitPrice: { amount: '20000', currency: 'IRT' } }, { contractualTitle: 'عنوان تازه' }, { description: 'شرح تازه' }]) {
    const changed = PartnerTechnicalDraftSchema.parse({ ...draft, rows: [{ ...draft.rows[0], ...change }] });
    const result = compileOrReuseTechnicalSavedGraph(changed, context, previous);
    const expected = compilePartnerTechnicalGraph(changed, context);
    assert.equal(result.ok, true);
    if (!result.ok || !expected.ok) throw new Error('Changed intent was rejected');
    assert.notEqual(result.value.graph, previous.graph);
    assert.deepEqual(result.value.graph, expected.value.graph);
    assert.deepEqual(result.value.measures, expected.value.measures);
  }
});

test('owner evidence changes and historical calculation basis force compilation', () => {
  const { draft, context, previous } = fixture();
  const changed = structuredClone(context);
  changed.products = changed.products.map(product => ({ ...product,
    preparedRates: [{ kind: 'readyPiece', unit: 'count', rateToman: '20000' }] }));
  const result = compileOrReuseTechnicalSavedGraph(draft, changed, previous);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.notEqual(result.value.graph, previous.graph);
    assert.equal(result.value.graph.rows[0].commercial.baseRateToman, '20000');
  }
  const { partnerPricingBasis: _basis, ...legacyCalculation } = previous.graph.rows[0].commercial.calculationSnapshot!;
  const legacy = { ...previous, graph: { ...previous.graph, rows: previous.graph.rows.map(row => ({ ...row,
    commercial: { ...row.commercial, calculationSnapshot: legacyCalculation } })) } };
  const migrated = compileOrReuseTechnicalSavedGraph(draft, context, legacy);
  assert.equal(migrated.ok, true);
  if (migrated.ok) {
    assert.notEqual(migrated.value.graph, legacy.graph);
    assert.equal(migrated.value.graph.rows[0].commercial.calculationSnapshot?.partnerPricingBasis, 'ordinary-sale-v1');
  }
});

test('pending input remains invalid even with an otherwise unchanged validated graph', () => {
  const { draft, context, previous } = fixture();
  const result = compileOrReuseTechnicalSavedGraph({ ...draft,
    editingValues: [{ entityId: 'prepared-row', field: 'quantity', text: '۳٫' }] }, context, previous);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'INVALID_PAYLOAD');
});

test('Prisma save boundary has a bounded deadline and locks operations before recovery; saved reads use SHARE', async () => {
  for (const operation of ['save', 'readSaved'] as const) {
    const queries: string[] = []; let timeout: number | undefined;
    const tx = { $queryRaw: async (parts: TemplateStringsArray) => { queries.push(parts.join('?')); return []; },
      partnerOperationsControl: { findUnique: async () => null },
      salesContractEditSession: { findUnique: async () => ({ ownerUserId: 'actor' }) } };
    const service = createPrismaPartnerTechnicalSaveService({ actorId: 'actor',
      database: { $transaction: async (work: any, options: any) => { timeout = options.timeout; return work(tx); } } as any,
      authorize: async () => ({ ok: false, error: partnerError('FORBIDDEN') }),
      resolveEvidence: async () => { throw new Error('Denied actor must not resolve evidence'); } });
    const access = { schemaVersion: 1 as const, recoveryId: 'recovery', browserSessionId: 'browser', leaseToken: 'lease', baseRevision: 0 };
    const result = operation === 'save' ? await service.save({ ...access, expectedRecoveryRevision: 0,
      idempotencyKey: 'key', draft: fixture().draft }) : await service.readSaved({ ...access, recoveryRevision: 1 });
    assert.equal(result.ok, false);
    assert.equal(timeout, 20_000);
    assert.match(queries[0], /partner_operations_controls/);
    assert.match(queries[0], operation === 'save' ? /FOR UPDATE/ : /FOR SHARE/);
    assert.match(queries[1], /sales_contract_edit_sessions.*FOR UPDATE/);
    assert.equal(queries.length, 2);
  }
});
