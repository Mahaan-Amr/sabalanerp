import assert from 'node:assert/strict';
import {
  HR_ACTION_PERMISSION_GROUPS,
  actionPermissionsForLegacyAuthority,
  expandHrActionPermissionSelection,
} from '../hrActionPermissionCatalog';

assert.ok(HR_ACTION_PERMISSION_GROUPS.every((group) => group.labelFa && group.permissions.length));
assert.deepEqual(
  expandHrActionPermissionSelection(['RECORD_PRELIMINARY_DECISION']),
  ['RECRUITMENT_CASES', 'VIEW_INITIAL_INTERVIEW_REPORT', 'RECORD_PRELIMINARY_DECISION'],
  'selecting an action includes and previews the minimum evidence permissions',
);
assert.ok(actionPermissionsForLegacyAuthority('HR_PROCESSOR').includes('RECORD_INITIAL_INTERVIEW'));
assert.ok(actionPermissionsForLegacyAuthority('HR_MANAGER').includes('RECORD_PRELIMINARY_DECISION'));
assert.ok(actionPermissionsForLegacyAuthority('COMPANY_MANAGER').includes('RECORD_FINAL_MANAGEMENT_DECISION'));
assert.deepEqual(actionPermissionsForLegacyAuthority('UNKNOWN'), []);
console.log('HR action permission catalog tests passed.');
