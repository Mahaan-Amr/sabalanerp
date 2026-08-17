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

export type ProjectedWorkspaceAccess = {
  key: string;
  workspace: string;
  permissionLevel: string;
  source: 'direct' | 'role' | 'admin';
};

const hrLevel = (level: CanonicalHrWorkspaceGrant['level']) => level.toLowerCase();

export const projectUserWorkspaceAccess = ({
  role,
  directPermissions,
  roleDefaults,
  canonicalHrGrants,
  evaluatedAt,
}: {
  role: string;
  directPermissions: WorkspaceProjectionPermission[];
  roleDefaults: WorkspaceProjectionPermission[];
  canonicalHrGrants: CanonicalHrWorkspaceGrant[];
  evaluatedAt?: string;
}): ProjectedWorkspaceAccess[] => {
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
  const evaluationTime = evaluatedAt ? new Date(evaluatedAt).getTime() : Date.now();
  const canonicalHr = [...canonicalHrGrants]
    .filter((grant) => {
      return grant.status === 'ACTIVE'
        && grant.workspaceCode === 'HUMAN_RESOURCES'
        && (!grant.effectiveFrom || new Date(grant.effectiveFrom).getTime() <= evaluationTime)
        && (!grant.effectiveTo || new Date(grant.effectiveTo).getTime() > evaluationTime);
    })
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
