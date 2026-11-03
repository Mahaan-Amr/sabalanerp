const PERSIAN_DATE_PATTERN = /^(\d{4})\/(\d{2})\/(\d{2})$/;

export const getCreatedContractDestination = (contractId: string): string =>
  `/dashboard/sales/contracts/${encodeURIComponent(contractId)}?created=1`;

export const getContractDetailDestination = (contractId: string): string =>
  `/dashboard/sales/contracts/${encodeURIComponent(contractId)}`;

export const isContractDateOlderThanToday = (
  contractDate: string | null | undefined,
  today: string
): boolean => {
  const contractMatch = contractDate?.match(PERSIAN_DATE_PATTERN);
  const todayMatch = today.match(PERSIAN_DATE_PATTERN);
  if (!contractMatch || !todayMatch) return false;
  return contractMatch.slice(1).join('') < todayMatch.slice(1).join('');
};

export const finalizeSuccessfulContractCommit = async ({
  contractId,
  finalizeRecovery,
  navigate,
  justCreated = true,
  logCleanupError = console.error
}: {
  contractId: string;
  finalizeRecovery?: () => Promise<void> | void;
  navigate: (destination: string) => void;
  justCreated?: boolean;
  logCleanupError?: (message: string, error: unknown) => void;
}): Promise<void> => {
  try {
    await finalizeRecovery?.();
  } catch (error) {
    logCleanupError('Contract recovery cleanup failed after a successful commit:', error);
  }
  navigate(justCreated
    ? getCreatedContractDestination(contractId)
    : getContractDetailDestination(contractId));
};
