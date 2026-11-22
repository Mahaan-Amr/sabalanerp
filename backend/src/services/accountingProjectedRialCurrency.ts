// The ordinary accounting projection converts the contract to rials but sums
// financial records and payment rows as stored. Label it only when their units
// are known; an unknown or mixed unit must not be silently presented as rials.
export function accountingProjectedRialCurrency(
  contractCurrency: unknown,
  records: readonly { currency?: unknown }[],
  payments: readonly { currency?: unknown }[],
): 'IRR' | undefined {
  const unit = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';
  const rial = (value: unknown) => ['ریال', 'rial', 'irr'].includes(unit(value));
  const contractUnit = unit(contractCurrency);
  if (![ 'تومان', 'toman', 'ریال', 'rial', 'irr' ].includes(contractUnit)) return undefined;
  return records.every(row => rial(row.currency)) && payments.every(row => rial(row.currency)) ? 'IRR' : undefined;
}
