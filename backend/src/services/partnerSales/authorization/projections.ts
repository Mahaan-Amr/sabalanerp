import { checkExpectedRevision, FulfillmentViewSchema, PartnerCaseViewSchema, PartnerQuerySchema,
  SabalanInternalRecordViewSchema, partnerError, type PartnerAuthorizationPort, type PartnerQuery,
  type PartnerQueryResults, type Result } from '@sabalanerp/partner-sales-contracts';

type CasePurpose = 'PARTNER_CASE' | 'ACCOUNTING' | 'FULFILLMENT';
type CaseQuery = Extract<PartnerQuery, { purpose: CasePurpose }>;
const projections = {
  PARTNER_CASE: { action: 'CASE_READ', schema: PartnerCaseViewSchema },
  ACCOUNTING: { action: 'ACCOUNTING_READ', schema: SabalanInternalRecordViewSchema },
  FULFILLMENT: { action: 'FULFILLMENT_READ', schema: FulfillmentViewSchema },
} as const;

/** Owner adapters build their positive DTO; raw entities and unknown nested fields
 * are rejected, never spread or silently stripped. Public customer output remains
 * the snapshot-bound #325 reader, not an alias for a private Case projection. */
export function createAuthorizedCaseReader(authorization: PartnerAuthorizationPort, source: {
  read(query: CaseQuery): Promise<unknown>;
}) {
  return { async query<P extends CasePurpose>(query: Extract<CaseQuery, { purpose: P }>): Promise<Result<PartnerQueryResults[P]>> {
    const parsedQuery = PartnerQuerySchema.safeParse(query);
    if (!parsedQuery.success || !Object.prototype.hasOwnProperty.call(projections, parsedQuery.data.purpose)) {
      return { ok: false, error: partnerError('INVALID_PAYLOAD') };
    }
    const request = parsedQuery.data as CaseQuery;
    const projection = projections[request.purpose];
    const root = { kind: 'CASE' as const, id: request.expected.caseId };
    const permitted = await authorization.authorize(projection.action, root);
    if (!permitted.ok) return permitted;
    const candidate = await source.read(request);
    // Do not disclose an obsolete projection after a grant/lifecycle changed during IO.
    const current = await authorization.authorize(projection.action, root);
    if (!current.ok) return current;
    const parsed = projection.schema.safeParse(candidate);
    if (!parsed.success) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
    const mismatch = checkExpectedRevision(request.expected, parsed.data.owner);
    if (mismatch) return { ok: false, error: mismatch };
    return { ok: true, value: parsed.data as PartnerQueryResults[P] };
  } };
}
