import type { PartnerActivationViewV3 } from '@sabalanerp/partner-sales-contracts';

export function activationOperationAvailability(view: PartnerActivationViewV3 | undefined) {
  const subject = view?.subject;
  const enrolled = Boolean(subject?.gates.find(gate => gate.id === 'ENROLLMENT')?.ready);
  return {
    enrolled,
    canDefineCohort: Boolean(view?.release.status === 'READY' && !view.cohort),
    canOpenEnrollment: Boolean(view?.release.status === 'READY' && view.cohort && !view.cohort.enrollmentOpen),
    canEnroll: Boolean(subject?.profileId && view?.cohort?.enrollmentOpen && !enrolled),
    canOpenOperations: Boolean(subject?.profileId && enrolled && view?.cohort && !view.cohort.operationsOpen),
  };
}
