import type { CheckAccountingStatus } from '@prisma/client';

/** The command and its action projection share the instrument state machine. */
export const partnerCheckTransitions: Record<CheckAccountingStatus, readonly CheckAccountingStatus[]> = {
  PENDING_HANDOVER: ['RECEIVED', 'RETURNED'],
  RECEIVED: ['DEPOSITED', 'CLEARED', 'BOUNCED', 'RETURNED'],
  DEPOSITED: ['CLEARED', 'BOUNCED', 'RETURNED'],
  CLEARED: ['BOUNCED', 'RETURNED'],
  BOUNCED: ['DEPOSITED', 'CLEARED', 'RETURNED'],
  RETURNED: [], REPLACED: [],
};
