import { ExactQuantityDecimal, parseExactQuantityAtoms } from './exactQuantity';

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

type OriginalTaxEconomics = {
  quantity: string;
  rawBaseAmount: string;
  recordedRawTaxAmount: string;
  roundedTaxRials: string;
  rateBasisPoints: number;
  exempt: boolean;
};

export function calculateStoneReturnTaxProvenance(original: OriginalTaxEconomics, prior: string, returned: string) {
  const base = new ExactQuantityDecimal(original.rawBaseAmount);
  const ratio = new ExactQuantityDecimal(returned).div(original.quantity);
  // Original sale recognition used this formula even when older tax rows copied the rounded amount into rawTaxAmount.
  const originalRawTax = original.exempt ? new ExactQuantityDecimal(0) : base.mul(original.rateBasisPoints).div(10_000);
  return {
    rawBaseAmount: base.mul(ratio).toFixed(8, ExactQuantityDecimal.ROUND_HALF_UP),
    rawTaxAmount: originalRawTax.mul(ratio).toFixed(8, ExactQuantityDecimal.ROUND_HALF_UP),
    allocation: {
      policy: 'CUMULATIVE_PROPORTION_HALF_UP_IRR_V1',
      rawSnapshotPolicy: 'ORIGINAL_TAX_RATE_PROPORTION_HALF_UP_SCALE_8_V1',
      originalRawBaseAmount: original.rawBaseAmount,
      originalRecordedRawTaxAmount: original.recordedRawTaxAmount,
      originalCalculatedRawTaxAmount: originalRawTax.toFixed(),
      originalRoundedTaxRials: original.roundedTaxRials,
      originalQuantity: original.quantity,
      priorReturnedQuantity: prior,
      returnedQuantity: returned,
      cumulativeReturnedQuantity: new ExactQuantityDecimal(prior).plus(returned).toFixed(),
    },
  };
}
