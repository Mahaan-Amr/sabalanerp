import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPartnerFixtures } from '@sabalanerp/partner-sales-contracts/testing';
import {
  createPartnerFulfillmentAdapter,
  type PartnerFulfillmentRepository,
  type PartnerFulfillmentCommand,
  type PartnerFulfillmentCommandReceipt,
  type PartnerFulfillmentSource,
  type PartnerFulfillmentTransaction,
  type PartnerPhysicalLineage,
  type PartnerQuantityDependency,
} from '../partnerSales/fulfillment';
import { contracts, type Result } from '../partnerSales/fulfillment/contracts';

class PartnerFulfillmentFixture implements PartnerFulfillmentRepository {
  readonly fixtures = createPartnerFixtures();
  source: PartnerFulfillmentSource = {
    view: { ...this.fixtures.fulfillment },
    graph: { ...this.fixtures.case.graph },
    canonicalGraph: {
      graphHash: this.fixtures.case.graph.graphHash,
      productRowIds: [...this.fixtures.case.graph.productRowIds],
    },
    caseState: 'COMMITTED',
    customer: {
      customerId: this.fixtures.case.customerId,
      displayName: 'مشتری آزمایشی',
      phone: '09120000001',
      destination: 'نشانی آزمایشی مشتری',
    },
  };
  lineages: PartnerPhysicalLineage[] = [];
  dependencies: PartnerQuantityDependency[] = [];
  commands: PartnerFulfillmentCommandReceipt[] = [];
  private tail: Promise<unknown> = Promise.resolve();

  async transaction<T>(operation: (tx: PartnerFulfillmentTransaction) => Promise<Result<T>>): Promise<Result<T>> {
    const run = this.tail.then(async () => {
      const before = structuredClone({ lineages: this.lineages, commands: this.commands });
      const result = await operation({
        readAuthorizedSource: async () => ({ ok: true, value: structuredClone(this.source) }),
        readLineageCommand: async command => this.commands.find(row => row.commandId === command.commandId ||
          contracts.compareIdempotency(row.idempotency, command.idempotency) !== 'DISTINCT') || null,
        findLineage: async (caseId, productRowId) => this.lineages.find(row => row.caseId === caseId && row.productRowId === productRowId) || null,
        commitLineages: async input => {
          if (contracts.checkExpectedRevision(input.command.expected, this.source.view.owner)) {
            return { ok: false, error: contracts.partnerError('ROW_STALE') };
          }
          const evidenceIds: string[] = [];
          for (const lineage of input.lineages) {
            const existing = this.lineages.find(row => row.caseId === lineage.caseId && row.productRowId === lineage.productRowId);
            if (existing && contracts.canonicalJson(existing) !== contracts.canonicalJson(lineage)) {
              return { ok: false, error: contracts.partnerError('INTEGRITY_CONFLICT') };
            }
            if (!existing) this.lineages.push(structuredClone(lineage));
            evidenceIds.push((existing || lineage).lineageId);
          }
          const receipt = { commandId: input.command.commandId, intentHash: input.intentHash,
            idempotency: input.command.idempotency, lineageEvidenceIds: evidenceIds };
          this.commands.push(structuredClone(receipt));
          return { ok: true, value: receipt };
        },
        readQuantityDependencies: async () => structuredClone(this.dependencies),
      });
      if (!result.ok) {
        this.lineages = before.lineages;
        this.commands = before.commands;
      }
      return result;
    });
    this.tail = run.catch(() => undefined);
    return run;
  }
}

const lineageCommand = (fixture: PartnerFulfillmentFixture, commandId = 'fixture-323-command'): PartnerFulfillmentCommand => ({
  schemaVersion: 1,
  commandId,
  correlationId: 'fixture-323-correlation',
  authenticatedActorId: 'fixture-313-partner',
  idempotencyKey: commandId,
  expected: fixture.source.view.owner,
});

const quantityDependency = (
  fixture: PartnerFulfillmentFixture,
  overrides: Partial<PartnerQuantityDependency> = {},
): PartnerQuantityDependency => ({
  sourceKind: 'PARTNER_CASE',
  owner: fixture.source.view.owner,
  internalRecordId: fixture.source.view.recordId,
  productRowId: 'fixture-313-row',
  unit: 'm',
  contracted: '2.000',
  finalizedReserved: '0.000',
  physicallyDispatched: '0.000',
  health: 'CURRENT',
  evidenceIds: [],
  ...overrides,
});

test('committed fulfillment creates one revision-bound direct lineage and reuses it on replay', async () => {
  const fixture = new PartnerFulfillmentFixture();
  const adapter = createPartnerFulfillmentAdapter(fixture);

  const command = lineageCommand(fixture);
  const first = await adapter.ensureCommittedLineage(fixture.source.view, command);
  const replay = await adapter.ensureCommittedLineage(fixture.source.view, command);

  assert.equal(first.ok, true);
  assert.equal(first.ok && first.value.replayed, false);
  assert.equal(replay.ok && replay.value.replayed, true);
  assert.deepEqual(first.ok && first.value.lineageEvidenceIds, replay.ok && replay.value.lineageEvidenceIds);
  assert.equal(fixture.lineages.length, 1);
  assert.deepEqual(fixture.lineages[0], {
    lineageId: fixture.lineages[0]?.lineageId,
    sourceKind: 'PARTNER_CASE',
    caseId: fixture.source.view.owner.caseId,
    createdFrom: fixture.source.view.owner,
    internalRecordId: fixture.source.view.recordId,
    productRowId: fixture.source.view.products[0]?.productRowId,
    quantity: '2.000',
    unit: 'm',
    recipient: fixture.source.customer,
    deliveryIds: ['fixture-313-delivery'],
  });
  assert.equal(JSON.stringify(fixture.lineages).includes('wholesale'), false);
  assert.equal(JSON.stringify(fixture.lineages).includes('retail'), false);
  assert.equal(contracts.FulfillmentViewSchema.safeParse(fixture.source.view).success, true);
});

test('delivery allocation cannot exceed the canonical row quantity', async () => {
  const fixture = new PartnerFulfillmentFixture();
  fixture.source.view.deliveries[0]!.items[0]!.quantity = '2.001';
  const result = await createPartnerFulfillmentAdapter(fixture).ensureCommittedLineage(fixture.source.view, lineageCommand(fixture));

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'INTEGRITY_CONFLICT');
  assert.equal(fixture.lineages.length, 0);
});

test('dependency inspection blocks a successor below reserved plus dispatched quantity', async () => {
  const fixture = new PartnerFulfillmentFixture();
  fixture.dependencies = [quantityDependency(fixture, {
    finalizedReserved: '1.125',
    physicallyDispatched: '0.876', health: 'CURRENT', evidenceIds: ['reservation-evidence', 'dispatch-evidence'],
  })];

  const result = await createPartnerFulfillmentAdapter(fixture).inspectDependencies(fixture.source.view);

  assert.deepEqual(result, { ok: true, value: {
    evidenceIds: ['reservation-evidence', 'dispatch-evidence'],
    blockedProductRowIds: ['fixture-313-row'],
  } });
});

test('a stale graph hash fails closed before physical lineage is created', async () => {
  const fixture = new PartnerFulfillmentFixture();
  fixture.source.graph.graphHash = `sha256-v1:${'b'.repeat(64)}`;

  const result = await createPartnerFulfillmentAdapter(fixture).ensureCommittedLineage(fixture.source.view, lineageCommand(fixture));

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'INTEGRITY_CONFLICT');
  assert.equal(fixture.lineages.length, 0);
});

test('voiding stays blocked until Logistics releases reservations and posts verified returns', async () => {
  const fixture = new PartnerFulfillmentFixture();
  fixture.dependencies = [quantityDependency(fixture, {
    finalizedReserved: '0.250',
    physicallyDispatched: '0.500', health: 'CURRENT', evidenceIds: ['reservation', 'physical-exit'],
  })];
  const adapter = createPartnerFulfillmentAdapter(fixture);

  const blocked = await adapter.inspectVoidingDependencies(fixture.source.view);
  fixture.dependencies[0] = {
    ...fixture.dependencies[0]!, finalizedReserved: '0.000', physicallyDispatched: '0.000',
    evidenceIds: ['reservation', 'physical-exit', 'release', 'verified-return', 'posted-correction'],
  };
  const cleared = await adapter.inspectVoidingDependencies(fixture.source.view);

  assert.deepEqual(blocked.ok && blocked.value.blockedProductRowIds, ['fixture-313-row']);
  assert.deepEqual(cleared.ok && cleared.value.blockedProductRowIds, []);
  assert.deepEqual(cleared.ok && cleared.value.evidenceIds, ['reservation', 'physical-exit', 'release', 'verified-return', 'posted-correction']);
});

test('a materialized lineage with a missing shipment projection fails closed', async () => {
  const fixture = new PartnerFulfillmentFixture();
  const adapter = createPartnerFulfillmentAdapter(fixture);
  assert.equal((await adapter.ensureCommittedLineage(fixture.source.view, lineageCommand(fixture))).ok, true);

  const result = await adapter.inspectDependencies(fixture.source.view);

  assert.deepEqual(result, { ok: true, value: {
    evidenceIds: [],
    blockedProductRowIds: ['fixture-313-row'],
  } });
});

test('retail-shaped or non-committed sources never create fulfillment work', async () => {
  const retail = new PartnerFulfillmentFixture();
  const retailView = { ...retail.source.view, sourceKind: 'PARTNER_CUSTOMER' } as unknown as typeof retail.source.view;
  const retailResult = await createPartnerFulfillmentAdapter(retail).ensureCommittedLineage(retailView, lineageCommand(retail));
  assert.equal(retailResult.ok, false);
  assert.equal(retail.lineages.length, 0);

  const draft = new PartnerFulfillmentFixture();
  draft.source.caseState = 'CUSTOMER_APPROVED';
  const draftResult = await createPartnerFulfillmentAdapter(draft).ensureCommittedLineage(draft.source.view, lineageCommand(draft));
  assert.equal(draftResult.ok, false);
  if (!draftResult.ok) assert.equal(draftResult.error.code, 'STATE_CONFLICT');
  assert.equal(draft.lineages.length, 0);
});

test('current reconciled evidence permits fulfillment and a corrupted existing lineage cannot be duplicated', async () => {
  const fixture = new PartnerFulfillmentFixture();
  const adapter = createPartnerFulfillmentAdapter(fixture);
  assert.equal((await adapter.ensureCommittedLineage(fixture.source.view, lineageCommand(fixture))).ok, true);
  fixture.dependencies = [quantityDependency(fixture, {
    finalizedReserved: '0.500',
    physicallyDispatched: '0.250', health: 'CURRENT', evidenceIds: ['contracted', 'reserved', 'exit'],
  })];
  assert.deepEqual(await adapter.inspectDependencies(fixture.source.view), { ok: true, value: {
    evidenceIds: ['contracted', 'reserved', 'exit'], blockedProductRowIds: [],
  } });

  fixture.lineages[0]!.internalRecordId = 'retail-record';
  const replay = await adapter.ensureCommittedLineage(fixture.source.view, lineageCommand(fixture, 'fixture-323-second-command'));
  assert.equal(replay.ok, false);
  if (!replay.ok) assert.equal(replay.error.code, 'INTEGRITY_CONFLICT');
  assert.equal(fixture.lineages.length, 1);
});

test('malformed canonical evidence returns a controlled error and duplicate Delivery rows are rejected', async () => {
  const missingGraph = new PartnerFulfillmentFixture();
  missingGraph.source.canonicalGraph = undefined as unknown as PartnerFulfillmentSource['canonicalGraph'];
  const malformed = await createPartnerFulfillmentAdapter(missingGraph).ensureCommittedLineage(missingGraph.source.view, lineageCommand(missingGraph));
  assert.equal(malformed.ok, false);
  assert.equal(missingGraph.lineages.length, 0);

  const duplicateDeliveryRow = new PartnerFulfillmentFixture();
  duplicateDeliveryRow.source.view.deliveries[0]!.items.push({ ...duplicateDeliveryRow.source.view.deliveries[0]!.items[0]! });
  duplicateDeliveryRow.source.view.products[0]!.quantity = '4.000';
  const duplicate = await createPartnerFulfillmentAdapter(duplicateDeliveryRow).ensureCommittedLineage(duplicateDeliveryRow.source.view, lineageCommand(duplicateDeliveryRow));
  assert.equal(duplicate.ok, false);
  assert.equal(duplicateDeliveryRow.lineages.length, 0);
});

test('partial Delivery allocation and a drifted contracted baseline both fail closed', async () => {
  const partial = new PartnerFulfillmentFixture();
  partial.source.view.deliveries[0]!.items[0]!.quantity = '1.999';
  const partialResult = await createPartnerFulfillmentAdapter(partial)
    .ensureCommittedLineage(partial.source.view, lineageCommand(partial));
  assert.equal(partialResult.ok, false);

  const omitted = new PartnerFulfillmentFixture();
  omitted.source.view.deliveries = [];
  const omittedResult = await createPartnerFulfillmentAdapter(omitted)
    .ensureCommittedLineage(omitted.source.view, lineageCommand(omitted));
  assert.equal(omittedResult.ok, false);

  const drifted = new PartnerFulfillmentFixture();
  drifted.dependencies = [quantityDependency(drifted, {
    contracted: '3.000', finalizedReserved: '1.000', physicallyDispatched: '0.000', evidenceIds: ['wrong-baseline'],
  })];
  assert.deepEqual(await createPartnerFulfillmentAdapter(drifted).inspectDependencies(drifted.source.view), {
    ok: true, value: { evidenceIds: ['wrong-baseline'], blockedProductRowIds: ['fixture-313-row'] },
  });
});

test('dependency evidence is bound to the exact Case revision and internal record', async () => {
  const fixture = new PartnerFulfillmentFixture();
  fixture.dependencies = [quantityDependency(fixture, {
    owner: { ...fixture.source.view.owner, revision: fixture.source.view.owner.revision + 1 },
    internalRecordId: 'another-internal-record',
    evidenceIds: ['stale-evidence'],
  })];

  const result = await createPartnerFulfillmentAdapter(fixture).inspectDependencies(fixture.source.view);

  assert.deepEqual(result, { ok: true, value: {
    evidenceIds: ['stale-evidence'], blockedProductRowIds: ['fixture-313-row'],
  } });
});

test('concurrent commands atomically converge on one physical lineage', async () => {
  const fixture = new PartnerFulfillmentFixture();
  const adapter = createPartnerFulfillmentAdapter(fixture);

  const [first, second] = await Promise.all([
    adapter.ensureCommittedLineage(fixture.source.view, lineageCommand(fixture, 'fixture-323-concurrent-a')),
    adapter.ensureCommittedLineage(fixture.source.view, lineageCommand(fixture, 'fixture-323-concurrent-b')),
  ]);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(fixture.lineages.length, 1);
  assert.equal(fixture.commands.length, 2);
  assert.deepEqual(first.ok && first.value.lineageEvidenceIds, second.ok && second.value.lineageEvidenceIds);
});
