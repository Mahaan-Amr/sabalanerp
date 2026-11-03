export type ShipmentProjectionHealth =
  | 'CURRENT'
  | 'STALE'
  | 'LEGACY_UNRECONCILED'
  | 'EVIDENCE_CONFLICT';

export type ShipmentQuantityEvidenceKind =
  | 'CONTRACTED_SET'
  | 'ALLOCATION_FINALIZED'
  | 'ALLOCATION_RELEASED'
  | 'PHYSICAL_EXIT'
  | 'MANUAL_OUTAGE_EXIT'
  | 'DISPATCH_CORRECTION_DRAFT'
  | 'DISPATCH_CORRECTION_POSTED'
  | 'GUARD_RETURN_VERIFIED'
  | 'LEGACY_UNRECONCILED_RESERVED'
  | 'LEGACY_DISPATCHED'
  | 'LEGACY_RELEASED'
  | 'LEGACY_STILL_RESERVED'
  | 'PROJECTION_STALE'
  | 'EVIDENCE_CONFLICT';

export interface ShipmentQuantityEvidence {
  readonly id: string;
  readonly contractId: string;
  readonly contractItemId: string;
  readonly productRowId: string;
  readonly unit: string;
  readonly kind: ShipmentQuantityEvidenceKind;
  readonly quantity: string;
  readonly effectiveAt: string;
  readonly recordedAt: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly sourceVersion: number;
  readonly integrityHash: string;
  readonly metadata?: Record<string, unknown>;
  readonly guardReturnMovementId?: string;
  readonly returnEvidenceId?: string;
  readonly dispatchEvidenceId?: string;
  readonly guardReturnValidated?: boolean;
}

export interface ShipmentQuantities {
  readonly contracted: string;
  readonly finalizedReserved: string;
  readonly physicallyDispatched: string;
  readonly availableToLoad: string;
}

export interface LastVerifiedShipmentRow {
  readonly contractId: string;
  readonly contractItemId: string;
  readonly productRowId: string;
  readonly unit: string;
  readonly quantities: ShipmentQuantities;
  readonly verifiedAt: string;
}

export interface ShipmentProjectionRow {
  readonly contractId: string;
  readonly contractItemId: string;
  readonly productRowId: string;
  readonly unit: string;
  readonly quantities: ShipmentQuantities | null;
  readonly health: ShipmentProjectionHealth;
  readonly healthReasons: readonly string[];
  readonly hasNegativeAvailability: boolean;
  readonly canAuthorizeLoading: boolean;
  readonly cutoff: string;
  readonly lastVerifiedAt: string | null;
  readonly sourceEvidenceIds: readonly string[];
}

export interface ShipmentQuantityProjection {
  readonly mode: 'OPERATIONAL_AS_OF' | 'AUDIT_KNOWN_AT';
  readonly cutoff: string;
  readonly rows: readonly ShipmentProjectionRow[];
  readonly totalsByUnit: ReadonlyArray<{
    readonly unit: string;
    readonly contracted: string | null;
    readonly finalizedReserved: string | null;
    readonly physicallyDispatched: string | null;
    readonly availableToLoad: string | null;
    readonly affectedRowCount: number;
    readonly isComplete: boolean;
  }>;
}

const SCALE = 1_000n;

export const parseShipmentQuantityToScaledInteger = (value: string): bigint => {
  const normalized = String(value).trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,3}))?$/.exec(normalized);
  if (!match) throw new Error(`Shipment quantity must have at most three decimal places: ${value}`);
  const sign = match[1] === '-' ? -1n : 1n;
  return sign * (BigInt(match[2]) * SCALE + BigInt((match[3] || '').padEnd(3, '0')));
};

export const formatShipmentQuantity = (value: bigint): string => {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / SCALE}.${String(absolute % SCALE).padStart(3, '0')}`;
};

const rowKey = (item: Pick<ShipmentQuantityEvidence, 'contractId' | 'contractItemId' | 'productRowId' | 'unit'>) =>
  [item.contractId, item.contractItemId, item.productRowId, item.unit].join('\u001f');

const eventOrder = (left: ShipmentQuantityEvidence, right: ShipmentQuantityEvidence) =>
  left.effectiveAt.localeCompare(right.effectiveAt)
  || left.recordedAt.localeCompare(right.recordedAt)
  || left.id.localeCompare(right.id);

const healthPriority: Record<ShipmentProjectionHealth, number> = {
  CURRENT: 0,
  STALE: 1,
  LEGACY_UNRECONCILED: 2,
  EVIDENCE_CONFLICT: 3,
};

export const projectShipmentQuantities = (
  allEvidence: readonly ShipmentQuantityEvidence[],
  options: {
    readonly cutoff?: string;
    readonly mode?: 'OPERATIONAL_AS_OF' | 'AUDIT_KNOWN_AT';
    readonly lastVerifiedRows?: readonly LastVerifiedShipmentRow[];
  } = {},
): ShipmentQuantityProjection => {
  const mode = options.mode || 'OPERATIONAL_AS_OF';
  const cutoff = options.cutoff || new Date().toISOString();
  const included = allEvidence.filter((item) => {
    if (item.effectiveAt > cutoff) return false;
    return mode !== 'AUDIT_KNOWN_AT' || item.recordedAt <= cutoff;
  });
  const grouped = new Map<string, ShipmentQuantityEvidence[]>();
  for (const item of included) {
    const key = rowKey(item);
    grouped.set(key, [...(grouped.get(key) || []), item]);
  }
  const lastVerified = new Map((options.lastVerifiedRows || []).map((row) => [rowKey(row), row]));

  const rows = [...grouped.entries()].map(([key, unsorted]): ShipmentProjectionRow => {
    const events = [...unsorted].sort(eventOrder);
    const identity = events[0];
    let contracted: bigint | null = null;
    let reserved = 0n;
    let dispatched = 0n;
    let unresolvedLegacy = 0n;
    const verifiedReturns = new Map(events
      .filter((item) => item.kind === 'GUARD_RETURN_VERIFIED' && item.guardReturnValidated)
      .map((item) => [item.id, parseShipmentQuantityToScaledInteger(item.quantity)]));
    const awaitingReturnAccounting = new Set(verifiedReturns.keys());
    const usedReturnCorrections = new Set<string>();
    let health: ShipmentProjectionHealth = 'CURRENT';
    const healthReasons: string[] = [];

    const worsenHealth = (next: ShipmentProjectionHealth, reason: string) => {
      if (healthPriority[next] > healthPriority[health]) health = next;
      if (!healthReasons.includes(reason)) healthReasons.push(reason);
    };

    for (const item of events) {
      const quantity = parseShipmentQuantityToScaledInteger(item.quantity);
      switch (item.kind) {
        case 'CONTRACTED_SET': contracted = quantity; break;
        case 'ALLOCATION_FINALIZED': reserved += quantity; break;
        case 'ALLOCATION_RELEASED': reserved -= quantity; break;
        case 'PHYSICAL_EXIT':
        case 'MANUAL_OUTAGE_EXIT': reserved -= quantity; dispatched += quantity; break;
        case 'DISPATCH_CORRECTION_POSTED':
          if (quantity < 0n) {
            if (item.metadata?.reversalOfId) {
              dispatched += quantity;
              break;
            }
            const returnEvidenceId = String(item.returnEvidenceId || item.metadata?.returnEvidenceId || '');
            const verifiedReturnQuantity = verifiedReturns.get(returnEvidenceId);
            if (!returnEvidenceId || verifiedReturnQuantity === undefined) {
              worsenHealth('EVIDENCE_CONFLICT', 'Negative return correction lacks verified Guard inbound evidence');
              break;
            }
            if (usedReturnCorrections.has(returnEvidenceId) || -quantity > verifiedReturnQuantity) {
              worsenHealth('EVIDENCE_CONFLICT', 'Verified Guard return evidence is reused or correction exceeds the accepted return');
              break;
            }
            usedReturnCorrections.add(returnEvidenceId);
            awaitingReturnAccounting.delete(returnEvidenceId);
          }
          dispatched += quantity;
          break;
        case 'GUARD_RETURN_VERIFIED':
          if (!item.guardReturnValidated) worsenHealth('EVIDENCE_CONFLICT', 'Guard return evidence was not validated against a completed inbound movement');
          break;
        case 'LEGACY_UNRECONCILED_RESERVED':
          reserved += quantity;
          unresolvedLegacy += quantity;
          break;
        case 'LEGACY_DISPATCHED':
          if (item.metadata?.reviewOf) { reserved -= quantity; unresolvedLegacy -= quantity; }
          dispatched += quantity;
          break;
        case 'LEGACY_RELEASED':
          if (item.metadata?.reviewOf) { reserved -= quantity; unresolvedLegacy -= quantity; }
          break;
        case 'LEGACY_STILL_RESERVED':
          if (item.metadata?.reviewOf) unresolvedLegacy -= quantity;
          break;
        case 'PROJECTION_STALE': worsenHealth('STALE', 'Projection refresh is incomplete'); break;
        case 'EVIDENCE_CONFLICT':
          worsenHealth('EVIDENCE_CONFLICT', String(item.metadata?.reason || 'Source evidence conflicts'));
          break;
        case 'DISPATCH_CORRECTION_DRAFT': break;
      }
    }

    if (contracted === null) worsenHealth('EVIDENCE_CONFLICT', 'Contracted quantity evidence is missing');
    if (reserved < 0n) worsenHealth('EVIDENCE_CONFLICT', 'Reserved quantity movement has no matching reservation');
    if (unresolvedLegacy > 0n) worsenHealth('LEGACY_UNRECONCILED', 'Legacy finalized loading awaits review');
    if (unresolvedLegacy < 0n) worsenHealth('EVIDENCE_CONFLICT', 'Legacy review has no matching held quantity');
    if (awaitingReturnAccounting.size > 0) worsenHealth('EVIDENCE_CONFLICT', 'Verified physical return awaits Accounting correction');

    const finalHealth = health as ShipmentProjectionHealth;
    const verified = lastVerified.get(key);
    const computed = contracted === null ? null : {
      contracted: formatShipmentQuantity(contracted),
      finalizedReserved: formatShipmentQuantity(reserved),
      physicallyDispatched: formatShipmentQuantity(dispatched),
      availableToLoad: formatShipmentQuantity(contracted - reserved - dispatched),
    };
    const quantities = finalHealth !== 'CURRENT' && verified ? verified.quantities : computed;

    return {
      contractId: identity.contractId,
      contractItemId: identity.contractItemId,
      productRowId: identity.productRowId,
      unit: identity.unit,
      quantities,
      health: finalHealth,
      healthReasons,
      hasNegativeAvailability: quantities ? parseShipmentQuantityToScaledInteger(quantities.availableToLoad) < 0n : false,
      canAuthorizeLoading: finalHealth === 'CURRENT' && quantities !== null && parseShipmentQuantityToScaledInteger(quantities.availableToLoad) >= 0n,
      cutoff,
      lastVerifiedAt: finalHealth !== 'CURRENT' && verified ? verified.verifiedAt : finalHealth === 'CURRENT' ? cutoff : null,
      sourceEvidenceIds: events.map((item) => item.id),
    };
  }).sort((left, right) => rowKey(left).localeCompare(rowKey(right)));

  const byUnit = new Map<string, { contracted: bigint; reserved: bigint; dispatched: bigint; available: bigint; affected: number; known: number; complete: boolean }>();
  for (const row of rows) {
    const aggregate = byUnit.get(row.unit) || { contracted: 0n, reserved: 0n, dispatched: 0n, available: 0n, affected: 0, known: 0, complete: true };
    if (!row.quantities) {
      aggregate.affected += 1;
      aggregate.complete = false;
    } else {
      aggregate.known += 1;
      aggregate.contracted += parseShipmentQuantityToScaledInteger(row.quantities.contracted);
      aggregate.reserved += parseShipmentQuantityToScaledInteger(row.quantities.finalizedReserved);
      aggregate.dispatched += parseShipmentQuantityToScaledInteger(row.quantities.physicallyDispatched);
      aggregate.available += parseShipmentQuantityToScaledInteger(row.quantities.availableToLoad);
      if (row.health !== 'CURRENT') {
        aggregate.affected += 1;
        aggregate.complete = false;
      }
    }
    byUnit.set(row.unit, aggregate);
  }

  return {
    mode,
    cutoff,
    rows,
    totalsByUnit: [...byUnit.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([unit, value]) => ({
      unit,
      contracted: value.known ? formatShipmentQuantity(value.contracted) : null,
      finalizedReserved: value.known ? formatShipmentQuantity(value.reserved) : null,
      physicallyDispatched: value.known ? formatShipmentQuantity(value.dispatched) : null,
      availableToLoad: value.known ? formatShipmentQuantity(value.available) : null,
      affectedRowCount: value.affected,
      isComplete: value.complete,
    })),
  };
};
