import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { isValidFinanciallyApprovedInvoice } from '../accountingStatus';
import {
  APPROVED_PRICING_SCHEMA_VERSION,
  type ApprovedPricingRepository,
  type ApprovedPricingSealResult,
  type ApprovedPricingSource,
  type ApprovedPricingVersionInsert,
} from './types';

const record = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is missing or null`);
  return value as Record<string, unknown>;
};

const requiredString = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is missing or null`);
  return value.trim();
};

const exact = (value: unknown, scale: number, label: string) => {
  let decimal: Prisma.Decimal;
  try {
    decimal = new Prisma.Decimal(String(value));
  } catch {
    throw new Error(`${label} is not a valid decimal`);
  }
  if (!decimal.isFinite() || decimal.decimalPlaces() > scale) throw new Error(`${label} exceeds scale ${scale}`);
  return decimal.toFixed(scale);
};

const money = (value: unknown, label: string) => exact(value, 12, label);
const quantity = (value: unknown, label: string) => exact(value, 3, label);

const canonicalize = (value: unknown): unknown => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical evidence contains a non-finite number');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  throw new Error('Canonical evidence contains an unsupported value');
};

export const canonicalApprovedPricingHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');

export type ApprovedPricingRowIntegrityInput = {
  versionId: string;
  contractId: string;
  sourceFinancialRecordId: string;
  versionNumber: number;
  contractItemId: string;
  productRowId: string;
  ordinal: number;
  contractedQuantity: string;
  unit: string;
  canonicalAllInTotal: string;
  discountEligible: boolean;
  componentEvidence: Readonly<Record<string, string>>;
};

export const approvedPricingRowIntegrityPayload = (input: ApprovedPricingRowIntegrityInput) => ({
  versionId: input.versionId,
  contractId: input.contractId,
  sourceFinancialRecordId: input.sourceFinancialRecordId,
  versionNumber: input.versionNumber,
  contractItemId: input.contractItemId,
  productRowId: input.productRowId,
  ordinal: input.ordinal,
  contractedQuantity: quantity(input.contractedQuantity, 'Approved pricing row integrity quantity'),
  unit: input.unit,
  canonicalAllInTotal: money(input.canonicalAllInTotal, 'Approved pricing row integrity amount'),
  discountEligible: input.discountEligible,
  componentEvidence: Object.fromEntries(Object.entries(input.componentEvidence)
    .map(([key, value]) => [key, money(value, `Approved pricing component ${key}`)])),
});

export const approvedPricingRowIntegrityHash = (input: ApprovedPricingRowIntegrityInput) =>
  canonicalApprovedPricingHash(approvedPricingRowIntegrityPayload(input));

export type ApprovedPricingVersionIntegrityInput = {
  id: string;
  contractId: string;
  versionNumber: number;
  sourceFinancialRecordId: string;
  approvedAt: Date | string;
  approvedBy: string;
  schemaVersion: number;
  currency: string;
  grossAmount: string;
  discountAmount: string;
  netAmount: string;
  sourceEvidence: Readonly<Record<string, unknown>>;
  rowHashes: readonly string[];
};

export const approvedPricingVersionIntegrityPayload = (input: ApprovedPricingVersionIntegrityInput) => ({
  id: input.id,
  contractId: input.contractId,
  versionNumber: input.versionNumber,
  sourceFinancialRecordId: input.sourceFinancialRecordId,
  approvedAt: (input.approvedAt instanceof Date ? input.approvedAt : new Date(input.approvedAt)).toISOString(),
  approvedBy: input.approvedBy,
  schemaVersion: input.schemaVersion,
  currency: input.currency,
  grossAmount: money(input.grossAmount, 'Approved pricing integrity gross amount'),
  discountAmount: money(input.discountAmount, 'Approved pricing integrity discount amount'),
  netAmount: money(input.netAmount, 'Approved pricing integrity net amount'),
  sourceEvidence: input.sourceEvidence,
  rowHashes: [...input.rowHashes],
});

export const approvedPricingVersionIntegrityHash = (input: ApprovedPricingVersionIntegrityInput) =>
  canonicalApprovedPricingHash(approvedPricingVersionIntegrityPayload(input));

const productRows = (contractData: unknown) => {
  const data = record(contractData, 'Contract snapshot');
  if (!Array.isArray(data.products) || data.products.length === 0) throw new Error('Contract product snapshots are missing');
  return { data, products: data.products.map((item, index) => record(item, `Contract product snapshot ${index}`)) };
};

const rowQuantityAndUnit = (row: Record<string, unknown>, productType: string, label: string) => {
  const type = productType.toLowerCase();
  if (type === 'prepared') {
    const unit = requiredString(row.preparedUnit ?? row.unit, `${label} unit`);
    if (!['squareMeter', 'ton', 'count'].includes(unit)) throw new Error(`${label} has an unsupported unit`);
    return { unit, quantity: quantity(row.preparedQuantity ?? row.quantity, `${label} quantity`) };
  }
  if (type === 'longitudinal') {
    const lengthUnit = requiredString(row.lengthUnit, `${label} length unit`);
    if (!['m', 'cm'].includes(lengthUnit)) throw new Error(`${label} has an unsupported length unit`);
    const length = new Prisma.Decimal(requiredString(String(row.length ?? ''), `${label} length`));
    const count = new Prisma.Decimal(requiredString(String(row.quantity ?? ''), `${label} count`));
    if (!length.gt(0) || !count.gt(0)) throw new Error(`${label} quantity must be positive`);
    return { unit: 'meter', quantity: quantity(lengthUnit === 'cm' ? length.div(100).mul(count) : length.mul(count), `${label} quantity`) };
  }
  if (type === 'slab') {
    return { unit: 'squareMeter', quantity: quantity(row.squareMeters, `${label} quantity`) };
  }
  return { unit: 'count', quantity: quantity(row.quantity, `${label} quantity`) };
};

export const buildApprovedPricingVersion = (
  source: ApprovedPricingSource,
  versionNumber: number,
  versionId: string = randomUUID(),
): ApprovedPricingVersionInsert => {
  if (!isValidFinanciallyApprovedInvoice(source.leaf)) throw new Error('Financial record is not a valid approved invoice leaf');
  const contractId = requiredString(source.leaf.contractId, 'Approved invoice contract');
  if (contractId !== source.contract.id) throw new Error('Approved invoice and contract identities conflict');
  const approvedAt = source.leaf.financiallyApprovedAt;
  if (!approvedAt || Number.isNaN(approvedAt.getTime())) throw new Error('Approval time is missing or null');
  const approvedBy = requiredString(source.leaf.financiallyApprovedBy, 'Approval identity');
  const currency = requiredString(source.contract.currency, 'Contract currency');
  if (!Number.isSafeInteger(versionNumber) || versionNumber < 1) throw new Error('Pricing version number is invalid');

  const graph = source.contract.productGraph;
  if (!graph) throw new Error('Canonical product graph is missing');
  requiredString(graph.inputHash, 'Canonical graph input hash');
  requiredString(graph.resultHash, 'Canonical graph result hash');
  if (!Number.isSafeInteger(graph.schemaVersion) || !Number.isSafeInteger(graph.revision)) throw new Error('Canonical graph version evidence is invalid');

  const { data, products } = productRows(source.contract.contractData);
  const payment = record(data.payment, 'Contract payment evidence');
  if (requiredString(payment.currency, 'Contract payment currency') !== currency) {
    throw new Error('Contract payment currency conflicts with contract currency');
  }
  const snapshotCustomerId = requiredString(data.customerId, 'Contract snapshot customer identity');
  const customer = record(data.customer, 'Contract customer snapshot');
  if (snapshotCustomerId !== source.contract.customerId || requiredString(customer.id, 'Customer snapshot identity') !== snapshotCustomerId) {
    throw new Error('Contract customer identities conflict');
  }
  const projectId = requiredString(data.projectId, 'Contract project identity');
  const project = record(data.project, 'Contract project snapshot');
  if (requiredString(project.id, 'Project snapshot identity') !== projectId) throw new Error('Contract project identities conflict');
  const destination = requiredString(project.address, 'Contract destination');

  const discount = record(data.discount, 'Contract discount evidence');
  if (typeof discount.enabled !== 'boolean') throw new Error('Contract discount enabled evidence is missing');
  const discountCurrency = requiredString(discount.currency, 'Contract discount currency');
  if (discountCurrency !== currency) throw new Error('Contract discount currency conflicts with contract currency');
  const discountBase = money(discount.baseSubtotal, 'Contract discount base subtotal');
  const discountPercent = money(discount.percent, 'Contract discount percent');
  const discountAmount = money(discount.amount, 'Contract discount amount');
  const discountValue = new Prisma.Decimal(discountAmount);
  if (discount.enabled !== discountValue.gt(0)) throw new Error('Contract discount enabled flag conflicts with amount');
  if (!discountValue.gte(0)) throw new Error('Contract discount amount cannot be negative');
  if (!discount.enabled && (new Prisma.Decimal(discountPercent).gt(0) || new Prisma.Decimal(discountBase).lt(0))) {
    throw new Error('Explicit no-discount evidence conflicts with its amounts');
  }
  if (discount.enabled) {
    requiredString(discount.rangeId, 'Contract discount range identity');
    const appliedAt = new Date(requiredString(discount.appliedAt, 'Contract discount applied time'));
    if (Number.isNaN(appliedAt.getTime())) throw new Error('Contract discount applied time is invalid');
    const maximumPercent = new Prisma.Decimal(money(discount.maxDiscountPercent, 'Contract maximum discount percent'));
    const appliedPercent = new Prisma.Decimal(discountPercent);
    if (appliedPercent.lte(0) || appliedPercent.gt(maximumPercent) || maximumPercent.gt(100)) {
      throw new Error('Contract discount percent conflicts with approved range');
    }
    if (!new Prisma.Decimal(discountBase).mul(appliedPercent).div(100).eq(discountValue)) {
      throw new Error('Contract discount amount conflicts with base subtotal and percent');
    }
  }

  if (graph.rows.length !== source.contract.items.length || products.length !== graph.rows.length) {
    throw new Error('Contract item, snapshot, and canonical graph row counts conflict');
  }
  if (new Set(graph.rows.map(row => row.productRowId)).size !== graph.rows.length) {
    throw new Error('Canonical product row identities are duplicated');
  }
  const itemByRow = new Map(source.contract.items.map(item => [item.productRowId, item]));
  const snapshotByRow = new Map(products.map(item => [requiredString(item.rowId ?? item.productRowId, 'Product snapshot row identity'), item]));
  if (itemByRow.size !== source.contract.items.length || snapshotByRow.size !== products.length || itemByRow.has(null)) {
    throw new Error('Stable product row identities are missing or duplicated');
  }

  let eligibleBase = new Prisma.Decimal(0);
  let gross = new Prisma.Decimal(0);
  const rows = graph.rows.map((graphRow, index) => {
    const ordinal = index + 1;
    const item = itemByRow.get(graphRow.productRowId);
    const snapshot = snapshotByRow.get(graphRow.productRowId);
    if (!item || !snapshot) throw new Error(`Canonical row ${graphRow.productRowId} has no exact contract source`);
    if (item.productId !== graphRow.catalogProductId || requiredString(snapshot.productId, `Product ${graphRow.productRowId} catalog identity`) !== item.productId) {
      throw new Error(`Canonical row ${graphRow.productRowId} product identities conflict`);
    }
    const snapshotType = requiredString(snapshot.productType, `Product ${graphRow.productRowId} type`);
    if (snapshotType !== graphRow.productType || item.productType !== graphRow.productType) throw new Error(`Canonical row ${graphRow.productRowId} types conflict`);
    const contracted = rowQuantityAndUnit(snapshot, graphRow.productType, `Product ${graphRow.productRowId}`);
    if (!new Prisma.Decimal(contracted.quantity).gt(0)) throw new Error(`Product ${graphRow.productRowId} quantity must be positive`);
    const snapshotItemQuantity = graphRow.productType === 'prepared'
      ? snapshot.preparedQuantity ?? snapshot.quantity
      : snapshot.quantity;
    if (quantity(snapshotItemQuantity, `Product ${graphRow.productRowId} item quantity`) !== quantity(item.quantity, `Contract item ${item.id} quantity`)) {
      throw new Error(`Product ${graphRow.productRowId} contract item quantity conflicts with snapshot`);
    }
    const canonicalContractedQuantity = graphRow.productType === 'longitudinal'
      ? quantity(
        new Prisma.Decimal(requiredString(graphRow.requestedLengthMeters, `Canonical row ${graphRow.productRowId} length`))
          .mul(requiredString(graphRow.requestedQuantity, `Canonical row ${graphRow.productRowId} count`)),
        `Canonical row ${graphRow.productRowId} quantity`,
      )
      : graphRow.productType === 'slab'
        ? quantity(graphRow.requestedAreaSquareMeters, `Canonical row ${graphRow.productRowId} quantity`)
        : quantity(graphRow.requestedQuantity, `Canonical row ${graphRow.productRowId} quantity`);
    if (canonicalContractedQuantity !== contracted.quantity) {
      throw new Error(`Product ${graphRow.productRowId} canonical quantity conflicts with contract snapshot`);
    }
    const base = money(graphRow.baseAmountToman, `Product ${graphRow.productRowId} base amount`);
    const total = money(graphRow.totalAmountToman, `Product ${graphRow.productRowId} all-in amount`);
    if (new Prisma.Decimal(base).lt(0) || new Prisma.Decimal(total).lt(0)) {
      throw new Error(`Product ${graphRow.productRowId} pricing cannot be negative`);
    }
    const components: Record<string, string> = { base };
    for (const operation of [...graphRow.operations].sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`))) {
      const key = `${operation.kind}:${requiredString(operation.id, 'Attached component identity')}`;
      if (components[key]) throw new Error(`Product ${graphRow.productRowId} attached component identities are duplicated`);
      const amount = money(operation.amountToman, 'Attached component amount');
      if (new Prisma.Decimal(amount).lt(0)) throw new Error('Attached component amount cannot be negative');
      components[key] = amount;
    }
    const componentTotal = Object.values(components).reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0));
    if (!componentTotal.eq(total)) throw new Error(`Product ${graphRow.productRowId} attached component evidence conflicts with all-in amount`);
    const meta = snapshot.meta === undefined ? {} : record(snapshot.meta, `Product ${graphRow.productRowId} metadata`);
    const discountEligible = meta.isLayer !== true && new Prisma.Decimal(base).gt(0);
    components.discountBasis = discountEligible ? base : money(0, 'Non-eligible discount basis');
    if (discountEligible) eligibleBase = eligibleBase.plus(base);
    gross = gross.plus(total);
    const rowPayload: ApprovedPricingRowIntegrityInput = {
      versionId,
      contractId,
      sourceFinancialRecordId: source.leaf.id,
      versionNumber,
      contractItemId: item.id,
      productRowId: graphRow.productRowId,
      ordinal,
      contractedQuantity: contracted.quantity,
      unit: contracted.unit,
      canonicalAllInTotal: total,
      discountEligible,
      componentEvidence: components,
    };
    return { id: randomUUID(), ...rowPayload, integrityHash: approvedPricingRowIntegrityHash(rowPayload) };
  });

  if (!eligibleBase.eq(discountBase)) throw new Error('Contract discount base subtotal conflicts with canonical eligible rows');
  if (discountValue.gt(eligibleBase)) throw new Error('Contract discount exceeds eligible pricing');
  const grossAmount = money(gross, 'Approved pricing gross amount');
  if (grossAmount !== money(graph.totalAmountToman, 'Canonical graph total amount')) {
    throw new Error('Canonical graph total conflicts with ordered all-in rows');
  }
  const netAmount = money(gross.minus(discountValue), 'Approved pricing net amount');
  const sourceEvidence = {
    contractNumber: source.contract.contractNumber,
    customer: canonicalize(customer),
    project: canonicalize(project),
    destination,
    discount: canonicalize({ ...discount, baseSubtotal: discountBase, percent: discountPercent, amount: discountAmount }),
    graph: {
      schemaVersion: graph.schemaVersion,
      revision: graph.revision,
      inputHash: graph.inputHash,
      resultHash: graph.resultHash,
      totalAmountToman: money(graph.totalAmountToman, 'Canonical graph total amount'),
    },
  };
  const rootPayload: ApprovedPricingVersionIntegrityInput = {
    id: versionId,
    contractId,
    versionNumber,
    sourceFinancialRecordId: source.leaf.id,
    approvedAt: approvedAt.toISOString(),
    approvedBy,
    schemaVersion: APPROVED_PRICING_SCHEMA_VERSION,
    currency,
    grossAmount,
    discountAmount,
    netAmount,
    sourceEvidence,
    rowHashes: rows.map(row => row.integrityHash),
  };
  const { rowHashes: _rowHashes, ...versionFields } = rootPayload;
  return { ...versionFields, approvedAt, rows, integrityHash: approvedPricingVersionIntegrityHash(rootPayload) };
};

export const sealApprovedPricing = async (
  repository: ApprovedPricingRepository,
  financialRecordId: string,
  createVersionId: () => string = () => randomUUID(),
): Promise<ApprovedPricingSealResult> => {
  const leaf = await repository.readApprovalLeaf(financialRecordId);
  if (!leaf) throw new Error('Approved invoice leaf was not found');
  if (!isValidFinanciallyApprovedInvoice(leaf)) throw new Error('Financial record is not a valid approved invoice leaf');
  const contractId = requiredString(leaf.contractId, 'Approved invoice contract');
  return repository.withContractLock(contractId, async () => {
    const existing = await repository.findByApproval(contractId, financialRecordId);
    if (existing) {
      if (existing.approvedAt.toISOString() !== leaf.financiallyApprovedAt?.toISOString() || existing.approvedBy !== leaf.financiallyApprovedBy) {
        throw new Error('Existing approved pricing version conflicts with approval evidence');
      }
      return { outcome: 'REPLAYED', version: existing };
    }
    const source = await repository.loadSource(financialRecordId);
    if (!source) throw new Error('Approved pricing source was not found');
    const version = buildApprovedPricingVersion(source, await repository.nextVersionNumber(contractId), createVersionId());
    return { outcome: 'SEALED', version: await repository.insertAndAdvance(version) };
  });
};
