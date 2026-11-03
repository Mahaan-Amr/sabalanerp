import type * as Foundation from '../../../../../packages/partner-sales-contracts';

// Public package types only. The shared writer installs/wires the runtime;
// composition passes the public exports, never package internals or test code.
export type ContractRuntime = Pick<typeof Foundation,
  'SafeNotificationSchema' | 'InquiryBatchResultSchema' | 'InstantSchema' | 'IdSchema'
  | 'canonicalHash' | 'canonicalJson' | 'partnerError'>;
export type { SafeNotification, NotificationGateway, InquiryBatchResult, TransactionClock, Result }
  from '../../../../../packages/partner-sales-contracts';

export type InquiryNoticeType = 'SUBMITTED' | 'CANCELLED' | 'PARTIAL_RESPONSE' | 'REASSIGNED' | 'EXPIRING' | 'EXPIRED';
export const inquiryNoticeKinds = {
  SUBMITTED: 'INQUIRY_PENDING', CANCELLED: 'INQUIRY_DECIDED', PARTIAL_RESPONSE: 'INQUIRY_DECIDED',
  REASSIGNED: 'INQUIRY_PENDING', EXPIRING: 'APPROVAL_EXPIRING', EXPIRED: 'INQUIRY_DECIDED',
} as const;
