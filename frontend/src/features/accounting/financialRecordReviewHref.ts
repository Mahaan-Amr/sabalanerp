/** Open the exact financial record and preserve an Accounting-only return destination. */
export const financialRecordReviewHref = (recordId: string, returnTo: string) =>
  `/dashboard/accounting/invoice-candidates/${encodeURIComponent(recordId)}?returnTo=${encodeURIComponent(returnTo)}`;

export const accountingReviewReturn = (requested: string | null) => {
  const value = requested || '';
  return (value === '/dashboard/accounting' || value.startsWith('/dashboard/accounting/') || value.startsWith('/dashboard/accounting?'))
    && !value.startsWith('//') ? value : '/dashboard/accounting/invoice-candidates';
};
