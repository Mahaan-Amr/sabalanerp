import type {
  DispatchDocumentCommandScope,
  DispatchDocumentKind,
  DispatchDocumentRenderInput,
  PublishedDispatchArtifact,
} from './contracts';
import type { BoundAllocationPricingFreshness as AllocationFreshness,
  BoundPricedAllocationReadModel } from '../allocationPricingReadModel';

export type PrimaryBundleIdentity = {
  waybillId: string;
  waybillDocumentId: string;
  statementDocumentId: string;
  number: string;
  issuedAt: string;
};

export type PrimaryBundleSource = {
  candidateId: string;
  allocationRevisionId: string;
  sourceIntegrityHash: string;
  pricedAllocation: BoundPricedAllocationSource;
  provenance: {
    generatorVersion: string;
    sourceVersionIdentities: Readonly<Record<string, string>>;
  };
  waybillSnapshot: Readonly<Record<string, unknown>>;
  waybill: Extract<DispatchDocumentRenderInput, { kind: 'WAYBILL' }>;
  statement: Extract<DispatchDocumentRenderInput, { kind: 'STATEMENT' }>;
};

export type ReplacementBundleSource = PrimaryBundleSource & { predecessorWaybillId: string };

/** Mirrors issue 258's readBoundPricedAllocation output without importing its unstable branch. */
export type BoundPricedAllocationSource = BoundPricedAllocationReadModel;
export type BoundAllocationPricingFreshness = AllocationFreshness;

export interface DispatchDocumentSourceReader {
  readPrimaryBundle(input: { candidateId: string; waybill: PrimaryBundleIdentity }): Promise<PrimaryBundleSource>;
  readReplacementBundle(input: { waybillId: string; replacement: PrimaryBundleIdentity }): Promise<ReplacementBundleSource>;
}

export interface DispatchArtifactStorage {
  stage(input: { storageKey: string; bytes: Uint8Array }): Promise<void>;
  read(storageKey: string): Promise<Uint8Array | null>;
}

export type IssuedWaybill = {
  id: string;
  number: string;
  status: 'ISSUED';
  issuedAt: string;
  replacesWaybillId: string | null;
};

export type CandidateDecisionResult = {
  candidateId: string;
  status: 'ACCEPTED' | 'REJECTED' | 'RETURNED' | 'STALE_REQUIRES_SUCCESSOR';
  waybill: IssuedWaybill | null;
};

export interface DispatchDocumentRepository {
  findCommandResult(input: {
    scope: DispatchDocumentCommandScope;
    scopeId: string;
    idempotencyKey: string;
  }): Promise<unknown | null>;
  allocateWaybillNumber(): Promise<string>;
  acceptAndIssue(input: {
    candidateId: string;
    allocationRevisionId: string;
    expectedSourceIntegrityHash: string;
    waybillSnapshot: Readonly<Record<string, unknown>>;
    waybill: IssuedWaybill;
    artifacts: PublishedDispatchArtifact[];
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<CandidateDecisionResult>;
  rejectCandidate(input: {
    candidateId: string;
    action: 'REJECT' | 'RETURN';
    reason: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<CandidateDecisionResult>;
  voidWaybill(input: {
    waybillId: string;
    reason: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
    authority: unknown;
  }): Promise<unknown>;
  replaceWaybill(input: {
    waybillId: string;
    allocationRevisionId: string;
    expectedSourceIntegrityHash: string;
    waybillSnapshot: Readonly<Record<string, unknown>>;
    replacement: IssuedWaybill;
    artifacts: PublishedDispatchArtifact[];
    reason: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
    authority: unknown;
  }): Promise<unknown>;
  getArtifact(input: { artifactId: string; waybillId: string }): Promise<PublishedDispatchArtifact | null>;
  recordRetrieval(input: {
    waybillId: string;
    artifact: PublishedDispatchArtifact;
    actorId: string;
    correlationId: string;
    status: 'SUCCEEDED' | 'FAILED';
    failureCode?: string;
  }): Promise<void>;
  getPrintableArtifacts(input: { waybillId: string; kinds: DispatchDocumentKind[] }): Promise<PublishedDispatchArtifact[]>;
  recordPrintHandoff(input: {
    waybillId: string;
    operationIdempotencyKey: string;
    attemptId: string;
    correlationId: string;
    actorId: string;
    kinds: DispatchDocumentKind[];
    status: 'SUCCEEDED' | 'FAILED';
    artifacts: PublishedDispatchArtifact[];
    failureCode?: string;
  }): Promise<void>;
  getCombinedReadModel(input: { candidateId: string; authorizedWaybillId: string }): Promise<unknown | null>;
}

export interface DispatchSourceIntegrityVerifier<Transaction = unknown> {
  assess(input: {
    transaction: Transaction;
    allocationRevisionId: string;
    expectedSourceIntegrityHash: string;
  }): Promise<BoundAllocationPricingFreshness>;
}

export interface DispatchDocumentAccessPolicy {
  canReadWaybill(input: { actorId: string; waybillId: string }): Promise<boolean>;
}

export interface DispatchIntegrityIncidentReporter {
  report(input: { waybillId: string; artifactId: string; actorId: string; correlationId: string;
    failureCode: string; evidence: Readonly<Record<string, unknown>> }): Promise<void>;
}
