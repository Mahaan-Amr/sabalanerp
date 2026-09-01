import { z } from 'zod';
import {
  calculateProductOperationsTechnical, parseStableIdentity, parseCanonicalDecimal,
  type CanonicalDecimal, type ProductOperationsConflict, type ProductOperationsTechnicalResult,
} from '@sabalanerp/contract-product-graph';
import { IdSchema, InstantSchema } from './primitives';
import { technicalDecimal as decimal } from './technical-values';
import type { PartnerTechnicalOperation } from './technical-catalog';

const selection = {
  operationGroupId: IdSchema, catalogItemId: IdSchema, catalogSnapshotVersion: InstantSchema,
  quantityOverride: z.object({ value: decimal, automaticQuantitySnapshot: decimal,
    resolution: z.enum(['keep', 'use-calculation']).optional(),
  }).strict().optional(),
};
export const PartnerTechnicalOperationsIntentSchema = z.object({
  groups: z.array(z.object({ operationGroupId: IdSchema, scope: decimal }).strict()),
  tools: z.array(z.object({ ...selection, toolSelectionId: IdSchema,
    edges: z.array(z.enum(['front', 'back', 'left', 'right'])).optional(),
  }).strict()),
  finishings: z.array(z.object({ ...selection, finishingSelectionId: IdSchema }).strict()),
}).strict();
export type PartnerTechnicalOperationsIntent = z.infer<typeof PartnerTechnicalOperationsIntentSchema>;
type MissingOperation = { code: 'catalog-unavailable'; path: readonly string[]; entityId: string; message: string };
export type PartnerTechnicalOperationsPreview =
  | { ok: true; result: ProductOperationsTechnicalResult }
  | { ok: false; inputRevision?: number; conflicts: readonly (ProductOperationsConflict | MissingOperation)[];
      result?: ProductOperationsTechnicalResult };

/** Bind safe catalog snapshots to canonical selections. Missing catalog entries
 * remain conflicts; they never acquire fake units, rates or computed quantities.
 */
export function previewTechnicalOperations(
  intent: PartnerTechnicalOperationsIntent,
  geometry: { productRowId: string; operationScopeId?: string; inputRevision: number; lengthMeters: CanonicalDecimal; widthMeters: CanonicalDecimal; quantity?: number },
  catalog: readonly PartnerTechnicalOperation[],
): PartnerTechnicalOperationsPreview {
  const missing: MissingOperation[] = [];
  const override = (value: PartnerTechnicalOperationsIntent['tools'][number]['quantityOverride']) => value && ({
    ...value, value: parseCanonicalDecimal(value.value), automaticQuantitySnapshot: parseCanonicalDecimal(value.automaticQuantitySnapshot),
  });
  const tools = intent.tools.flatMap(tool => {
    const item = catalog.find((entry): entry is Extract<PartnerTechnicalOperation, { kind: 'TOOL' }> =>
      entry.kind === 'TOOL' && entry.catalogItemId === tool.catalogItemId && entry.catalogSnapshotVersion === tool.catalogSnapshotVersion);
    if (!item) {
      missing.push({ code: 'catalog-unavailable', path: ['tools', tool.toolSelectionId, 'catalogItemId'],
        entityId: tool.toolSelectionId, message: 'مشخصات فنی ابزار در دسترس نیست.' });
      return [];
    }
    return [{ ...tool, toolSelectionId: parseStableIdentity('tool-selection', tool.toolSelectionId),
      operationGroupId: parseStableIdentity('operation-group', tool.operationGroupId), name: item.name, unit: item.unit,
      quantityOverride: override(tool.quantityOverride) }];
  });
  const finishings = intent.finishings.flatMap(finishing => {
    const item = catalog.find((entry): entry is Extract<PartnerTechnicalOperation, { kind: 'FINISHING' }> =>
      entry.kind === 'FINISHING' && entry.catalogItemId === finishing.catalogItemId && entry.catalogSnapshotVersion === finishing.catalogSnapshotVersion);
    if (!item) {
      missing.push({ code: 'catalog-unavailable', path: ['finishings', finishing.finishingSelectionId, 'catalogItemId'],
        entityId: finishing.finishingSelectionId, message: 'مشخصات فنی پرداخت در دسترس نیست.' });
      return [];
    }
    return [{ ...finishing, finishingSelectionId: parseStableIdentity('finishing-selection', finishing.finishingSelectionId),
      operationGroupId: parseStableIdentity('operation-group', finishing.operationGroupId), name: item.name, unit: item.unit,
      incompatibleCatalogItemIds: item.incompatibleCatalogItemIds, quantityOverride: override(finishing.quantityOverride) }];
  });
  const calculation = calculateProductOperationsTechnical({ ...geometry,
    productRowId: parseStableIdentity('product-row', geometry.productRowId),
    groups: intent.groups.map(group => ({ ...group, operationGroupId: parseStableIdentity('operation-group', group.operationGroupId), scope: parseCanonicalDecimal(group.scope) })),
    tools, finishings,
  });
  if (missing.length === 0) return calculation;
  return { ok: false, inputRevision: geometry.inputRevision,
    conflicts: [...missing, ...(!calculation.ok ? calculation.conflicts : [])],
    ...(calculation.result ? { result: calculation.result } : {}),
  };
}
