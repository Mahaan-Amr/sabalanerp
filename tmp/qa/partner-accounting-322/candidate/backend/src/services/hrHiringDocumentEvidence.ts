const normalizePersianText = (value: unknown) =>
  String(value || '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\s+/g, ' ')
    .trim();

export const normalizeHiringDocumentTitle = (category: string, value: unknown) => {
  if (category !== 'OTHER') return null;
  const title = normalizePersianText(value);
  if (!title) throw new Error('عنوان سند سایر الزامی است.');
  return title;
};
