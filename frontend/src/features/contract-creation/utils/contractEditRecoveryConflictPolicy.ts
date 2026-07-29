export type ContractEditRecoveryBlockReason =
  | 'owned-elsewhere'
  | 'revision-conflict'
  | 'takeover-failed'
  | 'permission'
  | 'ownership-lost';

type ContractEditRecoveryFailurePhase = 'acquire' | 'takeover' | 'checkpoint';

export const classifyContractEditRecoveryFailure = ({
  status,
  code,
  phase
}: {
  status?: number;
  code?: string;
  phase: ContractEditRecoveryFailurePhase;
}): {
  reason: ContractEditRecoveryBlockReason;
  applyRecovery: boolean;
} => {
  if (status === 403) {
    return { reason: 'permission', applyRecovery: false };
  }

  if (phase === 'checkpoint' && code === 'edit-session-owned-elsewhere') {
    return { reason: 'ownership-lost', applyRecovery: false };
  }

  if (code === 'revision-conflict') {
    return { reason: 'revision-conflict', applyRecovery: false };
  }

  if (phase === 'takeover') {
    return { reason: 'takeover-failed', applyRecovery: false };
  }

  return {
    reason: 'owned-elsewhere',
    applyRecovery: code === 'edit-session-owned-elsewhere'
  };
};

export const getContractEditRecoveryMessage = (
  reason: ContractEditRecoveryBlockReason
): string => ({
  'owned-elsewhere': 'این قرارداد در محل دیگری در حال ویرایش است',
  'revision-conflict': 'نسخه قرارداد تغییر کرده است؛ برای دریافت آخرین اطلاعات، قرارداد را دوباره بارگذاری کنید',
  'takeover-failed': 'انتقال اختیار ویرایش انجام نشد؛ دوباره تلاش کنید',
  permission: 'شما اجازه ویرایش این قرارداد را ندارید',
  'ownership-lost': 'اختیار ویرایش این قرارداد به محل دیگری منتقل شده است'
})[reason];
