import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { isValidFinanciallyApprovedInvoice } from '../accountingStatus';
import {
  reconcileOptimizerDerivedLongitudinalQuantity,
  type OptimizerDerivedQuantityEvidence,
} from '../optimizerDerivedQuantityEvidence';
import {
  contractDiscountEligibilityEvidence,
  hasConflictingDiscountOrNonProductAdjustmentEvidence,
  isContractRowDiscountEligible,
  LEGACY_DISCOUNT_ELIGIBILITY_EVIDENCE_ORIGIN,
  LEGACY_NO_DISCOUNT_EVIDENCE_ORIGIN,
} from '../contractDiscountEvidence';
import {
  APPROVED_PRICING_SCHEMA_VERSION,
  type ApprovedPricingRepository,
  type ApprovedPricingGraphRowSource,
  type ApprovedPricingSealResult,
  type ApprovedPricingSource,
  type ApprovedPricingVersionInsert,
} from './types';
import {
  ApprovedPricingEvidenceError,
  asApprovedPricingEvidenceError,
} from './evidenceError';

// Every deliberate throw in this pure interpreter is an evidence rejection.
// Native runtime failures (TypeError, RangeError, and database errors) remain untyped and escape unchanged.

const record = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApprovedPricingEvidenceError(`${label} is missing or null`);
  return value as Record<string, unknown>;
};

const requiredString = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new ApprovedPricingEvidenceError(`${label} is missing or null`);
  return value.trim();
};

const exact = (value: unknown, scale: number, label: string) => {
  let decimal: Prisma.Decimal;
  try {
    decimal = new Prisma.Decimal(String(value));
  } catch {
    throw new ApprovedPricingEvidenceError(`${label} is not a valid decimal`);
  }
  if (!decimal.isFinite() || decimal.decimalPlaces() > scale) throw new ApprovedPricingEvidenceError(`${label} exceeds scale ${scale}`);
  return decimal.toFixed(scale);
};

const money = (value: unknown, label: string) => exact(value, 12, label);
const quantity = (value: unknown, label: string) => exact(value, 3, label);

const canonicalize = (value: unknown): unknown => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ApprovedPricingEvidenceError('Canonical evidence contains a non-finite number');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  throw new ApprovedPricingEvidenceError('Canonical evidence contains an unsupported value');
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
  if (!Array.isArray(data.products) || data.products.length === 0) throw new ApprovedPricingEvidenceError('Contract product snapshots are missing');
  return { data, products: data.products.map((item, index) => record(item, `Contract product snapshot ${index}`)) };
};

export type ProductQuantityPolicy = {
  snapshot(row: Record<string, unknown>, label: string): { unit: string; quantity: string };
  canonical(row: ApprovedPricingGraphRowSource, label: string): string;
};

const countQuantityPolicy: ProductQuantityPolicy = {
  snapshot: (row, label) => ({ unit: 'count', quantity: quantity(row.quantity, `${label} quantity`) }),
  canonical: (row, label) => quantity(row.requestedQuantity, `${label} quantity`),
};

const PRODUCT_QUANTITY_POLICIES: Readonly<Record<string, ProductQuantityPolicy>> = {
  prepared: {
    snapshot: (row, label) => {
      const unit = requiredString(row.preparedUnit ?? row.unit, `${label} unit`);
      if (!['squareMeter', 'ton', 'count'].includes(unit)) throw new ApprovedPricingEvidenceError(`${label} has an unsupported unit`);
      return { unit, quantity: quantity(row.preparedQuantity ?? row.quantity, `${label} quantity`) };
    },
    canonical: (row, label) => quantity(row.requestedQuantity, `${label} quantity`),
  },
  longitudinal: {
    snapshot: (row, label) => {
      const lengthUnit = requiredString(row.lengthUnit, `${label} length unit`);
      if (!['m', 'cm'].includes(lengthUnit)) throw new ApprovedPricingEvidenceError(`${label} has an unsupported length unit`);
      const length = new Prisma.Decimal(requiredString(String(row.length ?? ''), `${label} length`));
      const count = new Prisma.Decimal(requiredString(String(row.quantity ?? ''), `${label} count`));
      if (!length.gt(0) || !count.gt(0)) throw new ApprovedPricingEvidenceError(`${label} quantity must be positive`);
      return { unit: 'meter', quantity: quantity(lengthUnit === 'cm' ? length.div(100).mul(count) : length.mul(count), `${label} quantity`) };
    },
    canonical: (row, label) => quantity(
      new Prisma.Decimal(requiredString(row.requestedLengthMeters, `${label} length`))
        .mul(requiredString(row.requestedQuantity, `${label} count`)),
      `${label} quantity`,
    ),
  },
  slab: {
    snapshot: (row, label) => ({ unit: 'squareMeter', quantity: quantity(row.squareMeters, `${label} quantity`) }),
    canonical: (row, label) => quantity(row.requestedAreaSquareMeters, `${label} quantity`),
  },
  stair: countQuantityPolicy,
  volumetric: countQuantityPolicy,
};

export const productQuantityPolicy = (productType: string, label: string) => {
  const policy = PRODUCT_QUANTITY_POLICIES[productType.toLowerCase()];
  if (!policy) throw new ApprovedPricingEvidenceError(`${label} has an unsupported product type`);
  return policy;
};

const pricingCurrencyKind = (currency: string) => {
  const normalized = currency.trim().toLowerCase();
  if (['تومان', 'toman', 'ØªÙˆÙ…Ø§Ù†'.toLowerCase()].includes(normalized)) return 'TOMAN';
  if (['ریال', 'rial', 'Ø±ÛŒØ§Ù„'.toLowerCase()].includes(normalized)) return 'RIAL';
  throw new ApprovedPricingEvidenceError(`Unsupported approved pricing currency: ${currency}`);
};

const invoiceCurrencyFactor = (contractCurrency: string, invoiceCurrency: string) => {
  const contractKind = pricingCurrencyKind(contractCurrency);
  const invoiceKind = pricingCurrencyKind(invoiceCurrency);
  if (contractKind === invoiceKind) return new Prisma.Decimal(1);
  if (contractKind === 'TOMAN' && invoiceKind === 'RIAL') return new Prisma.Decimal(10);
  throw new ApprovedPricingEvidenceError('Invoice currency cannot be reconciled with contract pricing currency');
};

const destinationEvidence = (data: Record<string, unknown>) => {
  const contractKind = requiredString(data.contractKind, 'Contract kind');
  if (contractKind === 'collaboration') {
    const projectId = typeof data.projectId === 'string' ? data.projectId.trim() : '';
    if (!projectId && data.project == null) {
      return { project: null, destination: { kind: 'COLLABORATION_SALE' as const, projectId: null, address: null } };
    }
    const project = record(data.project, 'Collaboration project snapshot');
    if (!projectId || requiredString(project.id, 'Collaboration project identity') !== projectId) {
      throw new ApprovedPricingEvidenceError('Collaboration sale has conflicting project destination evidence');
    }
    return {
      project,
      destination: {
        kind: 'COLLABORATION_PROJECT_ADDRESS' as const,
        projectId,
        address: requiredString(project.address, 'Collaboration destination'),
      },
    };
  }
  if (contractKind !== 'standard') throw new ApprovedPricingEvidenceError('Contract kind is unsupported for approved pricing');
  const projectId = requiredString(data.projectId, 'Contract project identity');
  const project = record(data.project, 'Contract project snapshot');
  if (requiredString(project.id, 'Project snapshot identity') !== projectId) throw new ApprovedPricingEvidenceError('Contract project identities conflict');
  const address = requiredString(project.address, 'Contract destination');
  return { project, destination: { kind: 'PROJECT_ADDRESS' as const, projectId, address } };
};

const projectApprovedPricingRows = (input: {
  graphRows: readonly ApprovedPricingGraphRowSource[];
  itemByRow: ReadonlyMap<string | null, ApprovedPricingSource['contract']['items'][number]>;
  snapshotByRow: ReadonlyMap<string, Record<string, unknown>>;
  versionId: string;
  contractId: string;
  sourceFinancialRecordId: string;
  versionNumber: number;
  normalizedLegacyNonLayerProductRowIds: ReadonlySet<string>;
  quantityEvidenceByRow: ReadonlyMap<string, OptimizerDerivedQuantityEvidence>;
}) => {
  let selectedEligibleBase = new Prisma.Decimal(0);
  let gross = new Prisma.Decimal(0);
  const rows = input.graphRows.map((graphRow, index) => {
    const item = input.itemByRow.get(graphRow.productRowId);
    const snapshot = input.snapshotByRow.get(graphRow.productRowId);
    if (!item || !snapshot) throw new ApprovedPricingEvidenceError(`Canonical row ${graphRow.productRowId} has no exact contract source`);
    if (item.productId !== graphRow.catalogProductId || requiredString(snapshot.productId, `Product ${graphRow.productRowId} catalog identity`) !== item.productId) {
      throw new ApprovedPricingEvidenceError(`Canonical row ${graphRow.productRowId} product identities conflict`);
    }
    const snapshotType = requiredString(snapshot.productType, `Product ${graphRow.productRowId} type`);
    if (snapshotType !== graphRow.productType || item.productType !== graphRow.productType) throw new ApprovedPricingEvidenceError(`Canonical row ${graphRow.productRowId} types conflict`);
    const quantityEvidence = input.quantityEvidenceByRow.get(graphRow.productRowId);
    const quantityPolicy = quantityEvidence
      ? null
      : productQuantityPolicy(graphRow.productType, `Product ${graphRow.productRowId}`);
    const contracted = quantityEvidence
      ? { unit: quantityEvidence.unit, quantity: quantityEvidence.sealedQuantity }
      : quantityPolicy!.snapshot(snapshot, `Product ${graphRow.productRowId}`);
    if (!new Prisma.Decimal(contracted.quantity).gt(0)) throw new ApprovedPricingEvidenceError(`Product ${graphRow.productRowId} quantity must be positive`);
    const snapshotItemQuantity = graphRow.productType === 'prepared' ? snapshot.preparedQuantity ?? snapshot.quantity : snapshot.quantity;
    if (quantity(snapshotItemQuantity, `Product ${graphRow.productRowId} item quantity`) !== quantity(item.quantity, `Contract item ${item.id} quantity`)) {
      throw new ApprovedPricingEvidenceError(`Product ${graphRow.productRowId} contract item quantity conflicts with snapshot`);
    }
    if (quantityPolicy && quantityPolicy.canonical(graphRow, `Canonical row ${graphRow.productRowId}`) !== contracted.quantity) {
      throw new ApprovedPricingEvidenceError(`Product ${graphRow.productRowId} canonical quantity conflicts with contract snapshot`);
    }
    const base = money(graphRow.baseAmountToman, `Product ${graphRow.productRowId} base amount`);
    const total = money(graphRow.totalAmountToman, `Product ${graphRow.productRowId} all-in amount`);
    if (new Prisma.Decimal(base).lt(0) || new Prisma.Decimal(total).lt(0)) throw new ApprovedPricingEvidenceError(`Product ${graphRow.productRowId} pricing cannot be negative`);
    const components: Record<string, string> = {};
    if (graphRow.pricingComponents && graphRow.pricingComponents.length > 0) {
      for (const component of [...graphRow.pricingComponents]
        .sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`))) {
        const kind = requiredString(component.kind, 'Pricing component kind');
        const id = requiredString(component.id, 'Pricing component identity');
        const key = `${kind}:${id}`;
        if (components[key]) throw new ApprovedPricingEvidenceError(`Product ${graphRow.productRowId} pricing component identities are duplicated`);
        const amount = money(component.amountToman, `Pricing component ${key} amount`);
        if (new Prisma.Decimal(amount).lt(0)) throw new ApprovedPricingEvidenceError('Pricing component amount cannot be negative');
        components[key] = amount;
      }
      const baseComponents = graphRow.pricingComponents.filter(component =>
        (component.kind === 'base-material' && component.id === 'base-material') ||
        (component.kind === 'slab-material' && component.id === 'slab-material')
      );
      if (baseComponents.length !== 1 ||
        components[`${baseComponents[0]?.kind}:${baseComponents[0]?.id}`] !== base) {
        throw new ApprovedPricingEvidenceError(`Product ${graphRow.productRowId} canonical base component conflicts with base amount`);
      }
      for (const operation of graphRow.operations) {
        const key = `${operation.kind}:${requiredString(operation.id, 'Attached component identity')}`;
        const amount = money(operation.amountToman, 'Attached component amount');
        if (components[key] !== amount) {
          throw new ApprovedPricingEvidenceError(`Product ${graphRow.productRowId} attached component evidence conflicts with pricing components`);
        }
      }
    } else {
      components.base = base;
      for (const operation of [...graphRow.operations].sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`))) {
        const key = `${operation.kind}:${requiredString(operation.id, 'Attached component identity')}`;
        if (components[key]) throw new ApprovedPricingEvidenceError(`Product ${graphRow.productRowId} attached component identities are duplicated`);
        const amount = money(operation.amountToman, 'Attached component amount');
        if (new Prisma.Decimal(amount).lt(0)) throw new ApprovedPricingEvidenceError('Attached component amount cannot be negative');
        components[key] = amount;
      }
    }
    const componentTotal = Object.values(components).reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0));
    if (!componentTotal.eq(total)) throw new ApprovedPricingEvidenceError(`Product ${graphRow.productRowId} attached component evidence conflicts with all-in amount`);
    const normalizeMissingNonLayer = input.normalizedLegacyNonLayerProductRowIds.has(graphRow.productRowId)
      ? () => undefined
      : undefined;
    const discountEligible = isContractRowDiscountEligible(
      snapshot,
      new Prisma.Decimal(base),
      graphRow.productRowId,
      normalizeMissingNonLayer,
    );
    components.discountBasis = discountEligible ? base : money(0, 'Non-eligible discount basis');
    if (discountEligible) selectedEligibleBase = selectedEligibleBase.plus(base);
    gross = gross.plus(total);
    const rowPayload: ApprovedPricingRowIntegrityInput = {
      versionId: input.versionId,
      contractId: input.contractId,
      sourceFinancialRecordId: input.sourceFinancialRecordId,
      versionNumber: input.versionNumber,
      contractItemId: item.id,
      productRowId: graphRow.productRowId,
      ordinal: index + 1,
      contractedQuantity: contracted.quantity,
      unit: contracted.unit,
      canonicalAllInTotal: total,
      discountEligible,
      componentEvidence: components,
    };
    return { id: randomUUID(), ...rowPayload, integrityHash: approvedPricingRowIntegrityHash(rowPayload) };
  });
  return { rows, selectedEligibleBase, gross };
};

const validateApprovalEnvelope = (source: ApprovedPricingSource, versionNumber: number) => {
  if (!isValidFinanciallyApprovedInvoice(source.leaf)) throw new ApprovedPricingEvidenceError('Financial record is not a valid approved invoice leaf');
  const contractId = requiredString(source.leaf.contractId, 'Approved invoice contract');
  if (contractId !== source.contract.id) throw new ApprovedPricingEvidenceError('Approved invoice and contract identities conflict');
  const approvedAt = source.leaf.financiallyApprovedAt;
  if (!approvedAt || Number.isNaN(approvedAt.getTime())) throw new ApprovedPricingEvidenceError('Approval time is missing or null');
  const approvedBy = requiredString(source.leaf.financiallyApprovedBy, 'Approval identity');
  const currency = requiredString(source.contract.currency, 'Contract currency');
  const invoiceCurrency = requiredString(source.leaf.currency, 'Approved invoice currency');
  const financialSnapshot = record(source.leaf.sourceSnapshot, 'Invoice candidate source snapshot');
  if (requiredString(financialSnapshot.id, 'Invoice candidate source contract identity') !== contractId || source.leaf.sourceId !== contractId) {
    throw new ApprovedPricingEvidenceError('Invoice candidate source identities conflict with approved contract');
  }
  const mode = requiredString(record(source.leaf.metadata, 'Invoice candidate metadata').mode, 'Invoice candidate pricing mode');
  if (!['FROM_CONTRACT_TOTAL', 'FROM_SELECTED_ITEMS', 'REPLACEMENT_AFTER_CORRECTION'].includes(mode)) {
    throw new ApprovedPricingEvidenceError(`Invoice candidate pricing mode ${mode} cannot produce approved pricing`);
  }
  if (!Number.isSafeInteger(versionNumber) || versionNumber < 1) throw new ApprovedPricingEvidenceError('Pricing version number is invalid');
  const graph = source.contract.productGraph;
  if (!graph) throw new ApprovedPricingEvidenceError('Canonical product graph is missing');
  requiredString(graph.inputHash, 'Canonical graph input hash');
  requiredString(graph.resultHash, 'Canonical graph result hash');
  if (!Number.isSafeInteger(graph.schemaVersion) || !Number.isSafeInteger(graph.revision)) throw new ApprovedPricingEvidenceError('Canonical graph version evidence is invalid');
  return { contractId, approvedAt, approvedBy, currency, invoiceCurrency, currencyFactor: invoiceCurrencyFactor(currency, invoiceCurrency), mode, graph };
};

const validateContractPricingContext = (source: ApprovedPricingSource, currency: string) => {
  const { data, products } = productRows(source.contract.contractData);
  const payment = record(data.payment, 'Contract payment evidence');
  if (requiredString(payment.currency, 'Contract payment currency') !== currency) {
    throw new ApprovedPricingEvidenceError('Contract payment currency conflicts with contract currency');
  }
  const snapshotCustomerId = requiredString(data.customerId, 'Contract snapshot customer identity');
  const customer = record(data.customer, 'Contract customer snapshot');
  if (snapshotCustomerId !== source.contract.customerId || requiredString(customer.id, 'Customer snapshot identity') !== snapshotCustomerId) {
    throw new ApprovedPricingEvidenceError('Contract customer identities conflict');
  }
  const destination = destinationEvidence(data);
  return { data, products, customer, destination, payment };
};

const validateContractDiscountEvidence = (
  data: Record<string, unknown>,
  payment: Record<string, unknown>,
  currency: string,
  contractEligibleBase: Prisma.Decimal,
  completeGrossTotal: string,
) => {
  const hasDiscountField = Object.prototype.hasOwnProperty.call(data, 'discount');
  const isLegacyWizardNull = hasDiscountField && data.discount === null;
  const isLegacyWizardAbsent = !hasDiscountField;
  const reconciledPayableTotal = isLegacyWizardAbsent
    ? money(payment.totalContractAmount, 'Legacy contract payable total')
    : null;
  const reconciledGrossTotal = isLegacyWizardAbsent
    ? money(completeGrossTotal, 'Legacy contract gross total')
    : null;
  if (reconciledPayableTotal !== null && reconciledPayableTotal !== reconciledGrossTotal) {
    throw new ApprovedPricingEvidenceError('Legacy contract without discount evidence does not reconcile to zero discount');
  }
  if (isLegacyWizardAbsent && hasConflictingDiscountOrNonProductAdjustmentEvidence(data)) {
    throw new ApprovedPricingEvidenceError('Legacy contract contains conflicting discount or non-product adjustment evidence');
  }
  const discount = isLegacyWizardNull
    ? {
        enabled: false,
        baseSubtotal: contractEligibleBase.toString(),
        percent: '0',
        amount: '0',
        currency,
        evidenceOrigin: LEGACY_NO_DISCOUNT_EVIDENCE_ORIGIN.EXPLICIT_NULL,
      }
    : isLegacyWizardAbsent
      ? {
          enabled: false,
          baseSubtotal: contractEligibleBase.toString(),
          percent: '0',
          amount: '0',
          currency,
          evidenceOrigin: LEGACY_NO_DISCOUNT_EVIDENCE_ORIGIN.ABSENT_RECONCILED,
          reconciledPayableTotal,
          reconciledGrossTotal,
        }
    : record(data.discount, 'Contract discount evidence');
  if (typeof discount.enabled !== 'boolean') throw new ApprovedPricingEvidenceError('Contract discount enabled evidence is missing');
  if (requiredString(discount.currency, 'Contract discount currency') !== currency) throw new ApprovedPricingEvidenceError('Contract discount currency conflicts with contract currency');
  const discountBase = money(discount.baseSubtotal, 'Contract discount base subtotal');
  const discountPercent = money(discount.percent, 'Contract discount percent');
  const contractDiscountAmount = money(discount.amount, 'Contract discount amount');
  const discountValue = new Prisma.Decimal(contractDiscountAmount);
  if (discount.enabled !== discountValue.gt(0)) throw new ApprovedPricingEvidenceError('Contract discount enabled flag conflicts with amount');
  if (!discountValue.gte(0)) throw new ApprovedPricingEvidenceError('Contract discount amount cannot be negative');
  if (!discount.enabled && (new Prisma.Decimal(discountPercent).gt(0) || new Prisma.Decimal(discountBase).lt(0))) {
    throw new ApprovedPricingEvidenceError('Explicit no-discount evidence conflicts with its amounts');
  }
  if (discount.enabled) {
    requiredString(discount.rangeId, 'Contract discount range identity');
    const appliedAt = new Date(requiredString(discount.appliedAt, 'Contract discount applied time'));
    if (Number.isNaN(appliedAt.getTime())) throw new ApprovedPricingEvidenceError('Contract discount applied time is invalid');
    const maximumPercent = new Prisma.Decimal(money(discount.maxDiscountPercent, 'Contract maximum discount percent'));
    const appliedPercent = new Prisma.Decimal(discountPercent);
    if (appliedPercent.lte(0) || appliedPercent.gt(maximumPercent) || maximumPercent.gt(100)) throw new ApprovedPricingEvidenceError('Contract discount percent conflicts with approved range');
    if (!new Prisma.Decimal(discountBase).mul(appliedPercent).div(100).eq(discountValue)) {
      throw new ApprovedPricingEvidenceError('Contract discount amount conflicts with base subtotal and percent');
    }
  }
  return { discount, discountBase, discountPercent, contractDiscountAmount, discountValue };
};

export const buildApprovedPricingVersion = (
  source: ApprovedPricingSource,
  versionNumber: number,
  versionId: string = randomUUID(),
): ApprovedPricingVersionInsert => {
  const { contractId, approvedAt, approvedBy, currency, invoiceCurrency, currencyFactor, mode, graph } =
    validateApprovalEnvelope(source, versionNumber);
  const { data, products, customer, destination, payment } =
    validateContractPricingContext(source, currency);

  if (graph.rows.length !== source.contract.items.length || products.length !== graph.rows.length) {
    throw new ApprovedPricingEvidenceError('Contract item, snapshot, and canonical graph row counts conflict');
  }
  if (new Set(graph.rows.map(row => row.productRowId)).size !== graph.rows.length) {
    throw new ApprovedPricingEvidenceError('Canonical product row identities are duplicated');
  }
  const itemByRow = new Map(source.contract.items.map(item => [item.productRowId, item]));
  const snapshotByRow = new Map(products.map(item => [requiredString(item.rowId ?? item.productRowId, 'Product snapshot row identity'), item]));
  if (itemByRow.size !== source.contract.items.length || snapshotByRow.size !== products.length || itemByRow.has(null)) {
    throw new ApprovedPricingEvidenceError('Stable product row identities are missing or duplicated');
  }

  const currentById = new Map(source.contract.currentItems.map(item => [item.id, item]));
  if (currentById.size !== source.contract.items.length || source.contract.currentItems.length !== source.contract.items.length) {
    throw new ApprovedPricingEvidenceError('Contract rows changed after invoice candidate snapshot');
  }
  for (const item of source.contract.items) {
    const current = currentById.get(item.id);
    if (!current || current.productId !== item.productId || current.productRowId !== item.productRowId ||
      current.productType !== item.productType || quantity(current.quantity, `Current contract item ${item.id} quantity`) !== quantity(item.quantity, `Snapshotted contract item ${item.id} quantity`) ||
      money(current.totalPrice, `Current contract item ${item.id} total`) !== money(item.totalPrice, `Snapshotted contract item ${item.id} total`)) {
      throw new ApprovedPricingEvidenceError('Contract rows changed after invoice candidate snapshot');
    }
  }

  if (source.leaf.invoiceItems.length === 0) throw new ApprovedPricingEvidenceError('Approved invoice item evidence is missing');
  const invoiceByContractItem = new Map(source.leaf.invoiceItems.map(item => [item.contractItemId, item]));
  if (invoiceByContractItem.size !== source.leaf.invoiceItems.length || invoiceByContractItem.has(null)) {
    throw new ApprovedPricingEvidenceError('Approved invoice item identities are missing or duplicated');
  }
  for (const invoiceItem of source.leaf.invoiceItems) {
    const sourceItem = source.contract.items.find(item => item.id === invoiceItem.contractItemId);
    if (!sourceItem || invoiceItem.productId !== sourceItem.productId) throw new ApprovedPricingEvidenceError('Approved invoice item conflicts with source contract item');
  }
  if (mode !== 'FROM_SELECTED_ITEMS' && invoiceByContractItem.size !== source.contract.items.length) {
    throw new ApprovedPricingEvidenceError(`Invoice candidate mode ${mode} requires the complete snapshotted contract item set`);
  }
  const selectedContractItemIds = new Set(invoiceByContractItem.keys() as Iterable<string>);
  const selectedGraphRows = graph.rows.filter(row => {
    const sourceItem = itemByRow.get(row.productRowId);
    return sourceItem ? selectedContractItemIds.has(sourceItem.id) : false;
  });
  if (selectedGraphRows.length !== selectedContractItemIds.size) throw new ApprovedPricingEvidenceError('Approved invoice subset cannot be reconciled to canonical product rows');

  const financialSnapshot = record(source.leaf.sourceSnapshot, 'Invoice candidate source snapshot');
  const quantityNormalizations: OptimizerDerivedQuantityEvidence[] = [];
  for (const graphRow of selectedGraphRows) {
    const sourceItem = itemByRow.get(graphRow.productRowId);
    const snapshot = snapshotByRow.get(graphRow.productRowId);
    const invoiceItem = sourceItem ? invoiceByContractItem.get(sourceItem.id) : null;
    if (!sourceItem || !snapshot || !invoiceItem) throw new ApprovedPricingEvidenceError(`Product ${graphRow.productRowId} quantity sources are incomplete`);
    const evidence = reconcileOptimizerDerivedLongitudinalQuantity({
      graphSchemaVersion: graph.schemaVersion,
      roundingPolicy: graph.roundingPolicy,
      producer: graph.quantityPolicyProvenance?.producer ?? null,
      producerVersion: graph.quantityPolicyProvenance?.producerVersion ?? null,
      graphAuditCommandId: graph.quantityPolicyProvenance?.graphAuditCommandId ?? null,
      productRowId: graphRow.productRowId,
      productId: sourceItem.productId,
      productType: graphRow.productType,
      rawContractItemQuantity: sourceItem.quantity,
      rawInvoiceItemQuantity: invoiceItem.quantity,
      productSnapshot: snapshot,
      graphRequestedLengthMeters: graphRow.requestedLengthMeters,
      persistedDeliveries: financialSnapshot.deliveries,
      wizardDeliveries: data.deliveries,
    });
    if (evidence) quantityNormalizations.push(evidence);
  }
  const quantityEvidenceByRow = new Map(quantityNormalizations.map(item => [item.productRowId, item]));
  const financialAmountNormalizations: Array<Record<string, string>> = [];

  const hasDiscountField = Object.prototype.hasOwnProperty.call(data, 'discount');
  const isLegacyNoDiscountShape = !hasDiscountField || data.discount === null;
  const discountEligibility = contractDiscountEligibilityEvidence(snapshotByRow, graph.rows.map(row => ({
    productRowId: row.productRowId,
    baseAmountToman: money(row.baseAmountToman, `Product ${row.productRowId} base amount`),
  })), { allowLegacyMissingNonLayer: isLegacyNoDiscountShape });
  const contractEligibleBase = discountEligibility.eligibleBase;
  const { discount, discountBase, discountPercent, contractDiscountAmount, discountValue } =
    validateContractDiscountEvidence(data, payment, currency, contractEligibleBase, graph.totalAmountToman);
  if (!contractEligibleBase.eq(discountBase)) throw new ApprovedPricingEvidenceError('Contract discount base subtotal conflicts with canonical eligible rows');
  if (discountValue.gt(contractEligibleBase)) throw new ApprovedPricingEvidenceError('Contract discount exceeds eligible pricing');

  const canonicalWriterV2MoneyNormalizations = new Map(
    (graph.compatibility?.monetaryNormalizations ?? [])
      .filter(item => item.rule === 'CANONICAL_WIZARD_GRAPH_V1_ROUNDING_V2_RAW_TOMAN_TO_CANONICAL')
      .map(item => [item.productRowId, item]),
  );
  if (canonicalWriterV2MoneyNormalizations.size > 0) {
    const writer = graph.quantityPolicyProvenance;
    const hasExactProvenance = mode === 'FROM_CONTRACT_TOTAL' && discount.enabled === false &&
      graph.schemaVersion === 1 && graph.roundingPolicy === 'rounding-v2' &&
      writer?.producer === 'CANONICAL_WIZARD_SAVE';
    for (const normalization of canonicalWriterV2MoneyNormalizations.values()) {
      if (!hasExactProvenance || normalization.graphSchemaVersion !== 1 ||
        normalization.roundingPolicy !== 'rounding-v2' || normalization.producer !== 'CANONICAL_WIZARD_SAVE' ||
        normalization.producerVersion !== writer!.producerVersion ||
        normalization.graphAuditCommandId !== writer!.graphAuditCommandId) {
        throw new ApprovedPricingEvidenceError('Canonical writer rounding-v2 money normalization provenance conflicts with approved pricing');
      }
    }
  }

  const { rows, selectedEligibleBase, gross } = projectApprovedPricingRows({
    graphRows: selectedGraphRows,
    itemByRow,
    snapshotByRow,
    versionId,
    contractId,
    sourceFinancialRecordId: source.leaf.id,
    versionNumber,
    normalizedLegacyNonLayerProductRowIds: new Set(discountEligibility.normalizedNonLayerProductRowIds),
    quantityEvidenceByRow,
  });

  const grossAmount = money(gross, 'Approved pricing gross amount');
  const completeGraphTotal = graph.rows.reduce(
    (sum, row) => sum.plus(money(row.totalAmountToman, `Product ${row.productRowId} all-in amount`)),
    new Prisma.Decimal(0),
  );
  if (money(completeGraphTotal, 'Complete canonical graph total') !== money(graph.totalAmountToman, 'Canonical graph total amount')) {
    throw new ApprovedPricingEvidenceError('Canonical graph total conflicts with ordered all-in rows');
  }
  const selectedDiscountValue = discount.enabled
    ? selectedEligibleBase.mul(new Prisma.Decimal(discountPercent)).div(100)
    : new Prisma.Decimal(0);
  const discountAmount = money(selectedDiscountValue, 'Approved pricing discount amount');
  const netAmount = money(gross.minus(selectedDiscountValue), 'Approved pricing net amount');
  const rowByItem = new Map(rows.map(row => [row.contractItemId, row]));
  for (const invoiceItem of source.leaf.invoiceItems) {
    const sourceItem = source.contract.items.find(item => item.id === invoiceItem.contractItemId);
    const pricingRow = rowByItem.get(invoiceItem.contractItemId ?? '');
    if (!sourceItem || !pricingRow) throw new ApprovedPricingEvidenceError('Approved invoice item has no sealed pricing row');
    if (!quantityEvidenceByRow.has(pricingRow.productRowId) &&
      quantity(invoiceItem.quantity, `Invoice item ${invoiceItem.id} quantity`) !== quantity(sourceItem.quantity, `Contract item ${sourceItem.id} quantity`)) {
      throw new ApprovedPricingEvidenceError('Approved invoice item quantity conflicts with source snapshot');
    }
    const graphRow = selectedGraphRows.find(item => item.productRowId === pricingRow.productRowId)!;
    const canonicalWriterV2Normalization = canonicalWriterV2MoneyNormalizations.get(pricingRow.productRowId);
    const sourceItemTotal = new Prisma.Decimal(money(sourceItem.totalPrice, `Contract item ${sourceItem.id} total`));
    const legacySourceItemTotal = graphRow.legacyRawTotalAmountToman == null ? null :
      new Prisma.Decimal(graphRow.legacyRawTotalAmountToman).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    if (!sourceItemTotal.eq(pricingRow.canonicalAllInTotal) && !legacySourceItemTotal?.eq(sourceItemTotal)) {
      throw new ApprovedPricingEvidenceError('Source contract item total conflicts with canonical all-in pricing');
    }
    const expectedInvoiceGross = new Prisma.Decimal(pricingRow.canonicalAllInTotal).mul(currencyFactor);
    const invoiceItemTotal = new Prisma.Decimal(invoiceItem.totalPrice);
    const legacyInvoiceGross = graphRow.legacyRawTotalAmountToman == null ? null :
      new Prisma.Decimal(graphRow.legacyRawTotalAmountToman)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).mul(currencyFactor);
    if (!invoiceItemTotal.eq(expectedInvoiceGross) && !legacyInvoiceGross?.eq(invoiceItemTotal)) {
      throw new ApprovedPricingEvidenceError('Approved invoice item total conflicts with canonical all-in pricing');
    }
    if (!sourceItemTotal.eq(pricingRow.canonicalAllInTotal) || !invoiceItemTotal.eq(expectedInvoiceGross)) {
      financialAmountNormalizations.push({
        productRowId: pricingRow.productRowId,
        rawGraphAmountToman: String(graphRow.legacyRawTotalAmountToman),
        rawContractItemAmountToman: sourceItemTotal.toString(),
        rawInvoiceItemAmount: invoiceItemTotal.toString(),
        sealedAmountToman: pricingRow.canonicalAllInTotal,
        sealedInvoiceItemAmount: expectedInvoiceGross.toString(),
        differenceToman: new Prisma.Decimal(pricingRow.canonicalAllInTotal).minus(sourceItemTotal).toString(),
        ...(canonicalWriterV2Normalization ? {
          canonicalBaseAmountToman: String(graphRow.baseAmountToman),
          currencyConversionFactor: currencyFactor.toString(),
          graphSchemaVersion: String(canonicalWriterV2Normalization.graphSchemaVersion),
          roundingPolicy: canonicalWriterV2Normalization.roundingPolicy!,
          producer: canonicalWriterV2Normalization.producer!,
          producerVersion: String(canonicalWriterV2Normalization.producerVersion),
          graphAuditCommandId: canonicalWriterV2Normalization.graphAuditCommandId!,
          initiatingActor: approvedBy,
          action: 'FINANCIAL_APPROVAL',
          rule: canonicalWriterV2Normalization.rule,
        } : {
          rule: 'LEGACY_GRAPH_V1_AMOUNT_STORAGE_SCALE_TO_CANONICAL_TOMAN',
        }),
      });
    }
  }
  const expectedInvoiceAmount = new Prisma.Decimal(netAmount).mul(currencyFactor);
  const leafAmount = new Prisma.Decimal(source.leaf.amount);
  const legacyRawSelectedGross = selectedGraphRows.some(row => row.legacyRawTotalAmountToman != null)
    ? selectedGraphRows.reduce((sum, row) => sum.plus(
        new Prisma.Decimal(row.legacyRawTotalAmountToman ?? row.totalAmountToman!).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
      ), new Prisma.Decimal(0))
    : null;
  const legacyExpectedInvoiceAmount = !discount.enabled && legacyRawSelectedGross
    ? legacyRawSelectedGross.mul(currencyFactor).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    : null;
  if (!leafAmount.eq(expectedInvoiceAmount) && !legacyExpectedInvoiceAmount?.eq(leafAmount)) {
    throw new ApprovedPricingEvidenceError('Approved invoice amount conflicts with sealed net pricing');
  }
  if (!leafAmount.eq(expectedInvoiceAmount)) {
    const canonicalWriterV2InvoiceNormalizations = [...canonicalWriterV2MoneyNormalizations.values()]
      .filter(item => selectedGraphRows.some(row => row.productRowId === item.productRowId));
    financialAmountNormalizations.push({
      scope: 'invoice',
      rawInvoiceAmount: leafAmount.toString(),
      sealedInvoiceAmount: expectedInvoiceAmount.toString(),
      difference: expectedInvoiceAmount.minus(leafAmount).toString(),
      ...(canonicalWriterV2InvoiceNormalizations.length > 0 ? {
        currencyConversionFactor: currencyFactor.toString(),
        graphSchemaVersion: '1',
        roundingPolicy: 'rounding-v2',
        producer: 'CANONICAL_WIZARD_SAVE',
        producerVersion: String(canonicalWriterV2InvoiceNormalizations[0]!.producerVersion),
        graphAuditCommandId: canonicalWriterV2InvoiceNormalizations[0]!.graphAuditCommandId!,
        initiatingActor: approvedBy,
        action: 'FINANCIAL_APPROVAL',
        normalizedProductRowIds: canonicalWriterV2InvoiceNormalizations
          .map(item => item.productRowId).sort().join(','),
        rule: 'CANONICAL_WIZARD_GRAPH_V1_ROUNDING_V2_RAW_TOMAN_TO_CANONICAL',
      } : {
        rule: 'LEGACY_GRAPH_V1_AMOUNT_STORAGE_SCALE_TO_CANONICAL_TOMAN',
      }),
    });
  }
  const sourceEvidence = {
    contractNumber: source.contract.contractNumber,
    customer: canonicalize(customer),
    project: canonicalize(destination.project),
    destination: destination.destination,
    discount: canonicalize({
      ...discount,
      baseSubtotal: discountBase,
      percent: discountPercent,
      amount: contractDiscountAmount,
      selectedBasis: money(selectedEligibleBase, 'Selected discount basis'),
      selectedAmount: discountAmount,
    }),
    ...(discountEligibility.normalizedNonLayerProductRowIds.length > 0
      ? {
          discountEligibility: {
            evidenceOrigin: LEGACY_DISCOUNT_ELIGIBILITY_EVIDENCE_ORIGIN,
            normalizedNonLayerProductRowIds: discountEligibility.normalizedNonLayerProductRowIds,
          },
        }
      : {}),
    ...(quantityNormalizations.length > 0 ? { quantityNormalizations } : {}),
    ...(financialAmountNormalizations.length > 0 ? { financialAmountNormalizations } : {}),
    financialApproval: {
      financialRecordId: source.leaf.id,
      mode,
      amount: money(source.leaf.amount, 'Approved invoice evidence amount'),
      currency: invoiceCurrency,
      sourceSnapshotHash: canonicalApprovedPricingHash(source.leaf.sourceSnapshot),
      metadataHash: canonicalApprovedPricingHash(source.leaf.metadata),
      invoiceItems: [...source.leaf.invoiceItems]
        .sort((left, right) => `${left.contractItemId}:${left.id}`.localeCompare(`${right.contractItemId}:${right.id}`))
        .map(item => ({
        id: item.id,
        contractItemId: item.contractItemId,
        productId: item.productId,
        quantity: quantity(item.quantity, `Invoice item ${item.id} evidence quantity`),
        totalPrice: money(item.totalPrice, `Invoice item ${item.id} evidence total`),
        })),
    },
    graph: {
      schemaVersion: graph.schemaVersion,
      revision: graph.revision,
      inputHash: graph.inputHash,
      resultHash: graph.resultHash,
      totalAmountToman: money(graph.totalAmountToman, 'Canonical graph total amount'),
      ...(graph.compatibility ? { compatibility: canonicalize(graph.compatibility) } : {}),
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
  if (!leaf) throw new ApprovedPricingEvidenceError({ technicalDetail: 'Approved invoice leaf was not found' });
  if (!isValidFinanciallyApprovedInvoice(leaf)) {
    throw new ApprovedPricingEvidenceError({ technicalDetail: 'Financial record is not a valid approved invoice leaf' });
  }
  let contractId: string;
  try {
    contractId = requiredString(leaf.contractId, 'Approved invoice contract');
  } catch (error) {
    const evidenceError = asApprovedPricingEvidenceError(error);
    if (evidenceError) throw evidenceError;
    throw error;
  }
  return repository.withContractLock(contractId, async () => {
    const existing = await repository.findByApproval(contractId, financialRecordId);
    if (existing) {
      if (existing.approvedAt.toISOString() !== leaf.financiallyApprovedAt?.toISOString() || existing.approvedBy !== leaf.financiallyApprovedBy) {
        throw new ApprovedPricingEvidenceError({
          technicalDetail: 'Existing approved pricing version conflicts with approval evidence',
        });
      }
      return { outcome: 'REPLAYED', version: existing };
    }
    let source: ApprovedPricingSource | null;
    try {
      source = await repository.loadSource(financialRecordId);
    } catch (error) {
      const evidenceError = asApprovedPricingEvidenceError(error);
      if (evidenceError) throw evidenceError;
      throw error;
    }
    if (!source) throw new ApprovedPricingEvidenceError({ technicalDetail: 'Approved pricing source was not found' });
    let version: ApprovedPricingVersionInsert;
    try {
      version = buildApprovedPricingVersion(source, await repository.nextVersionNumber(contractId), createVersionId());
    } catch (error) {
      const evidenceError = asApprovedPricingEvidenceError(error);
      if (evidenceError) throw evidenceError;
      throw error;
    }
    return { outcome: 'SEALED', version: await repository.insertAndAdvance(version) };
  });
};
