import type { ResponderWorkspaceViewV2 } from '@sabalanerp/partner-sales-contracts';

type Inquiry = ResponderWorkspaceViewV2['inquiries'][number];
type Row = Inquiry['rows'][number];
export type ResponderQueueView = 'pending' | 'answered';

export function responderRowView(row: Row, now: number): ResponderQueueView | 'history' {
  if (row.state === 'PENDING') return 'pending';
  if (row.state === 'REJECTED') return 'answered';
  if (row.state === 'APPROVED' && (!row.expiresAt || Date.parse(row.expiresAt) > now)) return 'answered';
  return 'history';
}

export function responderInquiriesForView(inquiries: readonly Inquiry[], view: ResponderQueueView | 'history', now: number): Inquiry[] {
  return inquiries.flatMap(inquiry => {
    const rows = inquiry.rows.filter(row => responderRowView(row, now) === view);
    return rows.length ? [{ ...inquiry, rows }] : [];
  });
}
