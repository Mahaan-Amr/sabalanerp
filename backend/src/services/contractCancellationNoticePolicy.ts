export type CurrentMobile = { number: string; type: string; isActive: boolean; isPrimary: boolean };

export function normalizeCancellationMobile(value: string): string | null {
  const digits = value.replace(/[۰-۹]/g, char => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(char)))
    .replace(/[٠-٩]/g, char => String('٠١٢٣٤٥٦٧٨٩'.indexOf(char))).replace(/\D/g, '');
  const local = digits.startsWith('0098') ? `0${digits.slice(4)}`
    : digits.startsWith('98') && digits.length === 12 ? `0${digits.slice(2)}`
    : digits.startsWith('9') && digits.length === 10 ? `0${digits}` : digits;
  return /^09\d{9}$/.test(local) ? local : null;
}

export function resolveCancellationRecipient(phones: CurrentMobile[], selected?: string | null) {
  const active = phones.filter(phone => phone.isActive && phone.type === 'mobile')
    .map(phone => ({ ...phone, normalized: normalizeCancellationMobile(phone.number) }))
    .filter((phone): phone is CurrentMobile & { normalized: string } => !!phone.normalized);
  const available = [...new Set(active.map(phone => phone.normalized))];
  const primary = [...new Set(active.filter(phone => phone.isPrimary).map(phone => phone.normalized))];
  const explicit = selected ? normalizeCancellationMobile(selected) : null;
  const phoneNumber = primary.length === 1 ? primary[0] : available.length === 1 ? available[0]
    : explicit && available.includes(explicit) ? explicit : null;
  return { availablePhoneNumbers: available, phoneNumber,
    canChoosePhone: available.length > 1 && primary.length !== 1,
    status: phoneNumber ? 'PENDING' : available.length ? 'NEEDS_SELECTION' : 'NEEDS_PHONE' };
}

export const cancellationNoticeRetryStatuses = ['PENDING', 'RETRY', 'NEEDS_PHONE', 'NEEDS_SELECTION', 'FAILED', 'UNKNOWN'];

export function cancellationSubmissionIsUnknown(result: { success: boolean; failureKind?: string; errorCode?: string; httpStatus?: number }) {
  return !result.success && (result.failureKind === 'NETWORK'
    && ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EPIPE', 'UND_ERR_SOCKET'].includes(result.errorCode || '')
    || result.failureKind === 'HTTP' && (result.httpStatus === 408 || Number(result.httpStatus) >= 500));
}
