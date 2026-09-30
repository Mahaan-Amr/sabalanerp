import Decimal from 'decimal.js';
import { parseCanonicalDecimal } from './canonicalDecimal';

export const CONTRACT_MONETARY_ROUNDING_POLICY = 'contract-payable-whole-unit-v1' as const;
export const PRECISE_PREPARED_GRAPH_PRICING_POLICY = 'pricing-precise-prepared-v2' as const;
export const PRECISE_PREPARED_MATERIAL_POLICY = 'prepared-price-precise-v1' as const;
export interface ContractMonetaryRounding {
  policyVersion: typeof CONTRACT_MONETARY_ROUNDING_POLICY;
  currency: string;
  sourceAmount: string;
  roundedAmount: string;
  difference: string;
}

const text = (value: string | number) => parseCanonicalDecimal(
  typeof value === 'number' ? new Decimal(value).toFixed() : value
);

export function multiplyContractMonetaryAmounts(left: string | number, right: string | number): string {
  const a = text(left), b = text(right);
  const scale = (a.split('.')[1]?.length ?? 0) + (b.split('.')[1]?.length ?? 0);
  const product = BigInt(a.replace('.', '')) * BigInt(b.replace('.', ''));
  const digits = (product < BigInt(0) ? -product : product).toString().padStart(scale + 1, '0');
  return parseCanonicalDecimal(`${product < BigInt(0) ? '-' : ''}${scale
    ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits}`);
}

/** Exact decimal summation; never round the contributing product rows. */
export function sumContractMonetaryAmounts(values: readonly (string | number)[]): string {
  const amounts = values.map(text);
  const scale = amounts.reduce((max, value) => Math.max(max, value.split('.')[1]?.length ?? 0), 0);
  const sum = amounts.reduce((total, value) => {
    const negative = value.startsWith('-');
    const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
    const units = BigInt(whole + fraction.padEnd(scale, '0'));
    return total + (negative ? -units : units);
  }, BigInt(0));
  const digits = (sum < BigInt(0) ? -sum : sum).toString().padStart(scale + 1, '0');
  return parseCanonicalDecimal(`${sum < BigInt(0) ? '-' : ''}${scale
    ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits}`);
}

/** Currency is the agreement's unit (e.g. IRT), not an inferred conversion. */
export function roundContractPayableTotal(source: string | number, currency: string): ContractMonetaryRounding {
  const sourceAmount = text(source);
  if (sourceAmount.startsWith('-') || !currency.trim()) throw new TypeError('Invalid contract payable amount or currency');
  const [whole, fraction = ''] = sourceAmount.split('.');
  const roundedAmount = (BigInt(whole) + (fraction[0] >= '5' ? BigInt(1) : BigInt(0))).toString();
  return { policyVersion: CONTRACT_MONETARY_ROUNDING_POLICY, currency, sourceAmount, roundedAmount,
    difference: sumContractMonetaryAmounts([roundedAmount, `-${sourceAmount}`]) };
}

/** Replay sealed evidence exactly. Unknown policies and changed witnesses fail closed. */
export function verifyContractMonetaryRounding(source: string | number, currency: string, evidence: unknown): string {
  const expected = roundContractPayableTotal(source, currency);
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence) ||
    Object.keys(evidence).length !== Object.keys(expected).length ||
    Object.entries(expected).some(([key, value]) => (evidence as Record<string, unknown>)[key] !== value)) {
    throw new TypeError('Contract monetary rounding evidence conflict');
  }
  return expected.roundedAmount;
}
