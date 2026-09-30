import type { PartnerTechnicalDraft, PartnerTechnicalProduct } from '@sabalanerp/partner-sales-contracts';
import type { PartnerRetailRow } from './partnerRetail';

export function partnerRetailPresentation(draft: PartnerTechnicalDraft, catalog: readonly PartnerTechnicalProduct[]) {
  const title = (row: { catalogItemId: string; catalogSnapshotVersion: string }) => catalog.find(product =>
    product.catalogItemId === row.catalogItemId && product.catalogSnapshotVersion === row.catalogSnapshotVersion)?.name ?? row.catalogItemId;
  return new Map<string, { title: string; parentProductRowId?: string }>([
    ...draft.rows.map(row => [row.productRowId, { title: title(row) }] as const),
    ...(draft.dependents ?? []).flatMap(row => row.kind === 'remainder' ? [[row.productRowId,
      { title: title(row), parentProductRowId: row.sourceProductRowId }] as const] : []),
  ]);
}

/** Rehydrate presentation for older wizard checkpoints without changing amounts or approvals. */
export function presentPartnerRetailRows(rows: PartnerRetailRow[], draft: PartnerTechnicalDraft, catalog: readonly PartnerTechnicalProduct[]) {
  const presentation = partnerRetailPresentation(draft, catalog);
  return rows.map(row => {
    const item = presentation.get(row.productRowId);
    return item ? { ...row, parentProductRowId: item.parentProductRowId,
      inquiryRow: { ...row.inquiryRow, description: item.title } } : row;
  });
}
