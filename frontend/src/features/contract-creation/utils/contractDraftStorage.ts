import type { ContractWizardData } from '../types/contract.types';

export const CONTRACT_DRAFT_STORAGE_KEY = 'contractWizardAutosaveDraft';
export const CONTRACT_DRAFT_VERSION = 1;
export const CONTRACT_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ContractAutosaveDraft {
  version: number;
  updatedAt: number;
  currentStep: number;
  wizardData: ContractWizardData;
  searches?: {
    customerSearchTerm?: string;
    productSearchTerm?: string;
    treadProductSearchTerm?: string;
    riserProductSearchTerm?: string;
    landingProductSearchTerm?: string;
    stairStoneSearchTerm?: string;
  };
  productModal?: Record<string, unknown>;
  stairSystemV2?: Record<string, unknown>;
}

export const isContractDraftExpired = (
  draft: Pick<ContractAutosaveDraft, 'updatedAt'> | null | undefined,
  now = Date.now()
): boolean => {
  if (!draft?.updatedAt) return true;
  return now - draft.updatedAt > CONTRACT_DRAFT_TTL_MS;
};

export const createContractAutosaveDraft = (
  draft: Omit<ContractAutosaveDraft, 'version' | 'updatedAt'>,
  now = Date.now()
): ContractAutosaveDraft => ({
  ...draft,
  version: CONTRACT_DRAFT_VERSION,
  updatedAt: now
});

export const clampContractDraftStep = (step: unknown, totalSteps: number): number => {
  const numericStep = typeof step === 'number' ? step : Number(step);
  if (!Number.isFinite(numericStep)) return 1;
  return Math.max(1, Math.min(Math.trunc(numericStep), totalSteps));
};

export const parseContractAutosaveDraft = (
  raw: string | null,
  now = Date.now()
): ContractAutosaveDraft | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ContractAutosaveDraft;
    if (parsed.version !== CONTRACT_DRAFT_VERSION) return null;
    if (isContractDraftExpired(parsed, now)) return null;
    if (!parsed.wizardData || !parsed.currentStep) return null;
    return parsed;
  } catch {
    return null;
  }
};
