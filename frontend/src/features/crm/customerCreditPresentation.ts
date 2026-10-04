/** Preserve large whole-rial values and any legacy fractional evidence when displaying exposure. */
export const formatCustomerCreditRials = (value: string | null) => {
  if (value === null) return 'نامحدود';
  const [whole, fraction] = value.split('.');
  const digits = (text: string) => text.replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
  const formatted = BigInt(whole).toLocaleString('fa-IR');
  return `${formatted}${fraction ? `٫${digits(fraction)}` : ''} ریال`;
};
