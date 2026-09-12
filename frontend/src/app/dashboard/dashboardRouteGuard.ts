export function deniesDashboardWorkspaceRoute(input: {
  workspaceAccessLoading: boolean;
  currentWorkspace: string | null;
  taskScopedDutyRoute: boolean;
  accessibleWorkspaceIds: readonly string[];
  routeAllowed: boolean | null;
}) {
  return Boolean(!input.workspaceAccessLoading
    && input.currentWorkspace
    && !input.taskScopedDutyRoute
    && input.routeAllowed !== true
    && !input.accessibleWorkspaceIds.includes(input.currentWorkspace));
}
