import assert from 'node:assert/strict';
import {
  assertValidEffectivePeriod,
  effectivePeriodsOverlap,
  normalizeIranianPlate,
  projectInternalDriverReadiness,
  assertLifecycleTransition,
  canPermanentlyDeleteDraft,
  auditOwnerForSubject,
  projectExternalDriverReadiness,
  projectExternalVehicleReadiness,
  assertNoLegacyDispatchReferences,
} from '../dispatchMasterDataPolicy';
import { evaluateNarrowFeatureAccess } from '../narrowFeatureAccess';

assert.equal(normalizeIranianPlate(' ۱۲ ب ۳۴۵ ایران ۶۷ '), '12ب345ایران67');
assert.equal(normalizeIranianPlate('IR-22 AA 010'), 'IR22AA010');

assert.equal(
  effectivePeriodsOverlap(
    { from: new Date('2026-08-01T00:00:00.000Z'), to: new Date('2026-08-10T00:00:00.000Z') },
    { from: new Date('2026-08-10T00:00:00.000Z'), to: null },
  ),
  false,
  'effective periods are half-open so a replacement may start exactly when its predecessor ends',
);
assert.equal(
  effectivePeriodsOverlap(
    { from: new Date('2026-08-01T00:00:00.000Z'), to: null },
    { from: new Date('2026-08-09T00:00:00.000Z'), to: new Date('2026-08-11T00:00:00.000Z') },
  ),
  true,
);
assert.throws(
  () => assertValidEffectivePeriod(new Date('2026-08-02T00:00:00.000Z'), new Date('2026-08-01T00:00:00.000Z')),
  /after its start/i,
);

const ready = projectInternalDriverReadiness({
  personnelActive: true,
  activeEmployment: true,
  eligible: true,
  drivingProfileActive: true,
  licenceNumber: 'LIC-1',
  licenceClass: 'CLASS_ONE',
  licenceExpiresAt: new Date('2026-12-01T00:00:00.000Z'),
  assignmentActive: true,
  assignedVehicleActive: true,
  assignedVehicleHasCurrentPlate: true,
}, new Date('2026-08-07T00:00:00.000Z'));
assert.deepEqual(ready, { status: 'READY', blockers: [] });

const blocked = projectInternalDriverReadiness({
  personnelActive: true,
  activeEmployment: true,
  eligible: false,
  drivingProfileActive: true,
  licenceNumber: '',
  licenceClass: '',
  licenceExpiresAt: null,
  assignmentActive: true,
  assignedVehicleActive: false,
  assignedVehicleHasCurrentPlate: false,
}, new Date('2026-08-07T00:00:00.000Z'));
assert.deepEqual(blocked, {
  status: 'NOT_READY',
  blockers: ['ELIGIBILITY_INACTIVE', 'LICENCE_NUMBER_MISSING', 'LICENCE_CLASS_MISSING', 'LICENCE_EXPIRY_MISSING', 'VEHICLE_NOT_ACTIVE', 'VEHICLE_PLATE_MISSING'],
});

const expiredLicence = projectInternalDriverReadiness({
  personnelActive: true, activeEmployment: true, eligible: true, drivingProfileActive: true,
  licenceNumber: 'LIC-2', licenceClass: 'CLASS_ONE', licenceExpiresAt: new Date('2026-01-01T00:00:00.000Z'),
  assignmentActive: true, assignedVehicleActive: true, assignedVehicleHasCurrentPlate: true,
}, new Date('2026-08-07T00:00:00.000Z'));
assert.deepEqual(expiredLicence.blockers, ['LICENCE_EXPIRED']);

assert.throws(() => assertLifecycleTransition('COMPANY_VEHICLE', 'DRAFT', 'OUT_OF_SERVICE'), /not permitted/i);
assert.doesNotThrow(() => assertLifecycleTransition('COMPANY_VEHICLE', 'DRAFT', 'ACTIVE'));
assert.doesNotThrow(() => assertLifecycleTransition('EXTERNAL_DRIVER', 'ACTIVE', 'RESTRICTED'));
assert.throws(() => assertLifecycleTransition('EXTERNAL_DRIVER', 'ARCHIVED', 'RESTRICTED'), /not permitted/i);

assert.equal(canPermanentlyDeleteDraft({ status: 'DRAFT', dependencyCount: 0 }), true);
assert.equal(canPermanentlyDeleteDraft({ status: 'DRAFT', dependencyCount: 1 }), false);
assert.equal(canPermanentlyDeleteDraft({ status: 'ARCHIVED', dependencyCount: 0 }), false);

assert.equal(auditOwnerForSubject('INTERNAL_DRIVER_ELIGIBILITY'), 'HR');
assert.equal(auditOwnerForSubject('INTERNAL_DRIVER_PROFILE'), 'VEHICLE_OPERATIONS');
assert.equal(auditOwnerForSubject('EXTERNAL_DRIVER'), 'GUARD');

const at = new Date('2026-08-07T00:00:00.000Z');
assert.deepEqual(projectExternalDriverReadiness({ lifecycleStatus: 'ACTIVE', documents: [] }, at), {
  status: 'NOT_READY', blockers: ['DRIVING_LICENCE_MISSING'],
});
assert.deepEqual(projectExternalDriverReadiness({ lifecycleStatus: 'ACTIVE', documents: [
  { documentType: 'DRIVING_LICENCE', expiresAt: new Date('2026-08-01T00:00:00.000Z') },
] }, at), { status: 'NOT_READY', blockers: ['DRIVING_LICENCE_EXPIRED'] });
assert.deepEqual(projectExternalDriverReadiness({ lifecycleStatus: 'ACTIVE', documents: [
  { documentType: 'DRIVING_LICENCE', expiresAt: new Date('2027-08-01T00:00:00.000Z') },
] }, at), { status: 'READY', blockers: [] });
assert.deepEqual(projectExternalDriverReadiness({ lifecycleStatus: 'ACTIVE', documents: [
  { documentType: 'DRIVING_LICENCE', expiresAt: new Date('2027-08-01T00:00:00.000Z') },
], continuityLinkedToActiveInternalIdentity: true }, at), { status: 'NOT_READY', blockers: ['CONTINUITY_LINKED_INTERNAL_IDENTITY_ACTIVE'] });

assert.deepEqual(projectExternalVehicleReadiness({ lifecycleStatus: 'ACTIVE', hasCurrentPlate: true, documents: [] }, at), {
  status: 'NOT_READY', blockers: ['VEHICLE_REGISTRATION_MISSING'],
});
assert.deepEqual(projectExternalVehicleReadiness({ lifecycleStatus: 'ACTIVE', hasCurrentPlate: true, documents: [
  { documentType: 'VEHICLE_REGISTRATION', expiresAt: new Date('2026-08-07T00:00:00.000Z') },
] }, at), { status: 'NOT_READY', blockers: ['VEHICLE_REGISTRATION_EXPIRED'] });
assert.deepEqual(projectExternalVehicleReadiness({ lifecycleStatus: 'ACTIVE', hasCurrentPlate: true, documents: [
  { documentType: 'VEHICLE_REGISTRATION', expiresAt: new Date('2027-08-01T00:00:00.000Z') },
] }, at), { status: 'READY', blockers: [] });

assert.doesNotThrow(() => assertNoLegacyDispatchReferences({ queueTurnIds: [], existingAssignmentCount: 0, vehiclePairId: null }));
assert.throws(() => assertNoLegacyDispatchReferences({ queueTurnIds: ['legacy-turn'], existingAssignmentCount: 0, vehiclePairId: null }), /retired/i);
assert.throws(() => assertNoLegacyDispatchReferences({ queueTurnIds: [], existingAssignmentCount: 1, vehiclePairId: null }), /retired/i);
assert.throws(() => assertNoLegacyDispatchReferences({ queueTurnIds: [], existingAssignmentCount: 0, vehiclePairId: 'legacy-pair' }), /retired/i);

const narrowAt = new Date('2026-08-07T00:00:00.000Z');
const hrWorkspaceEditOnly = evaluateNarrowFeatureAccess({ role: 'USER', requiredPermission: 'view', userFeature: null, roleFeature: null, userWorkspace: { isActive: true, expiresAt: null, permissionLevel: 'edit' }, roleWorkspace: null }, narrowAt);
assert.deepEqual(hrWorkspaceEditOnly, { allowed: false, permissionLevel: null });
assert.deepEqual(evaluateNarrowFeatureAccess({ role: 'USER', requiredPermission: 'view', userFeature: { isActive: true, expiresAt: null, permissionLevel: 'view' }, roleFeature: null, userWorkspace: null, roleWorkspace: null }, narrowAt), { allowed: true, permissionLevel: 'view' });
assert.deepEqual(evaluateNarrowFeatureAccess({ role: 'USER', requiredPermission: 'edit', userFeature: { isActive: true, expiresAt: null, permissionLevel: 'edit' }, roleFeature: null, userWorkspace: null, roleWorkspace: null }, narrowAt), { allowed: true, permissionLevel: 'edit' });
assert.deepEqual(evaluateNarrowFeatureAccess({ role: 'USER', requiredPermission: 'view', userFeature: { isActive: true, expiresAt: new Date('2026-08-06T00:00:00.000Z'), permissionLevel: 'admin' }, roleFeature: null, userWorkspace: null, roleWorkspace: null }, narrowAt), { allowed: false, permissionLevel: null });
assert.deepEqual(evaluateNarrowFeatureAccess({ role: 'ADMIN', requiredPermission: 'edit', userFeature: null, roleFeature: null, userWorkspace: null, roleWorkspace: null }, narrowAt), { allowed: true, permissionLevel: 'admin' });
assert.deepEqual(evaluateNarrowFeatureAccess({ role: 'MANAGER', requiredPermission: 'edit', userFeature: null, roleFeature: null, userWorkspace: null, roleWorkspace: null }, narrowAt), { allowed: false, permissionLevel: null });
assert.deepEqual(evaluateNarrowFeatureAccess({ role: 'MANAGER', requiredPermission: 'edit', userFeature: null, roleFeature: null, userWorkspace: { isActive: true, expiresAt: null, permissionLevel: 'admin' }, roleWorkspace: null }, narrowAt), { allowed: true, permissionLevel: 'admin' });
assert.deepEqual(evaluateNarrowFeatureAccess({ role: 'USER', requiredPermission: 'edit', userFeature: { isActive: true, expiresAt: null, permissionLevel: 'view' }, roleFeature: null, userWorkspace: { isActive: true, expiresAt: null, permissionLevel: 'admin' }, roleWorkspace: null }, narrowAt), { allowed: true, permissionLevel: 'admin' });
assert.deepEqual(evaluateNarrowFeatureAccess({ role: 'USER', requiredPermission: 'view', userFeature: null, roleFeature: null, userWorkspace: { isActive: true, expiresAt: null, permissionLevel: 'view' }, roleWorkspace: { isActive: true, expiresAt: null, permissionLevel: 'admin' } }, narrowAt), { allowed: false, permissionLevel: null });

console.log('Dispatch master-data policy tests passed.');
