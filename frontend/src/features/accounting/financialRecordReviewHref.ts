/** Open the exact financial record and preserve an Accounting-only return destination. */
export const financialRecordReviewHref = (recordId: string, returnTo: string) =>
  `/dashboard/accounting/invoice-candidates/${encodeURIComponent(recordId)}?returnTo=${encodeURIComponent(returnTo)}`;

/** Next's route parameter is an encoded path segment, not a persisted record ID.
 * Decode once: a literal percent escape in an ID must never become another ID. */
export const financialRecordReviewId = (segment: string): string | null => {
  try { return decodeURIComponent(segment) || null; }
  catch { return null; }
};

export const accountingReviewReturn = (requested: string | null,
  fallback = '/dashboard/accounting/invoice-candidates') => {
  const value = requested || '';
  return (value === '/dashboard/accounting' || value.startsWith('/dashboard/accounting/') || value.startsWith('/dashboard/accounting?'))
    && !value.startsWith('//') ? value : fallback;
};
