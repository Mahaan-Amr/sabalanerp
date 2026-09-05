import assert from 'node:assert/strict';
import {
  HR_ACTION_PERMISSION_GROUPS,
  PERFORMANCE_ACTION_PERMISSION_CODES,
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
assert.ok(actionPermissionsForLegacyAuthority('HR_MANAGER').includes('VIEW_FORMAL_ASSESSMENT_RESULTS'));
assert.ok(actionPermissionsForLegacyAuthority('COMPANY_MANAGER').includes('RECORD_FINAL_MANAGEMENT_DECISION'));
assert.ok(actionPermissionsForLegacyAuthority('COMPANY_MANAGER').includes('VIEW_FORMAL_ASSESSMENT_RESULTS'));
assert.ok(actionPermissionsForLegacyAuthority('COMPANY_MANAGER').includes('MANAGE_PERSONNEL_SCHEDULE'));
assert.deepEqual(actionPermissionsForLegacyAuthority('UNKNOWN'), []);

assert.deepEqual(PERFORMANCE_ACTION_PERMISSION_CODES, [
  'REQUEST_PERFORMANCE_PRIVACY_CASE',
  'VIEW_PERFORMANCE_PRIVACY_CASE',
  'ACKNOWLEDGE_PERFORMANCE_PRIVACY_CASE',
  'VERIFY_PERFORMANCE_PRIVACY_IDENTITY',
  'DECIDE_PERFORMANCE_PRIVACY_ACCESS',
  'REGISTER_PERFORMANCE_CORRECTION',
  'DECIDE_PERFORMANCE_PRIVACY_CORRECTION',
  'DECIDE_PERFORMANCE_ERASURE',
  'RESTRICT_PERFORMANCE_EVIDENCE',
  'RELEASE_PERFORMANCE_RESTRICTION',
  'PLACE_PERFORMANCE_LEGAL_HOLD',
  'RELEASE_PERFORMANCE_LEGAL_HOLD',
  'MANAGE_PERFORMANCE_POLICY',
  'MANAGE_PERFORMANCE_CYCLE',
  'SUBMIT_PERFORMANCE_EVALUATION',
  'REVIEW_PERFORMANCE_EVALUATION',
  'VIEW_PERFORMANCE_HISTORY',
  'VIEW_PERFORMANCE_BADGE_LIST',
  'VIEW_PERFORMANCE_ANALYTICS',
  'VIEW_NAMED_PERFORMANCE_RANKING',
  'VIEW_EVALUATOR_CALIBRATION',
  'REQUEST_PERFORMANCE_EXPORT',
  'VIEW_PERFORMANCE_AUDIT',
  'MANAGE_PERFORMANCE_RETENTION',
  'CREATE_PERFORMANCE_CONSEQUENCE_HANDOFF',
  'VIEW_ASSIGNED_PERFORMANCE_CONSEQUENCE_HANDOFF',
  'REVIEW_PERFORMANCE_CONSEQUENCE_LEGAL_CONTROL',
  'MANAGE_COMPENSATION_AGREEMENTS',
  'MANAGE_PERFORMANCE_ROLLOUT',
  'PAUSE_PERFORMANCE_EVALUATION',
  'RECORD_PERFORMANCE_TRAINING',
  'APPROVE_PERFORMANCE_COHORT_HR',
  'APPROVE_PERFORMANCE_COHORT_SECURITY',
  'APPROVE_PERFORMANCE_COHORT_SYSTEM',
  'TECHNICALLY_ACTIVATE_PERFORMANCE_COHORT',
  'APPROVE_PERFORMANCE_RESUME_HR',
  'APPROVE_PERFORMANCE_RESUME_SECURITY',
  'APPROVE_PERFORMANCE_RESUME_SYSTEM',
]);

for (const code of PERFORMANCE_ACTION_PERMISSION_CODES) {
  assert.deepEqual(
    expandHrActionPermissionSelection([code]),
    [code],
    `${code} must remain an independent performance capability`,
  );
  for (const legacyAuthority of ['HR_PROCESSOR', 'HR_MANAGER', 'COMPANY_MANAGER']) {
    assert.ok(
      !actionPermissionsForLegacyAuthority(legacyAuthority).includes(code),
      `${legacyAuthority} must not imply ${code}`,
    );
  }
}
console.log('HR action permission catalog tests passed.');
