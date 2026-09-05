import type { TaxSubmissionStatus } from '@prisma/client';

/** One transition vocabulary for the public command and action projection. */
export const partnerTaxTransitions: Record<TaxSubmissionStatus, TaxSubmissionStatus[]> = {
  NOT_READY: [], READY: ['SUBMITTED_MANUALLY', 'SUBMITTED_EXTERNALLY'],
  SUBMITTED_MANUALLY: ['ACCEPTED', 'REJECTED', 'NEEDS_CORRECTION'],
  SUBMITTED_EXTERNALLY: ['ACCEPTED', 'REJECTED', 'NEEDS_CORRECTION'],
  ACCEPTED: ['NEEDS_CORRECTION'], REJECTED: ['SUBMITTED_MANUALLY', 'SUBMITTED_EXTERNALLY'],
  NEEDS_CORRECTION: ['SUBMITTED_MANUALLY', 'SUBMITTED_EXTERNALLY'],
};
