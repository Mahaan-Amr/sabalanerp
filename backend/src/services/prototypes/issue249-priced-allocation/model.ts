import { createHash } from 'node:crypto';

export type CandidateStatus =
  | 'PENDING'
  | 'STALE_REQUIRES_SUCCESSOR'
  | 'ISSUED'
  | 'EVIDENCE_CONFLICT';

export type PricingEvidence = {
  schemaVersion: 1;
  contractId: string;
  versionId: string;
  versionNumber: number;
  sourceFinancialRecordId: string;
  approvedAt: string;
  approvedBy: string;
  currency: string;
  contractGross: string;
  contractDiscount: string;
  contractNet: string;
  rows: Array<{
    contractItemId: string;
    productRowId: string;
    contractedQuantity: string;
    unit: string;
    canonicalAllInTotal: string;
    productAttachedComponents: Record<string, string>;
  }>;
};

export type ApprovedPricingVersion = {
  evidence: PricingEvidence;
  integrityHash: string;
};

export type AllocationRevision = {
  id: string;
  revisionNumber: number;
  predecessorRevisionId: string | null;
  quantity: string;
  reservationActive: boolean;
  pricingVersionId: string;
  pricingIntegrityHash: string;
  integrityHash: string;
};

export type PrototypeState = {
  currentPricingVersionId: string;
  pricingVersions: ApprovedPricingVersion[];
  allocations: AllocationRevision[];
  candidate: {
    allocationRevisionId: string;
    status: CandidateStatus;
    reason: string | null;
  };
  issuedBundleNumber: string | null;
  lastTransition: string;
};

export type Action =
  | { type: 'APPROVE_REPLACEMENT_PRICING' }
  | { type: 'ACCOUNTING_ACCEPT' }
  | { type: 'FINALIZE_SUCCESSOR' }
  | { type: 'TAMPER_CURRENT_PRICING' }
  | { type: 'TAMPER_ALLOCATION' }
  | { type: 'DROP_REQUIRED_PRICING_FIELD' }
  | { type: 'RESET' };

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
};

const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

const versionEvidence = (versionNumber: number): PricingEvidence => ({
  schemaVersion: 1,
  contractId: 'contract-100',
  versionId: `price-v${versionNumber}`,
  versionNumber,
  sourceFinancialRecordId: `financial-record-${versionNumber}`,
  approvedAt: `2026-08-0${versionNumber}T08:00:00.000Z`,
  approvedBy: 'accountant-1',
  currency: 'TOMAN',
  contractGross: versionNumber === 1 ? '120000000.000000' : '125000000.000000',
  contractDiscount: versionNumber === 1 ? '6000000.000000' : '6250000.000000',
  contractNet: versionNumber === 1 ? '114000000.000000' : '118750000.000000',
  rows: [
    {
      contractItemId: 'contract-item-1',
      productRowId: 'product-row-stable-1',
      contractedQuantity: '10.000',
      unit: 'm2',
      canonicalAllInTotal: versionNumber === 1 ? '120000000.000000' : '125000000.000000',
      productAttachedComponents: {
        base: versionNumber === 1 ? '100000000.000000' : '105000000.000000',
        cutting: '10000000.000000',
        finishing: '7000000.000000',
        tools: '3000000.000000',
      },
    },
  ],
});

const approvedVersion = (versionNumber: number): ApprovedPricingVersion => {
  const evidence = versionEvidence(versionNumber);
  return { evidence, integrityHash: hash(evidence) };
};

const allocationHashInput = (allocation: Omit<AllocationRevision, 'integrityHash'>) => ({
  id: allocation.id,
  predecessorRevisionId: allocation.predecessorRevisionId,
  pricingIntegrityHash: allocation.pricingIntegrityHash,
  pricingVersionId: allocation.pricingVersionId,
  quantity: allocation.quantity,
  revisionNumber: allocation.revisionNumber,
});

const allocationRevision = (
  revisionNumber: number,
  predecessorRevisionId: string | null,
  pricing: ApprovedPricingVersion,
): AllocationRevision => {
  const withoutHash = {
    id: `allocation-r${revisionNumber}`,
    revisionNumber,
    predecessorRevisionId,
    quantity: '4.000',
    reservationActive: true,
    pricingVersionId: pricing.evidence.versionId,
    pricingIntegrityHash: pricing.integrityHash,
  };
  return { ...withoutHash, integrityHash: hash(allocationHashInput(withoutHash as AllocationRevision)) };
};

const hasCompletePricingEvidence = (evidence: PricingEvidence) => {
  const requiredHeader = [
    evidence.contractId,
    evidence.versionId,
    evidence.sourceFinancialRecordId,
    evidence.approvedAt,
    evidence.approvedBy,
    evidence.currency,
    evidence.contractGross,
    evidence.contractDiscount,
    evidence.contractNet,
  ];
  return requiredHeader.every(Boolean) && evidence.rows.length > 0 && evidence.rows.every((row) =>
    [row.contractItemId, row.productRowId, row.contractedQuantity, row.unit, row.canonicalAllInTotal]
      .every(Boolean),
  );
};

export const initialState = (): PrototypeState => {
  const pricing = approvedVersion(1);
  const allocation = allocationRevision(1, null, pricing);
  return {
    currentPricingVersionId: pricing.evidence.versionId,
    pricingVersions: [pricing],
    allocations: [allocation],
    candidate: { allocationRevisionId: allocation.id, status: 'PENDING', reason: null },
    issuedBundleNumber: null,
    lastTransition: 'Logistics finalized allocation-r1 against immutable price-v1.',
  };
};

export const reduce = (state: PrototypeState, action: Action): PrototypeState => {
  if (action.type === 'RESET') return initialState();

  if (action.type === 'APPROVE_REPLACEMENT_PRICING') {
    const nextNumber = state.pricingVersions.length + 1;
    const next = approvedVersion(nextNumber);
    return {
      ...state,
      currentPricingVersionId: next.evidence.versionId,
      pricingVersions: [...state.pricingVersions, next],
      lastTransition: `${next.evidence.versionId} inserted; the contract pricing head advanced atomically. Older evidence was not edited.`,
    };
  }

  if (action.type === 'TAMPER_CURRENT_PRICING') {
    return {
      ...state,
      pricingVersions: state.pricingVersions.map((version) =>
        version.evidence.versionId === state.currentPricingVersionId
          ? {
              ...version,
              evidence: { ...version.evidence, contractNet: '1.000000' },
            }
          : version,
      ),
      lastTransition: 'Current pricing payload was changed without changing its stored hash.',
    };
  }

  if (action.type === 'DROP_REQUIRED_PRICING_FIELD') {
    return {
      ...state,
      pricingVersions: state.pricingVersions.map((version) =>
        version.evidence.versionId === state.currentPricingVersionId
          ? {
              ...version,
              evidence: { ...version.evidence, currency: '' },
              integrityHash: hash({ ...version.evidence, currency: '' }),
            }
          : version,
      ),
      lastTransition: 'Current approved evidence now has a valid hash but no currency.',
    };
  }

  if (action.type === 'TAMPER_ALLOCATION') {
    return {
      ...state,
      allocations: state.allocations.map((allocation) =>
        allocation.id === state.candidate.allocationRevisionId
          ? { ...allocation, quantity: '9.000' }
          : allocation,
      ),
      lastTransition: 'The candidate allocation quantity changed without resealing its hash.',
    };
  }

  if (action.type === 'ACCOUNTING_ACCEPT') {
    if (state.candidate.status !== 'PENDING') {
      return { ...state, lastTransition: `Acceptance ignored: candidate is ${state.candidate.status}.` };
    }
    const allocation = state.allocations.find((entry) => entry.id === state.candidate.allocationRevisionId)!;
    if (hash(allocationHashInput(allocation)) !== allocation.integrityHash) {
      return {
        ...state,
        candidate: { ...state.candidate, status: 'EVIDENCE_CONFLICT', reason: 'ALLOCATION_HASH_MISMATCH' },
        lastTransition: 'Issuance blocked: the sealed allocation hash no longer matches.',
      };
    }
    const frozen = state.pricingVersions.find((version) => version.evidence.versionId === allocation.pricingVersionId)!;
    const current = state.pricingVersions.find((version) => version.evidence.versionId === state.currentPricingVersionId)!;
    if (hash(frozen.evidence) !== frozen.integrityHash || hash(current.evidence) !== current.integrityHash) {
      return {
        ...state,
        candidate: { ...state.candidate, status: 'EVIDENCE_CONFLICT', reason: 'PRICING_HASH_MISMATCH' },
        lastTransition: 'Issuance blocked: immutable pricing evidence failed integrity verification.',
      };
    }
    if (!hasCompletePricingEvidence(frozen.evidence) || !hasCompletePricingEvidence(current.evidence)) {
      return {
        ...state,
        candidate: { ...state.candidate, status: 'EVIDENCE_CONFLICT', reason: 'INCOMPLETE_PRICING_EVIDENCE' },
        lastTransition: 'Issuance blocked: approved pricing evidence is incomplete; missing values did not become zero.',
      };
    }
    if (
      current.evidence.versionId !== allocation.pricingVersionId ||
      current.integrityHash !== allocation.pricingIntegrityHash
    ) {
      return {
        ...state,
        candidate: { ...state.candidate, status: 'STALE_REQUIRES_SUCCESSOR', reason: 'APPROVED_PRICING_CHANGED' },
        lastTransition: 'Issuance blocked: a different pricing version is current. Logistics must finalize a successor.',
      };
    }
    return {
      ...state,
      candidate: { ...state.candidate, status: 'ISSUED', reason: null },
      issuedBundleNumber: '1405-000001',
      lastTransition: 'One numbered waybill/statement bundle issued atomically from allocation and pricing evidence.',
    };
  }

  if (action.type === 'FINALIZE_SUCCESSOR') {
    if (state.candidate.status !== 'STALE_REQUIRES_SUCCESSOR') {
      return { ...state, lastTransition: 'Successor blocked: the candidate is not stale.' };
    }
    const current = state.pricingVersions.find((version) => version.evidence.versionId === state.currentPricingVersionId)!;
    if (hash(current.evidence) !== current.integrityHash || !hasCompletePricingEvidence(current.evidence)) {
      return { ...state, lastTransition: 'Successor blocked: current pricing evidence is incomplete or corrupt.' };
    }
    const predecessor = state.allocations.find((entry) => entry.id === state.candidate.allocationRevisionId)!;
    const successor = allocationRevision(predecessor.revisionNumber + 1, predecessor.id, current);
    return {
      ...state,
      allocations: [
        ...state.allocations.map((entry) =>
          entry.id === predecessor.id ? { ...entry, reservationActive: false } : entry,
        ),
        successor,
      ],
      candidate: { allocationRevisionId: successor.id, status: 'PENDING', reason: null },
      lastTransition: `Atomic transfer: ${predecessor.id} released and ${successor.id} reserved the same 4.000 units against ${current.evidence.versionId}.`,
    };
  }

  return state;
};
