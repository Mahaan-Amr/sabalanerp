import { collectCalculatedOperationQuantities, evaluateOperationMinimums, operationMinimumMessage, type OperationMinimumQuantity } from '@sabalanerp/contract-product-graph';
import type { PartnerTechnicalDraft, PartnerTechnicalOperation, PartnerTechnicalServiceCatalogItem } from '@sabalanerp/partner-sales-contracts';
import type { OperationMinimumContextValue } from '../components/product-modal-system/OperationMinimumContext';

export function partnerOperationMinimumState(preview: unknown, operations: readonly PartnerTechnicalOperation[],
  services: PartnerTechnicalDraft['serviceRows'], serviceCatalog: readonly PartnerTechnicalServiceCatalogItem[] = []): OperationMinimumContextValue {
  const quantities: OperationMinimumQuantity[] = collectCalculatedOperationQuantities(preview);
  for (const row of services ?? []) if (row.sourceType === 'tool' || row.sourceType === 'finishing')
    quantities.push({ kind: row.sourceType, catalogItemId: row.catalogItemId, unit: row.unit, quantity: row.quantity ?? '0', selectionId: row.serviceRowId });
  const rules = operations.flatMap(item => item.kind === 'LAYER' ? [] : [{
    kind: item.kind === 'TOOL' ? 'tool' as const : 'finishing' as const, catalogItemId: item.catalogItemId,
    name: item.name, unit: item.unit, minimumQuantity: item.minimumQuantity,
  }]);
  for (const item of serviceCatalog) if ((item.sourceType === 'tool' || item.sourceType === 'finishing') && (item.unit === 'meter' || item.unit === 'squareMeter') &&
      !rules.some(rule => rule.kind === item.sourceType && rule.catalogItemId === item.catalogItemId))
    rules.push({ kind: item.sourceType, catalogItemId: item.catalogItemId, name: item.name, unit: item.unit, minimumQuantity: item.minimumQuantity });
  return { quantities, rules };
}

export function partnerOperationMinimumFailure(...args: Parameters<typeof partnerOperationMinimumState>): string | null {
  const state = partnerOperationMinimumState(...args);
  return evaluateOperationMinimums(state.quantities, state.rules).map(operationMinimumMessage).join('\n') || null;
}
