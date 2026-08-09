import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountingRecordStatus, FinancialRecordKind } from '@prisma/client';
import {
  buildApprovedPricingVersion,
  canonicalApprovedPricingHash,
  sealApprovedPricing,
} from '../approvedPricing/domain';
import {
  APPROVED_PRICING_FIXTURE_EXPECTED,
  approvedPricingSourceFixture,
} from '../approvedPricing/fixtures';
import type {
  ApprovedPricingRepository,
  ApprovedPricingSource,
  ApprovedPricingVersionInsert,
  ApprovedPricingVersionRecord,
} from '../approvedPricing/types';

class MemoryRepository implements ApprovedPricingRepository {
  readonly versions: ApprovedPricingVersionRecord[] = [];
  private tail: Promise<void> = Promise.resolve();

  constructor(readonly sources: Map<string, ApprovedPricingSource>) {}

  async readApprovalLeaf(id: string) { return this.sources.get(id)?.leaf ?? null; }
  async withContractLock<T>(_contractId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await work(); } finally { release(); }
  }
  async findByApproval(contractId: string, financialRecordId: string) {
    return this.versions.find(item => item.contractId === contractId && item.sourceFinancialRecordId === financialRecordId) ?? null;
  }
  async loadSource(id: string) { return this.sources.get(id) ?? null; }
  async nextVersionNumber(contractId: string) {
    return Math.max(0, ...this.versions.filter(item => item.contractId === contractId).map(item => item.versionNumber)) + 1;
  }
  async insertAndAdvance(version: ApprovedPricingVersionInsert) {
    this.versions.push(version);
    return version;
  }
}

test('freezes scale-three quantity, all-in attached costs, discount, context, and stable hashes', () => {
  const version = buildApprovedPricingVersion(approvedPricingSourceFixture(), 1, APPROVED_PRICING_FIXTURE_EXPECTED.versionId);
  assert.equal(version.grossAmount, APPROVED_PRICING_FIXTURE_EXPECTED.grossAmount);
  assert.equal(version.discountAmount, APPROVED_PRICING_FIXTURE_EXPECTED.discountAmount);
  assert.equal(version.netAmount, APPROVED_PRICING_FIXTURE_EXPECTED.netAmount);
  assert.deepEqual(version.rows[0]?.componentEvidence, {
    base: '1000.000000000000',
    discountBasis: '1000.000000000000',
    'finishing:finish-1': '100.000000000000',
    'tool:tool-1': '150.000000000000',
  });
  assert.equal(version.rows[0]?.contractedQuantity, APPROVED_PRICING_FIXTURE_EXPECTED.contractedQuantity);
  assert.equal(version.rows[0]?.unit, APPROVED_PRICING_FIXTURE_EXPECTED.unit);
  assert.equal(version.rows[0]?.integrityHash, APPROVED_PRICING_FIXTURE_EXPECTED.rowHash);
  assert.equal(version.integrityHash, APPROVED_PRICING_FIXTURE_EXPECTED.rootHash);
  assert.equal(version.sourceEvidence.destination, 'تهران، خیابان نمونه');
});

test('accepts explicit no-discount evidence without deriving a default', () => {
  const source = approvedPricingSourceFixture();
  (source.contract.contractData as any).discount = {
    enabled: false, baseSubtotal: '1000', percent: '0', amount: '0', currency: 'تومان',
  };
  const version = buildApprovedPricingVersion(source, 1, 'no-discount-version');
  assert.equal(version.discountAmount, '0.000000000000');
  assert.equal(version.netAmount, version.grossAmount);
});

test('freezes a zero discount basis for a non-eligible row', () => {
  const source = approvedPricingSourceFixture();
  (source.contract.contractData as any).products[0].meta.isLayer = true;
  (source.contract.contractData as any).discount = {
    enabled: false, baseSubtotal: '0', percent: '0', amount: '0', currency: 'تومان',
  };
  const version = buildApprovedPricingVersion(source, 1, 'non-eligible-version');
  assert.equal(version.rows[0]?.discountEligible, false);
  assert.equal(version.rows[0]?.componentEvidence.discountBasis, '0.000000000000');
});

test('canonical hash is independent of object key insertion order', () => {
  assert.equal(canonicalApprovedPricingHash({ b: 2, a: { d: 4, c: 3 } }), canonicalApprovedPricingHash({ a: { c: 3, d: 4 }, b: 2 }));
});

test('equal commercial content creates distinct immutable version identities', async () => {
  const first = approvedPricingSourceFixture();
  const second = approvedPricingSourceFixture();
  second.leaf = { ...second.leaf, id: 'invoice-approved-2', financiallyApprovedAt: new Date('2026-08-10T08:30:00.000Z') };
  const repository = new MemoryRepository(new Map([[first.leaf.id, first], [second.leaf.id, second]]));
  const one = await sealApprovedPricing(repository, first.leaf.id, () => 'version-1');
  const two = await sealApprovedPricing(repository, second.leaf.id, () => 'version-2');
  assert.equal(one.outcome, 'SEALED');
  assert.equal(two.outcome, 'SEALED');
  assert.equal(two.version.versionNumber, 2);
  assert.notEqual(one.version.id, two.version.id);
  assert.notEqual(one.version.integrityHash, two.version.integrityHash);
});

test('retry and concurrent retry return the one existing version', async () => {
  const source = approvedPricingSourceFixture();
  const repository = new MemoryRepository(new Map([[source.leaf.id, source]]));
  const [first, second] = await Promise.all([
    sealApprovedPricing(repository, source.leaf.id, () => 'one-version'),
    sealApprovedPricing(repository, source.leaf.id, () => 'must-not-be-used'),
  ]);
  assert.deepEqual(new Set([first.outcome, second.outcome]), new Set(['SEALED', 'REPLAYED']));
  assert.equal(repository.versions.length, 1);
  assert.equal(first.version.id, second.version.id);
});

test('invalid leaf fails before any repository mutation', async () => {
  const source = approvedPricingSourceFixture();
  source.leaf = { ...source.leaf, kind: FinancialRecordKind.RECEIVABLE, status: AccountingRecordStatus.POSTED };
  const repository = new MemoryRepository(new Map([[source.leaf.id, source]]));
  await assert.rejects(() => sealApprovedPricing(repository, source.leaf.id), /valid approved invoice leaf/);
  assert.equal(repository.versions.length, 0);
});

test('missing, null, and conflicting evidence fail closed', () => {
  const missingDiscount = approvedPricingSourceFixture();
  (missingDiscount.contract.contractData as any).discount = null;
  assert.throws(() => buildApprovedPricingVersion(missingDiscount, 1, 'v1'), /discount evidence.*missing or null/);

  const missingDestination = approvedPricingSourceFixture();
  (missingDestination.contract.contractData as any).project.address = null;
  assert.throws(() => buildApprovedPricingVersion(missingDestination, 1, 'v1'), /destination.*missing or null/);

  const missingCurrencyEvidence = approvedPricingSourceFixture();
  (missingCurrencyEvidence.contract.contractData as any).payment = null;
  assert.throws(() => buildApprovedPricingVersion(missingCurrencyEvidence, 1, 'v1'), /payment evidence.*missing or null/);

  const conflictingProduct = approvedPricingSourceFixture();
  conflictingProduct.contract.productGraph = {
    ...conflictingProduct.contract.productGraph!,
    rows: [{ ...conflictingProduct.contract.productGraph!.rows[0]!, catalogProductId: 'other-product' }],
  };
  assert.throws(() => buildApprovedPricingVersion(conflictingProduct, 1, 'v1'), /product identities conflict/);

  const conflictingComponents = approvedPricingSourceFixture();
  conflictingComponents.contract.productGraph = {
    ...conflictingComponents.contract.productGraph!,
    rows: [{ ...conflictingComponents.contract.productGraph!.rows[0]!, totalAmountToman: '1251' }],
  };
  assert.throws(() => buildApprovedPricingVersion(conflictingComponents, 1, 'v1'), /component evidence conflicts/);

  const conflictingGraphTotal = approvedPricingSourceFixture();
  conflictingGraphTotal.contract.productGraph = {
    ...conflictingGraphTotal.contract.productGraph!, totalAmountToman: '1251',
  };
  assert.throws(() => buildApprovedPricingVersion(conflictingGraphTotal, 1, 'v1'), /graph total conflicts/);

  const conflictingQuantity = approvedPricingSourceFixture();
  conflictingQuantity.contract.productGraph = {
    ...conflictingQuantity.contract.productGraph!,
    rows: [{ ...conflictingQuantity.contract.productGraph!.rows[0]!, requestedQuantity: '5' }],
  };
  assert.throws(() => buildApprovedPricingVersion(conflictingQuantity, 1, 'v1'), /canonical quantity conflicts/);
});
