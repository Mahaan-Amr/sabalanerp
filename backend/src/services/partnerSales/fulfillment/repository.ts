import type { CaseState, FulfillmentView, IdempotencyIdentity, Result, RevisionRef } from './contracts';

export type PartnerFulfillmentRecipient = {
  customerId: string;
  displayName: string;
  phone: string;
  destination: string;
};

export type PartnerFulfillmentSource = {
  view: FulfillmentView;
  graph: {
    owner: RevisionRef;
    schemaVersion: 1;
    graphHash: string;
    productRowIds: string[];
  };
  /** Result of resolving and hashing the immutable Case-owned graph snapshot. */
  canonicalGraph: {
    graphHash: string;
    productRowIds: string[];
  };
  caseState: CaseState;
  customer: PartnerFulfillmentRecipient;
};

export type PartnerPhysicalLineage = {
  lineageId: string;
  sourceKind: 'PARTNER_CASE';
  caseId: string;
  createdFrom: RevisionRef;
  internalRecordId: string;
  productRowId: string;
  quantity: string;
  unit: string;
  recipient: PartnerFulfillmentRecipient;
  deliveryIds: string[];
};

export type PartnerQuantityDependency = {
  sourceKind: 'PARTNER_CASE';
  owner: RevisionRef;
  internalRecordId: string;
  productRowId: string;
  unit: string;
  contracted: string;
  finalizedReserved: string;
  physicallyDispatched: string;
  health: 'CURRENT' | 'STALE' | 'LEGACY_UNRECONCILED' | 'EVIDENCE_CONFLICT';
  evidenceIds: readonly string[];
};

export type PartnerFulfillmentCommand = {
  schemaVersion: 1;
  commandId: string;
  correlationId: string;
  authenticatedActorId: string;
  idempotencyKey: string;
  expected: RevisionRef;
};

export type PartnerFulfillmentCommandScope = PartnerFulfillmentCommand & {
  idempotency: IdempotencyIdentity;
};

export type PartnerFulfillmentCommandReceipt = {
  commandId: string;
  intentHash: string;
  idempotency: IdempotencyIdentity;
  lineageEvidenceIds: readonly string[];
};

export interface PartnerFulfillmentTransaction {
  readAuthorizedSource(expected: RevisionRef, action: 'MATERIALIZE' | 'INSPECT_DEPENDENCIES' | 'INSPECT_VOIDING', authenticatedActorId?: string): Promise<Result<PartnerFulfillmentSource>>;
  /** Lookup is scoped by command identity OR actor/operation/target/key so a
   * changed command ID cannot bypass a durable replay decision. */
  readLineageCommand(command: PartnerFulfillmentCommandScope): Promise<PartnerFulfillmentCommandReceipt | null>;
  findLineage(caseId: string, productRowId: string): Promise<PartnerPhysicalLineage | null>;
  /** Atomically CASes expected Case state/revision, enforces unique
   * (caseId, productRowId), inserts every missing lineage, and records the
   * command receipt. It must commit all three effects or none of them. */
  commitLineages(input: {
    command: PartnerFulfillmentCommandScope;
    intentHash: string;
    lineages: readonly PartnerPhysicalLineage[];
  }): Promise<Result<PartnerFulfillmentCommandReceipt>>;
  readQuantityDependencies(expected: RevisionRef): Promise<readonly PartnerQuantityDependency[]>;
}

export interface PartnerFulfillmentRepository {
  transaction<T>(operation: (tx: PartnerFulfillmentTransaction) => Promise<Result<T>>): Promise<Result<T>>;
}
