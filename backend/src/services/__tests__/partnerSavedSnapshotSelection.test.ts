import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalHash, PartnerTechnicalDraftSchema } from '@sabalanerp/partner-sales-contracts';
import { createPartnerTechnicalCatalogFixtures } from '@sabalanerp/partner-sales-contracts/testing';
import { compilePartnerTechnicalGraph } from '../partnerSales/cases/technicalGraph';
import { encodeTechnicalSavedSnapshot, latestTechnicalSavedSnapshot, technicalSavedSnapshotAtRevision } from '../partnerSales/cases/technicalSavedRecords';

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


test('latest presentation skips older payload work while rejecting corrupt newer evidence and preserving first-valid ties', async () => {
  const first = await evidence(3), second = await evidence(3);
  let unrelatedReads = 0;
  const older = { payload: { view: { recoveryRevision: 1 }, get context() { unrelatedReads++; throw Error('unrelated historical payload'); } }, integrityHash: 'corrupt' };
  const records = [older, first.record, { payload: { view: { recoveryRevision: 9 } }, integrityHash: 'corrupt' }, second.record];
  const selected = await latestTechnicalSavedSnapshot(records);
  assert.equal(selected?.view.recoveryRevision, 3);
  assert.equal(selected?.context, (first.record.payload as any).context);
  assert.equal(unrelatedReads, 0, 'an older unrelated snapshot must not enter parsing or hashing');
  assert.equal(records[0], older, 'selection must not reorder stored history');
  assert.equal(await latestTechnicalSavedSnapshot([{ ...first.record, integrityHash: 'corrupt' }]), undefined);
});

test('revision presentation verifies only matching candidates, keeps last-valid ties and rejects corruption', async () => {
  const first = await evidence(3), last = await evidence(3);
  let unrelatedReads = 0;
  const unrelated = { payload: { view: { recoveryRevision: 1 }, get context() { unrelatedReads++; throw Error('unrelated historical payload'); } }, integrityHash: 'corrupt' };
  const corrupt = { ...last.record, integrityHash: 'corrupt' };
  const selected = await technicalSavedSnapshotAtRevision([first.record, unrelated, last.record, corrupt], 3);
  assert.equal(selected?.context, (last.record.payload as any).context);
  assert.equal(unrelatedReads, 0, 'other revisions must not enter parsing or hashing');
  assert.equal((await technicalSavedSnapshotAtRevision([first.record, corrupt], 3))?.context, (first.record.payload as any).context);
  assert.equal(await technicalSavedSnapshotAtRevision([corrupt], 3), undefined);
  assert.equal(await technicalSavedSnapshotAtRevision([first.record], 9), undefined);
});

test('revision hints never bypass graph coherence and legacy evidence retains its derived graph hash', async () => {
  const { record } = await evidence(3);
  const legacyPayload = structuredClone(record.payload) as any;
  delete legacyPayload.view.graphHash;
  const legacy = { payload: legacyPayload, integrityHash: await canonicalHash(legacyPayload) };
  const forgedPayload = structuredClone(record.payload) as any;
  forgedPayload.view.recoveryRevision = 9;
  const forged = { payload: forgedPayload, integrityHash: await canonicalHash(forgedPayload) };
  const selected = await latestTechnicalSavedSnapshot([legacy, forged]);
  assert.equal(selected?.view.recoveryRevision, 3, 'a valid envelope hash does not excuse mismatched row revision refs');
  assert.match(selected?.view.graphHash ?? '', /^sha256-v1:[a-f0-9]{64}$/);
  assert.equal(await technicalSavedSnapshotAtRevision([forged], 9), undefined);
  assert.equal((await technicalSavedSnapshotAtRevision([legacy], 3))?.view.graphHash, selected?.view.graphHash);
  assert.equal(await latestTechnicalSavedSnapshot([null, {}, { payload: { view: { recoveryRevision: '3' } } }]), undefined);
});
