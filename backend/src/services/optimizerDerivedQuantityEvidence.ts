import { Prisma } from '@prisma/client';

export const OPTIMIZER_DERIVED_QUANTITY_EVIDENCE_ORIGIN =
  'OPTIMIZER_DERIVED_LONGITUDINAL_ZERO_SENTINEL' as const;

type UnknownRecord = Readonly<Record<string, unknown>>;

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
    rows: readonly { deliveryId: string; deliveryProductId: string; quantity: string }[];
    totalQuantity: string;
  };
  wizardDelivery: { present: boolean; totalQuantity?: string };
};

export type OptimizerDerivedQuantityInput = {
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
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is missing or malformed`);
  return value as UnknownRecord;
};

const decimal = (value: unknown, label: string) => {
  if (value === null || value === undefined || value === '') throw new Error(`${label} is missing or malformed`);
  try {
    return new Prisma.Decimal(String(value));
  } catch {
    throw new Error(`${label} is missing or malformed`);
  }
};

const positive = (value: unknown, label: string) => {
  const result = decimal(value, label);
  if (!result.gt(0)) throw new Error(`${label} must be positive`);
  if (result.decimalPlaces() > 3) throw new Error(`${label} must use scale-three precision`);
  return result;
};

const requiredString = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is missing or malformed`);
  return value.trim();
};

const fixedQuantity = (value: Prisma.Decimal) => value.toDecimalPlaces(3).toFixed(3);

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
    throw new Error(`Canonical row ${String(row.productRowId ?? '')} optimizer plan is not quantity-derived`);
  }
  if (plan.totalRequestedLengthM === null || plan.totalRequestedLengthM === undefined || plan.totalRequestedLengthM === '') {
    throw new Error(`Canonical row ${String(row.productRowId ?? '')} optimizer total length is missing or malformed`);
  }
  return String(plan.totalRequestedLengthM);
};

export const reconcileOptimizerDerivedLongitudinalQuantity = (
  input: OptimizerDerivedQuantityInput,
): OptimizerDerivedQuantityEvidence | null => {
  if (input.productType.toLowerCase() !== 'longitudinal' ||
    !decimal(input.rawContractItemQuantity, `Product ${input.productRowId} contract item quantity`).eq(0)) return null;

  const snapshotQuantity = decimal(input.productSnapshot.quantity, `Product ${input.productRowId} snapshot quantity`);
  if (!snapshotQuantity.eq(0)) throw new Error(`Product ${input.productRowId} zero-sentinel quantities conflict`);
  if (input.productSnapshot.smartCutDerivedQuantity !== true) {
    throw new Error(`Product ${input.productRowId} optimizer-derived quantity evidence is missing`);
  }
  const plan = record(input.productSnapshot.smartCutPlan, `Product ${input.productRowId} optimizer plan`);
  if (plan.derivedQuantity !== true) throw new Error(`Product ${input.productRowId} optimizer plan is not quantity-derived`);
  positive(plan.requestedQuantity, `Product ${input.productRowId} optimizer requested quantity`);
  const planQuantity = positive(plan.totalRequestedLengthM, `Product ${input.productRowId} optimizer total length`);
  if (!Array.isArray(plan.productionPieces) || plan.productionPieces.length === 0) {
    throw new Error(`Product ${input.productRowId} optimizer production pieces are missing`);
  }
  const productionQuantity = plan.productionPieces.reduce((sum, value, index) => {
    const piece = record(value, `Product ${input.productRowId} optimizer production piece ${index}`);
    return sum.plus(
      positive(piece.lengthM, `Product ${input.productRowId} optimizer production length ${index}`)
        .mul(positive(piece.quantity, `Product ${input.productRowId} optimizer production quantity ${index}`)),
    );
  }, new Prisma.Decimal(0));
  if (!productionQuantity.eq(planQuantity)) throw new Error(`Product ${input.productRowId} optimizer quantities conflict`);

  const graphQuantity = positive(input.graphRequestedLengthMeters, `Product ${input.productRowId} canonical graph length`);
  if (!graphQuantity.eq(planQuantity)) throw new Error(`Product ${input.productRowId} canonical graph quantity conflicts with optimizer plan`);

  if (!Array.isArray(input.persistedDeliveries) || input.persistedDeliveries.length === 0) {
    throw new Error(`Product ${input.productRowId} persisted Delivery evidence is missing`);
  }
  const persistedRows: { deliveryId: string; deliveryProductId: string; quantity: string }[] = [];
  const persistedKeys = new Set<string>();
  let persistedTotal = new Prisma.Decimal(0);
  for (const [deliveryIndex, rawDelivery] of input.persistedDeliveries.entries()) {
    const delivery = record(rawDelivery, `Persisted Delivery ${deliveryIndex}`);
    const deliveryId = requiredString(delivery.id, `Persisted Delivery ${deliveryIndex} identity`);
    if (!Array.isArray(delivery.products)) throw new Error(`Persisted Delivery ${deliveryId} products are missing`);
    for (const [productIndex, rawProduct] of delivery.products.entries()) {
      const product = record(rawProduct, `Persisted Delivery ${deliveryId} product ${productIndex}`);
      if (product.productRowId !== input.productRowId) continue;
      if (delivery.status === 'CANCELLED') throw new Error(`Product ${input.productRowId} persisted Delivery is cancelled`);
      if (product.productId !== input.productId) throw new Error(`Product ${input.productRowId} persisted Delivery identity conflicts`);
      const deliveryProductId = requiredString(product.id, `Persisted Delivery ${deliveryId} product identity`);
      const key = `${deliveryId}:${input.productRowId}`;
      if (persistedKeys.has(key)) throw new Error(`Product ${input.productRowId} persisted Delivery row is duplicated`);
      persistedKeys.add(key);
      const rowQuantity = positive(product.quantity, `Product ${input.productRowId} persisted Delivery quantity`);
      persistedTotal = persistedTotal.plus(rowQuantity);
      persistedRows.push({ deliveryId, deliveryProductId, quantity: fixedQuantity(rowQuantity) });
    }
  }
  if (persistedRows.length === 0) throw new Error(`Product ${input.productRowId} persisted Delivery evidence is missing`);
  if (!persistedTotal.eq(planQuantity)) throw new Error(`Product ${input.productRowId} persisted Delivery quantity conflicts`);

  let wizardEvidence: OptimizerDerivedQuantityEvidence['wizardDelivery'] = { present: false };
  if (input.wizardDeliveries !== null && input.wizardDeliveries !== undefined) {
    if (!Array.isArray(input.wizardDeliveries)) throw new Error(`Product ${input.productRowId} wizard Delivery evidence is malformed`);
    if (input.wizardDeliveries.length > 0) {
      let wizardTotal = new Prisma.Decimal(0);
      let wizardRows = 0;
      for (const [deliveryIndex, rawDelivery] of input.wizardDeliveries.entries()) {
        const delivery = record(rawDelivery, `Wizard Delivery ${deliveryIndex}`);
        if (!Array.isArray(delivery.products)) throw new Error(`Wizard Delivery ${deliveryIndex} products are missing`);
        let matchedInDelivery = false;
        for (const [productIndex, rawProduct] of delivery.products.entries()) {
          const product = record(rawProduct, `Wizard Delivery ${deliveryIndex} product ${productIndex}`);
          if (product.productRowId !== input.productRowId) continue;
          if (matchedInDelivery) throw new Error(`Product ${input.productRowId} wizard Delivery row is duplicated`);
          matchedInDelivery = true;
          wizardRows += 1;
          if (product.productId !== input.productId || product.unit !== 'meter') {
            throw new Error(`Product ${input.productRowId} wizard Delivery identity or unit conflicts`);
          }
          wizardTotal = wizardTotal.plus(positive(product.quantity, `Product ${input.productRowId} wizard Delivery quantity`));
        }
      }
      if (wizardRows === 0 || !wizardTotal.eq(planQuantity)) {
        throw new Error(`Product ${input.productRowId} wizard Delivery quantity conflicts`);
      }
      wizardEvidence = { present: true, totalQuantity: fixedQuantity(wizardTotal) };
    }
  }

  const invoiceQuantity = input.rawInvoiceItemQuantity === undefined
    ? undefined
    : decimal(input.rawInvoiceItemQuantity, `Product ${input.productRowId} invoice quantity`);
  if (invoiceQuantity !== undefined && !invoiceQuantity.eq(0) && !invoiceQuantity.eq(planQuantity)) {
    throw new Error(`Product ${input.productRowId} invoice quantity conflicts with sealed meters`);
  }

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
  };
};
