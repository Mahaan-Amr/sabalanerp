import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as graph from '../index';

const decimal = graph.parseCanonicalDecimal;

test('private or unknown input fields are rejected without echoing their contents', () => {
  const draft = input();
  const preview = graph.calculateProductOperationsTechnical({
    ...draft, tools: [{ ...draft.tools[0], rateToman: decimal('123456789') }],
  } as unknown as graph.ProductOperationsTechnicalInput);
  assert.equal(preview.ok, false);
  assert.equal(JSON.stringify(preview).includes('123456789'), false);
  if (!preview.ok) assert.equal(preview.conflicts[0].code, 'invalid-operation-input');
});

const input = () => ({
  inputRevision: 3,
  productRowId: graph.parseStableIdentity('product-row', 'technical-row'),
  lengthMeters: decimal('2'), widthMeters: decimal('0.4'), quantity: 3,
  groups: [{ operationGroupId: graph.parseStableIdentity('operation-group', 'group-a'), scope: decimal('3') }],
  tools: [{
    toolSelectionId: graph.parseStableIdentity('tool-selection', 'tool-a'),
    operationGroupId: graph.parseStableIdentity('operation-group', 'group-a'),
    catalogItemId: 'front-tool', catalogSnapshotVersion: '1', name: 'Front edge',
    unit: 'meter' as const, edges: ['front' as const],
  }],
  finishings: [{
    finishingSelectionId: graph.parseStableIdentity('finishing-selection', 'finish-a'),
    operationGroupId: graph.parseStableIdentity('operation-group', 'group-a'),
    catalogItemId: 'area-finish', catalogSnapshotVersion: '1', name: 'Area finishing',
    unit: 'squareMeter' as const, incompatibleCatalogItemIds: [],
  }],
});

test('an incomplete tool keeps valid finishing facts and identifies the missing edge by stable selection', () => {
  const draft = input();
  const preview = graph.calculateProductOperationsTechnical({
    ...draft, tools: [{ ...draft.tools[0], edges: [] }],
  });
  assert.equal(preview.ok, false);
  if (preview.ok) return;
  assert.ok(preview.result);
  assert.equal(preview.result.finishings[0].finalQuantity, '2.4');
  assert.equal(preview.result.tools.length, 0);
  assert.deepEqual(preview.conflicts[0].path, ['tools', 'tool-a', 'edges']);
  assert.equal(preview.conflicts[0].code, 'tool-edge-required');
});

test('three 2m by 0.4m pieces expose 6m of front tooling and 2.4m2 finishing without rates', () => {
  const preview = graph.calculateProductOperationsTechnical(input());
  assert.equal(preview.ok, true);
  assert.ok(preview.result);
  assert.equal(preview.result.inputRevision, 3);
  assert.equal(preview.result.productRowId, 'technical-row');
  assert.equal(preview.result.tools[0].automaticQuantity, '6');
  assert.equal(preview.result.finishings[0].finalQuantity, '2.4');
  assert.equal(/rateToman|amountToman|pricing|inputHash|resultHash/.test(JSON.stringify(preview)), false);
});

test('the canonical geometry refresh and group split also accept rate-free drafts', () => {
  const draft: graph.ProductOperationsTechnicalInput = input();
  const refreshed = graph.refreshProductOperationsGeometry({
    input: draft, lengthMeters: decimal('2'), widthMeters: decimal('0.4'), quantity: 4,
  });
  const split = graph.splitOperationGroup({
    input: refreshed, sourceOperationGroupId: draft.groups[0].operationGroupId,
    selectedScope: decimal('1'), selectedOperationGroupId: graph.parseStableIdentity('operation-group', 'group-b'),
    clonedToolSelectionIds: { 'tool-a': graph.parseStableIdentity('tool-selection', 'tool-b') },
    clonedFinishingSelectionIds: { 'finish-a': graph.parseStableIdentity('finishing-selection', 'finish-b') },
  });
  assert.equal(split.ok, true);
  if (!split.ok) return;
  const preview = graph.calculateProductOperationsTechnical(split.input);
  assert.ok(preview.ok);
  assert.deepEqual(preview.result.groups.map(group => group.scope), ['1', '3']);
  assert.deepEqual(preview.result.tools.map(tool => tool.finalQuantity), ['6', '2']);
  assert.equal(preview.result.inputRevision, 3);
});

test('a stale manual quantity remains visible until keep or use-calculation is explicitly chosen', () => {
  const draft = input();
  const quantityOverride = { value: decimal('7'), automaticQuantitySnapshot: decimal('4') };
  const stale = graph.calculateProductOperationsTechnical({ ...draft,
    tools: [{ ...draft.tools[0], quantityOverride }],
  });
  assert.equal(stale.ok, false);
  if (stale.ok) return;
  assert.equal(stale.conflicts[0].code, 'manual-override-stale');
  assert.equal(stale.result?.tools[0].automaticQuantity, '6');
  assert.equal(stale.result?.tools[0].finalQuantity, '7');
  for (const resolution of ['keep', 'use-calculation'] as const) {
    const resolved = graph.calculateProductOperationsTechnical({ ...draft,
      tools: [{ ...draft.tools[0], quantityOverride: { ...quantityOverride, resolution } }],
    });
    assert.ok(resolved.ok);
    assert.equal(resolved.result.tools[0].finalQuantity, resolution === 'keep' ? '7' : '6');
    assert.equal(resolved.result.tools[0].overrideStatus, resolution === 'keep' ? 'kept' : 'used-calculation');
    assert.deepEqual(resolved.result.tools[0].quantityOverride, resolution === 'keep'
      ? { value: '7', automaticQuantitySnapshot: '6' } : undefined);
  }
  assert.deepEqual(quantityOverride, { value: '7', automaticQuantitySnapshot: '4' });
});

test('ordinary priced amount and evidence hashes match the published 1c93b47f calculation', () => {
  const { inputRevision: _revision, ...draft } = input();
  const priced = graph.calculateProductOperations({ ...draft,
    policyVersion: 'operations-v1', pricingPolicyVersion: 'pricing-v1', roundingPolicyVersion: 'round-v1',
    tools: draft.tools.map(tool => ({ ...tool, rateToman: decimal('10000') })),
    finishings: draft.finishings.map(finishing => ({ ...finishing, rateToman: decimal('20000') })),
  });
  assert.ok(priced.ok);
  // Golden values captured from the unchanged published implementation, not recomputed here.
  assert.equal(priced.result.totalAmountToman, '108000');
  assert.equal(priced.result.inputHash, 'cpg-fnv1a64-a67ac91b6608eecc');
  assert.equal(priced.result.resultHash, 'cpg-fnv1a64-b7d5f7a03b44f390');
});

test('ordinary priced calculation still refuses absent or negative rates', () => {
  const { inputRevision: _revision, ...draft } = input();
  const ordinary = { ...draft, policyVersion: 'operations-v1', pricingPolicyVersion: 'pricing-v1', roundingPolicyVersion: 'round-v1' };
  const absent = graph.calculateProductOperations(ordinary);
  assert.equal(absent.ok, false);
  if (!absent.ok) assert.deepEqual(absent.conflicts.map(conflict => conflict.code), ['inventory-rate-missing', 'inventory-rate-missing']);
  const negative = graph.calculateProductOperations({ ...ordinary,
    tools: draft.tools.map(tool => ({ ...tool, rateToman: decimal('-1') })),
  });
  assert.equal(negative.ok, false);
});

test('linear-meter scope and uncovered product remain distinct from piece-count scope', () => {
  const draft = input();
  const preview = graph.calculateProductOperationsTechnical({ ...draft,
    lengthMeters: decimal('10'), quantity: undefined,
    groups: [{ ...draft.groups[0], scope: decimal('6') }],
  });
  assert.ok(preview.ok);
  assert.equal(preview.result.basis, 'linear-meters');
  assert.equal(preview.result.tools[0].finalQuantity, '6');
  assert.equal(preview.result.finishings[0].finalQuantity, '2.4');
  assert.equal(preview.result.noOperationScope, '4');
  assert.equal(preview.result.groups[1].automaticNoOperations, true);
});

test('automatic no-operation scope cannot duplicate a user supplied group identity', () => {
  const draft = input();
  const preview = graph.calculateProductOperationsTechnical({ ...draft,
    groups: [{ operationGroupId: graph.parseStableIdentity('operation-group', 'technical-row:no-operations'), scope: decimal('2') }],
    tools: [], finishings: [],
  });
  assert.equal(preview.ok, false);
  if (!preview.ok) assert.equal(preview.conflicts[0].code, 'duplicate-operation-identity');
});

test('even incomplete geometry errors echo the valid input revision to reject late responses', () => {
  const preview = graph.calculateProductOperationsTechnical({ ...input(), inputRevision: 8, lengthMeters: decimal('0') });
  assert.equal(preview.ok, false);
  if (!preview.ok) assert.equal(preview.inputRevision, 8);
});

test('all nested technical shapes reject private fields and malformed enums without echoing values', () => {
  const draft = input();
  const changes: unknown[] = [
    { ...draft, policyVersion: 'secret-private-policy' },
    { ...draft, groups: [{ ...draft.groups[0], amountToman: 'secret-private-amount' }] },
    { ...draft, finishings: [{ ...draft.finishings[0], rateToman: 'secret-private-rate' }] },
    { ...draft, tools: [{ ...draft.tools[0], unit: 'secret-private-unit' }] },
    { ...draft, tools: [{ ...draft.tools[0], edges: ['secret-private-edge'] }] },
    { ...draft, tools: [{ ...draft.tools[0], quantityOverride: {
      value: '7', automaticQuantitySnapshot: '6', priceHash: 'secret-private-hash',
    } }] },
  ];
  for (const change of changes) {
    const preview = graph.calculateProductOperationsTechnical(change as graph.ProductOperationsTechnicalInput);
    assert.equal(preview.ok, false);
    assert.equal(JSON.stringify(preview).includes('secret-private'), false);
  }
});
