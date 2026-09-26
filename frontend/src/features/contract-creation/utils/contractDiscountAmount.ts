/** Contract discounts entered in toman cannot exceed the manager's percentage cap. */
export function maximumContractDiscountToman(baseSubtotal: number, maxPercent: number): number {
  if (!Number.isFinite(baseSubtotal) || !Number.isFinite(maxPercent) || baseSubtotal <= 0 || maxPercent <= 0) return 0;
  return Math.max(0, Math.floor(baseSubtotal * maxPercent / 100));
}

export function clampContractDiscountToman(value: number, maximum: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.trunc(value), 0), maximum);
}

export function contractDiscountTomanFromPercent(baseSubtotal: number, percent: number, maximum: number): number {
  if (!Number.isFinite(baseSubtotal) || !Number.isFinite(percent) || baseSubtotal <= 0) return 0;
  return clampContractDiscountToman(Math.round(baseSubtotal * Math.max(percent, 0) / 100), maximum);
}

export function contractDiscountDisplayPercent(amount: number, baseSubtotal: number): number {
  return Number(contractDiscountEquivalentPercent(amount, baseSubtotal).toFixed(2));
}

/** Percentage is an explanatory snapshot; the entered toman amount is authoritative. */
export function contractDiscountEquivalentPercent(amount: number, baseSubtotal: number): number {
  if (amount <= 0 || baseSubtotal <= 0) return 0;
  return Number((amount * 100 / baseSubtotal).toFixed(12));
}
