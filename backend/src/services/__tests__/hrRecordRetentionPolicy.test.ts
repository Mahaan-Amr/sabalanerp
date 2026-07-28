import assert from 'node:assert/strict';
import {
  assertArchiveReason,
  assertArchivedRecordMutable,
  assertPermanentDeletionConfirmation,
  assertPersonnelErasureTarget,
  projectRecordRetentionCapabilities,
  stableDeletionFingerprint,
} from '../hrRecordRetentionPolicy';

assert.deepEqual(projectRecordRetentionCapabilities({ role: 'USER', authorities: ['HR_MANAGER'], archived: false }), {
  canArchive: true, canRestore: false, canPermanentlyDelete: false,
});
assert.deepEqual(projectRecordRetentionCapabilities({ role: 'ADMIN', authorities: [], archived: true }), {
  canArchive: false, canRestore: true, canPermanentlyDelete: true,
});
assert.deepEqual(projectRecordRetentionCapabilities({ role: 'MANAGER', authorities: [], archived: false }), {
  canArchive: false, canRestore: false, canPermanentlyDelete: false,
});

assert.throws(() => assertArchiveReason('  '), /دلیل/);
assert.doesNotThrow(() => assertArchiveReason('ثبت تکراری پرونده'));
assert.throws(() => assertArchivedRecordMutable(new Date()), /بایگانی/);
assert.doesNotThrow(() => assertArchivedRecordMutable(null));

const impact = { targetId: 'application-1', updatedAt: '2026-07-27T10:00:00.000Z', counts: { documents: 2, tasks: 1 }, files: ['a.pdf'] };
const fingerprint = stableDeletionFingerprint(impact, 'test-secret');
assert.equal(fingerprint, stableDeletionFingerprint({ ...impact, counts: { tasks: 1, documents: 2 } }, 'test-secret'));
assert.notEqual(fingerprint, stableDeletionFingerprint({ ...impact, counts: { documents: 3, tasks: 1 } }, 'test-secret'));
assert.notEqual(
  stableDeletionFingerprint({ decidedAt: new Date('2026-07-27T10:00:00.000Z') }, 'test-secret'),
  stableDeletionFingerprint({ decidedAt: new Date('2026-07-27T10:00:01.000Z') }, 'test-secret'),
);

assert.doesNotThrow(() => assertPermanentDeletionConfirmation({
  expectedFingerprint: fingerprint,
  suppliedFingerprint: fingerprint,
  expectedFullName: 'علی آزمون',
  suppliedFullName: 'علي آزمون',
  reason: 'درخواست حذف دائمی ثبت اشتباه',
  confirmed: true,
}));
assert.throws(() => assertPermanentDeletionConfirmation({
  expectedFingerprint: fingerprint,
  suppliedFingerprint: 'stale',
  expectedFullName: 'علی آزمون',
  suppliedFullName: 'علی آزمون',
  reason: 'درخواست حذف دائمی ثبت اشتباه',
  confirmed: true,
}), /منقضی/);

assert.throws(() => assertPersonnelErasureTarget({ actorUserId: 'admin-1', targetUserId: 'admin-1', targetIsActiveAdmin: true, activeAdminCount: 2 }), /خود/);
assert.throws(() => assertPersonnelErasureTarget({ actorUserId: 'admin-1', targetUserId: 'admin-2', targetIsActiveAdmin: true, activeAdminCount: 1 }), /آخرین/);
assert.doesNotThrow(() => assertPersonnelErasureTarget({ actorUserId: 'admin-1', targetUserId: 'admin-2', targetIsActiveAdmin: true, activeAdminCount: 2 }));

console.log('HR record retention policy tests passed.');
