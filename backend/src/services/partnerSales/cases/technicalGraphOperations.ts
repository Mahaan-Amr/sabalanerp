import { parseCanonicalDecimal, parseStableIdentity, type ProductOperationsInput } from '@sabalanerp/contract-product-graph';
import type { PartnerTechnicalOperationsIntent } from '@sabalanerp/partner-sales-contracts';
import type { PartnerTechnicalGraphContext } from './technicalGraph';

/** Rebind selected technical identities to the owner's private rate snapshots.
 * Geometry is already canonical; quantities/overrides are calculated by the graph. */
export function technicalGraphOperations(intent: PartnerTechnicalOperationsIntent,
  geometry: Pick<ProductOperationsInput, 'productRowId' | 'lengthMeters' | 'widthMeters' | 'quantity'> & { operationScopeId?: string },
  context: PartnerTechnicalGraphContext): ProductOperationsInput {
  const catalog = (selection: { catalogItemId: string; catalogSnapshotVersion: string }, kind: 'TOOL' | 'FINISHING') => {
    const matches = context.catalog.operations.filter(item => item.kind === kind && item.catalogItemId === selection.catalogItemId &&
      item.catalogSnapshotVersion === selection.catalogSnapshotVersion);
    const evidence = context.operations?.filter(item => item.kind === kind && item.catalogItemId === selection.catalogItemId &&
      item.catalogSnapshotVersion === selection.catalogSnapshotVersion) ?? [];
    if (matches.length !== 1 || evidence.length !== 1) throw new Error('Missing or ambiguous operation evidence');
    return { item: matches[0], rateToman: parseCanonicalDecimal(evidence[0].rateToman) };
  };
  const override = (value: PartnerTechnicalOperationsIntent['tools'][number]['quantityOverride']) => value && ({
    ...value, value: parseCanonicalDecimal(value.value), automaticQuantitySnapshot: parseCanonicalDecimal(value.automaticQuantitySnapshot),
  });
  return { ...geometry, policyVersion: context.policy.calculation, pricingPolicyVersion: context.policy.pricing,
    roundingPolicyVersion: context.policy.rounding,
    groups: intent.groups.map(group => ({ operationGroupId: parseStableIdentity('operation-group', group.operationGroupId),
      scope: parseCanonicalDecimal(group.scope) })),
    tools: intent.tools.map(tool => {
      const { item, rateToman } = catalog(tool, 'TOOL');
      if (item.kind !== 'TOOL') throw new Error('Wrong operation evidence');
      return { ...tool, toolSelectionId: parseStableIdentity('tool-selection', tool.toolSelectionId),
        operationGroupId: parseStableIdentity('operation-group', tool.operationGroupId), name: item.name, unit: item.unit,
        rateToman, quantityOverride: override(tool.quantityOverride) };
    }),
    finishings: intent.finishings.map(finishing => {
      const { item, rateToman } = catalog(finishing, 'FINISHING');
      if (item.kind !== 'FINISHING') throw new Error('Wrong operation evidence');
      return { ...finishing, finishingSelectionId: parseStableIdentity('finishing-selection', finishing.finishingSelectionId),
        operationGroupId: parseStableIdentity('operation-group', finishing.operationGroupId), name: item.name, unit: item.unit,
        incompatibleCatalogItemIds: item.incompatibleCatalogItemIds, rateToman, quantityOverride: override(finishing.quantityOverride) };
    }),
  };
}
