import assert from 'node:assert/strict';
import { assertHiringAuthorityMutationAllowed } from '../hrHiringAuthorityPolicy';
import { activeHiringAuthoritiesAt } from '../hrHiringDashboardMetrics';

const companyManager = { actorRole: 'USER', actorUserId: 'manager-1', actorAuthorities: ['COMPANY_MANAGER'], targetRole: 'USER' };

assert.doesNotThrow(() => assertHiringAuthorityMutationAllowed({
  ...companyManager, action: 'GRANT', targetUserId: 'user-1', authority: 'HR_PROCESSOR', activeCompanyManagerCount: 2,
}));
assert.throws(() => assertHiringAuthorityMutationAllowed({
  ...companyManager, action: 'GRANT', targetUserId: 'user-1', authority: 'COMPANY_MANAGER', activeCompanyManagerCount: 2,
}), /مدیر سامانه/);
assert.throws(() => assertHiringAuthorityMutationAllowed({
  ...companyManager, action: 'REVOKE', targetUserId: 'manager-1', authority: 'HR_PROCESSOR', activeCompanyManagerCount: 2,
}), /اختیار خود/);
assert.doesNotThrow(() => assertHiringAuthorityMutationAllowed({
  actorRole: 'ADMIN', actorUserId: 'admin-1', actorAuthorities: [], action: 'GRANT', targetUserId: 'user-1', targetRole: 'USER', authority: 'COMPANY_MANAGER', activeCompanyManagerCount: 1,
}));

assert.throws(() => assertHiringAuthorityMutationAllowed({
  actorRole: 'USER', actorUserId: 'manager-1', actorAuthorities: ['COMPANY_MANAGER'], action: 'GRANT',
  targetUserId: 'admin-1', targetRole: 'ADMIN', authority: 'HR_MANAGER', activeCompanyManagerCount: 2
}), /مدیر سامانه/);
assert.throws(() => assertHiringAuthorityMutationAllowed({
  actorRole: 'ADMIN', actorUserId: 'admin-1', actorAuthorities: [], action: 'REVOKE', targetUserId: 'manager-1', targetRole: 'USER', authority: 'COMPANY_MANAGER', activeCompanyManagerCount: 1,
}), /آخرین مدیر شرکت/);

assert.deepEqual(activeHiringAuthoritiesAt([
  { authority: 'FINANCE_RECORDER', isActive: true, expiresAt: null },
  { authority: 'FINANCE_MANAGER', isActive: true, expiresAt: new Date('2026-08-08T07:59:59.999Z') },
  { authority: 'FINANCE_MANAGER', isActive: false, expiresAt: null },
], new Date('2026-08-08T08:00:00.000Z')), ['FINANCE_RECORDER']);

console.log('HR hiring authority policy tests passed.');
