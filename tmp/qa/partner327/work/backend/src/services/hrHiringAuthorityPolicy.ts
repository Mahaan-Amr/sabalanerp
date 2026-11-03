export const assertHiringAuthorityMutationAllowed = (input: {
  actorRole: string;
  actorUserId: string;
  actorAuthorities: string[];
  action: 'GRANT' | 'REVOKE';
  targetUserId: string;
  targetRole: string;
  authority: string;
  activeCompanyManagerCount: number;
}) => {
  const superAdmin = input.actorRole === 'ADMIN';
  const companyManager = input.actorAuthorities.includes('COMPANY_MANAGER');
  if (!superAdmin && !companyManager) throw new Error('اختیار مدیریت شرکت یا نقش مدیر سامانه الزامی است.');
  if (!superAdmin && input.targetRole === 'ADMIN') {
    throw new Error('مدیر شرکت نمی‌تواند اختیارهای مدیر سامانه را تغییر دهد.');
  }
  if (!superAdmin && input.authority === 'COMPANY_MANAGER') {
    throw new Error('فقط مدیر سامانه می‌تواند اختیار مدیریت شرکت را واگذار یا سلب کند.');
  }
  if (!superAdmin && input.action === 'REVOKE' && input.targetUserId === input.actorUserId) {
    throw new Error('مدیر شرکت نمی‌تواند اختیار خود را سلب کند.');
  }
  if (input.action === 'REVOKE' && input.authority === 'COMPANY_MANAGER' && input.activeCompanyManagerCount <= 1) {
    throw new Error('آخرین مدیر شرکت فعال قابل سلب اختیار نیست.');
  }
};
