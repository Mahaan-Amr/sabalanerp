export const PERSONNEL_COLLECTION_PAGE_SIZE = 10;

export type PersonnelCollectionRecord = {
  id: string;
  firstName: string;
  lastName: string;
  nationalCode?: string | null;
  employeeNumber?: string | null;
};

export const normalizePersonnelSearch = (value: unknown) =>
  String(value ?? '')
    .normalize('NFKC')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const collator = new Intl.Collator('fa', { sensitivity: 'base', numeric: true });

export const buildPersonnelCollection = <T extends PersonnelCollectionRecord>(
  records: readonly T[],
  input: { search?: unknown; page?: unknown; focusId?: string | null },
) => {
  const tokens = normalizePersonnelSearch(input.search).toLocaleLowerCase('fa').split(' ').filter(Boolean);
  const filtered = records.filter((record) => {
    if (!tokens.length) return true;
    const searchable = [record.firstName, record.lastName, record.nationalCode, record.employeeNumber]
      .map((value) => normalizePersonnelSearch(value).toLocaleLowerCase('fa'));
    return tokens.every((token) => searchable.some((value) => value.includes(token)));
  }).sort((left, right) =>
    collator.compare(normalizePersonnelSearch(left.lastName), normalizePersonnelSearch(right.lastName)) ||
    collator.compare(normalizePersonnelSearch(left.firstName), normalizePersonnelSearch(right.firstName)) ||
    collator.compare(left.id, right.id)
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PERSONNEL_COLLECTION_PAGE_SIZE));
  const requestedPage = Number.isInteger(Number(input.page)) ? Number(input.page) : 1;
  const focusIndex = input.focusId ? filtered.findIndex((record) => record.id === input.focusId) : -1;
  const page = focusIndex >= 0
    ? Math.floor(focusIndex / PERSONNEL_COLLECTION_PAGE_SIZE) + 1
    : Math.min(totalPages, Math.max(1, requestedPage));
  const start = (page - 1) * PERSONNEL_COLLECTION_PAGE_SIZE;

  return {
    rows: filtered.slice(start, start + PERSONNEL_COLLECTION_PAGE_SIZE),
    meta: {
      page,
      pageSize: PERSONNEL_COLLECTION_PAGE_SIZE,
      total: filtered.length,
      totalPages,
      focus: input.focusId ? (focusIndex >= 0 ? 'present' : 'removed') as 'present' | 'removed' : null,
    },
  };
};
