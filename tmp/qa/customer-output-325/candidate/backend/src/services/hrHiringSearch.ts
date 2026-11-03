import type { Prisma } from '@prisma/client';

export const buildHiringCandidateSearchConditions = (
  rawSearch: string,
  canSeeSensitiveIdentity: boolean,
): Prisma.HrJobApplicationWhereInput[] => {
  const tokens = rawSearch.trim().split(/\s+/).filter(Boolean);
  return tokens.map((token) => ({ OR: [
    { candidate: { firstName: { contains: token, mode: 'insensitive' } } },
    { candidate: { lastName: { contains: token, mode: 'insensitive' } } },
    ...(canSeeSensitiveIdentity ? [{ candidate: { mobile: { contains: token } } }] : []),
    ...(canSeeSensitiveIdentity ? [{ candidate: { nationalCode: { contains: token } } }] : []),
  ] }));
};
