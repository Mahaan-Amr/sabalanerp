export const CONTRACT_RETURN_SELECTION_STORAGE_KEY = 'contractWizardReturnSelection:v1';

export interface ContractReturnSelection {
  version: 1;
  currentStep: number;
  customerId: string;
  projectId?: string;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const writeContractReturnSelection = (
  selection: Omit<ContractReturnSelection, 'version'>,
  storage: StorageLike = localStorage
): boolean => {
  try {
    storage.setItem(CONTRACT_RETURN_SELECTION_STORAGE_KEY, JSON.stringify({ version: 1, ...selection }));
    return true;
  } catch {
    return false;
  }
};

export const consumeContractReturnSelection = (
  storage: StorageLike = localStorage
): ContractReturnSelection | null => {
  const raw = storage.getItem(CONTRACT_RETURN_SELECTION_STORAGE_KEY);
  if (!raw) return null;
  storage.removeItem(CONTRACT_RETURN_SELECTION_STORAGE_KEY);
  try {
    const value = JSON.parse(raw);
    if (value?.version !== 1 || !value.customerId || !Number.isFinite(value.currentStep)) return null;
    return value as ContractReturnSelection;
  } catch {
    return null;
  }
};
