// New company-fleet entries only; historical and external plates retain their original meaning.
export const COMPANY_PLATE_LETTERS = ['الف', 'ب', 'پ', 'ت', 'ث', 'ج', 'د', 'ز', 'س', 'ش', 'ص', 'ط', 'ع', 'ف', 'ق', 'ک', 'ل', 'م', 'ن', 'و', 'ه', 'ی'] as const;
export const normalizePlateDigits = (value: string) => value.replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
export const currentManufactureYear = (at = new Date()) => Number(new Intl.DateTimeFormat('en-US-u-ca-persian', { year: 'numeric', timeZone: 'Asia/Tehran' }).formatToParts(at).find(part => part.type === 'year')?.value);
export const manufactureYears = (at = new Date()) => {
  const last = currentManufactureYear(at);
  return Array.from({ length: last - 1300 + 1 }, (_, index) => last - index);
};
export const validManufactureYear = (value: unknown, at = new Date()) => {
  const text = normalizePlateDigits(String(value ?? ''));
  return /^\d{4}$/.test(text) && Number(text) >= 1300 && Number(text) <= currentManufactureYear(at);
};
export const requireManufactureYear = (value: unknown, at = new Date()) => {
  if (!validManufactureYear(value, at)) throw new Error('سال ساخت باید از ۱۳۰۰ تا سال جاری شمسی انتخاب شود.');
  return Number(normalizePlateDigits(String(value)));
};
export type CompanyPlateParts = { first: string; letter: string; serial: string; region: string };
export const emptyCompanyPlate: CompanyPlateParts = { first: '', letter: '', serial: '', region: '' };
export const plateDigits = (value: string, length: number) => normalizePlateDigits(value).replace(/[^0-9]/g, '').slice(0, length);
export const completeCompanyPlate = (parts: CompanyPlateParts) => /^\d{2}$/.test(parts.first) && COMPANY_PLATE_LETTERS.some(letter => letter === parts.letter) && /^\d{3}$/.test(parts.serial) && /^\d{2}$/.test(parts.region);
export const formatCompanyPlate = (parts: CompanyPlateParts) => `${parts.first} ${parts.letter} ${parts.serial} ایران ${parts.region}`;
export const requireCompanyPlate = (value: unknown) => {
  const text = normalizePlateDigits(String(value ?? '')).trim();
  const match = /^(\d{2})\s*(الف|[ابپتثجدزسشصطعفقکلمنوهی])\s*(\d{3})\s*(?:ایران\s*)?(\d{2})$/.exec(text);
  if (!match) throw new Error('پلاک باید شامل دو رقم، حرف مجاز، سه رقم و دو رقم کد ایران باشد.');
  const letter = match[2] === 'ا' ? 'الف' : match[2];
  return formatCompanyPlate({ first: match[1], letter, serial: match[3], region: match[4] });
};
