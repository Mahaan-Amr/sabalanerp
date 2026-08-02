import { getUserWorkspaces, WORKSPACE_PERMISSIONS, WORKSPACES, WorkspacePermission } from '../middleware/workspace';
import {
  buildSalesReport,
  SalesReportAccess,
  SalesReportQuery,
} from './salesReportingService';
import { buildBiRecommendations } from './biRecommendationService';

export type BiReportUser = {
  id: string;
  role: string;
  departmentId?: string | null;
};

export const resolveBiReportAccess = ({
  user,
  workspacePermission,
}: {
  user: BiReportUser;
  workspacePermission: WorkspacePermission;
}): SalesReportAccess => ({
  userId: user.id,
  role: user.role,
  departmentId: user.departmentId,
  canManage: true,
  canCompany:
    user.role === 'ADMIN'
    || workspacePermission === WORKSPACE_PERMISSIONS.ADMIN,
});

export type BiSourceState = 'complete' | 'partial' | 'unavailable' | 'unauthorized';

export type BiSourceCoverage = {
  covered: number;
  total: number;
};

export const resolveBiSourceState = ({
  available,
  authorized = true,
  covered,
  total,
}: {
  available: boolean;
  authorized?: boolean;
  covered: number;
  total: number;
}): { state: BiSourceState; coverage: BiSourceCoverage | null } => {
  if (!authorized) return { state: 'unauthorized', coverage: null };
  if (!available) return { state: 'unavailable', coverage: null };
  return {
    state: covered >= total ? 'complete' : 'partial',
    coverage: { covered, total },
  };
};

export type BiSourceHealth = {
  source: 'SALES' | 'CRM' | 'ACCOUNTING' | 'LOGISTICS' | 'SECURITY';
  state: BiSourceState;
  refreshedAt: string | null;
  coverage: BiSourceCoverage | null;
};

export const buildBiSnapshot = async ({
  user,
  workspacePermission,
  query,
}: {
  user: BiReportUser;
  workspacePermission: WorkspacePermission;
  query: SalesReportQuery;
}) => {
  const workspaces = await getUserWorkspaces(user.id, user.role);
  const accessibleSources = new Set(workspaces.map((row) => row.workspace));
  const report = await buildSalesReport(
    {
      ...resolveBiReportAccess({ user, workspacePermission }),
      canOpenSalesSource: accessibleSources.has(WORKSPACES.SALES),
    },
    query,
  );
  const accounting = resolveBiSourceState({
    available: report.sourceAvailability.accounting,
    covered: report.finance.coverage.coveredContracts,
    total: report.finance.coverage.totalContracts,
  });
  const crm = resolveBiSourceState({
    available: report.sourceAvailability.crm,
    covered: 0,
    total: 0,
  });
  const logistics = resolveBiSourceState({
    available: report.sourceAvailability.logistics,
    covered: report.delivery.coverage.coveredContracts,
    total: report.delivery.coverage.totalContracts,
  });
  const security = resolveBiSourceState({
    available: report.sourceAvailability.security,
    covered: report.delivery.coverage.coveredContracts,
    total: report.delivery.coverage.totalContracts,
  });
  const recommendations = buildBiRecommendations({
    ...report.riskEvidence,
    currentNetRealized: report.cards.netRealized,
    previousNetRealized: report.cards.previousNetRealized,
    legacyUnassigned: report.legacyUnassigned,
  }).filter((row) => {
    if (row.id === 'overdue-collections') return report.sourceAvailability.accounting;
    if (['overdue-follow-ups', 'crm-won-not-linked'].includes(row.id)) return report.sourceAvailability.crm;
    if (['delivery-not-linked', 'guard-exit-not-linked'].includes(row.id)) return report.sourceAvailability.logistics;
    return true;
  });

  return {
    ...report,
    snapshotVersion: 1 as const,
    recommendations,
    sourceRecordAccess: {
      sales: accessibleSources.has(WORKSPACES.SALES),
      crm: accessibleSources.has(WORKSPACES.CRM),
      accounting: accessibleSources.has(WORKSPACES.ACCOUNTING),
      logistics: accessibleSources.has(WORKSPACES.LOGISTICS),
      security: accessibleSources.has(WORKSPACES.SECURITY),
    },
    sourceHealth: [
      {
        source: 'SALES' as const,
        state: 'complete' as const,
        refreshedAt: report.generatedAt,
        coverage: null,
      },
      {
        source: 'CRM' as const,
        ...crm,
        refreshedAt: report.sourceAvailability.crm ? report.generatedAt : null,
      },
      {
        source: 'ACCOUNTING' as const,
        ...accounting,
        refreshedAt: report.generatedAt,
      },
      {
        source: 'LOGISTICS' as const,
        ...logistics,
        refreshedAt: report.generatedAt,
      },
      {
        source: 'SECURITY' as const,
        ...security,
        refreshedAt: report.generatedAt,
      },
    ] satisfies BiSourceHealth[],
  };
};

export type BiSnapshot = Awaited<ReturnType<typeof buildBiSnapshot>>;
