export type DeploymentGateResult = {
  name: string;
  passed: boolean;
  durationMs: number;
  details?: Record<string, unknown>;
  error?: string;
};

export const mandatoryReleaseDeploymentGateNames = [
  'postgres-query-and-isolated-write', 'migration-history', 'shipment-statement-runtime-state',
  'contract-financial-evidence', 'inquiry-sqlite-integrity', 'backend-readiness', 'frontend-health',
  'inquiry-health', 'nginx-health', 'contracts-storage', 'hr-storage', 'accounting-storage',
  'support-storage', 'performance-export-storage', 'uploads-storage', 'database-file-references',
  'checkpoint-manifest', 'database-connection-capacity',
] as const;

export function completeReleaseDeploymentGateReport(report: unknown) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) return false;
  const row = report as Record<string, unknown>;
  if (row.format !== 'sabalan-deployment-report' || row.version !== 1 || row.mode !== 'RELEASE'
      || !Array.isArray(row.gates) || row.gates.length !== mandatoryReleaseDeploymentGateNames.length) return false;
  const gates = row.gates.map(gate => gate && typeof gate === 'object' && !Array.isArray(gate)
    ? gate as Record<string, unknown> : null);
  return gates.every(gate => gate?.passed === true && typeof gate.name === 'string')
    && new Set(gates.map(gate => gate!.name)).size === mandatoryReleaseDeploymentGateNames.length
    && mandatoryReleaseDeploymentGateNames.every(name => gates.some(gate => gate!.name === name));
}

export const runMandatoryDeploymentGates = async (
  gates: Array<{ name: string; run: () => Promise<Record<string, unknown> | void> }>,
): Promise<DeploymentGateResult[]> => {
  const results: DeploymentGateResult[] = [];
  for (const gate of gates) {
    const startedAt = Date.now();
    try {
      const details = await gate.run();
      results.push({ name: gate.name, passed: true, durationMs: Date.now() - startedAt, ...(details ? { details } : {}) });
    } catch (error: any) {
      results.push({ name: gate.name, passed: false, durationMs: Date.now() - startedAt, error: String(error?.message || error) });
    }
  }
  return results;
};

export const assertMandatoryDeploymentGates = (results: DeploymentGateResult[]) => {
  const failed = results.filter((result) => !result.passed);
  if (failed.length) {
    throw Object.assign(new Error(`Mandatory deployment gates failed: ${failed.map((gate) => gate.name).join(', ')}`), {
      code: 'DEPLOYMENT_GATES_FAILED',
      results,
    });
  }
};

export const connectionUtilizationDecision = (used: number, maximum: number) => {
  if (!Number.isFinite(used) || !Number.isFinite(maximum) || maximum <= 0) {
    throw Object.assign(new Error('Database connection capacity could not be measured.'), { code: 'DEPLOYMENT_CONNECTION_CAPACITY_INVALID' });
  }
  const utilization = used / maximum;
  return {
    used,
    maximum,
    utilization,
    level: utilization >= 0.85 ? 'BLOCK' : utilization >= 0.75 ? 'CRITICAL' : utilization >= 0.6 ? 'WARNING' : 'HEALTHY',
    mayDeploy: utilization < 0.85,
  } as const;
};
