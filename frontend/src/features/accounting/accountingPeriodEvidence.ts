type EvidenceValue = null | boolean | number | string | EvidenceValue[] | { [key: string]: EvidenceValue | undefined };

/** Mirrors the period-end application's canonical JSON before SHA-256 signing. */
const canonicalize = (value: EvidenceValue): EvidenceValue => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalize(item as EvidenceValue)]));
  return value;
};

export const hashAccountingPeriodEvidence = async (evidence: EvidenceValue): Promise<string> => {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(evidence)));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (item) => item.toString(16).padStart(2, '0')).join('');
};
