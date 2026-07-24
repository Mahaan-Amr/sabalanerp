import { parseCanonicalDecimal, type CanonicalDecimal } from './canonicalDecimal';
import { findGraphIntegrityConflicts } from './graphIntegrity';
import type { CanonicalJsonObject, CanonicalJsonValue } from './canonicalJson';
import type {
  CalculationPolicySnapshot,
  CanonicalAllocation,
  CanonicalCommercialFacts,
  CanonicalFinishingSelection,
  CanonicalLayerConfiguration,
  CanonicalOperationGroup,
  CanonicalProductGraph,
  ProductGraphCommand,
  CanonicalProductRow,
  CanonicalProductType,
  CanonicalRemainingStone,
  CanonicalSourceBatch,
  CanonicalToolSelection,
  CatalogSnapshot,
  CatalogTechnicalFacts
} from './productGraph';
import { parseStableIdentity, type StableIdentityKind } from './stableIdentity';
import { parseLongitudinalProductInput } from './longitudinalPolicy';

type UnknownRecord = Record<string, unknown>;

const PRODUCT_TYPES = new Set<CanonicalProductType>([
  'longitudinal',
  'stair',
  'slab',
  'prepared',
  'volumetric'
]);

const recordAt = (value: unknown, path: string): UnknownRecord => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as UnknownRecord;
};

const arrayAt = (value: unknown, path: string): unknown[] => {
  if (!Array.isArray(value)) {
    throw new TypeError(`${path} must be an array.`);
  }
  return value;
};

const stringAt = (value: unknown, path: string): string => {
  if (typeof value !== 'string') {
    throw new TypeError(`${path} must be a string.`);
  }
  return value;
};

const nonEmptyStringAt = (value: unknown, path: string): string => {
  const parsed = stringAt(value, path).trim();
  if (!parsed) throw new TypeError(`${path} must be a non-empty string.`);
  return parsed;
};

const integerAt = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer.`);
  }
  return Number(value);
};

const decimalAt = (value: unknown, path: string): CanonicalDecimal => {
  if (typeof value !== 'string') {
    throw new TypeError(`${path} must be a canonical decimal string.`);
  }
  const parsed = parseCanonicalDecimal(value);
  if (parsed !== value) {
    throw new TypeError(`${path} must be a normalized canonical decimal string.`);
  }
  return parsed;
};

const optionalDecimalAt = (
  record: UnknownRecord,
  key: string,
  path: string
): CanonicalDecimal | undefined => (
  record[key] === undefined ? undefined : decimalAt(record[key], `${path}.${key}`)
);

const withOptionalDecimal = <Key extends string>(
  record: UnknownRecord,
  key: Key,
  path: string
): Partial<Record<Key, CanonicalDecimal>> => {
  const value = optionalDecimalAt(record, key, path);
  return value === undefined ? {} : { [key]: value } as Partial<Record<Key, CanonicalDecimal>>;
};

const identityAt = <Kind extends StableIdentityKind>(
  value: unknown,
  kind: Kind,
  path: string
) => parseStableIdentity(kind, stringAt(value, path));

const optionalIdentityAt = <Kind extends StableIdentityKind>(
  record: UnknownRecord,
  key: string,
  kind: Kind,
  path: string
) => (
  record[key] === undefined ? undefined : identityAt(record[key], kind, `${path}.${key}`)
);

const canonicalJsonAt = (value: unknown, path: string): CanonicalJsonValue => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => canonicalJsonAt(item, `${path}.${index}`));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        canonicalJsonAt(item, `${path}.${key}`)
      ])
    );
  }
  throw new TypeError(`${path} must contain only canonical JSON values.`);
};

const canonicalObjectAt = (value: unknown, path: string): CanonicalJsonObject =>
  canonicalJsonAt(recordAt(value, path), path) as CanonicalJsonObject;

const policyAt = (value: unknown, path: string): CalculationPolicySnapshot => {
  const record = recordAt(value, path);
  return {
    calculation: nonEmptyStringAt(record.calculation, `${path}.calculation`),
    packing: nonEmptyStringAt(record.packing, `${path}.packing`),
    pricing: nonEmptyStringAt(record.pricing, `${path}.pricing`),
    rounding: nonEmptyStringAt(record.rounding, `${path}.rounding`)
  };
};

const commercialAt = (value: unknown, path: string): CanonicalCommercialFacts => {
  const record = recordAt(value, path);
  return {
    ...withOptionalDecimal(record, 'requestedLengthMeters', path),
    ...withOptionalDecimal(record, 'requestedWidthMeters', path),
    ...withOptionalDecimal(record, 'requestedAreaSquareMeters', path),
    ...withOptionalDecimal(record, 'requestedQuantity', path),
    ...withOptionalDecimal(record, 'baseRateToman', path),
    ...withOptionalDecimal(record, 'baseAmountToman', path),
    ...withOptionalDecimal(record, 'totalAmountToman', path),
    ...(record.calculationSnapshot !== undefined
      ? {
          calculationSnapshot: canonicalObjectAt(
            record.calculationSnapshot,
            `${path}.calculationSnapshot`
          )
        }
      : {}),
    ...(record.legacySnapshot !== undefined
      ? { legacySnapshot: canonicalObjectAt(record.legacySnapshot, `${path}.legacySnapshot`) }
      : {})
  };
};

const technicalFactsAt = (value: unknown, path: string): CatalogTechnicalFacts => {
  const record = recordAt(value, path);
  const attributes = record.attributes === undefined
    ? undefined
    : Object.fromEntries(
        Object.entries(recordAt(record.attributes, `${path}.attributes`)).map(([key, item]) => [
          key,
          stringAt(item, `${path}.attributes.${key}`)
        ])
      );
  return {
    ...withOptionalDecimal(record, 'motherLengthMeters', path),
    ...withOptionalDecimal(record, 'motherWidthMeters', path),
    ...withOptionalDecimal(record, 'thicknessMeters', path),
    ...(attributes ? { attributes } : {}),
    ...(record.legacySnapshot !== undefined
      ? { legacySnapshot: canonicalObjectAt(record.legacySnapshot, `${path}.legacySnapshot`) }
      : {})
  };
};

const catalogSnapshotAt = (value: unknown, path: string): CatalogSnapshot => {
  const record = recordAt(value, path);
  return {
    catalogProductId: nonEmptyStringAt(record.catalogProductId, `${path}.catalogProductId`),
    snapshotVersion: nonEmptyStringAt(record.snapshotVersion, `${path}.snapshotVersion`),
    facts: technicalFactsAt(record.facts, `${path}.facts`)
  };
};

const productRowAt = (value: unknown, path: string): CanonicalProductRow => {
  const record = recordAt(value, path);
  const productType = stringAt(record.productType, `${path}.productType`);
  if (!PRODUCT_TYPES.has(productType as CanonicalProductType)) {
    throw new TypeError(`${path}.productType must be a recognized product type.`);
  }
  return {
    productRowId: identityAt(record.productRowId, 'product-row', `${path}.productRowId`),
    catalogProductId: nonEmptyStringAt(record.catalogProductId, `${path}.catalogProductId`),
    catalogSnapshotVersion: nonEmptyStringAt(
      record.catalogSnapshotVersion,
      `${path}.catalogSnapshotVersion`
    ),
    productType: productType as CanonicalProductType,
    contractualTitle: stringAt(record.contractualTitle, `${path}.contractualTitle`),
    commercial: commercialAt(record.commercial, `${path}.commercial`),
    ...(optionalIdentityAt(record, 'parentProductRowId', 'product-row', path)
      ? {
          parentProductRowId: optionalIdentityAt(
            record,
            'parentProductRowId',
            'product-row',
            path
          )
        }
      : {}),
    ...(optionalIdentityAt(record, 'sourceProductRowId', 'product-row', path)
      ? {
          sourceProductRowId: optionalIdentityAt(
            record,
            'sourceProductRowId',
            'product-row',
            path
          )
        }
      : {})
  };
};

const layerAt = (value: unknown, path: string): CanonicalLayerConfiguration => {
  const record = recordAt(value, path);
  return {
    layerConfigurationId: identityAt(
      record.layerConfigurationId,
      'layer-configuration',
      `${path}.layerConfigurationId`
    ),
    parentProductRowId: identityAt(
      record.parentProductRowId,
      'product-row',
      `${path}.parentProductRowId`
    ),
    ...(optionalIdentityAt(record, 'sourceBatchId', 'source-batch', path)
      ? { sourceBatchId: optionalIdentityAt(record, 'sourceBatchId', 'source-batch', path) }
      : {})
  };
};

const sourceBatchAt = (value: unknown, path: string): CanonicalSourceBatch => {
  const record = recordAt(value, path);
  return {
    sourceBatchId: identityAt(record.sourceBatchId, 'source-batch', `${path}.sourceBatchId`),
    ...(optionalIdentityAt(record, 'ownerProductRowId', 'product-row', path)
      ? {
          ownerProductRowId: optionalIdentityAt(
            record,
            'ownerProductRowId',
            'product-row',
            path
          )
        }
      : {})
  };
};

const remainingStoneAt = (value: unknown, path: string): CanonicalRemainingStone => {
  const record = recordAt(value, path);
  return {
    remainingStoneId: identityAt(
      record.remainingStoneId,
      'remaining-stone',
      `${path}.remainingStoneId`
    ),
    sourceBatchId: identityAt(record.sourceBatchId, 'source-batch', `${path}.sourceBatchId`)
  };
};

const allocationAt = (value: unknown, path: string): CanonicalAllocation => {
  const record = recordAt(value, path);
  return {
    allocationId: identityAt(record.allocationId, 'allocation', `${path}.allocationId`),
    sourceBatchId: identityAt(record.sourceBatchId, 'source-batch', `${path}.sourceBatchId`),
    targetProductRowId: identityAt(
      record.targetProductRowId,
      'product-row',
      `${path}.targetProductRowId`
    ),
    ...(optionalIdentityAt(record, 'remainingStoneId', 'remaining-stone', path)
      ? {
          remainingStoneId: optionalIdentityAt(
            record,
            'remainingStoneId',
            'remaining-stone',
            path
          )
        }
      : {})
  };
};

const operationGroupAt = (value: unknown, path: string): CanonicalOperationGroup => {
  const record = recordAt(value, path);
  return {
    operationGroupId: identityAt(
      record.operationGroupId,
      'operation-group',
      `${path}.operationGroupId`
    ),
    productRowId: identityAt(record.productRowId, 'product-row', `${path}.productRowId`)
  };
};

const toolSelectionAt = (value: unknown, path: string): CanonicalToolSelection => {
  const record = recordAt(value, path);
  return {
    toolSelectionId: identityAt(
      record.toolSelectionId,
      'tool-selection',
      `${path}.toolSelectionId`
    ),
    operationGroupId: identityAt(
      record.operationGroupId,
      'operation-group',
      `${path}.operationGroupId`
    )
  };
};

const finishingSelectionAt = (
  value: unknown,
  path: string
): CanonicalFinishingSelection => {
  const record = recordAt(value, path);
  return {
    finishingSelectionId: identityAt(
      record.finishingSelectionId,
      'finishing-selection',
      `${path}.finishingSelectionId`
    ),
    operationGroupId: identityAt(
      record.operationGroupId,
      'operation-group',
      `${path}.operationGroupId`
    )
  };
};

export const serializeCanonicalProductGraph = (graph: CanonicalProductGraph): string =>
  JSON.stringify(graph);

export const parseProductGraphCommand = (value: unknown): ProductGraphCommand => {
  const record = recordAt(value, 'command');
  if (record.type !== 'add-row' && record.type !== 'replace-row') {
    throw new TypeError('command.type must be add-row or replace-row.');
  }
  const sellerIntent = recordAt(record.sellerIntent, 'command.sellerIntent');
  const catalogSnapshots = arrayAt(record.catalogSnapshots, 'command.catalogSnapshots')
    .map((item, index) => catalogSnapshotAt(item, `command.catalogSnapshots.${index}`));
  const snapshotIdentities = new Set<string>();
  catalogSnapshots.forEach(snapshot => {
    const identity = `${snapshot.catalogProductId}\u0000${snapshot.snapshotVersion}`;
    if (snapshotIdentities.has(identity)) {
      throw new TypeError(
        `command.catalogSnapshots contains duplicate identity ${snapshot.catalogProductId}:${snapshot.snapshotVersion}.`
      );
    }
    snapshotIdentities.add(identity);
  });
  return {
    commandId: identityAt(record.commandId, 'audit-mutation', 'command.commandId'),
    type: record.type,
    baseRevision: integerAt(record.baseRevision, 'command.baseRevision'),
    calculationPolicy: policyAt(record.calculationPolicy, 'command.calculationPolicy'),
    sellerIntent: {
      row: productRowAt(sellerIntent.row, 'command.sellerIntent.row'),
      ...(sellerIntent.productPolicyInput === undefined
        ? {}
        : {
            productPolicyInput: parseLongitudinalProductInput(
              sellerIntent.productPolicyInput,
            )
          })
    },
    catalogSnapshots
  };
};

export const parseCanonicalProductGraph = (input: string | unknown): CanonicalProductGraph => {
  const value = typeof input === 'string' ? JSON.parse(input) : input;
  const record = recordAt(value, 'graph');
  const schemaVersion = integerAt(record.schemaVersion, 'graph.schemaVersion');
  if (schemaVersion !== 1) {
    throw new TypeError('graph.schemaVersion must be 1.');
  }

  const graph: CanonicalProductGraph = {
    schemaVersion: 1,
    revision: integerAt(record.revision, 'graph.revision'),
    calculationPolicy: policyAt(record.calculationPolicy, 'graph.calculationPolicy'),
    catalogSnapshots: arrayAt(record.catalogSnapshots, 'graph.catalogSnapshots')
      .map((item, index) => catalogSnapshotAt(item, `graph.catalogSnapshots.${index}`)),
    rows: arrayAt(record.rows, 'graph.rows')
      .map((item, index) => productRowAt(item, `graph.rows.${index}`)),
    layerConfigurations: arrayAt(record.layerConfigurations, 'graph.layerConfigurations')
      .map((item, index) => layerAt(item, `graph.layerConfigurations.${index}`)),
    sourceBatches: arrayAt(record.sourceBatches, 'graph.sourceBatches')
      .map((item, index) => sourceBatchAt(item, `graph.sourceBatches.${index}`)),
    remainingStones: arrayAt(record.remainingStones, 'graph.remainingStones')
      .map((item, index) => remainingStoneAt(item, `graph.remainingStones.${index}`)),
    allocations: arrayAt(record.allocations, 'graph.allocations')
      .map((item, index) => allocationAt(item, `graph.allocations.${index}`)),
    operationGroups: arrayAt(record.operationGroups, 'graph.operationGroups')
      .map((item, index) => operationGroupAt(item, `graph.operationGroups.${index}`)),
    toolSelections: arrayAt(record.toolSelections, 'graph.toolSelections')
      .map((item, index) => toolSelectionAt(item, `graph.toolSelections.${index}`)),
    finishingSelections: arrayAt(record.finishingSelections, 'graph.finishingSelections')
      .map((item, index) => finishingSelectionAt(item, `graph.finishingSelections.${index}`))
  };
  const conflicts = findGraphIntegrityConflicts(graph);
  if (conflicts.length > 0) {
    throw new TypeError(`Canonical product graph is invalid: ${conflicts[0].message}`);
  }
  return graph;
};
