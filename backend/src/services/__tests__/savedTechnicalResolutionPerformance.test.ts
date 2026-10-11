import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalHash, PartnerTechnicalDraftSchema } from '@sabalanerp/partner-sales-contracts';
import { createPartnerTechnicalCatalogFixtures } from '@sabalanerp/partner-sales-contracts/testing';
import { compilePartnerTechnicalGraph } from '../partnerSales/cases/technicalGraph';
import { encodeTechnicalSavedSnapshot } from '../partnerSales/cases/technicalSavedRecords';
import { createSavedTechnicalConfigurationResolver, resolveSavedTechnicalConfiguration } from '../partnerSales/inquiries/adapters';

async function evidence(revision = 1) {
  const catalog = createPartnerTechnicalCatalogFixtures();
  const product = catalog.products[0];
  const context = { catalog, policy: { calculation: 'calc', packing: 'packing', pricing: 'pricing', rounding: 'rounding' },
    products: [{ catalogItemId: product.catalogItemId, catalogSnapshotVersion: product.catalogSnapshotVersion,
      preparedRates: [{ kind: 'readyPiece' as const, unit: 'count' as const, rateToman: '12345' }] }] };
  const draft = PartnerTechnicalDraftSchema.parse({ schemaVersion: 1, inputRevision: revision, rows: [{
    productRowId: 'row', catalogItemId: product.catalogItemId, catalogSnapshotVersion: product.catalogSnapshotVersion,
    family: 'prepared', configuration: { kind: 'readyPiece', unit: 'count', quantity: '2' } }] });
  const compiled = compilePartnerTechnicalGraph(draft, context);
  assert.ok(compiled.ok);
  const reference = { recoveryId: 'recovery', recoveryRevision: revision, productRowId: 'row' };
  const record = await encodeTechnicalSavedSnapshot({ version: 1, sessionId: 'session', draft, context,
    graph: compiled.value.graph, identities: [{ productRowId: 'row', identity: {
      schemaVersion: 1, partnerSellerId: 'actor', catalogProductId: product.catalogItemId, family: 'prepared', unit: 'count',
      configuration: [{ key: 'quantity', value: '2' }], materialRateEvidenceId: 'rate',
      materialRateHash: 'sha256-v1:' + 'a'.repeat(64), components: [], currency: 'IRT',
      calculationPolicyVersion: 'calc', roundingPolicyVersion: 'rounding' } }],
    view: { schemaVersion: 1, recoveryId: 'recovery', recoveryRevision: revision, inputRevision: revision,
      graphHash: await canonicalHash({ purpose: 'PARTNER_CASE_GRAPH', schemaVersion: 1, graph: compiled.value.graph }),
      updatedAt: '2026-10-11T10:00:00.000Z', rows: [{ configurationRef: reference, quantity: '2', unit: 'count', configurationChange: 'NEW' }] } });
  return { record, reference };
}

test('resolution verifies the referenced revision without traversing unrelated large payloads', async () => {
  const { record, reference } = await evidence();
  let unrelatedTraversals = 0;
  // Instrument the database JSON boundary to enforce a deterministic work budget,
  // independent of machine speed. Unrelated evidence must not enter hashing/parsing.
  const unrelated = { payload: { view: { recoveryRevision: 2 },
    get context() { unrelatedTraversals++; return { largeCatalog: 'irrelevant' }; } }, integrityHash: 'invalid' };
  const database = { salesContractEditSession: { findUnique: async () => ({ ownerUserId: 'actor',
    recovery: { validatedSnapshots: [unrelated, { ...record, integrityHash: 'corrupt' }, record] } }) } };
  const result = await resolveSavedTechnicalConfiguration(database as any, { actorId: 'actor', reference });
  assert.ok(result.ok, 'a corrupt candidate must not hide a subsequent valid candidate of the same revision');
  assert.equal(result.value.measures?.count, '2');
  assert.equal(unrelatedTraversals, 0);
});

test('scoped resolution separates revisions and actors; a new operation rereads ownership and integrity', async () => {
  const first = await evidence();
  const second = await evidence(2);
  let ownerUserId = 'actor';
  let history = [first.record, second.record];
  let reads = 0;
  const database = { salesContractEditSession: { findUnique: async () => { reads++; return {
    ownerUserId, recovery: { validatedSnapshots: history } }; } } };
  const resolve = createSavedTechnicalConfigurationResolver();
  const results = await Promise.all([first, second].map(item => resolve(database as any, { actorId: 'actor', reference: item.reference })));
  assert.ok(results.every(item => item.ok));
  assert.equal(reads, 1);
  assert.equal((await resolve(database as any, { actorId: 'foreign', reference: first.reference })).ok, false);
  ownerUserId = 'foreign';
  assert.equal((await createSavedTechnicalConfigurationResolver()(database as any, { actorId: 'actor', reference: first.reference })).ok, false);
  ownerUserId = 'actor';
  history = [{ ...first.record, integrityHash: 'corrupt' }];
  assert.equal((await createSavedTechnicalConfigurationResolver()(database as any, { actorId: 'actor', reference: first.reference })).ok, false);
});

test('legacy saved views and submitted evidence retain full integrity checks', async () => {
  const { record, reference } = await evidence();
  const payload = structuredClone(record.payload) as any;
  delete payload.view.graphHash;
  const legacy = { payload, integrityHash: await canonicalHash(payload) };
  const outcome = { schemaVersion: 1, validatedSnapshots: [legacy] };
  let payloadHash = await canonicalHash(outcome);
  const database = { salesContractEditSession: { findUnique: async () => null },
    partnerCommandOutcome: { findUnique: async ({ where }: any) =>
      where.actorId_operation_targetScope_key.actorId === 'actor' ? { outcome, payloadHash } : null } };
  assert.equal((await resolveSavedTechnicalConfiguration(database as any, { actorId: 'actor', reference })).ok, true);
  assert.equal((await resolveSavedTechnicalConfiguration(database as any, { actorId: 'foreign', reference })).ok, false);
  payloadHash = 'corrupt';
  await assert.rejects(resolveSavedTechnicalConfiguration(database as any, { actorId: 'actor', reference }), /integrity conflict/);
});
