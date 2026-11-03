export const RECOVERY_FORMAT_VERSION = 1;
export const RECOVERY_RETENTION_MS = 24 * 60 * 60 * 1000;
export const RECOVERY_APPROVAL_MS = 30 * 60 * 1000;
export const RECOVERY_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000;
export const RESTORE_CONFIRMATION_PHRASE = 'RESTORE SABALAN ERP';

export type RecoveryPackageType = 'COMPLETE' | 'SANITIZED_TEST';

export const assertStrongBackupPassphrase = (value: unknown): string => {
  const passphrase = String(value || '');
  if (passphrase.length < 12 || !/[a-z]/i.test(passphrase) || !/\d/.test(passphrase)) {
    throw Object.assign(new Error('Backup passphrase must be at least 12 characters and contain letters and numbers.'), {
      code: 'WEAK_BACKUP_PASSPHRASE',
    });
  }
  return passphrase;
};

const versionParts = (value?: string | null) => {
  const match = String(value || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
};

export const recoveryCompatibility = (input: {
  sourceFormatVersion: number;
  targetFormatVersion?: number;
  sourceAppVersion?: string | null;
  targetAppVersion?: string | null;
  sourcePostgresVersion?: string | null;
  targetPostgresVersion?: string | null;
}) => {
  const targetFormat = input.targetFormatVersion ?? RECOVERY_FORMAT_VERSION;
  const sourceApp = versionParts(input.sourceAppVersion);
  const targetApp = versionParts(input.targetAppVersion);
  const sourcePg = Number(String(input.sourcePostgresVersion || '').match(/\d+/)?.[0]);
  const targetPg = Number(String(input.targetPostgresVersion || '').match(/\d+/)?.[0]);
  const reasons: string[] = [];
  if (input.sourceFormatVersion > targetFormat) reasons.push('BACKUP_FORMAT_NEWER_THAN_APPLICATION');
  if (sourceApp && targetApp) {
    const sourceComparable = sourceApp[0] * 1_000_000 + sourceApp[1] * 1_000 + sourceApp[2];
    const targetComparable = targetApp[0] * 1_000_000 + targetApp[1] * 1_000 + targetApp[2];
    if (sourceComparable > targetComparable) reasons.push('SOURCE_APPLICATION_NEWER_THAN_TARGET');
  }
  if (sourcePg && targetPg && sourcePg > targetPg) reasons.push('SOURCE_POSTGRES_NEWER_THAN_TARGET');
  return { compatible: reasons.length === 0, reasons };
};

export const assertRestoreAuthorization = (input: {
  actorId: string;
  activeAdminCount: number;
  approvedById?: string | null;
  approvalExpiresAt?: Date | null;
  breakGlassReason?: string;
  confirmationPhrase?: string;
  now?: Date;
}) => {
  if (input.confirmationPhrase !== RESTORE_CONFIRMATION_PHRASE) {
    throw Object.assign(new Error('Restore confirmation phrase does not match.'), { code: 'RESTORE_CONFIRMATION_MISMATCH' });
  }
  const now = input.now || new Date();
  if (input.activeAdminCount > 1) {
    if (!input.approvedById || input.approvedById === input.actorId) {
      throw Object.assign(new Error('A second active administrator must approve this restore.'), { code: 'SECOND_ADMIN_APPROVAL_REQUIRED' });
    }
    if (!input.approvalExpiresAt || input.approvalExpiresAt <= now) {
      throw Object.assign(new Error('Restore approval has expired.'), { code: 'RESTORE_APPROVAL_EXPIRED' });
    }
    return { mode: 'TWO_ADMIN' as const };
  }
  if (!String(input.breakGlassReason || '').trim()) {
    throw Object.assign(new Error('A break-glass reason is required when only one administrator is active.'), { code: 'BREAK_GLASS_REASON_REQUIRED' });
  }
  return { mode: 'BREAK_GLASS' as const };
};

export const packageExpired = (expiresAt: Date | null | undefined, now = new Date()) =>
  Boolean(expiresAt && expiresAt <= now);
