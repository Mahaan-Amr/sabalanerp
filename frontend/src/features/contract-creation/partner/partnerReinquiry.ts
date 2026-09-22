import type { PartnerInquiryRow } from '../../partner-sales/inquiries/inquiryPresentation';

export function selectPartnerReinquiryRows(sourceRows: PartnerInquiryRow[], inquiryId: string,
  requestedRow?: PartnerInquiryRow) {
  const distinct = new Map(sourceRows.map(item => [item.configurationRef.productRowId, item]));
  const selected = requestedRow ? Array.from(distinct.values()).filter(item =>
    item.configurationRef.productRowId === requestedRow.configurationRef.productRowId) : Array.from(distinct.values());
  if (!selected.length) throw new Error('Pricing subject unavailable');
  if (!inquiryId) throw new Error('Pricing package unavailable');
  return { inquiryId, rows: selected };
}
