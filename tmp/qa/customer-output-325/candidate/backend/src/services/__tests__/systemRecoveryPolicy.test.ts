import assert from 'node:assert/strict';
import {
  assertRestoreAuthorization,
  assertStrongBackupPassphrase,
  packageExpired,
  recoveryCompatibility,
  RESTORE_CONFIRMATION_PHRASE,
} from '../systemRecoveryPolicy';

assert.equal(assertStrongBackupPassphrase('StoneRecovery2026'), 'StoneRecovery2026');
assert.throws(() => assertStrongBackupPassphrase('short'), (error: any) => error.code === 'WEAK_BACKUP_PASSPHRASE');

assert.deepEqual(
  recoveryCompatibility({
    sourceFormatVersion: 1,
    sourceAppVersion: '1.0.0',
    targetAppVersion: '1.1.0',
    sourcePostgresVersion: '15.4',
    targetPostgresVersion: '15.8',
  }),
  { compatible: true, reasons: [] },
);
assert.equal(recoveryCompatibility({
  sourceFormatVersion: 2,
  sourceAppVersion: '2.0.0',
  targetAppVersion: '1.0.0',
  sourcePostgresVersion: '16',
  targetPostgresVersion: '15',
}).compatible, false);

assert.deepEqual(assertRestoreAuthorization({
  actorId: 'admin-1',
  activeAdminCount: 2,
  approvedById: 'admin-2',
  approvalExpiresAt: new Date(Date.now() + 60_000),
  confirmationPhrase: RESTORE_CONFIRMATION_PHRASE,
}), { mode: 'TWO_ADMIN' });

assert.throws(() => assertRestoreAuthorization({
  actorId: 'admin-1',
  activeAdminCount: 2,
  approvedById: 'admin-1',
  approvalExpiresAt: new Date(Date.now() + 60_000),
  confirmationPhrase: RESTORE_CONFIRMATION_PHRASE,
}), (error: any) => error.code === 'SECOND_ADMIN_APPROVAL_REQUIRED');

assert.deepEqual(assertRestoreAuthorization({
  actorId: 'admin-1',
  activeAdminCount: 1,
  breakGlassReason: 'Only active administrator during disaster recovery',
  confirmationPhrase: RESTORE_CONFIRMATION_PHRASE,
}), { mode: 'BREAK_GLASS' });

assert.equal(packageExpired(new Date(Date.now() - 1)), true);
assert.equal(packageExpired(new Date(Date.now() + 60_000)), false);

console.log('systemRecoveryPolicy tests passed');
