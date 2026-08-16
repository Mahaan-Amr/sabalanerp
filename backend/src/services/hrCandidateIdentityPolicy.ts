import { normalizeApplicantMobile } from './hrCandidateAccess';
import { normalizePersianFullName } from './hrOfferDecision';

type CandidateIdentity = {
  firstName: unknown;
  lastName: unknown;
  mobile: unknown;
};

export const candidateIdentityMatches = (
  existing: CandidateIdentity,
  requested: CandidateIdentity,
) => (
  normalizePersianFullName(`${existing.firstName ?? ''} ${existing.lastName ?? ''}`)
    === normalizePersianFullName(`${requested.firstName ?? ''} ${requested.lastName ?? ''}`)
  && normalizeApplicantMobile(existing.mobile) === normalizeApplicantMobile(requested.mobile)
);
