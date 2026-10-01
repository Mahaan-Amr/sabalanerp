import { sumContractMonetaryAmounts } from '@sabalanerp/contract-product-graph';

type Amount = string | number;

/** Persist versioned calculation facts; never recalculate money from display geometry. */
export const canonicalProductSavePricing = (
  facts: {
    materialBase: Amount;
    mandatoryAmount?: Amount;
    cuttingCost: Amount;
    totalAmount: Amount;
  },
  toolsCost: Amount = 0,
  finishingCost: Amount = 0
) => ({
  authority: 'canonical-current-save' as const,
  materialBase: Number(facts.materialBase),
  mandatoryAmount: Number(facts.mandatoryAmount ?? 0),
  cuttingCost: Number(facts.cuttingCost),
  toolsCost: Number(toolsCost),
  finishingCost: Number(finishingCost),
  totalPrice: Number(sumContractMonetaryAmounts([facts.totalAmount, toolsCost, finishingCost]))
});
