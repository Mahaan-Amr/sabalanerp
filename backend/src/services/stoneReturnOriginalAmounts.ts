import { parseExactQuantityAtoms } from './exactQuantity';

type OriginalAmounts = { quantity: string; netRials: string; taxRials: string; costRials: string };

/** Half-up cumulative portions preserve the original whole-rial total, even with many returns. */
export function allocateOriginalReturnAmounts(original: OriginalAmounts, prior: string, returned: string) {
  const originalQuantity = parseExactQuantityAtoms(original.quantity);
  const priorQuantity = parseExactQuantityAtoms(prior);
  const returnedQuantity = parseExactQuantityAtoms(returned);
  const cumulativeQuantity = priorQuantity + returnedQuantity;
  if (originalQuantity <= 0n || priorQuantity < 0n || returnedQuantity <= 0n || cumulativeQuantity > originalQuantity) {
    throw new RangeError('Return quantities exceed the original line');
  }
  const portion = (amount: string) => {
    const [whole, fractional = ''] = amount.split('.');
    const amountUnits = BigInt(whole + fractional);
    const denominator = originalQuantity * 10n ** BigInt(fractional.length);
    const rounded = (quantity: bigint) => (2n * amountUnits * quantity + denominator) / (2n * denominator);
    return rounded(cumulativeQuantity) - rounded(priorQuantity);
  };
  return {
    netRials: portion(original.netRials),
    taxRials: portion(original.taxRials),
    costRials: portion(original.costRials),
  };
}
