/** A retry must rebuild every authority-dependent result in its new scope. */
export async function readAccountingDashboardSnapshot<Scope, Workspace, Trend>(options: {
  withScope: <Result>(read: (scope: Scope) => Promise<Result>) => Promise<Result>;
  readWorkspace: (scope: Scope) => Promise<Workspace>;
  readTrend: (scope: Scope) => Promise<Trend>;
  retryWorkspace: () => Promise<Workspace>;
  onTrendError: (error: unknown) => void;
  onTransactionError: (error: unknown) => void;
}) {
  let workspaceCompleted = false;
  try {
    return await options.withScope(async scope => {
      const workspace = await options.readWorkspace(scope);
      workspaceCompleted = true;
      try {
        return { workspace, trend: await options.readTrend(scope), trendError: false };
      } catch (error) {
        options.onTrendError(error);
        return { workspace, trend: null, trendError: true };
      }
    });
  } catch (error) {
    if (!workspaceCompleted) throw error;
    options.onTransactionError(error);
    return { workspace: await options.retryWorkspace(), trend: null, trendError: true };
  }
}
