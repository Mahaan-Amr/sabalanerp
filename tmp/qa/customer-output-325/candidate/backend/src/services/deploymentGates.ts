export type DeploymentGateResult = {
  name: string;
  passed: boolean;
  durationMs: number;
  details?: Record<string, unknown>;
  error?: string;
};

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
