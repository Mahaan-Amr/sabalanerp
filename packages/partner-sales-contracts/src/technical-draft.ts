import { z } from 'zod';
import {
  calculatePreparedTechnical, calculateLongitudinalTechnical, calculateSlabTechnical, calculateStairPartTechnical,
  parseCanonicalDecimal, parseStableIdentity, longitudinalOperationsQuantity,
  type PreparedTechnicalCalculation, type LongitudinalTechnicalCalculation, type SlabTechnicalCalculation,
  type StairPartTechnicalCalculation, materializePaidRemainderStocks, type PaidRemainderStock,
} from '@sabalanerp/contract-product-graph';
import { IdSchema, InstantSchema } from './primitives';
import { PartnerTechnicalProductSchema, PartnerTechnicalOperationSchema,
  type PartnerTechnicalProduct, type PartnerTechnicalOperation } from './technical-catalog';
import { partnerError, type Result } from './errors';
import { technicalDecimal as decimal, centimetersToMeters, optionalCanonicalDecimal } from './technical-values';
import { PartnerTechnicalOperationsIntentSchema, previewTechnicalOperations, type PartnerTechnicalOperationsPreview } from './technical-operations';
import { PartnerTechnicalDependentSchema, previewTechnicalDependents, type PartnerTechnicalDependentPreview } from './technical-dependents';
import { inspectTechnicalIdentities, collectGeneratedTechnicalIdentities, type TechnicalDraftConflict, type TechnicalIdentityFailure } from './technical-identities';
import type { TechnicalLayerParent } from './technical-layers';
import { PartnerTechnicalStairSystemSchema, previewTechnicalStairSystems, type TechnicalStairSystemConflict } from './technical-stair-systems';

const rowIdentity = { productRowId: IdSchema, catalogItemId: IdSchema, catalogSnapshotVersion: InstantSchema };
const preparedConfiguration = z.object({
  kind: z.enum(['cubic', 'readyPiece']), unit: z.enum(['squareMeter', 'ton', 'count']), quantity: decimal.optional(),
}).strict();
const lengthUnit = z.enum(['cm', 'm']);
const calibration = { sawKerfEnabled: z.boolean(), calibrationEnabled: z.boolean(), calibrationSelection: z.enum(['automatic', 'manual']) };
const longitudinalConfiguration = z.object({
  sourceBatchId: IdSchema, lengthMeters: decimal.optional(), widthMeters: decimal.optional(),
  requestedAreaSquareMeters: decimal.optional(), quantity: z.number().int().safe().optional(),
  lastManualField: z.enum(['length', 'width', 'area', 'quantity']), lastManualDimension: z.enum(['length', 'width']),
  lengthDisplayUnit: lengthUnit, widthDisplayUnit: lengthUnit, ...calibration,
}).strict();
const slabConfiguration = z.object({
  sourceBatchId: IdSchema, lengthMeters: decimal.optional(), widthMeters: decimal.optional(),
  areaSquareMeters: decimal.optional(), quantity: z.number().int().safe().optional(),
  lastManualField: z.enum(['length', 'width', 'area']).optional(), lastManualDimension: z.enum(['length', 'width']).optional(),
  lengthDisplayUnit: lengthUnit, widthDisplayUnit: lengthUnit, sawKerfEnabled: z.boolean(),
  sourceRows: z.array(z.object({ sourceRowId: IdSchema,
    lengthMeters: decimal.optional(), widthMeters: decimal.optional(), quantity: z.number().int().safe().optional(),
    lengthDisplayUnit: lengthUnit, widthDisplayUnit: lengthUnit,
  }).strict()),
  verticalCutSides: z.array(z.enum(['top', 'bottom', 'left', 'right'])),
}).strict();
const stairConfiguration = z.object({
  stairSystemId: IdSchema, part: z.enum(['tread', 'riser', 'landing']), sourceBatchId: IdSchema,
  lengthMeters: decimal.optional(), crossDimensionMeters: decimal.optional(), quantity: z.number().int().safe().optional(),
  motherLengthMeters: decimal.optional(), motherLengthDisplayUnit: lengthUnit.optional(),
  quantityMode: z.enum(['system', 'manual']).optional(),
  lengthDisplayUnit: lengthUnit, crossDimensionDisplayUnit: lengthUnit, ...calibration,
}).strict();
export const PartnerTechnicalDraftSchema = z.object({
  schemaVersion: z.literal(1), inputRevision: z.number().int().nonnegative().safe(),
  rows: z.array(z.discriminatedUnion('family', [
    z.object({ ...rowIdentity, family: z.literal('prepared'), configuration: preparedConfiguration }).strict(),
    z.object({ ...rowIdentity, family: z.literal('volumetric'), configuration: preparedConfiguration }).strict(),
    z.object({ ...rowIdentity, family: z.literal('longitudinal'), configuration: longitudinalConfiguration, operations: PartnerTechnicalOperationsIntentSchema.optional() }).strict(),
    z.object({ ...rowIdentity, family: z.literal('slab'), configuration: slabConfiguration, operations: PartnerTechnicalOperationsIntentSchema.optional() }).strict(),
    z.object({ ...rowIdentity, family: z.literal('stair'), configuration: stairConfiguration, operations: PartnerTechnicalOperationsIntentSchema.optional() }).strict(),
  ])),
  dependents: z.array(PartnerTechnicalDependentSchema).optional(),
  stairSystems: z.array(PartnerTechnicalStairSystemSchema).optional(),
  // A control retains text until its normal unit-aware parsing commits a new
  // canonical value. Presence always blocks validated save, even if the text
  // happens to look numeric; it must never fall back silently to old geometry.
  editingValues: z.array(z.object({ entityId: IdSchema,
    field: z.enum(['lengthMeters', 'widthMeters', 'crossDimensionMeters', 'motherLengthMeters',
      'areaSquareMeters', 'requestedAreaSquareMeters', 'quantity', 'layersPerParentPiece',
      'scope', 'quantityOverride.value', 'totalSteps', 'numberOfStaircases', 'stepsPerStaircase']),
    text: z.string().max(80),
  }).strict()).optional(),
}).strict();
export type PartnerTechnicalDraft = z.infer<typeof PartnerTechnicalDraftSchema>;

export interface PartnerTechnicalPreviewCatalog {
  products: PartnerTechnicalProduct[]; operations: PartnerTechnicalOperation[]; sawKerfMeters: string;
}
export const PartnerTechnicalPreviewCatalogSchema: z.ZodType<PartnerTechnicalPreviewCatalog, z.ZodTypeDef, unknown> = z.object({
  products: z.array(PartnerTechnicalProductSchema), operations: z.array(PartnerTechnicalOperationSchema),
  sawKerfMeters: decimal,
}).strict();
type CatalogFailure = { ok: false; inputRevision: number; conflicts: readonly {
  code: 'catalog-unavailable'; field: 'catalogItemId'; message: string;
}[] };
export interface PartnerTechnicalPreview {
  schemaVersion: 1;
  inputRevision: number;
  conflicts: readonly (TechnicalDraftConflict | TechnicalStairSystemConflict | { code: 'editing-value-pending'; field: string; entityId: string; message: string })[];
  dependents: readonly PartnerTechnicalDependentPreview[];
  inventory: readonly PaidRemainderStock[];
  rows: readonly ((
    | { productRowId: string; family: 'prepared' | 'volumetric'; calculation: PreparedTechnicalCalculation }
    | { productRowId: string; family: 'longitudinal'; calculation: LongitudinalTechnicalCalculation }
    | { productRowId: string; family: 'slab'; calculation: SlabTechnicalCalculation }
    | { productRowId: string; family: 'stair'; calculation: StairPartTechnicalCalculation }
    | { productRowId: string; family: PartnerTechnicalDraft['rows'][number]['family']; calculation: CatalogFailure | TechnicalIdentityFailure }
  ) & { operations?: PartnerTechnicalOperationsPreview })[];
}

/** Pure canonical preview: no persistence, price inputs or inquiry-ready refs.
 * The catalog contains server-projected technical snapshots, including retained
 * historical snapshots when editing; a live catalog refresh is not repricing.
 */
export function previewPartnerTechnicalDraft(input: unknown, catalogInput: unknown): Result<PartnerTechnicalPreview> {
  const parsed = PartnerTechnicalDraftSchema.safeParse(input);
  const catalog = PartnerTechnicalPreviewCatalogSchema.safeParse(catalogInput);
  if (!parsed.success || !catalog.success) return { ok: false, error: partnerError('INVALID_PAYLOAD') };
  const draft = parsed.data;
  let identities = inspectTechnicalIdentities(draft);
  const generated = new Map<string, ReturnType<typeof collectGeneratedTechnicalIdentities>[number]>();
  // Blocking an ambiguous allocation can free stock for a later sibling. Audit
  // those newly usable facts too. Owners only become blocked, so this loop is
  // bounded by the number of draft entities; valid previews calculate once.
  while (true) {
    const preview = calculateTechnicalDraft(draft, catalog.data, identities);
    for (const owner of collectGeneratedTechnicalIdentities(draft, preview)) {
      generated.set(JSON.stringify(owner), owner);
    }
    const audited = inspectTechnicalIdentities(draft, [...generated.values()]);
    if (audited.rows.size === identities.rows.size && audited.dependents.size === identities.dependents.size) {
      return { ok: true, value: { ...preview, conflicts: [
        ...audited.conflicts, ...preview.conflicts.filter(conflict => conflict.code !== 'duplicate-identity'),
      ] } };
    }
    identities = audited;
  }
}

function calculateTechnicalDraft(draft: PartnerTechnicalDraft, catalog: PartnerTechnicalPreviewCatalog,
  identities: ReturnType<typeof inspectTechnicalIdentities>): PartnerTechnicalPreview {
  const stairSystems = previewTechnicalStairSystems(draft.stairSystems ?? []);
  const rows: PartnerTechnicalPreview['rows'] = draft.rows.map((row, index) => {
    const conflicts = identities.rows.get(index);
    if (conflicts) return { productRowId: row.productRowId, family: row.family,
      calculation: { ok: false, inputRevision: draft.inputRevision, conflicts } };
    const product = catalog.products.find(item => item.catalogItemId === row.catalogItemId &&
      item.catalogSnapshotVersion === row.catalogSnapshotVersion && item.families.includes(row.family));
    if (!product) return { productRowId: row.productRowId, family: row.family,
      calculation: { ok: false, inputRevision: draft.inputRevision,
        conflicts: [{ code: 'catalog-unavailable', field: 'catalogItemId', message: 'مشخصات فنی محصول در دسترس نیست.' }] } };
    if (row.family === 'longitudinal') return { productRowId: row.productRowId, family: row.family,
      calculation: calculateLongitudinalTechnical({ ...row.configuration, inputRevision: draft.inputRevision,
        sourceBatchId: parseStableIdentity('source-batch', row.configuration.sourceBatchId),
        lengthMeters: optionalCanonicalDecimal(row.configuration.lengthMeters),
        widthMeters: optionalCanonicalDecimal(row.configuration.widthMeters),
        requestedAreaSquareMeters: optionalCanonicalDecimal(row.configuration.requestedAreaSquareMeters),
        motherWidthMeters: centimetersToMeters(product.dimensions.motherWidthCentimeters),
        sawKerfMeters: parseCanonicalDecimal(catalog.sawKerfMeters),
      }) };
    if (row.family === 'stair') {
      const { quantityMode, ...geometry } = row.configuration;
      const quantity = quantityMode === 'system' ? stairSystems.quantities.get(geometry.stairSystemId) : geometry.quantity;
      if (quantityMode === 'system' && (quantity === undefined || geometry.part === 'landing')) return {
        productRowId: row.productRowId, family: row.family, calculation: { ok: false, inputRevision: draft.inputRevision,
          conflicts: [{ code: 'stair-quantity-required', field: 'quantity', message: 'تعداد معتبر و مستقل این بخش پله لازم است.' }] },
      };
      return { productRowId: row.productRowId, family: row.family,
      calculation: calculateStairPartTechnical({ ...geometry, quantity, inputRevision: draft.inputRevision,
        stairSystemId: parseStableIdentity('stair-system', row.configuration.stairSystemId),
        sourceBatchId: parseStableIdentity('source-batch', row.configuration.sourceBatchId),
        lengthMeters: optionalCanonicalDecimal(row.configuration.lengthMeters),
        crossDimensionMeters: optionalCanonicalDecimal(row.configuration.crossDimensionMeters),
        motherLengthMeters: optionalCanonicalDecimal(row.configuration.motherLengthMeters),
        motherWidthMeters: centimetersToMeters(product.dimensions.motherWidthCentimeters),
        sawKerfMeters: parseCanonicalDecimal(catalog.sawKerfMeters),
      }) };
    }
    if (row.family === 'slab') {
      const config = row.configuration;
      const incomplete = config.sourceRows.find(source => source.lengthMeters === undefined ||
        source.widthMeters === undefined || source.quantity === undefined);
      if (incomplete) return { productRowId: row.productRowId, family: row.family,
        calculation: { ok: false, inputRevision: draft.inputRevision, conflicts: [{
          code: 'slab-geometry-incomplete', field: 'sourceRows', entityId: incomplete.sourceRowId,
          message: 'ابعاد و تعداد سنگ مادر را کامل کنید.',
        }] } };
      const { sawKerfEnabled, ...geometry } = config;
      return { productRowId: row.productRowId, family: row.family,
        calculation: calculateSlabTechnical({ ...geometry, inputRevision: draft.inputRevision,
          sourceBatchId: parseStableIdentity('source-batch', config.sourceBatchId),
          lengthMeters: optionalCanonicalDecimal(config.lengthMeters), widthMeters: optionalCanonicalDecimal(config.widthMeters),
          areaSquareMeters: optionalCanonicalDecimal(config.areaSquareMeters),
          kerfMeters: parseCanonicalDecimal(sawKerfEnabled ? catalog.sawKerfMeters : '0'),
          sourceRows: config.sourceRows.map(source => ({ ...source,
            sourceRowId: parseStableIdentity('slab-source-row', source.sourceRowId),
            lengthMeters: parseCanonicalDecimal(source.lengthMeters!), widthMeters: parseCanonicalDecimal(source.widthMeters!), quantity: source.quantity!,
          })),
        }) };
    }
    return { productRowId: row.productRowId, family: row.family,
      calculation: calculatePreparedTechnical({ ...row.configuration, inputRevision: draft.inputRevision,
        quantity: optionalCanonicalDecimal(row.configuration.quantity),
        productRowId: parseStableIdentity('product-row', row.productRowId), family: row.family }) };
  });
  const withOperations = rows.map((row, index) => {
    const intent = draft.rows[index];
    if (!('operations' in intent) || !intent.operations || !row.calculation.ok) return row;
    const facts = row.calculation.result;
    if (!('lengthMeters' in facts)) return row;
    return { ...row, operations: previewTechnicalOperations(intent.operations, {
      productRowId: row.productRowId, inputRevision: draft.inputRevision, lengthMeters: facts.lengthMeters,
      widthMeters: 'widthMeters' in facts ? facts.widthMeters : facts.crossDimensionMeters,
      quantity: 'quantityMode' in facts ? longitudinalOperationsQuantity(facts) : facts.quantity,
    }, catalog.operations) };
  });
  const baseInventory = rows.flatMap((row, index) => {
    const intent = draft.rows[index];
    if (!row.calculation.ok || !('packingPlan' in row.calculation.result) || !('sourceBatchId' in intent.configuration)) return [];
    return materializePaidRemainderStocks({ ownerProductRowId: parseStableIdentity('product-row', row.productRowId),
      catalogProductId: intent.catalogItemId, sourceBatchId: parseStableIdentity('source-batch', intent.configuration.sourceBatchId),
      remainders: row.calculation.result.packingPlan.remainders });
  });
  const parents = new Map<string, TechnicalLayerParent>();
  rows.forEach((row, index) => { if (row.family === 'stair' && row.calculation.ok) {
    const { lengthMeters, crossDimensionMeters, quantity } = row.calculation.result;
    parents.set(row.productRowId, { geometry: { lengthMeters, crossDimensionMeters, quantity },
      catalogItemId: draft.rows[index].catalogItemId, catalogSnapshotVersion: draft.rows[index].catalogSnapshotVersion });
  } });
  const dependencies = previewTechnicalDependents(draft.inputRevision, draft.dependents ?? [], baseInventory, catalog, parents, identities.dependents);
  const pending = (draft.editingValues ?? []).map(value => ({ code: 'editing-value-pending' as const,
    field: value.field, entityId: value.entityId, message: 'ورودی در حال ویرایش را کامل کنید.' }));
  return { schemaVersion: 1, inputRevision: draft.inputRevision,
    conflicts: [...identities.conflicts, ...stairSystems.conflicts, ...pending], rows: withOperations, ...dependencies };
}
