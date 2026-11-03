import type { ContractWizardData } from '../types/contract.types';
import type { ContractEditRecoveryBlockReason } from '../utils/contractEditRecoveryConflictPolicy';

export const hasMeaningfulContractCreationProgress = ({
  wizardData,
  contractDateChanged,
}: {
  wizardData: ContractWizardData;
  contractDateChanged: boolean;
}): boolean => contractDateChanged ||
  Boolean(wizardData.customerId) ||
  Boolean(wizardData.projectId) ||
  wizardData.products.length > 0 ||
  (wizardData.serviceRows?.length ?? 0) > 0 ||
  wizardData.deliveries.length > 0 ||
  wizardData.payment.payments.length > 0;

export const contractCreationRecoverySurface = ({
  blockReason,
  hasRecoverableDraft,
}: {
  blockReason: ContractEditRecoveryBlockReason | null;
  hasRecoverableDraft: boolean;
}): 'NONE' | 'DRAFT' | 'OWNERSHIP' => {
  if (blockReason) return 'OWNERSHIP';
  return hasRecoverableDraft ? 'DRAFT' : 'NONE';
};

export const shouldRotateUnavailableCreationDraft = ({
  status,
  code,
  contractId,
  takeover,
}: {
  status?: number;
  code?: string;
  contractId?: string | null;
  takeover: boolean;
}): boolean => !contractId && !takeover && status === 404 && code === 'draft-owner-mismatch';
