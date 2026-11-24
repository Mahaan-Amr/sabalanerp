import {
  multiplyContractMonetaryAmounts, parseCanonicalDecimal, roundContractPayableTotal,
} from '@sabalanerp/contract-product-graph';

export function describeStoneReturnRate(input: string, quantity: string) {
  if (input.length > 100) return null;
  let agreedUnitRateRials: string;
  try {
    agreedUnitRateRials = parseCanonicalDecimal(input);
  } catch {
    return null;
  }
  if (agreedUnitRateRials === '0' || agreedUnitRateRials.startsWith('-')) return null;
  const amount = multiplyContractMonetaryAmounts(agreedUnitRateRials, quantity);
  const customerCreditRials = roundContractPayableTotal(amount, 'IRR').roundedAmount;
  return { agreedUnitRateRials, customerCreditRials };
}
