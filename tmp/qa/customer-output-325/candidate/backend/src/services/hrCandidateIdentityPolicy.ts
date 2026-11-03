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
) => classifyCandidateIdentity(existing, requested).kind !== 'HARD_CONFLICT';

export type CandidateIdentityClassification =
  | { kind: 'MATCH'; mobileMismatch: false }
  | { kind: 'MATCH_WITH_MOBILE_WARNING'; mobileMismatch: true }
  | { kind: 'HARD_CONFLICT'; mobileMismatch: boolean };

export const classifyCandidateIdentity = (
  existing: CandidateIdentity,
  requested: CandidateIdentity,
): CandidateIdentityClassification => {
  const nameMatches = normalizePersianFullName(`${existing.firstName ?? ''} ${existing.lastName ?? ''}`)
    === normalizePersianFullName(`${requested.firstName ?? ''} ${requested.lastName ?? ''}`);
  const mobileMismatch = normalizeApplicantMobile(existing.mobile) !== normalizeApplicantMobile(requested.mobile);
  if (!nameMatches) return { kind: 'HARD_CONFLICT', mobileMismatch };
  if (mobileMismatch) return { kind: 'MATCH_WITH_MOBILE_WARNING', mobileMismatch: true };
  return { kind: 'MATCH', mobileMismatch: false };
};
