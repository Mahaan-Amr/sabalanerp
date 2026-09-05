/** JSON markers are presence-based, including null/false and retained nested
 * snapshots. An incomplete private witness cannot become an ordinary source. */
const markerKeys = new Set(['partnerCaseId', 'partnerPreparation', 'partnerReceivable', 'partnerFact', 'financialEvidenceHash']);
export const PARTNER_ACCOUNTING_MARKER_JSON_PATH = '$.** ? (exists(@.partnerCaseId) || exists(@.partnerPreparation) || exists(@.partnerReceivable) || '
  + 'exists(@.partnerFact) || exists(@.financialEvidenceHash) || @.sourceKind == "PARTNER_INTERNAL_RECORD" || @.sourceKind == "SABALAN_TO_PARTNER")';

export function hasPartnerAccountingEvidence(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasPartnerAccountingEvidence);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => markerKeys.has(key) ||
    (key === 'sourceKind' && ['PARTNER_INTERNAL_RECORD', 'SABALAN_TO_PARTNER'].includes(String(child))) ||
    hasPartnerAccountingEvidence(child));
}
