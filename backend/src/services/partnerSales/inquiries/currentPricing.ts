/** Only packages explicitly replaced by the atomic product-edit command are
 * redundant in current pricing. Manual cancellations and incomplete evidence
 * remain visible to the ordinary reader. No history is mutated. */
export function currentPartnerPricingInquiryIds(caseId: string, inquiries: readonly {
  id: string; rows: readonly { id: string; outcome: string }[];
  events: readonly { evidence: unknown }[];
}[]): string[] {
  const known = new Set(inquiries.map(inquiry => inquiry.id));
  return inquiries.filter(inquiry => {
    if (!inquiry.rows.length || inquiry.rows.some(row => row.outcome !== 'CANCELLED')) return true;
    const replacedRows = new Set<string>();
    for (const event of inquiry.events) {
      const value = event.evidence as { version?: unknown; caseId?: unknown; replacementInquiryId?: unknown; rowIds?: unknown } | null;
      if (!value || value.version !== 1 || value.caseId !== caseId || typeof value.replacementInquiryId !== 'string' ||
          value.replacementInquiryId === inquiry.id || !known.has(value.replacementInquiryId) || !Array.isArray(value.rowIds)) continue;
      for (const id of value.rowIds) if (typeof id === 'string') replacedRows.add(id);
    }
    return !inquiry.rows.every(row => replacedRows.has(row.id));
  }).map(inquiry => inquiry.id);
}
