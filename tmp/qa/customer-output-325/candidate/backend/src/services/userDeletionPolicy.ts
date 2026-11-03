export interface UserDeletionActor {
  id: string;
  role: string;
}

export interface UserDeletionTarget {
  id: string;
  username: string;
  role: string;
  isActive: boolean;
}

export class UserDeletionPolicyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'UserDeletionPolicyError';
  }
}

export const assertUserCanBeDeleted = (params: {
  actor: UserDeletionActor;
  target: UserDeletionTarget;
  confirmationUsername: unknown;
  adminCount: number;
  activeAdminCount: number;
}) => {
  const { actor, target, confirmationUsername, adminCount, activeAdminCount } = params;

  if (actor.role !== 'ADMIN') {
    throw new UserDeletionPolicyError('USER_DELETE_ADMIN_REQUIRED', 'فقط مدیر سیستم می‌تواند حساب کاربری را حذف کند.', 403);
  }
  if (actor.id === target.id) {
    throw new UserDeletionPolicyError('USER_DELETE_SELF_FORBIDDEN', 'حذف حساب کاربری فعلی مجاز نیست.', 409);
  }
  if (String(confirmationUsername || '') !== target.username) {
    throw new UserDeletionPolicyError('USER_DELETE_CONFIRMATION_MISMATCH', 'برای تأیید حذف، نام کاربری را دقیق وارد کنید.', 400);
  }
  if (target.role === 'ADMIN' && adminCount <= 1) {
    throw new UserDeletionPolicyError('USER_DELETE_LAST_ADMIN', 'آخرین حساب مدیر سیستم قابل حذف نیست.', 409);
  }
  if (target.role === 'ADMIN' && target.isActive && activeAdminCount <= 1) {
    throw new UserDeletionPolicyError('USER_DELETE_LAST_ACTIVE_ADMIN', 'آخرین مدیر فعال سیستم قابل حذف نیست.', 409);
  }
};

const ACCESS_ONLY_RELATIONS = new Set(['workspacePermissions', 'featurePermissions']);

export const collectUserDeletionBlockers = (
  relationCounts: Record<string, number>,
  options: { hasSecurityPersonnel?: boolean } = {}
): string[] => {
  const blockers = Object.entries(relationCounts)
    .filter(([relation, count]) => count > 0 && !ACCESS_ONLY_RELATIONS.has(relation))
    .map(([relation]) => relation)
    .sort();
  if (options.hasSecurityPersonnel) blockers.push('securityPersonnel');
  return blockers;
};
