export type ContractStatusAction = {
  action: 'cancel' | 'reactivate';
  label: 'لغو قرارداد' | 'فعال‌سازی قرارداد';
  tone: 'danger' | 'success';
};

export const getContractStatusAction = (status?: string | null): ContractStatusAction =>
  status === 'CANCELLED'
    ? { action: 'reactivate', label: 'فعال‌سازی قرارداد', tone: 'success' }
    : { action: 'cancel', label: 'لغو قرارداد', tone: 'danger' };
