import { multiplyContractMonetaryAmounts, roundContractPayableTotal } from '@sabalanerp/contract-product-graph';
import { formatExactQuantityAtoms, parseExactQuantityAtoms } from './exactQuantity';

/** Invoice quantities are in stable original-invoice order. Consecutive portions telescope to the rounded case total. */
export function apportionStoneReturnCredit(rateRials: string, invoiceQuantities: readonly string[]) {
  let cumulativeQuantity = 0n;
  let agreedRials = 0n;
  const invoiceCredits = invoiceQuantities.map(quantity => {
    cumulativeQuantity += parseExactQuantityAtoms(quantity);
    const amount = multiplyContractMonetaryAmounts(rateRials, formatExactQuantityAtoms(cumulativeQuantity));
    const rounded = BigInt(roundContractPayableTotal(amount, 'IRR').roundedAmount);
    const credit = rounded - agreedRials;
    agreedRials = rounded;
    return credit;
  });
  return { agreedRials, invoiceCredits };
}
