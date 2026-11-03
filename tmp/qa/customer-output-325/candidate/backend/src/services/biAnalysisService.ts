type BiAnalysisRow = {
  id: string;
  contractNumber: string;
  customer: string;
  status: string;
  amount: number;
  createdAt: string | Date;
};

export const buildBiAnalysisPage = <T extends BiAnalysisRow>({
  rows,
  view,
  search = '',
  sort = 'createdAt',
  direction = 'desc',
  page = 1,
  pageSize = 25,
}: {
  rows: T[];
  view: string;
  search?: string;
  sort?: 'amount' | 'createdAt' | 'contractNumber';
  direction?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}) => {
  const normalizedSearch = search.trim().toLocaleLowerCase('fa');
  const filtered = rows.filter((row) => {
    if (view === 'pipeline' && !['PENDING_APPROVAL', 'APPROVED'].includes(row.status)) return false;
    if (view === 'realized-sales' && !['SIGNED', 'FINANCIALLY_APPROVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(row.status)) return false;
    return !normalizedSearch
      || row.contractNumber.toLocaleLowerCase('fa').includes(normalizedSearch)
      || row.customer.toLocaleLowerCase('fa').includes(normalizedSearch);
  });
  const sorted = [...filtered].sort((left, right) => {
    const leftValue = sort === 'createdAt' ? new Date(left.createdAt).getTime() : left[sort];
    const rightValue = sort === 'createdAt' ? new Date(right.createdAt).getTime() : right[sort];
    const result = leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
    return direction === 'asc' ? result : -result;
  });
  const safePageSize = Math.min(100, Math.max(1, pageSize));
  const totalPages = Math.max(1, Math.ceil(sorted.length / safePageSize));
  const safePage = Math.min(totalPages, Math.max(1, page));
  const start = (safePage - 1) * safePageSize;
  return {
    rows: sorted.slice(start, start + safePageSize),
    page: safePage,
    pageSize: safePageSize,
    totalItems: sorted.length,
    totalPages,
  };
};
