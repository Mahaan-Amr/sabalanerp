import type { PartnerTechnicalDraft, PartnerTechnicalServiceCatalogItem } from '@sabalanerp/partner-sales-contracts';

type Selection = { catalogItemId: string; catalogSnapshotVersion: string; unit: 'meter' | 'squareMeter' };

// Match ordinary Sales: only the main stair section resolves meter finishing rates.
// Longitudinal/slab products and stair layers require a square-meter rate.
export function partnerFinishingRate(selection: Selection, catalog: readonly PartnerTechnicalServiceCatalogItem[],
  mainStair: boolean): string | undefined {
  if (selection.unit === 'meter' && !mainStair) return undefined;
  return catalog.find(item => item.sourceType === 'finishing' && item.catalogItemId === selection.catalogItemId &&
    item.catalogSnapshotVersion === selection.catalogSnapshotVersion && item.unit === selection.unit)?.suggestedRetailUnitPrice?.amount;
}

export function partnerProductHasMissingFinishingRate(draft: PartnerTechnicalDraft, productRowId: string,
  catalog: readonly PartnerTechnicalServiceCatalogItem[]): boolean {
  const row = draft.rows.find(item => item.productRowId === productRowId);
  if (!row) return false;
  const missingRate = (selection: Omit<Selection, 'unit'>, mainStair: boolean) => {
    const item = catalog.find(item => item.sourceType === 'finishing' && item.catalogItemId === selection.catalogItemId &&
      item.catalogSnapshotVersion === selection.catalogSnapshotVersion);
    return !item || item.unit === 'count' || partnerFinishingRate({ ...selection, unit: item.unit }, catalog, mainStair) === undefined;
  };
  if ('operations' in row && row.operations?.finishings.some(item => missingRate(item, row.family === 'stair'))) return true;
  return (draft.dependents ?? []).some(item => item.kind === 'layer' && item.parentProductRowId === productRowId &&
    item.sideOperations?.some(side => side.operations.finishings.some(finishing => missingRate(finishing, false))));
}
