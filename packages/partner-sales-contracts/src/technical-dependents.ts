import { z } from 'zod';
import { parseCanonicalDecimal, parseStableIdentity, replayRemainderTechnical, compareProductDependentOrder,
  type PaidRemainderStock, type RemainderTechnicalReplay, type StairLayerTechnicalCalculation } from '@sabalanerp/contract-product-graph';
import { IdSchema, InstantSchema } from './primitives';
import { technicalDecimal as decimal } from './technical-values';
import { PartnerTechnicalOperationsIntentSchema, previewTechnicalOperations, type PartnerTechnicalOperationsPreview } from './technical-operations';
import type { PartnerTechnicalPreviewCatalog } from './technical-draft';
import { PartnerTechnicalLayerSchema, previewTechnicalLayer, type TechnicalLayerParent } from './technical-layers';
import type { TechnicalDraftConflict, TechnicalIdentityFailure } from './technical-identities';

const remainder = z.object({
  kind: z.literal('remainder'), creationOrder: z.number().int().nonnegative().safe(),
  allocationId: IdSchema, productRowId: IdSchema, sourceProductRowId: IdSchema,
  selectedRemainingStoneId: IdSchema.optional(), catalogItemId: IdSchema, catalogSnapshotVersion: InstantSchema,
  lengthMeters: decimal.optional(), widthMeters: decimal.optional(), quantity: z.number().int().safe().optional(),
  lengthDisplayUnit: z.enum(['cm', 'm']), widthDisplayUnit: z.enum(['cm', 'm']),
  sawKerfEnabled: z.boolean(), calibrationEnabled: z.boolean(),
  sourcePieceQuantities: z.array(z.number().int().positive().safe()).optional(),
  secondaryOwnerProductRowId: IdSchema.optional(), operations: PartnerTechnicalOperationsIntentSchema.optional(),
}).strict();
export const PartnerTechnicalDependentSchema = z.discriminatedUnion('kind', [remainder, PartnerTechnicalLayerSchema]);
export type PartnerTechnicalDependent = z.infer<typeof PartnerTechnicalDependentSchema>;
export type PartnerTechnicalDependentPreview = {
  kind: 'remainder'; productRowId: string; allocationId: string; calculation: RemainderTechnicalReplay | TechnicalIdentityFailure;
  operations?: PartnerTechnicalOperationsPreview;
} | { kind: 'layer'; layerConfigurationId: string; parentProductRowId: string; calculation: StairLayerTechnicalCalculation | TechnicalIdentityFailure };

/** Inventory is produced by canonical parent calculations, never accepted from
 * the editing payload. Each successful allocation feeds the next dependency.
 */
export function previewTechnicalDependents(inputRevision: number, intents: readonly PartnerTechnicalDependent[],
  baseInventory: readonly PaidRemainderStock[], catalog: PartnerTechnicalPreviewCatalog,
  parents: ReadonlyMap<string, TechnicalLayerParent>,
  identityConflicts: ReadonlyMap<number, TechnicalDraftConflict[]>,
): { dependents: PartnerTechnicalDependentPreview[]; inventory: readonly PaidRemainderStock[] } {
  let inventory = baseInventory;
  const dependents: PartnerTechnicalDependentPreview[] = [];
  const ordered = intents.map((intent, index) => ({ intent, index, kind: intent.kind,
    order: intent.creationOrder, identity: intent.kind === 'layer' ? intent.layerConfigurationId : intent.allocationId }))
    .sort(compareProductDependentOrder);
  for (const { intent, index } of ordered) {
    const conflicts = identityConflicts.get(index);
    if (conflicts) {
      const calculation: TechnicalIdentityFailure = { ok: false, inputRevision, conflicts };
      dependents.push(intent.kind === 'layer'
        ? { kind: 'layer', layerConfigurationId: intent.layerConfigurationId, parentProductRowId: intent.parentProductRowId, calculation }
        : { kind: 'remainder', allocationId: intent.allocationId, productRowId: intent.productRowId, calculation });
      continue;
    }
    if (intent.kind === 'layer') {
      const calculation = previewTechnicalLayer(inputRevision, intent, parents.get(intent.parentProductRowId), inventory, catalog);
      if (calculation.inventory) inventory = calculation.inventory;
      dependents.push({ kind: 'layer', layerConfigurationId: intent.layerConfigurationId, parentProductRowId: intent.parentProductRowId, calculation });
      continue;
    }
    const { lengthMeters, widthMeters, quantity } = intent;
    let calculation: RemainderTechnicalReplay;
    const item = catalog.products.find(product => product.catalogItemId === intent.catalogItemId &&
      product.catalogSnapshotVersion === intent.catalogSnapshotVersion);
    if (!item || lengthMeters === undefined || widthMeters === undefined || quantity === undefined) {
      calculation = { ok: false, inputRevision, conflicts: [{ code: 'invalid-remainder-input',
        path: ['dependents', intent.allocationId], childProductRowId: parseStableIdentity('product-row', intent.productRowId),
        message: 'مشخصات فنی، ابعاد و تعداد فرزند را کامل کنید.' }] };
    } else {
      calculation = replayRemainderTechnical({ inputRevision, baseInventory: inventory, childIntents: [{
        allocationId: parseStableIdentity('allocation', intent.allocationId), allocationOrder: intent.creationOrder,
        childProductRowId: parseStableIdentity('product-row', intent.productRowId),
        sourceProductRowId: parseStableIdentity('product-row', intent.sourceProductRowId),
        selectedRemainingStoneId: intent.selectedRemainingStoneId === undefined ? undefined : parseStableIdentity('remaining-stone', intent.selectedRemainingStoneId),
        catalogProductId: item.catalogItemId, lengthMeters: parseCanonicalDecimal(lengthMeters),
        widthMeters: parseCanonicalDecimal(widthMeters), quantity,
        kerfMeters: parseCanonicalDecimal(intent.sawKerfEnabled ? catalog.sawKerfMeters : '0'),
        calibrationEnabled: intent.calibrationEnabled, sourcePieceQuantities: intent.sourcePieceQuantities,
        secondaryOwnerProductRowId: intent.secondaryOwnerProductRowId === undefined ? undefined : parseStableIdentity('product-row', intent.secondaryOwnerProductRowId),
      }] });
      if (calculation.ok) inventory = calculation.result.inventory;
    }
    const operations = calculation.ok && intent.operations ? previewTechnicalOperations(intent.operations, {
      inputRevision, productRowId: intent.productRowId, lengthMeters: parseCanonicalDecimal(lengthMeters!),
      widthMeters: parseCanonicalDecimal(widthMeters!), quantity: quantity!,
    }, catalog.operations) : undefined;
    dependents.push({ kind: 'remainder', productRowId: intent.productRowId, allocationId: intent.allocationId, calculation,
      ...(operations ? { operations } : {}) });
  }
  return { dependents, inventory };
}
