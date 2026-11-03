export const roundMoney = (value: unknown): number => {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? Math.sign(numeric) * Math.round(Math.abs(numeric)) : 0;
};

export const formatMoney = (value: unknown, currency = 'تومان'): string =>
  `${roundMoney(value).toLocaleString('fa-IR')} ${currency}`;

export const roundMoneyFields = <T extends Record<string, any>>(
  row: T,
  fields: string[],
): T => {
  const rounded: Record<string, any> = { ...row };
  fields.forEach((field) => {
    if (rounded[field] !== null && rounded[field] !== undefined) {
      rounded[field] = roundMoney(rounded[field]);
    }
  });
  return rounded as T;
};
