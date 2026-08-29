import { RevisionRefSchema, type RevisionRef } from '@sabalanerp/partner-sales-contracts';

export type PartnerContractMetadata = { id: string; partnerKind?: string | null; partnerCaseId?: string | null; partnerRevision?: number | null; partnerIntegrityHash?: string | null };
export type PartnerContractRoute = { kind: 'ordinary' } | { kind: 'blocked' } | { kind: 'partner'; caseId: string; expected: RevisionRef };

export function resolvePartnerContractRoute(contract: PartnerContractMetadata): PartnerContractRoute {
  if (contract.partnerKind !== 'PARTNER_CUSTOMER') return { kind: 'ordinary' };
  const expected = RevisionRefSchema.safeParse({ caseId: contract.partnerCaseId, revision: contract.partnerRevision, integrityHash: contract.partnerIntegrityHash });
  return expected.success ? { kind: 'partner', caseId: expected.data.caseId, expected: expected.data } : { kind: 'blocked' };
}
