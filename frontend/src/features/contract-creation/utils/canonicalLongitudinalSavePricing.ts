import {
  calculateLongitudinalProduct,
  sumContractMonetaryAmounts,
  type LongitudinalProductInput
} from '@sabalanerp/contract-product-graph';
import { canonicalProductSavePricing } from './canonicalProductSavePricing';

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
    ...canonicalProductSavePricing({
      materialBase: result.baseAmountToman,
      mandatoryAmount: result.mandatoryAmountToman,
      cuttingCost: sumContractMonetaryAmounts([
        result.longitudinalCutAmountToman,
        result.calibrationCutAmountToman
      ]),
      totalAmount: result.totalAmountToman
    }, toolsCost, finishingCost)
  };
};
