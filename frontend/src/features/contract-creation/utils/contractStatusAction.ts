export type ContractStatusAction = {
  action: 'cancel' | 'reactivate' | 'withdraw-cancel';
  label: 'لغو قرارداد' | 'فعال‌سازی قرارداد' | 'انصراف از لغو';
  tone: 'danger' | 'success' | 'neutral';
};

export const getContractStatusAction = (status?: string | null, cancellationPending = false): ContractStatusAction =>
  cancellationPending
    ? { action: 'withdraw-cancel', label: 'انصراف از لغو', tone: 'neutral' }
    : status === 'CANCELLED'
    ? { action: 'reactivate', label: 'فعال‌سازی قرارداد', tone: 'success' }
    : { action: 'cancel', label: 'لغو قرارداد', tone: 'danger' };
