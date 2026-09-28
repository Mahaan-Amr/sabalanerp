import { roundContractPayableTotal, sumContractMonetaryAmounts, verifyContractMonetaryRounding } from '@sabalanerp/contract-product-graph';
import { TotalsSchema } from './primitives';

/** Historical totals without this evidence retain their exact original obligation. */
export function partnerContractPayableTotal(value: unknown): string {
  const totals = TotalsSchema.parse(value);
  const source = sumContractMonetaryAmounts([totals.net, `-${totals.discount}`, totals.tax, totals.charges]);
  const expected = totals.monetaryRounding
    ? verifyContractMonetaryRounding(source, totals.currency, totals.monetaryRounding) : source;
  if (expected !== sumContractMonetaryAmounts([totals.payable])) throw new TypeError('Partner payable total evidence conflict');
  return expected;
}

export function roundPartnerContractTotals(totals: Omit<ReturnType<typeof TotalsSchema.parse>, 'payable' | 'monetaryRounding'>) {
  const monetaryRounding = roundContractPayableTotal(
    sumContractMonetaryAmounts([totals.net, `-${totals.discount}`, totals.tax, totals.charges]), totals.currency);
  return TotalsSchema.parse({ ...totals, payable: monetaryRounding.roundedAmount, monetaryRounding });
}
