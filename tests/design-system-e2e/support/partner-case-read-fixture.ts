import { PartnerCaseRuntimeResultSchema, PartnerCaseChangeVersionSchema, partnerInputHash } from '../../../packages/partner-sales-contracts/dist';

// Successful read fixtures use one payload for the case query and its version.
// Command responses and deliberate read-error handlers retain their own behavior.
export async function partnerCaseReadFixtureData(path: string, currentData: unknown) {
  if (path !== '/api/partner/cases/changes-v2' && path !== '/api/partner/cases/query-v2') return currentData;
  const data = PartnerCaseRuntimeResultSchema.parse(currentData);
  return path.endsWith('/changes-v2')
    ? PartnerCaseChangeVersionSchema.parse({ version: await partnerInputHash(data) })
    : data;
}
