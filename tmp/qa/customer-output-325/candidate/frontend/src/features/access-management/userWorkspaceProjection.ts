export type WorkspaceProjectionPermission = {
  id: string;
  workspace: string;
  permissionLevel: string;
  isActive: boolean;
};

export type CanonicalHrWorkspaceGrant = {
  id: string;
  workspaceCode?: string;
  level: 'VIEW' | 'EDIT' | 'ADMIN';
  status: string;
  userId?: string;
  effectiveFrom?: string;
  effectiveTo?: string | null;
};

export type CanonicalHrWorkspaceSnapshot = {
  grants: CanonicalHrWorkspaceGrant[];
  evaluatedAt: string;
};

export type TimeBoundAccess = {
  isActive?: boolean;
  status?: string;
  expiresAt?: string | null;
  effectiveFrom?: string;
  effectiveTo?: string | null;
};

export type ProjectedWorkspaceAccess = {
  key: string;
  workspace: string;
  permissionLevel: string;
  source: 'direct' | 'role' | 'admin';
};

const hrLevel = (level: CanonicalHrWorkspaceGrant['level']) => level.toLowerCase();

const accessEvaluationTime = (evaluatedAt: string | number) => {
  const evaluationTime = typeof evaluatedAt === 'number' ? evaluatedAt : new Date(evaluatedAt).getTime();
  if (!Number.isFinite(evaluationTime)) {
    throw new Error('An authoritative server evaluation time is required for HR access projection.');
  }
  return evaluationTime;
};

export const isAccessEffectiveAt = (access: TimeBoundAccess, evaluatedAt: string | number) => {
  const evaluationTime = accessEvaluationTime(evaluatedAt);
  if (access.isActive === false || (access.status && access.status !== 'ACTIVE')) return false;
  if (access.expiresAt && new Date(access.expiresAt).getTime() <= evaluationTime) return false;
  if (access.effectiveFrom && new Date(access.effectiveFrom).getTime() > evaluationTime) return false;
  return !access.effectiveTo || new Date(access.effectiveTo).getTime() > evaluationTime;
};

export const projectUserWorkspaceAccess = ({
  role,
  directPermissions,
  roleDefaults,
  canonicalHrSnapshot,
}: {
  role: string;
  directPermissions: WorkspaceProjectionPermission[];
  roleDefaults: WorkspaceProjectionPermission[];
  canonicalHrSnapshot: CanonicalHrWorkspaceSnapshot;
}): ProjectedWorkspaceAccess[] => {
  accessEvaluationTime(canonicalHrSnapshot.evaluatedAt);
  if (role === 'ADMIN') {
    return ['sales', 'crm', 'hr', 'accounting', 'inventory', 'security', 'bi', 'logistics'].map((workspace) => ({
      key: `admin-${workspace}`,
      workspace,
      permissionLevel: 'admin',
      source: 'admin',
    }));
  }

  const activeDirect = directPermissions.filter((permission) => permission.isActive && permission.workspace !== 'hr');
  const activeRole = roleDefaults.filter((permission) => permission.isActive);
  const directWorkspaces = new Set(activeDirect.map((permission) => permission.workspace));
  const canonicalHr = [...canonicalHrSnapshot.grants]
    .filter((grant) => isAccessEffectiveAt(grant, canonicalHrSnapshot.evaluatedAt)
      && grant.workspaceCode === 'HUMAN_RESOURCES')
    .sort((left, right) => String(right.effectiveFrom || '').localeCompare(String(left.effectiveFrom || '')))[0];

  return [
    ...activeDirect.map((permission) => ({
      key: permission.id,
      workspace: permission.workspace,
      permissionLevel: permission.permissionLevel,
      source: 'direct' as const,
    })),
    ...(canonicalHr ? [{
      key: canonicalHr.id,
      workspace: 'hr',
      permissionLevel: hrLevel(canonicalHr.level),
      source: 'direct' as const,
    }] : []),
    ...activeRole
      .filter((permission) => !directWorkspaces.has(permission.workspace) && !(permission.workspace === 'hr' && canonicalHr))
      .map((permission) => ({
        key: permission.id,
        workspace: permission.workspace,
        permissionLevel: permission.permissionLevel,
        source: 'role' as const,
      })),
  ];
};
