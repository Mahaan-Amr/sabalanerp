import assert from 'node:assert/strict';
import { assertHiringAuthorityMutationAllowed } from '../hrHiringAuthorityPolicy';

const companyManager = { actorRole: 'USER', actorUserId: 'manager-1', actorAuthorities: ['COMPANY_MANAGER'] };

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
  actorRole: 'ADMIN', actorUserId: 'admin-1', actorAuthorities: [], action: 'GRANT', targetUserId: 'user-1', authority: 'COMPANY_MANAGER', activeCompanyManagerCount: 1,
}));
assert.throws(() => assertHiringAuthorityMutationAllowed({
  actorRole: 'ADMIN', actorUserId: 'admin-1', actorAuthorities: [], action: 'REVOKE', targetUserId: 'manager-1', authority: 'COMPANY_MANAGER', activeCompanyManagerCount: 1,
}), /آخرین مدیر شرکت/);

console.log('HR hiring authority policy tests passed.');
