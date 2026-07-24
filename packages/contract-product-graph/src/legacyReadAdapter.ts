import {
  normalizeLegacyJson,
  type CanonicalJsonObject
} from './canonicalJson';
import type {
  CalculationPolicySnapshot,
  CanonicalProductGraph,
  CanonicalProductRow,
  CanonicalProductType,
  CatalogSnapshot
} from './productGraph';
import { parseStableIdentity } from './stableIdentity';
import { parseCanonicalProductGraph } from './productGraphSerialization';

export interface LegacyProductGraphInput {
  readonly contractId: string;
  readonly revision: number;
  readonly calculationPolicy: CalculationPolicySnapshot;
  readonly products: readonly Readonly<Record<string, unknown>>[];
}

export interface LegacyProductGraphConflict {
  readonly code:
    | 'legacy-catalog-product-id-missing'
    | 'legacy-canonical-input-invalid'
    | 'legacy-product-reference-invalid'
    | 'legacy-product-reference-missing'
    | 'legacy-product-row-id-conflict'
    | 'legacy-product-row-id-duplicate'
    | 'legacy-product-row-id-missing'
    | 'legacy-product-type-invalid';
  readonly path: readonly string[];
  readonly message: string;
}

export type LegacyProductGraphRead =
  | {
      readonly ok: true;
      readonly source: 'legacy-read';
      readonly migrationRequired: true;
      readonly graph: CanonicalProductGraph;
      readonly conflicts: readonly [];
    }
  | {
      readonly ok: false;
      readonly source: 'legacy-read';
      readonly contractId: string;
      readonly revision: number;
      readonly migrationRequired: true;
      readonly legacyView: readonly Readonly<Record<string, unknown>>[];
      readonly conflicts: readonly LegacyProductGraphConflict[];
    };

const PRODUCT_TYPES = new Set<CanonicalProductType>([
  'longitudinal',
  'stair',
  'slab',
  'prepared',
  'volumetric'
]);

const cloneLegacyValue = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map(item => cloneLegacyValue(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneLegacyValue(item)])
    ) as T;
  }
  return value;
};

const resolveLegacyProductRowId = (
  product: Readonly<Record<string, unknown>>,
  index: number
): { value?: string; conflict?: LegacyProductGraphConflict } => {
  const canonical = typeof product.productRowId === 'string' ? product.productRowId.trim() : '';
  const compatibility = typeof product.rowId === 'string' ? product.rowId.trim() : '';

  if (canonical && compatibility && canonical !== compatibility) {
    return {
      conflict: {
        code: 'legacy-product-row-id-conflict',
        path: ['products', String(index), 'productRowId'],
        message: 'Legacy contract product has contradictory stable row identities.'
      }
    };
  }
  const value = canonical || compatibility;
  if (!value) {
    return {
      conflict: {
        code: 'legacy-product-row-id-missing',
        path: ['products', String(index), 'productRowId'],
        message: 'Legacy contract product has no stable product row identity.'
      }
    };
  }
  return { value };
};

const resolveLegacyProductType = (
  product: Readonly<Record<string, unknown>>,
  index: number
): { value?: CanonicalProductType; conflict?: LegacyProductGraphConflict } => {
  const value = product.productType;
  if (typeof value !== 'string' || !PRODUCT_TYPES.has(value as CanonicalProductType)) {
    return {
      conflict: {
        code: 'legacy-product-type-invalid',
        path: ['products', String(index), 'productType'],
        message: 'Legacy contract product has no recognized product type.'
      }
    };
  }
  return { value: value as CanonicalProductType };
};

const resolveLegacyCatalogProductId = (
  product: Readonly<Record<string, unknown>>,
  index: number
): { value?: string; conflict?: LegacyProductGraphConflict } => {
  const value = typeof product.productId === 'string' ? product.productId.trim() : '';
  if (!value) {
    return {
      conflict: {
        code: 'legacy-catalog-product-id-missing',
        path: ['products', String(index), 'productId'],
        message: 'Legacy contract product has no unambiguous catalog product identity.'
      }
    };
  }
  return { value };
};

const resolveLegacyProductReference = (
  product: Readonly<Record<string, unknown>>,
  key: 'parentProductRowId' | 'sourceProductRowId',
  index: number
): { value?: string; conflict?: LegacyProductGraphConflict } => {
  if (product[key] === undefined || product[key] === null) return {};
  const value = typeof product[key] === 'string' ? product[key].trim() : '';
  if (!value) {
    return {
      conflict: {
        code: 'legacy-product-reference-invalid',
        path: ['products', String(index), key],
        message: `Legacy contract product has an invalid explicit ${key}.`
      }
    };
  }
  return { value };
};

export const readLegacyProductGraph = ({
  contractId,
  revision,
  calculationPolicy,
  products
}: LegacyProductGraphInput): LegacyProductGraphRead => {
  const legacyView = products.map(product => cloneLegacyValue(product));
  const conflicts: LegacyProductGraphConflict[] = [];
  const rows: CanonicalProductRow[] = [];
  const rowLegacyIndexes: number[] = [];
  const catalogSnapshots: CatalogSnapshot[] = [];

  legacyView.forEach((product, index) => {
    const identity = resolveLegacyProductRowId(product, index);
    const productType = resolveLegacyProductType(product, index);
    const catalogIdentity = resolveLegacyCatalogProductId(product, index);
    const parentReference = resolveLegacyProductReference(product, 'parentProductRowId', index);
    const sourceReference = resolveLegacyProductReference(product, 'sourceProductRowId', index);
    if (identity.conflict) conflicts.push(identity.conflict);
    if (productType.conflict) conflicts.push(productType.conflict);
    if (catalogIdentity.conflict) conflicts.push(catalogIdentity.conflict);
    if (parentReference.conflict) conflicts.push(parentReference.conflict);
    if (sourceReference.conflict) conflicts.push(sourceReference.conflict);
    if (!identity.value || !productType.value || !catalogIdentity.value) return;

    const productRowId = parseStableIdentity('product-row', identity.value);
    const catalogProductId = catalogIdentity.value;
    const catalogSnapshotVersion = `legacy:${contractId}:${revision}:${productRowId}`;
    const legacySnapshot = normalizeLegacyJson(product) as CanonicalJsonObject;
    const contractualTitleCandidates = [
      product.contractualTitle,
      product.name,
      product.stoneName
    ];
    const contractualTitle = contractualTitleCandidates.find(
      candidate => typeof candidate === 'string'
    ) as string | undefined;

    rows.push({
      productRowId,
      catalogProductId,
      catalogSnapshotVersion,
      productType: productType.value,
      contractualTitle: contractualTitle || '',
      commercial: {
        legacySnapshot
      },
      ...(parentReference.value
        ? { parentProductRowId: parseStableIdentity('product-row', parentReference.value) }
        : {}),
      ...(sourceReference.value
        ? { sourceProductRowId: parseStableIdentity('product-row', sourceReference.value) }
        : {})
    });
    rowLegacyIndexes.push(index);
    catalogSnapshots.push({
      catalogProductId,
      snapshotVersion: catalogSnapshotVersion,
      facts: {
        legacySnapshot
      }
    });
  });

  const rowIndexesById = new Map<string, number[]>();
  rows.forEach((row, index) => {
    const indexes = rowIndexesById.get(row.productRowId) ?? [];
    indexes.push(rowLegacyIndexes[index]);
    rowIndexesById.set(row.productRowId, indexes);
  });
  rowIndexesById.forEach((indexes, productRowId) => {
    if (indexes.length > 1) {
      conflicts.push({
        code: 'legacy-product-row-id-duplicate',
        path: ['products', String(indexes[1]), 'productRowId'],
        message: `Legacy contract contains duplicate product row identity ${productRowId}.`
      });
    }
  });

  const rowIds = new Set(rows.map(row => row.productRowId));
  rows.forEach((row, index) => {
    const references = [
      ['parentProductRowId', row.parentProductRowId],
      ['sourceProductRowId', row.sourceProductRowId]
    ] as const;
    references.forEach(([key, reference]) => {
      if (reference && !rowIds.has(reference)) {
        conflicts.push({
          code: 'legacy-product-reference-missing',
          path: ['products', String(rowLegacyIndexes[index]), key],
          message: `Legacy contract product references missing row ${reference}.`
        });
      }
    });
  });

  if (conflicts.length > 0) {
    return {
      ok: false,
      source: 'legacy-read',
      contractId,
      revision,
      migrationRequired: true,
      legacyView,
      conflicts
    };
  }

  const graph = {
    schemaVersion: 1 as const,
    revision,
    calculationPolicy: { ...calculationPolicy },
    catalogSnapshots,
    rows,
    stairSystems: [],
    layerConfigurations: [],
    sourceBatches: [],
    remainingStones: [],
    allocations: [],
    operationGroups: [],
    toolSelections: [],
    finishingSelections: []
  };
  let canonicalGraph: CanonicalProductGraph;
  try {
    canonicalGraph = parseCanonicalProductGraph(graph);
  } catch (error) {
    return {
      ok: false,
      source: 'legacy-read',
      contractId,
      revision,
      migrationRequired: true,
      legacyView,
      conflicts: [{
        code: 'legacy-canonical-input-invalid',
        path: ['graph'],
        message: error instanceof Error ? error.message : 'Legacy graph metadata is invalid.'
      }]
    };
  }

  return {
    ok: true,
    source: 'legacy-read',
    migrationRequired: true,
    graph: canonicalGraph,
    conflicts: []
  };
};
