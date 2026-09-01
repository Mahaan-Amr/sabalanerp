import {
  PartnerEventSchema,
  type PartnerEvent,
  type RevisionRef,
} from '@sabalanerp/partner-sales-contracts';

type EventIdentity = {
  eventId: string;
  commandId: string;
  correlationId: string;
  actorId: string;
  recordedAt: string;
  effectiveDate: string;
  owner: RevisionRef;
};

type Commitment = EventIdentity & {
  trigger: 'SIGNED' | 'PRINTED';
  internalRecordId: string;
  salesCreditOwnerId: string;
  sabalanNetAmount: { amount: string; currency: 'IRR' | 'IRT' };
};

export function buildCaseCommitmentEvent(input: Commitment): Extract<PartnerEvent, { type: 'CASE_COMMITTED' }> {
  return PartnerEventSchema.parse({ schemaVersion: 1, type: 'CASE_COMMITTED', ...input }) as
    Extract<PartnerEvent, { type: 'CASE_COMMITTED' }>;
}

export function buildCaseCancellationEvent(input: EventIdentity & { reason: string }):
Extract<PartnerEvent, { type: 'CASE_CANCELLED' }> {
  return PartnerEventSchema.parse({ schemaVersion: 1, type: 'CASE_CANCELLED', ...input }) as
    Extract<PartnerEvent, { type: 'CASE_CANCELLED' }>;
}

type CustomerStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'SIGNED' | 'PRINTED' | 'CANCELLED' | 'EXPIRED' | 'COMMITTED';

/** Compatibility status is a monotonic projection of durable Case facts. */
export function projectCustomerContractStatus(current: CustomerStatus, fact: 'SIGNED' | 'PRINTED'):
  'SIGNED' | 'PRINTED' | null {
  if (current === 'PRINTED') return 'PRINTED';
  if (current === 'SIGNED') return fact === 'PRINTED' ? 'PRINTED' : 'SIGNED';
  if (current === 'APPROVED') return fact;
  return null;
}
