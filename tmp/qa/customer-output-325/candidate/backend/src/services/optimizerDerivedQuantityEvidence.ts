import { Prisma } from '@prisma/client';
import {
  ApprovedPricingEvidenceError,
  asApprovedPricingEvidenceError,
} from './approvedPricing/evidenceError';
import { resolveCommercialQuantityPolicy } from './commercialQuantityPolicy';

// Deliberate witness-validation failures are typed evidence conflicts; runtime failures remain native.

export const OPTIMIZER_DERIVED_QUANTITY_EVIDENCE_ORIGIN =
  'OPTIMIZER_DERIVED_LONGITUDINAL_ZERO_SENTINEL' as const;

type UnknownRecord = Readonly<Record<string, unknown>>;
export type OptimizerQuantityPolicyProvenance = {
  producer: 'LEGACY_MIGRATION' | 'CANONICAL_WIZARD_SAVE';
  producerVersion: 0 | 1;
  graphAuditCommandId: string;
};

export class OptimizerQuantityEvidenceConflictError extends ApprovedPricingEvidenceError {
  constructor(input: {
    productRowId: string;
    policy: string;
    rawOptimizerQuantity: string;
    rawProductionQuantity: string;
    difference: string;
    additionalEvidence?: Readonly<Record<string, unknown>>;
  }) {
    super({
      technicalDetail: `Product ${input.productRowId} optimizer quantities conflict`,
      evidence: {
        ...(input.additionalEvidence || {}),
        productRowId: input.productRowId,
        rule: input.policy,
        rawOptimizerQuantity: input.rawOptimizerQuantity,
        rawProductionQuantity: input.rawProductionQuantity,
        difference: input.difference,
        unit: 'meter',
      },
      userMessageFa: 'کمیت قطعات ثبت‌شده با کمیت کل قرارداد سازگار نیست. مدیر حسابداری باید پروندهٔ بررسی کمیت این قرارداد را تعیین تکلیف کند.',
      reviewKind: 'QUANTITY',
      remediationKind: 'RESPONSIBLE_SELLER_CORRECTION',
    });
    this.name = 'OptimizerQuantityEvidenceConflictError';
  }
}

export type OptimizerDerivedQuantityEvidence = {
  evidenceOrigin: typeof OPTIMIZER_DERIVED_QUANTITY_EVIDENCE_ORIGIN;
  productRowId: string;
  rawContractItemQuantity: string;
  rawInvoiceItemQuantity?: string;
  sealedQuantity: string;
  unit: 'meter';
  optimizerPlan: {
    totalRequestedLengthMeters: string;
    productionQuantity: string;
  };
  canonicalGraph: { requestedLengthMeters: string };
  persistedDeliveries: {
    rows: readonly { deliveryId: string; deliveryProductId: string; rawQuantity: string; quantity: string }[];
    totalQuantity: string;
  };
  wizardDelivery: {
    present: boolean;
    rows?: readonly { deliveryIndex: number; productIndex: number; rawQuantity: string }[];
    totalQuantity?: string;
  };
  compatibility: {
    policy:
      | 'CONTRACT_PRODUCT_GRAPH_V1_SCALE_TWO_PERSISTENCE'
      | 'CONTRACT_PRODUCT_GRAPH_V2_SCALE_THREE_PERSISTENCE';
    graphSchemaVersion: 1;
    rounding: 'ROUND_HALF_UP';
    sealedScale: 3;
    persistedScale: 2 | 3;
    producer: 'LEGACY_MIGRATION' | 'CANONICAL_WIZARD_SAVE';
    producerVersion: 0 | 1;
    graphAuditCommandId: string;
    rawOptimizerQuantity: string;
    rawProductionQuantity: string;
    rawCanonicalGraphQuantity?: string;
    sourceTransformation?: 'ROUND_HALF_UP_SCALE_THREE';
    commercialEquivalences?: readonly {
      leftSource: 'OPTIMIZER_PRODUCTION' | 'PRODUCT_GRAPH' | 'WIZARD_DELIVERY' | 'INVOICE';
      rightSource: 'OPTIMIZER_TOTAL';
      rawLeft: string;
      rawRight: string;
      comparableLeft: string;
      comparableRight: string;
      rawDifference: string;
      rule: 'ROUND_HALF_UP_SCALE_THREE';
    }[];
    commercialQuantityPolicy: ReturnType<typeof resolveCommercialQuantityPolicy>;
    rawPersistedDeliveryTotal: string;
    sealedQuantity: string;
    persistedComparableQuantity: string;
    persistedDifference: string;
  };
};

export type OptimizerDerivedQuantityInput = {
  graphSchemaVersion: number;
  roundingPolicy: string;
  producer: 'LEGACY_MIGRATION' | 'CANONICAL_WIZARD_SAVE' | null;
  producerVersion: number | null;
  graphAuditCommandId: string | null;
  productRowId: string;
  productId: string;
  productType: string;
  rawContractItemQuantity: unknown;
  rawInvoiceItemQuantity?: unknown;
  productSnapshot: UnknownRecord;
  graphRequestedLengthMeters: unknown;
  persistedDeliveries: unknown;
  wizardDeliveries: unknown;
};

const record = (value: unknown, label: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApprovedPricingEvidenceError(`${label} is missing or malformed`);
  return value as UnknownRecord;
};

export const optimizerQuantityPolicyProvenanceFromAudit = (input: {
  graphSchemaVersion: number;
  roundingPolicy: string;
  graphAuditCommandId: unknown;
  graphAuditCommand: unknown;
}): OptimizerQuantityPolicyProvenance | null => {
  if (typeof input.graphAuditCommandId !== 'string' || !input.graphAuditCommandId.trim()) return null;
  if (!input.graphAuditCommand || typeof input.graphAuditCommand !== 'object' || Array.isArray(input.graphAuditCommand)) return null;
  const command = input.graphAuditCommand as UnknownRecord;
  const producerVersion = command.writerVersion === 1 ? 1 : command.writerVersion === undefined ? 0 : null;
  if (producerVersion !== null && command.kind === 'legacy-migration' && input.graphSchemaVersion === 1 &&
    input.roundingPolicy === 'rounding-v1' && typeof command.backupReference === 'string' && command.backupReference.trim()) {
    return { producer: 'LEGACY_MIGRATION', producerVersion, graphAuditCommandId: input.graphAuditCommandId.trim() };
  }
  const policy = command.policy && typeof command.policy === 'object' && !Array.isArray(command.policy)
    ? command.policy as UnknownRecord
    : null;
  if (producerVersion !== null && command.kind === 'canonical-wizard-save' && input.graphSchemaVersion === 1 &&
    (input.roundingPolicy === 'rounding-v1' || input.roundingPolicy === 'rounding-v2') &&
    policy?.rounding === input.roundingPolicy) {
    return { producer: 'CANONICAL_WIZARD_SAVE', producerVersion, graphAuditCommandId: input.graphAuditCommandId.trim() };
  }
  return null;
};

const decimal = (value: unknown, label: string) => {
  if (value === null || value === undefined || value === '') throw new ApprovedPricingEvidenceError(`${label} is missing or malformed`);
  try {
    return new Prisma.Decimal(String(value));
  } catch {
    throw new ApprovedPricingEvidenceError(`${label} is missing or malformed`);
  }
};

const positive = (value: unknown, label: string, maximumScale?: number) => {
  const result = decimal(value, label);
  if (!result.gt(0)) throw new ApprovedPricingEvidenceError(`${label} must be positive`);
  if (maximumScale !== undefined && result.decimalPlaces() > maximumScale) {
    throw new ApprovedPricingEvidenceError(`${label} must use scale-${maximumScale} precision`);
  }
  return result;
};

const requiredString = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new ApprovedPricingEvidenceError(`${label} is missing or malformed`);
  return value.trim();
};

const fixedQuantity = (value: Prisma.Decimal) =>
  value.toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP).toFixed(3);

const commercialComparable = (value: Prisma.Decimal, scale: number) =>
  value.toDecimalPlaces(scale, Prisma.Decimal.ROUND_HALF_UP);

const commerciallyEqual = (left: Prisma.Decimal, right: Prisma.Decimal, scale: number) =>
  commercialComparable(left, scale).eq(commercialComparable(right, scale));

const optimizerQuantityPolicy = (input: Pick<OptimizerDerivedQuantityInput,
  'graphSchemaVersion' | 'roundingPolicy' | 'producer' | 'producerVersion' | 'graphAuditCommandId'>) => {
  const hasRecordedProducer = Boolean(input.graphAuditCommandId) &&
    (input.producerVersion === 0 || input.producerVersion === 1);
  if (hasRecordedProducer &&
    (input.producer === 'LEGACY_MIGRATION' || input.producer === 'CANONICAL_WIZARD_SAVE') &&
    input.graphSchemaVersion === 1 && input.roundingPolicy === 'rounding-v1') {
    const commercialQuantityPolicy = resolveCommercialQuantityPolicy({
      graphSchemaVersion: input.graphSchemaVersion,
      roundingPolicy: input.roundingPolicy,
      productFamily: 'longitudinal',
    });
    return {
      policy: 'CONTRACT_PRODUCT_GRAPH_V1_SCALE_TWO_PERSISTENCE' as const,
      graphSchemaVersion: 1 as const,
      sourceScale: undefined,
      persistedScale: 2 as const,
      sealedScale: commercialQuantityPolicy.billableQuantity.scale as 3,
      commercialQuantityPolicy,
      producer: input.producer,
      producerVersion: input.producerVersion as 0 | 1,
      graphAuditCommandId: input.graphAuditCommandId!,
    };
  }
  if (hasRecordedProducer && input.producer === 'CANONICAL_WIZARD_SAVE' &&
    input.graphSchemaVersion === 1 && input.roundingPolicy === 'rounding-v2') {
    const commercialQuantityPolicy = resolveCommercialQuantityPolicy({
      graphSchemaVersion: input.graphSchemaVersion,
      roundingPolicy: input.roundingPolicy,
      productFamily: 'longitudinal',
    });
    return {
      policy: 'CONTRACT_PRODUCT_GRAPH_V2_SCALE_THREE_PERSISTENCE' as const,
      graphSchemaVersion: 1 as const,
      sourceScale: undefined,
      persistedScale: 3 as const,
      sealedScale: commercialQuantityPolicy.billableQuantity.scale as 3,
      commercialQuantityPolicy,
      producer: input.producer,
      producerVersion: input.producerVersion as 0 | 1,
      graphAuditCommandId: input.graphAuditCommandId!,
    };
  }
  throw new ApprovedPricingEvidenceError({
    technicalDetail: `Unsupported or missing optimizer quantity provenance ${input.producer ?? 'unknown'}:${input.producerVersion ?? 'unknown'}:${input.graphSchemaVersion}:${input.roundingPolicy}`,
    evidence: {
      producer: input.producer,
      producerVersion: input.producerVersion,
      graphSchemaVersion: input.graphSchemaVersion,
      roundingPolicy: input.roundingPolicy,
      graphAuditCommandId: input.graphAuditCommandId,
    },
    userMessageFa: 'منشأ نسخهٔ محاسبهٔ کمیت این قرارداد قابل اثبات نیست. مدیر حسابداری باید پروندهٔ بررسی کمیت را تعیین تکلیف کند.',
    reviewKind: 'QUANTITY',
    remediationKind: 'EVIDENCE_RECOVERY',
  });
};

export const canonicalOptimizerDerivedLengthWitness = (
  graphRow: unknown,
  projectedLengthMeters: unknown,
): string | undefined => {
  if (projectedLengthMeters !== null && projectedLengthMeters !== undefined && projectedLengthMeters !== '') {
    return String(projectedLengthMeters);
  }
  const row = record(graphRow, 'Canonical product graph row');
  if (String(row.productType ?? '').toLowerCase() !== 'longitudinal') return undefined;
  const commercial = record(row.commercial, `Canonical row ${String(row.productRowId ?? '')} commercial evidence`);
  if (commercial.legacySnapshot === null || commercial.legacySnapshot === undefined) return undefined;
  const legacySnapshot = record(commercial.legacySnapshot, `Canonical row ${String(row.productRowId ?? '')} legacy snapshot`);
  if (legacySnapshot.smartCutDerivedQuantity !== true) return undefined;
  const plan = record(legacySnapshot.smartCutPlan, `Canonical row ${String(row.productRowId ?? '')} optimizer plan`);
  if (plan.derivedQuantity !== true) {
    throw new ApprovedPricingEvidenceError(`Canonical row ${String(row.productRowId ?? '')} optimizer plan is not quantity-derived`);
  }
  if (plan.totalRequestedLengthM === null || plan.totalRequestedLengthM === undefined || plan.totalRequestedLengthM === '') {
    throw new ApprovedPricingEvidenceError(`Canonical row ${String(row.productRowId ?? '')} optimizer total length is missing or malformed`);
  }
  return String(plan.totalRequestedLengthM);
};

const reconcileOptimizerDerivedLongitudinalQuantityInternal = (
  input: OptimizerDerivedQuantityInput,
): OptimizerDerivedQuantityEvidence | null => {
  if (input.productType.toLowerCase() !== 'longitudinal' ||
    !decimal(input.rawContractItemQuantity, `Product ${input.productRowId} contract item quantity`).eq(0)) return null;

  const policy = optimizerQuantityPolicy(input);
  const snapshotQuantity = decimal(input.productSnapshot.quantity, `Product ${input.productRowId} snapshot quantity`);
  if (!snapshotQuantity.eq(0)) throw new ApprovedPricingEvidenceError(`Product ${input.productRowId} zero-sentinel quantities conflict`);
  if (input.productSnapshot.smartCutDerivedQuantity !== true) {
    throw new ApprovedPricingEvidenceError(`Product ${input.productRowId} optimizer-derived quantity evidence is missing`);
  }
  const plan = record(input.productSnapshot.smartCutPlan, `Product ${input.productRowId} optimizer plan`);
  if (plan.derivedQuantity !== true) throw new ApprovedPricingEvidenceError(`Product ${input.productRowId} optimizer plan is not quantity-derived`);
  positive(plan.requestedQuantity, `Product ${input.productRowId} optimizer requested quantity`, policy.sourceScale);
  const planQuantity = positive(plan.totalRequestedLengthM, `Product ${input.productRowId} optimizer total length`, policy.sourceScale);
  if (!Array.isArray(plan.productionPieces) || plan.productionPieces.length === 0) {
    throw new ApprovedPricingEvidenceError(`Product ${input.productRowId} optimizer production pieces are missing`);
  }
  const productionQuantity = plan.productionPieces.reduce((sum, value, index) => {
    const piece = record(value, `Product ${input.productRowId} optimizer production piece ${index}`);
    return sum.plus(
      positive(piece.lengthM, `Product ${input.productRowId} optimizer production length ${index}`, policy.sourceScale)
        .mul(positive(piece.quantity, `Product ${input.productRowId} optimizer production quantity ${index}`, policy.sourceScale)),
    );
  }, new Prisma.Decimal(0));
  if (!commerciallyEqual(productionQuantity, planQuantity, policy.sealedScale)) {
    throw new OptimizerQuantityEvidenceConflictError({
      productRowId: input.productRowId,
      policy: policy.policy,
      rawOptimizerQuantity: planQuantity.toString(),
      rawProductionQuantity: productionQuantity.toString(),
      difference: productionQuantity.minus(planQuantity).toString(),
    });
  }

  const graphQuantity = positive(input.graphRequestedLengthMeters, `Product ${input.productRowId} canonical graph length`, policy.sourceScale);
  let sourceTransformation: 'ROUND_HALF_UP_SCALE_THREE' | undefined;
  if (!commerciallyEqual(graphQuantity, planQuantity, policy.sealedScale)) {
    throw new ApprovedPricingEvidenceError(`Product ${input.productRowId} canonical graph quantity conflicts with optimizer plan`);
  }
  if (!graphQuantity.eq(planQuantity)) {
    sourceTransformation = 'ROUND_HALF_UP_SCALE_THREE';
  }

  type CommercialEquivalence = NonNullable<
    OptimizerDerivedQuantityEvidence['compatibility']['commercialEquivalences']
  >[number];
  const commercialEquivalences: CommercialEquivalence[] = [];
  const recordCommercialEquivalence = (
    leftSource: (typeof commercialEquivalences)[number]['leftSource'],
    left: Prisma.Decimal,
  ) => {
    if (left.eq(planQuantity)) return;
    commercialEquivalences.push({
      leftSource,
      rightSource: 'OPTIMIZER_TOTAL',
      rawLeft: left.toString(),
      rawRight: planQuantity.toString(),
      comparableLeft: commercialComparable(left, policy.sealedScale).toFixed(policy.sealedScale),
      comparableRight: commercialComparable(planQuantity, policy.sealedScale).toFixed(policy.sealedScale),
      rawDifference: left.minus(planQuantity).toString(),
      rule: 'ROUND_HALF_UP_SCALE_THREE',
    });
  };
  recordCommercialEquivalence('OPTIMIZER_PRODUCTION', productionQuantity);
  recordCommercialEquivalence('PRODUCT_GRAPH', graphQuantity);

  if (!Array.isArray(input.persistedDeliveries) || input.persistedDeliveries.length === 0) {
    throw new ApprovedPricingEvidenceError(`Product ${input.productRowId} persisted Delivery evidence is missing`);
  }
  const persistedRows: { deliveryId: string; deliveryProductId: string; rawQuantity: string; quantity: string }[] = [];
  const persistedKeys = new Set<string>();
  let persistedTotal = new Prisma.Decimal(0);
  for (const [deliveryIndex, rawDelivery] of input.persistedDeliveries.entries()) {
    const delivery = record(rawDelivery, `Persisted Delivery ${deliveryIndex}`);
    const deliveryId = requiredString(delivery.id, `Persisted Delivery ${deliveryIndex} identity`);
    if (!Array.isArray(delivery.products)) throw new ApprovedPricingEvidenceError(`Persisted Delivery ${deliveryId} products are missing`);
    for (const [productIndex, rawProduct] of delivery.products.entries()) {
      const product = record(rawProduct, `Persisted Delivery ${deliveryId} product ${productIndex}`);
      if (product.productRowId !== input.productRowId) continue;
      if (delivery.status === 'CANCELLED') throw new ApprovedPricingEvidenceError(`Product ${input.productRowId} persisted Delivery is cancelled`);
      if (product.productId !== input.productId) throw new ApprovedPricingEvidenceError(`Product ${input.productRowId} persisted Delivery identity conflicts`);
      const deliveryProductId = requiredString(product.id, `Persisted Delivery ${deliveryId} product identity`);
      const key = `${deliveryId}:${input.productRowId}`;
      if (persistedKeys.has(key)) throw new ApprovedPricingEvidenceError(`Product ${input.productRowId} persisted Delivery row is duplicated`);
      persistedKeys.add(key);
      const rowQuantity = positive(product.quantity, `Product ${input.productRowId} persisted Delivery quantity`, policy.persistedScale);
      persistedTotal = persistedTotal.plus(rowQuantity);
      persistedRows.push({
        deliveryId,
        deliveryProductId,
        rawQuantity: rowQuantity.toString(),
        quantity: fixedQuantity(rowQuantity),
      });
    }
  }
  if (persistedRows.length === 0) throw new ApprovedPricingEvidenceError(`Product ${input.productRowId} persisted Delivery evidence is missing`);

  let wizardEvidence: OptimizerDerivedQuantityEvidence['wizardDelivery'] = { present: false };
  let persistedComparableQuantity = planQuantity.toDecimalPlaces(policy.persistedScale, Prisma.Decimal.ROUND_HALF_UP);
  let hasWizardRows = false;
  if (input.wizardDeliveries !== null && input.wizardDeliveries !== undefined) {
    if (!Array.isArray(input.wizardDeliveries)) throw new ApprovedPricingEvidenceError(`Product ${input.productRowId} wizard Delivery evidence is malformed`);
    if (input.wizardDeliveries.length > 0) {
      let wizardTotal = new Prisma.Decimal(0);
      let wizardPersistedComparableTotal = new Prisma.Decimal(0);
      let wizardRows = 0;
      const rawWizardRows: { deliveryIndex: number; productIndex: number; rawQuantity: string }[] = [];
      for (const [deliveryIndex, rawDelivery] of input.wizardDeliveries.entries()) {
        const delivery = record(rawDelivery, `Wizard Delivery ${deliveryIndex}`);
        if (!Array.isArray(delivery.products)) throw new ApprovedPricingEvidenceError(`Wizard Delivery ${deliveryIndex} products are missing`);
        let matchedInDelivery = false;
        for (const [productIndex, rawProduct] of delivery.products.entries()) {
          const product = record(rawProduct, `Wizard Delivery ${deliveryIndex} product ${productIndex}`);
          if (product.productRowId !== input.productRowId) continue;
          if (matchedInDelivery) throw new ApprovedPricingEvidenceError(`Product ${input.productRowId} wizard Delivery row is duplicated`);
          matchedInDelivery = true;
          wizardRows += 1;
          hasWizardRows = true;
          if (product.productId !== input.productId || product.unit !== 'meter') {
            throw new ApprovedPricingEvidenceError(`Product ${input.productRowId} wizard Delivery identity or unit conflicts`);
          }
          const wizardQuantity = positive(
            product.quantity,
            `Product ${input.productRowId} wizard Delivery quantity`,
            policy.sourceScale,
          );
          wizardTotal = wizardTotal.plus(wizardQuantity);
          rawWizardRows.push({ deliveryIndex, productIndex, rawQuantity: wizardQuantity.toString() });
          wizardPersistedComparableTotal = wizardPersistedComparableTotal.plus(
            wizardQuantity.toDecimalPlaces(policy.persistedScale, Prisma.Decimal.ROUND_HALF_UP),
          );
        }
      }
      if (wizardRows === 0 || !commerciallyEqual(wizardTotal, planQuantity, policy.sealedScale)) {
        throw new ApprovedPricingEvidenceError(`Product ${input.productRowId} wizard Delivery quantity conflicts`);
      }
      recordCommercialEquivalence('WIZARD_DELIVERY', wizardTotal);
      wizardEvidence = { present: true, rows: rawWizardRows, totalQuantity: fixedQuantity(wizardTotal) };
      persistedComparableQuantity = wizardPersistedComparableTotal;
    }
  }

  if (!hasWizardRows && persistedRows.length !== 1) {
    throw new ApprovedPricingEvidenceError({
      technicalDetail: `Product ${input.productRowId} has ambiguous multi-row persisted Delivery conversion without wizard-era row witnesses`,
      evidence: {
        productRowId: input.productRowId,
        rule: policy.policy,
        persistedRowCount: persistedRows.length,
        rawOptimizerQuantity: planQuantity.toString(),
        rawPersistedDeliveryRows: persistedRows.map(row => ({
          deliveryId: row.deliveryId,
          deliveryProductId: row.deliveryProductId,
          rawQuantity: row.rawQuantity,
        })),
      },
      userMessageFa: 'نحوهٔ تبدیل کمیت چند تحویل تاریخی این قرارداد یکتا نیست. مدیر حسابداری باید پروندهٔ بررسی کمیت را تعیین تکلیف کند.',
      reviewKind: 'QUANTITY',
      remediationKind: 'EVIDENCE_RECOVERY',
    });
  }

  if (!persistedTotal.eq(persistedComparableQuantity)) {
    throw new ApprovedPricingEvidenceError(`Product ${input.productRowId} persisted Delivery quantity conflicts`);
  }

  const invoiceQuantity = input.rawInvoiceItemQuantity === undefined
    ? undefined
    : decimal(input.rawInvoiceItemQuantity, `Product ${input.productRowId} invoice quantity`);
  if (invoiceQuantity !== undefined && !invoiceQuantity.eq(0) &&
    !commerciallyEqual(invoiceQuantity, planQuantity, policy.sealedScale)) {
    throw new ApprovedPricingEvidenceError(`Product ${input.productRowId} invoice quantity conflicts with sealed meters`);
  }
  if (invoiceQuantity !== undefined && !invoiceQuantity.eq(0)) recordCommercialEquivalence('INVOICE', invoiceQuantity);

  return {
    evidenceOrigin: OPTIMIZER_DERIVED_QUANTITY_EVIDENCE_ORIGIN,
    productRowId: input.productRowId,
    rawContractItemQuantity: fixedQuantity(new Prisma.Decimal(0)),
    ...(invoiceQuantity === undefined ? {} : { rawInvoiceItemQuantity: fixedQuantity(invoiceQuantity) }),
    sealedQuantity: fixedQuantity(planQuantity),
    unit: 'meter',
    optimizerPlan: {
      totalRequestedLengthMeters: fixedQuantity(planQuantity),
      productionQuantity: fixedQuantity(productionQuantity),
    },
    canonicalGraph: { requestedLengthMeters: fixedQuantity(graphQuantity) },
    persistedDeliveries: {
      rows: persistedRows,
      totalQuantity: fixedQuantity(persistedTotal),
    },
    wizardDelivery: wizardEvidence,
    compatibility: {
      policy: policy.policy,
      commercialQuantityPolicy: policy.commercialQuantityPolicy,
      graphSchemaVersion: policy.graphSchemaVersion,
      rounding: 'ROUND_HALF_UP' as const,
      sealedScale: policy.sealedScale,
      persistedScale: policy.persistedScale,
      producer: policy.producer,
      producerVersion: policy.producerVersion,
      graphAuditCommandId: policy.graphAuditCommandId,
      rawOptimizerQuantity: planQuantity.toString(),
      rawProductionQuantity: productionQuantity.toString(),
      rawCanonicalGraphQuantity: graphQuantity.toString(),
      ...(sourceTransformation ? { sourceTransformation } : {}),
      ...(commercialEquivalences.length > 0 ? { commercialEquivalences } : {}),
      rawPersistedDeliveryTotal: persistedTotal.toString(),
      sealedQuantity: fixedQuantity(planQuantity),
      persistedComparableQuantity: persistedComparableQuantity.toFixed(policy.persistedScale),
      persistedDifference: persistedTotal.minus(planQuantity).toString(),
    },
  };
};

const optionalRecord = (value: unknown): UnknownRecord | null => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null
);

const provenHistoricalPersistencePolicy = (input: OptimizerDerivedQuantityInput) => {
  try {
    return optimizerQuantityPolicy(input);
  } catch (error) {
    if (asApprovedPricingEvidenceError(error)) return null;
    throw error;
  }
};

const historicalConvertedQuantity = (value: unknown, scale: number | null) => {
  if (scale === null || value === null || value === undefined || value === '') return undefined;
  try {
    return new Prisma.Decimal(String(value))
      .toDecimalPlaces(scale, Prisma.Decimal.ROUND_HALF_UP)
      .toFixed(scale);
  } catch {
    return undefined;
  }
};

const exactDifference = (left: unknown, right: unknown) => {
  if (left === null || left === undefined || left === '' || right === null || right === undefined || right === '') return undefined;
  try {
    return new Prisma.Decimal(String(left)).minus(String(right)).toString();
  } catch {
    return undefined;
  }
};

const exactTotal = (values: readonly (string | undefined)[], fixedScale?: number | null) => {
  if (values.length === 0 || values.some(value => value === undefined || value === '')) return undefined;
  try {
    const total = values.reduce((sum, value) => sum.plus(String(value)), new Prisma.Decimal(0));
    return fixedScale === null || fixedScale === undefined ? total.toString() : total.toFixed(fixedScale);
  } catch {
    return undefined;
  }
};

const rawProductionTotal = (plan: UnknownRecord | null) => {
  if (!Array.isArray(plan?.productionPieces) || plan.productionPieces.length === 0) return undefined;
  try {
    return plan.productionPieces.reduce((sum, rawPiece) => {
      const piece = optionalRecord(rawPiece);
      if (!piece) throw new Error('malformed production piece');
      return sum.plus(new Prisma.Decimal(String(piece.lengthM)).mul(String(piece.quantity)));
    }, new Prisma.Decimal(0)).toString();
  } catch {
    return undefined;
  }
};

const rawQuantityReviewEvidence = (input: OptimizerDerivedQuantityInput, conflictDetail = '') => {
  const snapshot = optionalRecord(input.productSnapshot);
  const plan = optionalRecord(snapshot?.smartCutPlan);
  const provenPolicy = provenHistoricalPersistencePolicy(input);
  const deliveryScale = provenPolicy?.persistedScale ?? null;
  const commercialScale = provenPolicy?.sealedScale ?? null;
  const persistedRows: Array<{ deliveryId: string; deliveryProductId: string; rawQuantity: string; transformedQuantity?: string }> = [];
  if (Array.isArray(input.persistedDeliveries)) {
    for (const rawDelivery of input.persistedDeliveries) {
      const delivery = optionalRecord(rawDelivery);
      if (!delivery || !Array.isArray(delivery.products)) continue;
      for (const rawProduct of delivery.products) {
        const product = optionalRecord(rawProduct);
        if (!product || product.productRowId !== input.productRowId) continue;
        const rawQuantity = String(product.quantity ?? '');
        persistedRows.push({
          deliveryId: String(delivery.id ?? ''),
          deliveryProductId: String(product.id ?? ''),
          rawQuantity,
          ...(historicalConvertedQuantity(rawQuantity, deliveryScale) ? {
            transformedQuantity: historicalConvertedQuantity(rawQuantity, deliveryScale),
          } : {}),
        });
      }
    }
  }
  const wizardRows: Array<{ deliveryIndex: number; productIndex: number; rawQuantity: string; transformedQuantity?: string }> = [];
  if (Array.isArray(input.wizardDeliveries)) {
    input.wizardDeliveries.forEach((rawDelivery, deliveryIndex) => {
      const delivery = optionalRecord(rawDelivery);
      if (!delivery || !Array.isArray(delivery.products)) return;
      delivery.products.forEach((rawProduct, productIndex) => {
        const product = optionalRecord(rawProduct);
        if (product?.productRowId === input.productRowId) {
          const rawQuantity = String(product.quantity ?? '');
          wizardRows.push({
            deliveryIndex,
            productIndex,
            rawQuantity,
            ...(historicalConvertedQuantity(rawQuantity, deliveryScale) ? {
              transformedQuantity: historicalConvertedQuantity(rawQuantity, deliveryScale),
            } : {}),
          });
        }
      });
    });
  }
  const rawOptimizerQuantity = plan?.totalRequestedLengthM === undefined ? undefined : String(plan.totalRequestedLengthM);
  const rawProductionQuantity = rawProductionTotal(plan);
  const rawCanonicalGraphQuantity = input.graphRequestedLengthMeters === undefined
    ? undefined
    : String(input.graphRequestedLengthMeters);
  const rawInvoiceItemQuantity = input.rawInvoiceItemQuantity === undefined
    ? undefined
    : String(input.rawInvoiceItemQuantity);
  const rawPersistedDeliveryTotal = exactTotal(persistedRows.map(row => row.rawQuantity));
  const transformedPersistedDeliveryTotal = exactTotal(persistedRows.map(row => row.transformedQuantity), deliveryScale);
  const transformedWizardDeliveryTotal = exactTotal(wizardRows.map(row => row.transformedQuantity), deliveryScale);
  const transformedOptimizerQuantity = historicalConvertedQuantity(rawOptimizerQuantity, commercialScale);
  const transformedProductionQuantity = historicalConvertedQuantity(rawProductionQuantity, commercialScale);
  const transformedCanonicalGraphQuantity = historicalConvertedQuantity(rawCanonicalGraphQuantity, commercialScale);
  const graphComparableOptimizerQuantity = transformedOptimizerQuantity;
  const transformedInvoiceItemQuantity = historicalConvertedQuantity(rawInvoiceItemQuantity, commercialScale);
  const deliveryComparableOptimizerQuantity = historicalConvertedQuantity(rawOptimizerQuantity, deliveryScale);
  const persistedComparableQuantity = transformedWizardDeliveryTotal || deliveryComparableOptimizerQuantity;
  const comparisonDifferences: Array<{
    key: string;
    labelFa: string;
    leftSource: string;
    rightSource: string;
    value: string;
    unit: 'meter';
    basis: 'RAW' | 'HISTORICAL_TRANSFORMED';
    rule: string;
    leftComparableValue?: string;
    rightComparableValue?: string;
  }> = [];
  const addDifference = (entry: Omit<(typeof comparisonDifferences)[number], 'value'>, value: string | undefined) => {
    if (value !== undefined) comparisonDifferences.push({ ...entry, value });
  };
  if (/optimizer quantities conflict/i.test(conflictDetail)) {
    addDifference({
      key: 'OPTIMIZER_PRODUCTION_MINUS_OPTIMIZER_TOTAL',
      labelFa: 'اختلاف جمع قطعات تولیدی optimizer با کمیت کل optimizer',
      leftSource: 'OPTIMIZER_PRODUCTION',
      rightSource: 'OPTIMIZER_TOTAL',
      unit: 'meter',
      basis: 'HISTORICAL_TRANSFORMED',
      rule: 'ROUND_HALF_UP_SCALE_THREE',
      leftComparableValue: transformedProductionQuantity,
      rightComparableValue: transformedOptimizerQuantity,
    }, exactDifference(transformedProductionQuantity, transformedOptimizerQuantity));
  }
  if (/canonical graph quantity conflicts/i.test(conflictDetail)) {
    addDifference({
      key: 'PRODUCT_GRAPH_MINUS_OPTIMIZER',
      labelFa: 'اختلاف Product Graph با کمیت کل optimizer',
      leftSource: 'PRODUCT_GRAPH',
      rightSource: 'OPTIMIZER_TOTAL',
      unit: 'meter',
      basis: 'HISTORICAL_TRANSFORMED',
      rule: 'ROUND_HALF_UP_SCALE_THREE',
      leftComparableValue: transformedCanonicalGraphQuantity,
      rightComparableValue: graphComparableOptimizerQuantity,
    }, exactDifference(transformedCanonicalGraphQuantity, graphComparableOptimizerQuantity));
  }
  if (/persisted Delivery quantity conflicts/i.test(conflictDetail)) {
    addDifference({
      key: 'PERSISTED_DELIVERY_MINUS_COMPARABLE_OPTIMIZER',
      labelFa: 'اختلاف مجموع Delivery با کمیت تبدیل‌شده قابل‌مقایسه',
      leftSource: 'PERSISTED_DELIVERY_TOTAL',
      rightSource: transformedWizardDeliveryTotal ? 'WIZARD_DELIVERY_TOTAL' : 'OPTIMIZER_TOTAL',
      unit: 'meter',
      basis: 'HISTORICAL_TRANSFORMED',
      rule: deliveryScale === 2
        ? 'ROUND_HALF_UP_SCALE_TWO_PER_ROW_THEN_SUM'
        : 'ROUND_HALF_UP_SCALE_THREE_PER_ROW_THEN_SUM',
      leftComparableValue: transformedPersistedDeliveryTotal,
      rightComparableValue: persistedComparableQuantity,
    }, exactDifference(transformedPersistedDeliveryTotal, persistedComparableQuantity));
  }
  if (/invoice quantity conflicts/i.test(conflictDetail)) {
    addDifference({
      key: 'INVOICE_MINUS_OPTIMIZER',
      labelFa: 'اختلاف کمیت پیش‌فاکتور با کمیت کل optimizer',
      leftSource: 'INVOICE',
      rightSource: 'OPTIMIZER_TOTAL',
      unit: 'meter',
      basis: 'HISTORICAL_TRANSFORMED',
      rule: 'ROUND_HALF_UP_SCALE_THREE',
      leftComparableValue: transformedInvoiceItemQuantity,
      rightComparableValue: transformedOptimizerQuantity,
    }, exactDifference(transformedInvoiceItemQuantity, transformedOptimizerQuantity));
  }
  return {
    productRowId: input.productRowId,
    productId: input.productId,
    unit: 'meter',
    rule: provenPolicy?.policy,
    reportedGraphSchemaVersion: input.graphSchemaVersion,
    reportedRoundingPolicy: input.roundingPolicy,
    producer: input.producer,
    producerVersion: input.producerVersion,
    graphAuditCommandId: input.graphAuditCommandId,
    rawContractItemQuantity: String(input.rawContractItemQuantity ?? ''),
    rawInvoiceItemQuantity,
    transformedInvoiceItemQuantity,
    invoiceComparisonRule: provenPolicy ? 'ROUND_HALF_UP_SCALE_THREE' : undefined,
    rawOptimizerQuantity,
    transformedOptimizerQuantity,
    optimizerComparisonRule: provenPolicy ? 'ROUND_HALF_UP_SCALE_THREE' : undefined,
    rawProductionQuantity,
    transformedProductionQuantity,
    productionComparisonRule: provenPolicy ? 'ROUND_HALF_UP_SCALE_THREE' : undefined,
    rawProductionPieces: Array.isArray(plan?.productionPieces) ? plan.productionPieces : [],
    rawCanonicalGraphQuantity,
    transformedCanonicalGraphQuantity,
    graphComparisonRule: provenPolicy ? 'ROUND_HALF_UP_SCALE_THREE' : undefined,
    rawPersistedDeliveryRows: persistedRows,
    rawPersistedDeliveryTotal,
    transformedPersistedDeliveryTotal,
    deliveryComparisonRule: deliveryScale === 2
      ? 'ROUND_HALF_UP_SCALE_TWO_PER_ROW_THEN_SUM'
      : deliveryScale === 3
        ? 'ROUND_HALF_UP_SCALE_THREE_PER_ROW_THEN_SUM'
        : undefined,
    rawWizardDeliveryRows: wizardRows,
    ...(comparisonDifferences.length > 0 ? { comparisonDifferences } : {}),
  };
};

export const reconcileOptimizerDerivedLongitudinalQuantity = (
  input: OptimizerDerivedQuantityInput,
): OptimizerDerivedQuantityEvidence | null => {
  try {
    return reconcileOptimizerDerivedLongitudinalQuantityInternal(input);
  } catch (error) {
    const evidenceError = asApprovedPricingEvidenceError(error);
    if (!evidenceError) throw error;
    const technicalDetail = evidenceError.message;
    const provenanceProblem = /provenance|ambiguous|missing|منشأ|مبهم/i.test(technicalDetail);
    if (error instanceof OptimizerQuantityEvidenceConflictError) {
      throw new OptimizerQuantityEvidenceConflictError({
        productRowId: String(error.evidence?.productRowId || input.productRowId),
        policy: String(error.evidence?.rule || `graph-v${input.graphSchemaVersion}:${input.roundingPolicy}`),
        rawOptimizerQuantity: String(error.evidence?.rawOptimizerQuantity || ''),
        rawProductionQuantity: String(error.evidence?.rawProductionQuantity || ''),
        difference: String(error.evidence?.difference || ''),
        additionalEvidence: rawQuantityReviewEvidence(input, technicalDetail),
      });
    }
    throw new ApprovedPricingEvidenceError({
      technicalDetail,
      evidence: {
        ...rawQuantityReviewEvidence(input, technicalDetail),
        ...(evidenceError.evidence || {}),
      },
      userMessageFa: evidenceError.userMessageFa,
      reviewKind: 'QUANTITY',
      remediationKind: evidenceError.remediationKind ||
        (provenanceProblem ? 'EVIDENCE_RECOVERY' : 'RESPONSIBLE_SELLER_CORRECTION'),
    });
  }
};
