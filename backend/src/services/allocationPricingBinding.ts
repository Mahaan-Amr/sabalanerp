import type { PricingReadinessContract } from './dispatchDocuments/contracts';
import { isPostCutoverFinalization, isShipmentStatementFlowActive, type ShipmentStatementCutoverState } from './dispatchDocuments/featureGate';
import {
  PricedAllocationInvariantError,
  allocatePricedRevision,
  isPositiveCanonicalQuantity,
  pricedAllocationIntegrityHash,
  sumCanonicalQuantities,
  type LockedApprovedPricingVersion,
  type PriorPricedAllocationEvent,
  type PricedRevisionLine,
} from './pricedAllocationLedger';

export type LockedPricingEvidence = {
  version: LockedApprovedPricingVersion;
  readiness: PricingReadinessContract;
  scope: { customerId: string; projectId: string; destination: string };
  versionIntegrityVerified: boolean;
  rowIntegrityVerified: boolean;
};

export type PricingReferenceWrite = {
  allocationRevisionId: string;
  contractId: string;
  pricingVersionId: string;
  expectedPricingHash: string;
  readinessEvidenceHash: string;
};

export type PricedEventWrite = {
  allocationRevisionId: string;
  allocationRevisionLineId: string;
  pricingVersionId: string;
  pricingRowId: string;
  quantity: string;
  grossAmount: string;
  discountAmount: string;
  netAmount: string;
  consumesFinalRemainder: boolean;
  evidence: unknown;
  integrityHash: string;
  recordedBy: string;
};

export interface AllocationPricingBindingPort {
  loadCutover(): Promise<ShipmentStatementCutoverState | null>;
  lockPricingScope(keys: string[]): Promise<void>;
  loadLockedPricingEvidence(contractIds: string[]): Promise<LockedPricingEvidence[]>;
  loadPriorPricedEvents(pricingRowIds: string[]): Promise<PriorPricedAllocationEvent[]>;
  createPricingReference(reference: PricingReferenceWrite): Promise<void>;
  createPricedEvent(event: PricedEventWrite): Promise<void>;
}

export type AllocationPricingBindingCode =
  | 'PRICING_NOT_READY'
  | 'PRICING_SCOPE_MISMATCH'
  | 'PRICING_HASH_MISMATCH'
  | 'PRICING_SOURCE_MISMATCH'
  | 'PRICED_ALLOCATION_INVALID';

export class AllocationPricingBindingError extends Error {
  constructor(public readonly code: AllocationPricingBindingCode, message: string) {
    super(message);
  }
}

const sortedUnique = (values: string[]) => [...new Set(values)].sort((left, right) => left.localeCompare(right));

const assertEvidence = (expectedContracts: string[], expectedScope: LockedPricingEvidence['scope'], evidence: LockedPricingEvidence[]) => {
  const actualContracts = sortedUnique(evidence.map((entry) => entry.version.contractId));
  if (actualContracts.length !== expectedContracts.length || actualContracts.some((id, index) => id !== expectedContracts[index])) {
    throw new AllocationPricingBindingError('PRICING_SCOPE_MISMATCH', 'Current approved-pricing scope differs from the finalized allocation.');
  }
  for (const entry of evidence) {
    if (entry.scope.customerId !== expectedScope.customerId || entry.scope.projectId !== expectedScope.projectId
      || entry.scope.destination !== expectedScope.destination) {
      throw new AllocationPricingBindingError('PRICING_SCOPE_MISMATCH', `Contract ${entry.version.contractId} pricing destination scope changed.`);
    }
    if (entry.readiness.status !== 'READY' || entry.readiness.reasons.length !== 0) {
      throw new AllocationPricingBindingError('PRICING_NOT_READY', `Contract ${entry.version.contractId} pricing is not READY.`);
    }
    if (entry.readiness.sourceCount !== 1 || !entry.readiness.sourceIdentityHash
      || entry.readiness.quantityTotal === null || entry.readiness.amountTotal === null
      || !entry.version.readinessEvidenceHash) {
      throw new AllocationPricingBindingError('PRICING_SOURCE_MISMATCH', `Contract ${entry.version.contractId} pricing readiness evidence is incomplete.`);
    }
    if (!entry.versionIntegrityVerified || !entry.rowIntegrityVerified) {
      throw new AllocationPricingBindingError('PRICING_HASH_MISMATCH', `Contract ${entry.version.contractId} approved-pricing integrity verification failed.`);
    }
    const quantityTotal = sumCanonicalQuantities(entry.version.rows.map((row) => row.contractedQuantity));
    if (quantityTotal !== entry.readiness.quantityTotal || entry.version.grossAmount !== entry.readiness.amountTotal) {
      throw new AllocationPricingBindingError('PRICING_SOURCE_MISMATCH', `Contract ${entry.version.contractId} readiness totals changed.`);
    }
  }
};

export const bindFinalizedAllocationPricing = async (
  port: AllocationPricingBindingPort,
  input: {
    allocationRevisionId: string;
    finalizedAt: Date;
    actorId: string;
    scope: LockedPricingEvidence['scope'];
    lines: PricedRevisionLine[];
  },
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<{
  path: 'LEGACY_WAYBILL_ONLY' | 'ATOMIC_WAYBILL_STATEMENT';
  pricingVersionIds: string[];
  eventIntegrityHashes: string[];
}> => {
  const cutover = await port.loadCutover();
  if (!isShipmentStatementFlowActive(environment, cutover)
    || !cutover?.cutoverAt
    || !isPostCutoverFinalization(input.finalizedAt, cutover.cutoverAt)) {
    return { path: 'LEGACY_WAYBILL_ONLY', pricingVersionIds: [], eventIntegrityHashes: [] };
  }
  if (input.lines.some((line) => !isPositiveCanonicalQuantity(line.quantity))) {
    throw new AllocationPricingBindingError('PRICED_ALLOCATION_INVALID', 'Finalized allocation quantities must be positive.');
  }
  const contractIds = sortedUnique(input.lines.map((line) => line.contractId));
  await port.lockPricingScope(sortedUnique([
    ...contractIds.map((contractId) => `APPROVED_PRICING_HEAD:${contractId}`),
    ...input.lines.map((line) => `APPROVED_PRICING_ROW:${line.contractId}:${line.contractItemId}`),
  ]));
  const evidence = await port.loadLockedPricingEvidence(contractIds);
  assertEvidence(contractIds, input.scope, evidence);
  const versions = evidence.map((entry) => entry.version);
  const pricingRowIds = sortedUnique(versions.flatMap((version) => version.rows.map((row) => row.id)));
  await port.lockPricingScope(pricingRowIds.map((rowId) => `PRICED_ALLOCATION_LEDGER:${rowId}`));
  const priorEvents = await port.loadPriorPricedEvents(pricingRowIds);
  let calculated;
  try {
    calculated = allocatePricedRevision({ versions, priorEvents, lines: input.lines });
  } catch (error) {
    if (error instanceof PricedAllocationInvariantError) {
      throw new AllocationPricingBindingError('PRICED_ALLOCATION_INVALID', `${error.code}: ${error.message}`);
    }
    throw error;
  }
  const references: PricingReferenceWrite[] = evidence
    .sort((left, right) => left.version.contractId.localeCompare(right.version.contractId))
    .map(({ version }) => ({
      allocationRevisionId: input.allocationRevisionId,
      contractId: version.contractId,
      pricingVersionId: version.id,
      expectedPricingHash: version.integrityHash,
      readinessEvidenceHash: version.readinessEvidenceHash,
    }));
  for (const reference of references) await port.createPricingReference(reference);
  const hashes: string[] = [];
  for (const event of calculated.events) {
    const payload = {
      allocationRevisionId: input.allocationRevisionId,
      allocationRevisionLineId: event.allocationRevisionLineId,
      pricingVersionId: event.pricingVersionId,
      pricingRowId: event.pricingRowId,
      quantity: event.quantity,
      grossAmount: event.grossAmount,
      discountAmount: event.discountAmount,
      netAmount: event.netAmount,
      consumesFinalRemainder: event.consumesFinalRemainder,
      evidence: event.evidence,
      recordedBy: input.actorId,
    };
    const integrityHash = pricedAllocationIntegrityHash(payload);
    await port.createPricedEvent({ ...payload, integrityHash });
    hashes.push(integrityHash);
  }
  return { path: 'ATOMIC_WAYBILL_STATEMENT', pricingVersionIds: references.map((item) => item.pricingVersionId), eventIntegrityHashes: hashes };
};
