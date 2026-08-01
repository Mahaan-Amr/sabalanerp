import { WORKSPACES, WORKSPACE_PERMISSIONS, Workspace, WorkspacePermission } from '../middleware/workspace';
import { SalesReportAccess } from './salesReportingService';

export const resolveCoreDashboardSalesAccess = ({
  user,
  workspacePermissions,
}: {
  user: { id: string; role: string; departmentId?: string | null };
  workspacePermissions: Array<{ workspace: Workspace; permission: WorkspacePermission }>;
}): SalesReportAccess | null => {
  const salesPermission = workspacePermissions.find((entry) => entry.workspace === WORKSPACES.SALES)?.permission;
  if (!salesPermission) return null;
  return {
    userId: user.id,
    role: user.role,
    departmentId: user.departmentId,
    canManage: user.role === 'ADMIN' || salesPermission === WORKSPACE_PERMISSIONS.ADMIN,
    canCompany: user.role === 'ADMIN',
  };
};
