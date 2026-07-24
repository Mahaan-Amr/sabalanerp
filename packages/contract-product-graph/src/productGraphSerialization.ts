import Decimal from 'decimal.js';
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
  AddRowSellerIntent,
  CatalogSnapshot,
  CatalogTechnicalFacts
} from './productGraph';
import { parseStableIdentity, type StableIdentityKind } from './stableIdentity';
import { parseLongitudinalProductInput } from './longitudinalPolicy';
import { parseProductOperationsInput } from './operationsPolicy';
import {
  parseRemainderChildPolicyInput,
  type PaidRemainderStock,
  type RemainderChildIntent
} from './remainderPolicy';
import type { PackingPlan } from './packingPricing';
import {
  parseStairPartPolicyInput,
  type CanonicalStairPartFacts,
  type CanonicalStairSystem,
  type StaircaseQuantityIntent
} from './stairPolicy';

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

const booleanAt = (value: unknown, path: string): boolean => {
  if (typeof value !== 'boolean') throw new TypeError(`${path} must be boolean.`);
  return value;
};

const enumAt = <Value extends string>(
  value: unknown,
  allowed: readonly Value[],
  path: string
): Value => {
  if (!allowed.includes(value as Value)) {
    throw new TypeError(`${path} has an unsupported value.`);
  }
  return value as Value;
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

const stairPartFactsAt = (
  value: unknown,
  path: string
): CanonicalStairPartFacts => {
  const record = recordAt(value, path);
  return {
    stairSystemId: identityAt(
      record.stairSystemId,
      'stair-system',
      `${path}.stairSystemId`
    ),
    part: enumAt(record.part, ['tread', 'riser', 'landing'], `${path}.part`),
    lengthDisplayUnit: enumAt(
      record.lengthDisplayUnit,
      ['cm', 'm'],
      `${path}.lengthDisplayUnit`
    ),
    crossDimensionDisplayUnit: enumAt(
      record.crossDimensionDisplayUnit,
      ['cm', 'm'],
      `${path}.crossDimensionDisplayUnit`
    )
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
    ...(record.description === undefined
      ? {}
      : { description: stringAt(record.description, `${path}.description`) }),
    ...(record.stairPart === undefined
      ? {}
      : { stairPart: stairPartFactsAt(record.stairPart, `${path}.stairPart`) }),
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

const stairSystemAt = (value: unknown, path: string): CanonicalStairSystem => {
  const record = recordAt(value, path);
  const stairSystemId = identityAt(
    record.stairSystemId,
    'stair-system',
    `${path}.stairSystemId`
  );
  const catalogProductId = nonEmptyStringAt(
    record.catalogProductId,
    `${path}.catalogProductId`
  );
  const catalogSnapshotVersion = nonEmptyStringAt(
    record.catalogSnapshotVersion,
    `${path}.catalogSnapshotVersion`
  );
  const quantityMode = enumAt(
    record.quantityMode,
    ['steps', 'staircases'],
    `${path}.quantityMode`
  );
  const totalSteps = integerAt(record.totalSteps, `${path}.totalSteps`);
  if (totalSteps <= 0) throw new TypeError(`${path}.totalSteps must be positive.`);
  if (quantityMode === 'steps') {
    return {
      stairSystemId,
      catalogProductId,
      catalogSnapshotVersion,
      quantityMode,
      totalSteps
    };
  }
  const numberOfStaircases = integerAt(
    record.numberOfStaircases,
    `${path}.numberOfStaircases`
  );
  const stepsPerStaircase = integerAt(
    record.stepsPerStaircase,
    `${path}.stepsPerStaircase`
  );
  if (
    numberOfStaircases <= 0 ||
    stepsPerStaircase <= 0 ||
    numberOfStaircases * stepsPerStaircase !== totalSteps
  ) {
    throw new TypeError(`${path} staircase quantity is inconsistent.`);
  }
  return {
    stairSystemId,
    catalogProductId,
    catalogSnapshotVersion,
    quantityMode,
    totalSteps,
    numberOfStaircases,
    stepsPerStaircase
  };
};

const staircaseQuantityAt = (
  value: unknown,
  path: string
): StaircaseQuantityIntent => {
  const record = recordAt(value, path);
  const mode = enumAt(record.mode, ['steps', 'staircases'], `${path}.mode`);
  return mode === 'steps'
    ? { mode, totalSteps: integerAt(record.totalSteps, `${path}.totalSteps`) }
    : {
        mode,
        numberOfStaircases: integerAt(
          record.numberOfStaircases,
          `${path}.numberOfStaircases`
        ),
        stepsPerStaircase: integerAt(
          record.stepsPerStaircase,
          `${path}.stepsPerStaircase`
        )
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

const paidRemainderAt = (value: unknown, path: string): PaidRemainderStock => {
  const record = recordAt(value, path);
  const lengthMeters = decimalAt(record.lengthMeters, `${path}.lengthMeters`);
  const widthMeters = decimalAt(record.widthMeters, `${path}.widthMeters`);
  const quantity = integerAt(record.quantity, `${path}.quantity`);
  if (
    new Decimal(lengthMeters).lte(0) ||
    new Decimal(widthMeters).lte(0) ||
    quantity <= 0
  ) {
    throw new TypeError(`${path} dimensions and quantity must be positive.`);
  }
  return {
    remainingStoneId: identityAt(
      record.remainingStoneId,
      'remaining-stone',
      `${path}.remainingStoneId`
    ),
    ownerProductRowId: identityAt(
      record.ownerProductRowId,
      'product-row',
      `${path}.ownerProductRowId`
    ),
    catalogProductId: nonEmptyStringAt(
      record.catalogProductId,
      `${path}.catalogProductId`
    ),
    sourceBatchId: identityAt(
      record.sourceBatchId,
      'source-batch',
      `${path}.sourceBatchId`
    ),
    lengthMeters,
    widthMeters,
    quantity,
    creationOrder: integerAt(record.creationOrder, `${path}.creationOrder`),
    materialPaid: record.materialPaid === true
      ? true
      : (() => { throw new TypeError(`${path}.materialPaid must be true.`); })()
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
      : {}),
    ...(record.initialRemainders === undefined
      ? {}
      : {
          initialRemainders: arrayAt(
            record.initialRemainders,
            `${path}.initialRemainders`
          ).map((item, index) =>
            paidRemainderAt(item, `${path}.initialRemainders.${index}`)
          )
        })
  };
};

const remainingStoneAt = (value: unknown, path: string): CanonicalRemainingStone => {
  return paidRemainderAt(value, path);
};

const packingPlanAt = (value: unknown, path: string): PackingPlan => {
  const record = recordAt(value, path);
  const consumedSources = arrayAt(record.consumedSources, `${path}.consumedSources`)
    .map((item, index) => {
      const source = recordAt(item, `${path}.consumedSources.${index}`);
      return {
        sourceBatchId: identityAt(
          source.sourceBatchId,
          'source-batch',
          `${path}.consumedSources.${index}.sourceBatchId`
        ),
        sourceOrdinal: integerAt(
          source.sourceOrdinal,
          `${path}.consumedSources.${index}.sourceOrdinal`
        )
      };
    });
  const unusedSources = arrayAt(record.unusedSources, `${path}.unusedSources`)
    .map((item, index) => {
      const source = recordAt(item, `${path}.unusedSources.${index}`);
      return {
        sourceBatchId: identityAt(
          source.sourceBatchId,
          'source-batch',
          `${path}.unusedSources.${index}.sourceBatchId`
        ),
        quantity: integerAt(source.quantity, `${path}.unusedSources.${index}.quantity`)
      };
    });
  const placements = arrayAt(record.placements, `${path}.placements`)
    .map((item, index) => {
      const placement = recordAt(item, `${path}.placements.${index}`);
      return {
        demandId: nonEmptyStringAt(placement.demandId, `${path}.placements.${index}.demandId`),
        demandOrdinal: integerAt(
          placement.demandOrdinal,
          `${path}.placements.${index}.demandOrdinal`
        ),
        sourceBatchId: identityAt(
          placement.sourceBatchId,
          'source-batch',
          `${path}.placements.${index}.sourceBatchId`
        ),
        sourceOrdinal: integerAt(
          placement.sourceOrdinal,
          `${path}.placements.${index}.sourceOrdinal`
        ),
        xMeters: decimalAt(placement.xMeters, `${path}.placements.${index}.xMeters`),
        yMeters: decimalAt(placement.yMeters, `${path}.placements.${index}.yMeters`),
        lengthMeters: decimalAt(
          placement.lengthMeters,
          `${path}.placements.${index}.lengthMeters`
        ),
        widthMeters: decimalAt(
          placement.widthMeters,
          `${path}.placements.${index}.widthMeters`
        )
      };
    });
  const cuts = arrayAt(record.cuts, `${path}.cuts`).map((item, index) => {
    const cut = recordAt(item, `${path}.cuts.${index}`);
    return {
      cutId: nonEmptyStringAt(cut.cutId, `${path}.cuts.${index}.cutId`),
      sequence: integerAt(cut.sequence, `${path}.cuts.${index}.sequence`),
      axis: enumAt(
        cut.axis,
        ['longitudinal', 'cross'] as const,
        `${path}.cuts.${index}.axis`
      ),
      sourceBatchId: identityAt(
        cut.sourceBatchId,
        'source-batch',
        `${path}.cuts.${index}.sourceBatchId`
      ),
      sourceOrdinal: integerAt(
        cut.sourceOrdinal,
        `${path}.cuts.${index}.sourceOrdinal`
      ),
      positionMeters: decimalAt(
        cut.positionMeters,
        `${path}.cuts.${index}.positionMeters`
      ),
      spanStartMeters: decimalAt(
        cut.spanStartMeters,
        `${path}.cuts.${index}.spanStartMeters`
      ),
      meters: decimalAt(cut.meters, `${path}.cuts.${index}.meters`),
      kerfMeters: decimalAt(cut.kerfMeters, `${path}.cuts.${index}.kerfMeters`)
    };
  });
  const remainders = arrayAt(record.remainders, `${path}.remainders`)
    .map((item, index) => {
      const remainder = recordAt(item, `${path}.remainders.${index}`);
      return {
        remainingStoneId: identityAt(
          remainder.remainingStoneId,
          'remaining-stone',
          `${path}.remainders.${index}.remainingStoneId`
        ),
        sourceBatchId: identityAt(
          remainder.sourceBatchId,
          'source-batch',
          `${path}.remainders.${index}.sourceBatchId`
        ),
        sourceOrdinal: integerAt(
          remainder.sourceOrdinal,
          `${path}.remainders.${index}.sourceOrdinal`
        ),
        xMeters: decimalAt(remainder.xMeters, `${path}.remainders.${index}.xMeters`),
        yMeters: decimalAt(remainder.yMeters, `${path}.remainders.${index}.yMeters`),
        lengthMeters: decimalAt(
          remainder.lengthMeters,
          `${path}.remainders.${index}.lengthMeters`
        ),
        widthMeters: decimalAt(
          remainder.widthMeters,
          `${path}.remainders.${index}.widthMeters`
        )
      };
    });
  return {
    policyVersion: nonEmptyStringAt(record.policyVersion, `${path}.policyVersion`),
    inputHash: nonEmptyStringAt(record.inputHash, `${path}.inputHash`),
    resultHash: nonEmptyStringAt(record.resultHash, `${path}.resultHash`),
    consumedSources,
    unusedSources,
    placements,
    cuts,
    longitudinalCutMeters: decimalAt(
      record.longitudinalCutMeters,
      `${path}.longitudinalCutMeters`
    ),
    crossCutMeters: decimalAt(record.crossCutMeters, `${path}.crossCutMeters`),
    calibrationMeters: decimalAt(
      record.calibrationMeters,
      `${path}.calibrationMeters`
    ),
    kerfWasteSquareMeters: decimalAt(
      record.kerfWasteSquareMeters,
      `${path}.kerfWasteSquareMeters`
    ),
    remainders
  };
};

const remainderIntentAt = (value: unknown, path: string): RemainderChildIntent => {
  const record = recordAt(value, path);
  const policy = parseRemainderChildPolicyInput(record);
  return {
    ...policy,
    allocationOrder: integerAt(record.allocationOrder, `${path}.allocationOrder`),
    childProductRowId: identityAt(
      record.childProductRowId,
      'product-row',
      `${path}.childProductRowId`
    ),
    catalogProductId: nonEmptyStringAt(
      record.catalogProductId,
      `${path}.catalogProductId`
    )
  };
};

const allocationAt = (value: unknown, path: string): CanonicalAllocation => {
  const record = recordAt(value, path);
  const cuttingPricingLines = arrayAt(
    record.cuttingPricingLines,
    `${path}.cuttingPricingLines`
  ).map((item, index) => {
    const linePath = `${path}.cuttingPricingLines.${index}`;
    const line = recordAt(item, linePath);
    return {
      lineId: nonEmptyStringAt(line.lineId, `${linePath}.lineId`),
      quantity: decimalAt(line.quantity, `${linePath}.quantity`),
      rateToman: decimalAt(line.rateToman, `${linePath}.rateToman`),
      amountToman: decimalAt(line.amountToman, `${linePath}.amountToman`)
    };
  });
  return {
    allocationId: identityAt(record.allocationId, 'allocation', `${path}.allocationId`),
    allocationOrder: integerAt(record.allocationOrder, `${path}.allocationOrder`),
    sourceProductRowId: identityAt(
      record.sourceProductRowId,
      'product-row',
      `${path}.sourceProductRowId`
    ),
    targetProductRowId: identityAt(
      record.targetProductRowId,
      'product-row',
      `${path}.targetProductRowId`
    ),
    sourceRemainingStoneId: identityAt(
      record.sourceRemainingStoneId,
      'remaining-stone',
      `${path}.sourceRemainingStoneId`
    ),
    consumedSourcePieces: integerAt(
      record.consumedSourcePieces,
      `${path}.consumedSourcePieces`
    ),
    generatedRemainingStoneIds: arrayAt(
      record.generatedRemainingStoneIds,
      `${path}.generatedRemainingStoneIds`
    ).map((item, index) =>
      identityAt(
        item,
        'remaining-stone',
        `${path}.generatedRemainingStoneIds.${index}`
      )
    ),
    packingPlan: packingPlanAt(record.packingPlan, `${path}.packingPlan`),
    materialAmountToman: decimalAt(
      record.materialAmountToman,
      `${path}.materialAmountToman`
    ),
    materialPricingReason: enumAt(
      record.materialPricingReason,
      ['paid-in-source-product'] as const,
      `${path}.materialPricingReason`
    ),
    cuttingPricingLines,
    cuttingAmountToman: decimalAt(
      record.cuttingAmountToman,
      `${path}.cuttingAmountToman`
    ),
    intentSnapshot: remainderIntentAt(record.intentSnapshot, `${path}.intentSnapshot`)
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
    productRowId: identityAt(record.productRowId, 'product-row', `${path}.productRowId`),
    scope: decimalAt(record.scope, `${path}.scope`),
    basis: enumAt(record.basis, ['piece-count', 'linear-meters'], `${path}.basis`),
    automaticNoOperations: booleanAt(
      record.automaticNoOperations,
      `${path}.automaticNoOperations`
    )
  };
};

const quantityOverrideAt = (value: unknown, path: string) => {
  const record = recordAt(value, path);
  return {
    value: decimalAt(record.value, `${path}.value`),
    automaticQuantitySnapshot: decimalAt(
      record.automaticQuantitySnapshot,
      `${path}.automaticQuantitySnapshot`
    ),
    ...(record.resolution === undefined
      ? {}
      : {
          resolution: enumAt(
            record.resolution,
            ['keep', 'use-calculation'],
            `${path}.resolution`
          )
        })
  };
};

const toolSelectionAt = (value: unknown, path: string): CanonicalToolSelection => {
  const record = recordAt(value, path);
  const edges = record.edges === undefined
    ? undefined
    : arrayAt(record.edges, `${path}.edges`).map((edge, index) =>
        enumAt(
          edge,
          ['front', 'back', 'left', 'right'] as const,
          `${path}.edges.${index}`
        )
      );
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
    ),
    catalogItemId: nonEmptyStringAt(record.catalogItemId, `${path}.catalogItemId`),
    catalogSnapshotVersion: nonEmptyStringAt(
      record.catalogSnapshotVersion,
      `${path}.catalogSnapshotVersion`
    ),
    name: nonEmptyStringAt(record.name, `${path}.name`),
    unit: enumAt(record.unit, ['meter', 'squareMeter'], `${path}.unit`),
    rateToman: decimalAt(record.rateToman, `${path}.rateToman`),
    ...(edges === undefined ? {} : { edges }),
    ...(record.quantityOverride === undefined
      ? {}
      : {
          quantityOverride: quantityOverrideAt(
            record.quantityOverride,
            `${path}.quantityOverride`
          )
        }),
    ...(record.outsideCurrentCatalog === undefined
      ? {}
      : {
          outsideCurrentCatalog: booleanAt(
            record.outsideCurrentCatalog,
            `${path}.outsideCurrentCatalog`
          )
        }),
    automaticQuantity: decimalAt(
      record.automaticQuantity,
      `${path}.automaticQuantity`
    ),
    finalQuantity: decimalAt(record.finalQuantity, `${path}.finalQuantity`),
    amountToman: decimalAt(record.amountToman, `${path}.amountToman`),
    overrideStatus: enumAt(
      record.overrideStatus,
      ['automatic', 'current', 'kept', 'used-calculation'],
      `${path}.overrideStatus`
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
    ),
    catalogItemId: nonEmptyStringAt(record.catalogItemId, `${path}.catalogItemId`),
    catalogSnapshotVersion: nonEmptyStringAt(
      record.catalogSnapshotVersion,
      `${path}.catalogSnapshotVersion`
    ),
    name: nonEmptyStringAt(record.name, `${path}.name`),
    unit: enumAt(record.unit, ['meter', 'squareMeter'], `${path}.unit`),
    rateToman: decimalAt(record.rateToman, `${path}.rateToman`),
    incompatibleCatalogItemIds: arrayAt(
      record.incompatibleCatalogItemIds,
      `${path}.incompatibleCatalogItemIds`
    ).map((item, index) =>
      nonEmptyStringAt(item, `${path}.incompatibleCatalogItemIds.${index}`)
    ),
    ...(record.quantityOverride === undefined
      ? {}
      : {
          quantityOverride: quantityOverrideAt(
            record.quantityOverride,
            `${path}.quantityOverride`
          )
        }),
    ...(record.outsideCurrentCatalog === undefined
      ? {}
      : {
          outsideCurrentCatalog: booleanAt(
            record.outsideCurrentCatalog,
            `${path}.outsideCurrentCatalog`
          )
        }),
    automaticQuantity: decimalAt(
      record.automaticQuantity,
      `${path}.automaticQuantity`
    ),
    finalQuantity: decimalAt(record.finalQuantity, `${path}.finalQuantity`),
    amountToman: decimalAt(record.amountToman, `${path}.amountToman`),
    overrideStatus: enumAt(
      record.overrideStatus,
      ['automatic', 'current', 'kept', 'used-calculation'],
      `${path}.overrideStatus`
    )
  };
};

export const serializeCanonicalProductGraph = (graph: CanonicalProductGraph): string =>
  JSON.stringify(graph);

const addRowSellerIntentAt = (
  value: unknown,
  path: string
): AddRowSellerIntent => {
  const sellerIntent = recordAt(value, path);
  return {
    row: productRowAt(sellerIntent.row, `${path}.row`),
    ...(sellerIntent.productPolicyInput === undefined
      ? {}
      : {
          productPolicyInput: parseLongitudinalProductInput(
            sellerIntent.productPolicyInput
          )
        }),
    ...(sellerIntent.operationPolicyInput === undefined
      ? {}
      : {
          operationPolicyInput: parseProductOperationsInput(
            sellerIntent.operationPolicyInput
          )
        }),
    ...(sellerIntent.remainderChildPolicyInput === undefined
      ? {}
      : {
          remainderChildPolicyInput: parseRemainderChildPolicyInput(
            sellerIntent.remainderChildPolicyInput
          )
        }),
    ...(sellerIntent.stairPartPolicyInput === undefined
      ? {}
      : {
          stairPartPolicyInput: parseStairPartPolicyInput(
            sellerIntent.stairPartPolicyInput
          )
        })
  };
};

export const parseProductGraphCommand = (value: unknown): ProductGraphCommand => {
  const record = recordAt(value, 'command');
  if (
    record.type !== 'add-row' &&
    record.type !== 'replace-row' &&
    record.type !== 'delete-row' &&
    record.type !== 'add-stair-system'
  ) {
    throw new TypeError(
      'command.type must be add-row, replace-row, delete-row, or add-stair-system.'
    );
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
  const common = {
    commandId: identityAt(record.commandId, 'audit-mutation', 'command.commandId'),
    baseRevision: integerAt(record.baseRevision, 'command.baseRevision'),
    calculationPolicy: policyAt(record.calculationPolicy, 'command.calculationPolicy'),
    catalogSnapshots
  };
  if (record.type === 'delete-row') {
    return {
      ...common,
      type: 'delete-row',
      sellerIntent: {
        productRowId: identityAt(
          sellerIntent.productRowId,
          'product-row',
          'command.sellerIntent.productRowId'
        )
      }
    };
  }
  if (record.type === 'add-stair-system') {
    return {
      ...common,
      type: 'add-stair-system',
      sellerIntent: {
        stairSystemId: identityAt(
          sellerIntent.stairSystemId,
          'stair-system',
          'command.sellerIntent.stairSystemId'
        ),
        quantity: staircaseQuantityAt(
          sellerIntent.quantity,
          'command.sellerIntent.quantity'
        ),
        parts: arrayAt(
          sellerIntent.parts,
          'command.sellerIntent.parts'
        ).map((part, index) =>
          addRowSellerIntentAt(
            part,
            `command.sellerIntent.parts.${index}`
          )
        )
      }
    };
  }
  return {
    ...common,
    type: record.type,
    sellerIntent: addRowSellerIntentAt(
      sellerIntent,
      'command.sellerIntent'
    )
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
    stairSystems: (record.stairSystems === undefined
      ? []
      : arrayAt(record.stairSystems, 'graph.stairSystems')
    ).map((item, index) => stairSystemAt(item, `graph.stairSystems.${index}`)),
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
