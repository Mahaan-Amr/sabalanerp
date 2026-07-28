import crypto from 'crypto';

const normalizePersian = (value: unknown) => String(value || '')
  .trim()
  .replace(/\s+/g, ' ')
  .replace(/ي/g, 'ی')
  .replace(/ك/g, 'ک');

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
};

export const projectRecordRetentionCapabilities = (input: {
  role: string;
  authorities: string[];
  archived: boolean;
}) => {
  const archiveManager = input.role === 'ADMIN' || input.authorities.includes('HR_MANAGER');
  return {
    canArchive: archiveManager && !input.archived,
    canRestore: archiveManager && input.archived,
    canPermanentlyDelete: input.role === 'ADMIN',
  };
};

export const assertArchiveReason = (reason: unknown) => {
  const normalized = normalizePersian(reason);
  if (normalized.length < 3) throw new Error('دلیل بایگانی یا بازیابی الزامی است.');
  return normalized;
};

export const assertArchivedRecordMutable = (archivedAt?: Date | string | null) => {
  if (archivedAt) throw new Error('رکورد بایگانی‌شده تا زمان بازیابی قابل تغییر نیست.');
};

export const stableDeletionFingerprint = (impact: unknown, secret: string) =>
  crypto.createHmac('sha256', secret).update(JSON.stringify(canonicalize(impact))).digest('hex');

export const assertPermanentDeletionConfirmation = (input: {
  expectedFingerprint: string;
  suppliedFingerprint: unknown;
  expectedFullName: string;
  suppliedFullName: unknown;
  reason: unknown;
  confirmed: unknown;
}) => {
  if (!input.suppliedFingerprint || input.suppliedFingerprint !== input.expectedFingerprint) {
    throw new Error('پیش‌نمایش حذف منقضی یا نامعتبر است؛ پیش‌نمایش تازه دریافت کنید.');
  }
  assertArchiveReason(input.reason);
  if (normalizePersian(input.suppliedFullName) !== normalizePersian(input.expectedFullName)) {
    throw new Error('نام کامل واردشده با شخص انتخاب‌شده مطابقت ندارد.');
  }
  if (input.confirmed !== true) throw new Error('تأیید نهایی حذف دائمی الزامی است.');
};

export const assertPersonnelErasureTarget = (input: {
  actorUserId: string;
  targetUserId?: string | null;
  targetIsActiveAdmin: boolean;
  activeAdminCount: number;
}) => {
  if (input.targetUserId && input.targetUserId === input.actorUserId) {
    throw new Error('مدیر سامانه نمی‌تواند رکورد پرسنلی خود را حذف کند.');
  }
  if (input.targetIsActiveAdmin && input.activeAdminCount <= 1) {
    throw new Error('آخرین مدیر فعال سامانه قابل حذف نیست.');
  }
};
