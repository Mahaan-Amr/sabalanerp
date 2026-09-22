import { ContractStatus } from '@prisma/client';

const RESTORABLE_CONTRACT_STATUSES = new Set<ContractStatus>([
  ContractStatus.DRAFT,
  ContractStatus.PENDING_APPROVAL,
  ContractStatus.APPROVED,
  ContractStatus.SIGNED,
  ContractStatus.PRINTED
]);

export type ContractCancellationEvidence = {
  previousStatus?: unknown;
  reportingEventSourceKey?: unknown;
  at?: unknown;
};

export const readContractCancellationEvidence = (signatures: unknown): ContractCancellationEvidence | null => {
  if (!signatures || typeof signatures !== 'object' || Array.isArray(signatures)) return null;
  const cancellation = (signatures as Record<string, unknown>).cancellation;
  if (!cancellation || typeof cancellation !== 'object' || Array.isArray(cancellation)) return null;
  return cancellation as ContractCancellationEvidence;
};

export const resolveContractReactivationStatus = (signatures: unknown): ContractStatus | null => {
  const previousStatus = readContractCancellationEvidence(signatures)?.previousStatus;
  return typeof previousStatus === 'string' && RESTORABLE_CONTRACT_STATUSES.has(previousStatus as ContractStatus)
    ? previousStatus as ContractStatus
    : null;
};
