import {
  calculateLongitudinalProduct,
  sumContractMonetaryAmounts,
  type LongitudinalProductInput
} from '@sabalanerp/contract-product-graph';

/** Use the same versioned monetary facts as the modal and server replay. */
export const calculateCanonicalLongitudinalSavePricing = (
  input: LongitudinalProductInput,
  toolsCost: number,
  finishingCost: number
) => {
  const calculation = calculateLongitudinalProduct(input);
  if (!calculation.ok) return calculation;
  const result = calculation.result;
  return {
    ok: true as const,
    materialBase: Number(result.baseAmountToman),
    mandatoryAmount: Number(result.mandatoryAmountToman),
    cuttingCost: Number(sumContractMonetaryAmounts([
      result.longitudinalCutAmountToman,
      result.calibrationCutAmountToman
    ])),
    totalPrice: Number(sumContractMonetaryAmounts([
      result.totalAmountToman,
      toolsCost,
      finishingCost
    ]))
  };
};
