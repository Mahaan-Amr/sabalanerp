import { parseCanonicalDecimal as decimal, parseStableIdentity, type AddRowSellerIntent, type CanonicalProductGraph } from '@sabalanerp/contract-product-graph';
import type { PartnerTechnicalDependent, PartnerTechnicalDependentPreview } from '@sabalanerp/partner-sales-contracts';
import type { PartnerTechnicalGraphContext } from './technicalGraph';
import { technicalGraphOperations } from './technicalGraphOperations';

export function technicalGraphRemainder(intent: Extract<PartnerTechnicalDependent, { kind: 'remainder' }>,
  preview: PartnerTechnicalDependentPreview, graph: CanonicalProductGraph, context: PartnerTechnicalGraphContext): AddRowSellerIntent {
  if (preview.kind !== 'remainder' || !preview.calculation.ok) throw new Error('Invalid remainder preview');
  const allocation = preview.calculation.result.allocations[0];
  const stock = graph.remainingStones.find(stock => stock.remainingStoneId === allocation.sourceRemainingStoneId);
  const products = context.catalog.products.filter(item => item.catalogItemId === intent.catalogItemId && item.catalogSnapshotVersion === intent.catalogSnapshotVersion);
  const evidence = context.products.filter(item => item.catalogItemId === intent.catalogItemId && item.catalogSnapshotVersion === intent.catalogSnapshotVersion);
  if (!stock || products.length !== 1 || evidence.length !== 1 || !evidence[0].remainder) throw new Error('Missing remainder evidence');
  const rates = evidence[0].remainder;
  const lengthMeters = decimal(intent.lengthMeters!), widthMeters = decimal(intent.widthMeters!);
  const productRowId = parseStableIdentity('product-row', intent.productRowId);
  const sourceProductRowId = parseStableIdentity('product-row', intent.sourceProductRowId);
  const quantity = intent.quantity!;
  return { row: { productRowId, catalogProductId: intent.catalogItemId, catalogSnapshotVersion: intent.catalogSnapshotVersion,
    productType: 'longitudinal', contractualTitle: products[0].name, sourceProductRowId, parentProductRowId: sourceProductRowId,
    commercial: {} },
    productPolicyInput: { calculationPolicyVersion: context.policy.calculation, packingPolicyVersion: context.policy.packing,
      pricingPolicyVersion: context.policy.pricing, roundingPolicyVersion: context.policy.rounding,
      sourceBatchId: stock.sourceBatchId, motherWidthMeters: stock.widthMeters, lengthMeters, widthMeters, quantity,
      lastManualField: 'quantity', lastManualDimension: 'length', lengthDisplayUnit: intent.lengthDisplayUnit, widthDisplayUnit: intent.widthDisplayUnit,
      baseMaterialPricing: 'paid-source-zero', baseRateToman: decimal('0'), mandatoryEnabled: false,
      mandatoryPercentage: rates.mandatoryPercentage, rememberedMandatoryPercentage: rates.rememberedMandatoryPercentage,
      sawKerfEnabled: intent.sawKerfEnabled, sawKerfMeters: decimal(context.catalog.sawKerfMeters),
      calibrationEnabled: intent.calibrationEnabled, calibrationSelection: 'manual',
      longitudinalCutRateToman: rates.longitudinalCutRateToman, calibrationCutRateToman: rates.calibrationCutRateToman },
    remainderChildPolicyInput: { ...rates, allocationId: parseStableIdentity('allocation', intent.allocationId),
      allocationOrder: intent.creationOrder, sourceProductRowId, selectedRemainingStoneId: intent.selectedRemainingStoneId === undefined
        ? undefined : parseStableIdentity('remaining-stone', intent.selectedRemainingStoneId),
      lengthMeters, widthMeters, quantity, kerfMeters: decimal(intent.sawKerfEnabled ? context.catalog.sawKerfMeters : '0'),
      calibrationEnabled: intent.calibrationEnabled, sourcePieceQuantities: intent.sourcePieceQuantities,
      secondaryOwnerProductRowId: intent.secondaryOwnerProductRowId === undefined ? undefined : parseStableIdentity('product-row', intent.secondaryOwnerProductRowId) },
    ...(intent.operations ? { operationPolicyInput: technicalGraphOperations(intent.operations, { productRowId, lengthMeters, widthMeters, quantity }, context) } : {}),
  };
}
