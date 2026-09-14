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

/** Historical ordinary Contract snapshots copied Prisma's nullable ownership
 * column at their root. That null is relational schema shape, not private
 * Partner evidence. Remove only that one known root field; retained/nested null
 * markers and every non-null owner remain fail-closed. */
export function hasPartnerAccountingEvidenceInOrdinaryContractSnapshot(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !Object.prototype.hasOwnProperty.call(value, 'partnerCaseId') ||
      (value as Record<string, unknown>).partnerCaseId !== null) {
    return hasPartnerAccountingEvidence(value);
  }
  const { partnerCaseId: _ordinaryNullOwner, ...snapshot } = value as Record<string, unknown>;
  return hasPartnerAccountingEvidence(snapshot);
}

type FinancialSourceEvidence = {
  sourceKind?: string | null;
  sourceId?: string | null;
  contractId?: string | null;
  metadata?: unknown;
  sourceSnapshot?: unknown;
};

export function hasConflictingPartnerAccountingEvidence(source: FinancialSourceEvidence | null | undefined): boolean {
  if (!source) return false;
  const ordinaryContractSource = source.sourceKind === 'SALES_CONTRACT' &&
    typeof source.contractId === 'string' && source.sourceId === source.contractId;
  return hasPartnerAccountingEvidence(source.metadata) || (ordinaryContractSource
    ? hasPartnerAccountingEvidenceInOrdinaryContractSnapshot(source.sourceSnapshot)
    : hasPartnerAccountingEvidence(source.sourceSnapshot));
}
