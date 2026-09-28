export function parseBankApiRecord(value: string): Record<string, unknown> {
  let record: unknown;
  try { record = JSON.parse(value); }
  catch { throw new Error('رکورد رابط بانکی باید JSON معتبر باشد؛ برای فایل، مسیر CSV یا اکسل را انتخاب و فایل را بارگذاری کنید.'); }
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('رکورد رابط بانکی باید یک شیء JSON شامل ستون‌های نگاشت باشد.');
  return record as Record<string, unknown>;
}
