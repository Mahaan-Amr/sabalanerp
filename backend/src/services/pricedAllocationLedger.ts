import { createHash } from 'node:crypto';
import type { ApprovedPricingVersionContract } from './dispatchDocuments/contracts';

const QUANTITY_SCALE = 3;
const MONEY_SCALE = 12;
const ALGORITHM = 'shipment-money-allocation-v1' as const;

export type PricedAllocationInvariantCode =
  | 'DUPLICATE_PRICING_CONTRACT'
  | 'DUPLICATE_PRICING_ROW'
  | 'MISSING_PRICING_VERSION'
  | 'MISSING_PRICING_ROW'
  | 'ROW_IDENTITY_MISMATCH'
  | 'UNIT_MISMATCH'
  | 'MISSING_DISCOUNT_BASIS'
  | 'INVALID_FIXED_POINT'
  | 'PRICING_TOTAL_MISMATCH'
  | 'CURRENCY_MISMATCH';

export class PricedAllocationInvariantError extends Error {
  constructor(public readonly code: PricedAllocationInvariantCode, message: string) {
    super(message);
  }
}

export type LockedApprovedPricingRow = ApprovedPricingVersionContract['rows'][number] & { id: string };
export type LockedApprovedPricingVersion = Omit<ApprovedPricingVersionContract, 'rows'> & {
  readinessEvidenceHash: string;
  rows: LockedApprovedPricingRow[];
};

export type PricedRevisionLine = {
  allocationRevisionLineId: string;
  contractId: string;
  contractItemId: string;
  productRowId: string;
  quantity: string;
  unit: string;
};

export type PriorPricedAllocationEvent = {
  pricingRowId: string;
  quantity: string;
  grossAmount: string;
  discountAmount: string;
};

export type PricedAllocationEvidence = {
  schemaVersion: 1;
  algorithm: typeof ALGORITHM;
  beforeQuantity: string;
  afterQuantity: string;
  contractedQuantity: string;
  grossTarget: string;
  discountTarget: string;
  beforeGross: string;
  afterGross: string;
  beforeDiscount: string;
  afterDiscount: string;
  pricingIntegrityHash: string;
  pricingRowIntegrityHash: string;
  readinessEvidenceHash: string;
};

export type CalculatedPricedAllocationEvent = PricedRevisionLine & {
  pricingVersionId: string;
  pricingRowId: string;
  grossAmount: string;
  discountAmount: string;
  netAmount: string;
  consumesFinalRemainder: boolean;
  evidence: PricedAllocationEvidence;
};

const pow10 = (scale: number) => 10n ** BigInt(scale);

const parseFixed = (value: string, scale: number): bigint => {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value).trim());
  if (!match || (match[3] || '').length > scale) {
    throw new PricedAllocationInvariantError('INVALID_FIXED_POINT', `${value} must use at most scale ${scale}.`);
  }
  const fraction = (match[3] || '').padEnd(scale, '0');
  const atoms = BigInt(match[2]) * pow10(scale) + BigInt(fraction || '0');
  return match[1] ? -atoms : atoms;
};

const formatFixed = (atoms: bigint, scale: number): string => {
  const sign = atoms < 0n ? '-' : '';
  const absolute = atoms < 0n ? -atoms : atoms;
  const base = pow10(scale);
  return `${sign}${absolute / base}.${String(absolute % base).padStart(scale, '0')}`;
};

export const sumCanonicalQuantities = (values: string[]): string =>
  formatFixed(values.reduce((sum, value) => sum + parseFixed(value, QUANTITY_SCALE), 0n), QUANTITY_SCALE);

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]));
  }
  return value;
};

export const pricedAllocationIntegrityHash = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');

type RowState = {
  version: LockedApprovedPricingVersion;
  row: LockedApprovedPricingRow;
  contracted: bigint;
  grossTarget: bigint;
  discountTarget: bigint;
  quantity: bigint;
  gross: bigint;
  discount: bigint;
};

const prepareStates = (
  versions: LockedApprovedPricingVersion[],
  priorEvents: PriorPricedAllocationEvent[],
): { versionsByContract: Map<string, LockedApprovedPricingVersion>; statesByRow: Map<string, RowState> } => {
  const versionsByContract = new Map<string, LockedApprovedPricingVersion>();
  const statesByRow = new Map<string, RowState>();
  let currency: string | null = null;
  for (const version of [...versions].sort((left, right) => left.contractId.localeCompare(right.contractId))) {
    if (versionsByContract.has(version.contractId)) {
      throw new PricedAllocationInvariantError('DUPLICATE_PRICING_CONTRACT', `Contract ${version.contractId} has multiple bound pricing versions.`);
    }
    if (currency !== null && currency !== version.currency) {
      throw new PricedAllocationInvariantError('CURRENCY_MISMATCH', 'One allocation revision cannot mix pricing currencies.');
    }
    currency = version.currency;
    versionsByContract.set(version.contractId, version);
    const grossTotal = parseFixed(version.grossAmount, MONEY_SCALE);
    const discountTotal = parseFixed(version.discountAmount, MONEY_SCALE);
    const netTotal = parseFixed(version.netAmount, MONEY_SCALE);
    const ordered = [...version.rows].sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id));
    const eligible = ordered.filter((row) => row.discountEligible);
    const bases = new Map<string, bigint>();
    for (const row of ordered) {
      if (statesByRow.has(row.id)) throw new PricedAllocationInvariantError('DUPLICATE_PRICING_ROW', `Pricing row ${row.id} is duplicated.`);
      const rawBasis = row.componentEvidence.discountBasis;
      if (row.discountEligible && rawBasis === undefined) {
        throw new PricedAllocationInvariantError('MISSING_DISCOUNT_BASIS', `Pricing row ${row.id} lacks explicit discount basis evidence.`);
      }
      const basis = rawBasis === undefined ? 0n : parseFixed(rawBasis, MONEY_SCALE);
      if (basis < 0n || (!row.discountEligible && basis !== 0n)) {
        throw new PricedAllocationInvariantError('MISSING_DISCOUNT_BASIS', `Pricing row ${row.id} has invalid discount basis evidence.`);
      }
      bases.set(row.id, basis);
    }
    const basisTotal = eligible.reduce((sum, row) => sum + (bases.get(row.id) || 0n), 0n);
    if (discountTotal !== 0n && basisTotal === 0n) {
      throw new PricedAllocationInvariantError('MISSING_DISCOUNT_BASIS', `Contract ${version.contractId} has discount without eligible basis.`);
    }
    let allocatedDiscount = 0n;
    let rowGrossTotal = 0n;
    ordered.forEach((row) => {
      const eligibleIndex = eligible.findIndex((candidate) => candidate.id === row.id);
      const discountTarget = eligibleIndex < 0 ? 0n
        : eligibleIndex === eligible.length - 1 ? discountTotal - allocatedDiscount
          : (discountTotal * (bases.get(row.id) || 0n)) / basisTotal;
      allocatedDiscount += discountTarget;
      const contracted = parseFixed(row.contractedQuantity, QUANTITY_SCALE);
      const grossTarget = parseFixed(row.canonicalAllInTotal, MONEY_SCALE);
      if (contracted <= 0n) throw new PricedAllocationInvariantError('INVALID_FIXED_POINT', `Pricing row ${row.id} quantity must be positive.`);
      rowGrossTotal += grossTarget;
      statesByRow.set(row.id, { version, row, contracted, grossTarget, discountTarget, quantity: 0n, gross: 0n, discount: 0n });
    });
    if (rowGrossTotal !== grossTotal || grossTotal - discountTotal !== netTotal || allocatedDiscount !== discountTotal) {
      throw new PricedAllocationInvariantError('PRICING_TOTAL_MISMATCH', `Pricing version ${version.id} totals do not reconcile.`);
    }
  }
  for (const prior of priorEvents) {
    const state = statesByRow.get(prior.pricingRowId);
    if (!state) throw new PricedAllocationInvariantError('MISSING_PRICING_ROW', `Prior event references unknown pricing row ${prior.pricingRowId}.`);
    state.quantity += parseFixed(prior.quantity, QUANTITY_SCALE);
    state.gross += parseFixed(prior.grossAmount, MONEY_SCALE);
    state.discount += parseFixed(prior.discountAmount, MONEY_SCALE);
  }
  return { versionsByContract, statesByRow };
};

export const allocatePricedRevision = (input: {
  versions: LockedApprovedPricingVersion[];
  priorEvents: PriorPricedAllocationEvent[];
  lines: PricedRevisionLine[];
}): { events: CalculatedPricedAllocationEvent[]; totals: { quantity: string; grossAmount: string; discountAmount: string; netAmount: string } } => {
  const { versionsByContract, statesByRow } = prepareStates(input.versions, input.priorEvents);
  const events: CalculatedPricedAllocationEvent[] = [];
  let totalQuantity = 0n;
  let totalGross = 0n;
  let totalDiscount = 0n;
  for (const line of input.lines) {
    const version = versionsByContract.get(line.contractId);
    if (!version) throw new PricedAllocationInvariantError('MISSING_PRICING_VERSION', `Contract ${line.contractId} has no bound pricing version.`);
    const row = version.rows.find((candidate) => candidate.contractItemId === line.contractItemId);
    if (!row) throw new PricedAllocationInvariantError('MISSING_PRICING_ROW', `Contract item ${line.contractItemId} has no approved pricing row.`);
    if (row.productRowId !== line.productRowId) {
      throw new PricedAllocationInvariantError('ROW_IDENTITY_MISMATCH', `Contract item ${line.contractItemId} stable identity changed.`);
    }
    if (row.unit !== line.unit) throw new PricedAllocationInvariantError('UNIT_MISMATCH', `Contract item ${line.contractItemId} unit changed.`);
    const state = statesByRow.get(row.id)!;
    const quantity = parseFixed(line.quantity, QUANTITY_SCALE);
    if (quantity <= 0n) throw new PricedAllocationInvariantError('INVALID_FIXED_POINT', 'Finalized allocation quantities must be positive.');
    const beforeQuantity = state.quantity;
    const beforeGross = state.gross;
    const beforeDiscount = state.discount;
    const afterQuantity = beforeQuantity + quantity;
    const consumesFinalRemainder = afterQuantity === state.contracted;
    const gross = consumesFinalRemainder
      ? state.grossTarget - beforeGross
      : (state.grossTarget * quantity) / state.contracted;
    const discount = consumesFinalRemainder
      ? state.discountTarget - beforeDiscount
      : (state.discountTarget * quantity) / state.contracted;
    state.quantity = afterQuantity;
    state.gross += gross;
    state.discount += discount;
    totalQuantity += quantity;
    totalGross += gross;
    totalDiscount += discount;
    events.push({
      ...line,
      pricingVersionId: version.id,
      pricingRowId: row.id,
      grossAmount: formatFixed(gross, MONEY_SCALE),
      discountAmount: formatFixed(discount, MONEY_SCALE),
      netAmount: formatFixed(gross - discount, MONEY_SCALE),
      consumesFinalRemainder,
      evidence: {
        schemaVersion: 1,
        algorithm: ALGORITHM,
        beforeQuantity: formatFixed(beforeQuantity, QUANTITY_SCALE),
        afterQuantity: formatFixed(afterQuantity, QUANTITY_SCALE),
        contractedQuantity: formatFixed(state.contracted, QUANTITY_SCALE),
        grossTarget: formatFixed(state.grossTarget, MONEY_SCALE),
        discountTarget: formatFixed(state.discountTarget, MONEY_SCALE),
        beforeGross: formatFixed(beforeGross, MONEY_SCALE),
        afterGross: formatFixed(state.gross, MONEY_SCALE),
        beforeDiscount: formatFixed(beforeDiscount, MONEY_SCALE),
        afterDiscount: formatFixed(state.discount, MONEY_SCALE),
        pricingIntegrityHash: version.integrityHash,
        pricingRowIntegrityHash: row.integrityHash,
        readinessEvidenceHash: version.readinessEvidenceHash,
      },
    });
  }
  return {
    events,
    totals: {
      quantity: formatFixed(totalQuantity, QUANTITY_SCALE),
      grossAmount: formatFixed(totalGross, MONEY_SCALE),
      discountAmount: formatFixed(totalDiscount, MONEY_SCALE),
      netAmount: formatFixed(totalGross - totalDiscount, MONEY_SCALE),
    },
  };
};
