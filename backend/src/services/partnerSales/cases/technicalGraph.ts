import {
  calculatePricing, executeProductGraphCommand, parseCanonicalDecimal, parseStableIdentity,
  type CalculationPolicySnapshot, type CanonicalProductGraph, type CatalogSnapshot, type AddRowSellerIntent,
  type LongitudinalProductInput, type SlabPolicyInput, type StairPartPolicyInput, type ProductGraphCommand,
  longitudinalOperationsQuantity, resolveStaircaseQuantity,
  type RemainderChildPolicyInput, type StairLayerConfigurationInput, compareProductDependentOrder,
} from '@sabalanerp/contract-product-graph';
import { Prisma } from '@prisma/client';
import {
  PartnerTechnicalDraftSchema, previewPartnerTechnicalDraft, partnerError,
  type PartnerTechnicalPreview, type PartnerTechnicalPreviewCatalog, type PartnerTechnicalProduct, type Result,
} from '@sabalanerp/partner-sales-contracts';
import { technicalGraphOperations } from './technicalGraphOperations';
import { technicalGraphRemainder } from './technicalGraphRemainder';
import { technicalGraphLayer } from './technicalGraphLayers';
import { technicalGraphMeasures, type TechnicalGraphMeasure } from './technicalGraphMeasures';

/** Owner-resolved frozen calculation evidence, not approved wholesale prices.
 * Never accept this context from a Partner/browser or return it in safe views. */
export interface PartnerTechnicalGraphContext {
  catalog: PartnerTechnicalPreviewCatalog;
  policy: CalculationPolicySnapshot;
  products: readonly {
    catalogItemId: string; catalogSnapshotVersion: string;
    layerMaterialRateToman?: string;
    preparedRates?: readonly { kind: 'cubic' | 'readyPiece'; unit: 'squareMeter' | 'ton' | 'count'; rateToman: string }[];
    longitudinal?: Pick<LongitudinalProductInput, 'baseRateToman' | 'mandatoryEnabled' | 'mandatoryPercentage' |
      'rememberedMandatoryPercentage' | 'longitudinalCutRateToman' | 'calibrationCutRateToman'>;
    slab?: Pick<SlabPolicyInput, 'baseMaterialRateToman' | 'cuttingPricingMethod' | 'longitudinalCutRateToman' |
      'crossCutRateToman' | 'squareMeterCutRateToman' | 'verticalCutRateToman'>;
    stair?: Pick<StairPartPolicyInput, 'baseRateToman' | 'mandatoryEnabled' | 'mandatoryPercentage' |
      'rememberedMandatoryPercentage' | 'longitudinalCutRateToman' | 'crossCutRateToman' | 'calibrationCutRateToman'>;
    remainder?: Pick<RemainderChildPolicyInput, 'longitudinalCutRateToman' | 'crossCutRateToman' | 'calibrationCutRateToman'> &
      Pick<LongitudinalProductInput, 'mandatoryPercentage' | 'rememberedMandatoryPercentage'>;
  }[];
  operations?: readonly { kind: 'TOOL' | 'FINISHING'; catalogItemId: string; catalogSnapshotVersion: string; rateToman: string }[];
  layers?: readonly ({ catalogItemId: string; catalogSnapshotVersion: string } &
    Pick<StairLayerConfigurationInput, 'layerRateToman' | 'longitudinalCutRateToman' | 'crossCutRateToman' | 'calibrationCutRateToman'>)[];
}

function technicalProductSnapshot(product: PartnerTechnicalProduct): CatalogSnapshot {
  const meters = (centimeters: string | undefined) => centimeters === undefined ? undefined :
    parseCanonicalDecimal(new Prisma.Decimal(centimeters).div(100).toFixed());
  return { catalogProductId: product.catalogItemId, snapshotVersion: product.catalogSnapshotVersion,
    facts: { attributes: product.attributes, motherWidthMeters: meters(product.dimensions.motherWidthCentimeters),
      thicknessMeters: meters(product.dimensions.thicknessCentimeters),
      ...(product.dimensions.motherLengthMeters === undefined ? {} : { motherLengthMeters: parseCanonicalDecimal(product.dimensions.motherLengthMeters) }) } };
}

/** Pure server-side compiler. No persistence, inquiry refs or approval authority.
 * All rows must validate; incomplete editing remains checkpoint-only. */
export function compilePartnerTechnicalGraph(input: unknown, context: PartnerTechnicalGraphContext): Result<{
  graph: CanonicalProductGraph; preview: PartnerTechnicalPreview; measures: TechnicalGraphMeasure[];
}> {
  const parsed = PartnerTechnicalDraftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: partnerError('INVALID_PAYLOAD') };
  const draft = parsed.data;
  const preview = previewPartnerTechnicalDraft(draft, context.catalog);
  if (!preview.ok) return preview;
  if (draft.rows.length === 0 || preview.value.conflicts.length ||
      preview.value.rows.some(row => !row.calculation.ok || (row.operations && !row.operations.ok)) ||
      preview.value.dependents.some(item => !item.calculation.ok || ('operations' in item && item.operations && !item.operations.ok))) {
    return { ok: false, error: partnerError('INVALID_PAYLOAD') };
  }
  let graph: CanonicalProductGraph = { schemaVersion: 1, revision: 0, calculationPolicy: context.policy,
    catalogSnapshots: [], rows: [], stairSystems: [], layerConfigurations: [], sourceBatches: [],
    remainingStones: [], allocations: [], operationGroups: [], toolSelections: [], finishingSelections: [] };
  try {
    const rowIntents = new Map<string, { intent: AddRowSellerIntent; snapshot: CatalogSnapshot }>();
    const decimal = (value: string | undefined) => value === undefined ? undefined : parseCanonicalDecimal(value);
    const versions = { calculationPolicyVersion: context.policy.calculation, packingPolicyVersion: context.policy.packing,
      pricingPolicyVersion: context.policy.pricing, roundingPolicyVersion: context.policy.rounding };
    for (const row of draft.rows) {
      const products = context.catalog.products.filter(item => item.catalogItemId === row.catalogItemId && item.catalogSnapshotVersion === row.catalogSnapshotVersion);
      const evidence = context.products.filter(item => item.catalogItemId === row.catalogItemId && item.catalogSnapshotVersion === row.catalogSnapshotVersion);
      if (products.length !== 1 || evidence.length !== 1) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      const snapshot = technicalProductSnapshot(products[0]);
      let intent: AddRowSellerIntent = { row: {
        productRowId: parseStableIdentity('product-row', row.productRowId), catalogProductId: row.catalogItemId,
        catalogSnapshotVersion: row.catalogSnapshotVersion, productType: row.family, contractualTitle: products[0].name,
        commercial: {},
      } };
      if (row.family === 'prepared' || row.family === 'volumetric') {
        const rates = evidence[0].preparedRates?.filter(rate => rate.kind === row.configuration.kind && rate.unit === row.configuration.unit) ?? [];
        if (rates.length !== 1) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
        const quantity = parseCanonicalDecimal(row.configuration.quantity!);
        const rateToman = parseCanonicalDecimal(rates[0].rateToman);
        const pricing = calculatePricing({ policyVersion: context.policy.pricing, roundingPolicyVersion: context.policy.rounding,
          lines: [{ lineId: row.productRowId, quantity, rateToman }] });
        intent = { row: { ...intent.row, commercial: { requestedQuantity: quantity, baseRateToman: rateToman,
          baseAmountToman: pricing.totalAmountToman, totalAmountToman: pricing.totalAmountToman,
          calculationSnapshot: { kind: row.configuration.kind, unit: row.configuration.unit, quantity,
            squareMeters: row.configuration.unit === 'squareMeter' ? quantity : '0',
            pricingPolicyVersion: context.policy.pricing, roundingPolicyVersion: context.policy.rounding,
            inputHash: pricing.inputHash, resultHash: pricing.resultHash } },
        } };
      } else if (row.family === 'longitudinal') {
        const pricing = evidence[0].longitudinal;
        if (!pricing || !snapshot.facts.motherWidthMeters) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
        intent = { ...intent, productPolicyInput: { ...pricing, ...row.configuration,
          ...versions,
          sourceBatchId: parseStableIdentity('source-batch', row.configuration.sourceBatchId),
          motherWidthMeters: snapshot.facts.motherWidthMeters, sawKerfMeters: parseCanonicalDecimal(context.catalog.sawKerfMeters),
          lengthMeters: decimal(row.configuration.lengthMeters), widthMeters: decimal(row.configuration.widthMeters),
          requestedAreaSquareMeters: decimal(row.configuration.requestedAreaSquareMeters),
        } };
      } else if (row.family === 'slab') {
        const pricing = evidence[0].slab;
        if (!pricing) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
        const { sawKerfEnabled, ...configuration } = row.configuration;
        intent = { ...intent, slabPolicyInput: { ...pricing, ...configuration, ...versions,
          sourceBatchId: parseStableIdentity('source-batch', configuration.sourceBatchId),
          lengthMeters: decimal(configuration.lengthMeters), widthMeters: decimal(configuration.widthMeters),
          areaSquareMeters: decimal(configuration.areaSquareMeters),
          kerfMeters: parseCanonicalDecimal(sawKerfEnabled ? context.catalog.sawKerfMeters : '0'),
          sourceRows: configuration.sourceRows.map(source => ({ ...source,
            sourceRowId: parseStableIdentity('slab-source-row', source.sourceRowId),
            lengthMeters: parseCanonicalDecimal(source.lengthMeters!), widthMeters: parseCanonicalDecimal(source.widthMeters!),
            quantity: source.quantity!,
          })),
        } };
      } else if (row.family === 'stair') {
        const pricing = evidence[0].stair;
        if (!pricing) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
        const system = draft.stairSystems?.find(system => system.stairSystemId === row.configuration.stairSystemId);
        if (!system) return { ok: false, error: partnerError('INVALID_PAYLOAD') };
        const { quantityMode, ...configuration } = row.configuration;
        intent = { ...intent, stairPartPolicyInput: { ...pricing, ...configuration, ...versions,
          stairSystemId: parseStableIdentity('stair-system', configuration.stairSystemId),
          sourceBatchId: parseStableIdentity('source-batch', configuration.sourceBatchId),
          motherWidthMeters: snapshot.facts.motherWidthMeters, motherLengthMeters: decimal(configuration.motherLengthMeters),
          lengthMeters: decimal(configuration.lengthMeters), crossDimensionMeters: decimal(configuration.crossDimensionMeters),
          quantity: quantityMode === 'system' ? resolveStaircaseQuantity(system.quantity).totalSteps : configuration.quantity,
          sawKerfMeters: parseCanonicalDecimal(context.catalog.sawKerfMeters),
        } };
      } else return { ok: false, error: partnerError('INVALID_PAYLOAD') };
      if ('operations' in row && row.operations) {
        const technical = preview.value.rows.find(value => value.productRowId === row.productRowId)?.calculation;
        if (!technical?.ok || !('lengthMeters' in technical.result)) return { ok: false, error: partnerError('INVALID_PAYLOAD') };
        const facts = technical.result;
        intent = { ...intent, operationPolicyInput: technicalGraphOperations(row.operations, {
          productRowId: intent.row.productRowId, lengthMeters: facts.lengthMeters,
          widthMeters: 'widthMeters' in facts ? facts.widthMeters : facts.crossDimensionMeters,
          quantity: 'quantityMode' in facts ? longitudinalOperationsQuantity(facts) : facts.quantity,
        }, context) };
      }
      let command: ProductGraphCommand = {
        commandId: parseStableIdentity('audit-mutation', `technical:${row.productRowId}`), type: 'add-row', baseRevision: graph.revision,
        calculationPolicy: context.policy, catalogSnapshots: [snapshot], sellerIntent: intent,
      };
      if (row.family === 'stair' && !graph.stairSystems.some(system => system.stairSystemId === row.configuration.stairSystemId)) {
        const system = draft.stairSystems!.find(system => system.stairSystemId === row.configuration.stairSystemId)!;
        command = { ...command, type: 'add-stair-system', sellerIntent: {
          stairSystemId: parseStableIdentity('stair-system', system.stairSystemId), quantity: system.quantity, parts: [intent],
        } };
      }
      const applied = executeProductGraphCommand({ graph, command });
      if (!applied.ok) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      graph = applied.graph;
      rowIntents.set(row.productRowId, { intent, snapshot });
    }
    if ((draft.stairSystems?.length ?? 0) !== graph.stairSystems.length) return { ok: false, error: partnerError('INVALID_PAYLOAD') };
    const dependents = (draft.dependents ?? []).map(intent => ({ intent, kind: intent.kind, order: intent.creationOrder,
      identity: intent.kind === 'layer' ? intent.layerConfigurationId : intent.allocationId })).sort(compareProductDependentOrder);
    for (const { intent } of dependents) {
      if (intent.kind === 'layer') {
        const parent = rowIntents.get(intent.parentProductRowId);
        const technical = preview.value.dependents.find(item => item.kind === 'layer' && item.layerConfigurationId === intent.layerConfigurationId)!;
        if (!parent) return { ok: false, error: partnerError('INVALID_PAYLOAD') };
        const layer = technicalGraphLayer(intent, technical, context);
        const snapshots = [parent.snapshot];
        if (layer.source.kind === 'new-material') {
          const source = layer.source;
          const matches = context.catalog.products.filter(item => item.catalogItemId === source.catalogProductId && item.catalogSnapshotVersion === source.catalogSnapshotVersion);
          if (matches.length !== 1) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
          if (!snapshots.some(item => item.catalogProductId === source.catalogProductId && item.snapshotVersion === source.catalogSnapshotVersion)) {
            snapshots.push(technicalProductSnapshot(matches[0]));
          }
        }
        const applied = executeProductGraphCommand({ graph, command: {
          commandId: parseStableIdentity('audit-mutation', `technical:${intent.layerConfigurationId}`), type: 'replace-row', baseRevision: graph.revision,
          calculationPolicy: context.policy, catalogSnapshots: snapshots, sellerIntent: { ...parent.intent,
            layerConfigurationInputs: [...graph.layerConfigurations.filter(item => item.parentProductRowId === intent.parentProductRowId).map(item => item.input), layer] },
        } });
        if (!applied.ok) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
        graph = applied.graph;
        continue;
      }
      const technical = preview.value.dependents.find(item => item.kind === 'remainder' && item.allocationId === intent.allocationId)!;
      const sellerIntent = technicalGraphRemainder(intent, technical, graph, context);
      const snapshot = graph.catalogSnapshots.find(item => item.catalogProductId === intent.catalogItemId && item.snapshotVersion === intent.catalogSnapshotVersion);
      if (!snapshot) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      const applied = executeProductGraphCommand({ graph, command: {
        commandId: parseStableIdentity('audit-mutation', `technical:${intent.allocationId}`), type: 'add-row', baseRevision: graph.revision,
        calculationPolicy: context.policy, catalogSnapshots: [snapshot], sellerIntent,
      } });
      if (!applied.ok) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      graph = applied.graph;
    }
  } catch { return { ok: false, error: partnerError('INTEGRITY_CONFLICT') }; }
  try { return { ok: true, value: { graph, preview: preview.value, measures: technicalGraphMeasures(graph) } }; }
  catch { return { ok: false, error: partnerError('INTEGRITY_CONFLICT') }; }
}
