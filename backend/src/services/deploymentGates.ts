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

/** Earlier qualification gates allow private readiness startup only. They do
 * not assert that the later protected deployment passed its production gates. */
export function completeProtectedPrivateQualificationPrerequisite(value:unknown,expected:{releaseId:string;manifestSha256:string;qualificationCheckpointSha256:string;qualificationReports:Record<string,string>}){
  const row=value as Record<string,any>;
  return !!row&&typeof row==='object'&&!Array.isArray(row)
    &&Object.keys(row).length===6&&['format','releaseId','manifestSha256','qualificationCheckpointSha256','publicTrafficQualified','qualificationReports'].every(key=>Object.prototype.hasOwnProperty.call(row,key))
    &&row.format==='sabalan-protected-private-qualification-prerequisite/v1'&&row.publicTrafficQualified===false
    &&row.releaseId===expected.releaseId&&row.manifestSha256===expected.manifestSha256
    &&row.qualificationCheckpointSha256===expected.qualificationCheckpointSha256
    &&/^[a-f0-9]{64}$/.test(row.qualificationCheckpointSha256)
    &&row.qualificationReports&&typeof row.qualificationReports==='object'&&!Array.isArray(row.qualificationReports)
    &&Object.keys(row.qualificationReports).length===5&&Object.keys(expected.qualificationReports).length===5
    &&['compatible-migrations','coherent-independent-restore','browser-24-hours','single-worker-and-completion','current-domain']
      .every(scope=>Object.prototype.hasOwnProperty.call(row.qualificationReports,scope)&&/^[a-f0-9]{64}$/.test(row.qualificationReports[scope])
        &&row.qualificationReports[scope]===expected.qualificationReports[scope]);
}

/** ONLINE readiness is a separate stage from publication. All five typed
 * proofs are still validated by the evidence reader; this cannot stand in
 * for the original controller's later eighteen production gate results. */
export function completeOnlinePrivateQualificationPrerequisite(value:unknown,expected:{releaseId:string;manifestSha256:string;checkpointSha256:string;captureId:string;qualificationReports:Record<string,string>}){
  const row=value as Record<string,any>;
  if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).sort().join(',')!==
    ['format','releaseId','manifestSha256','checkpointSha256','captureId','publicTrafficQualified','qualificationReports'].sort().join(','))return false;
  if(row.format!=='sabalan-online-private-qualification-prerequisite/v1'||row.publicTrafficQualified!==false
    ||row.checkpointSha256!==expected.checkpointSha256||row.captureId!==expected.captureId
    ||!/^[a-f0-9]{64}$/.test(row.checkpointSha256)||!/^[a-f0-9]{64}$/.test(row.captureId))return false;
  return completeProtectedPrivateQualificationPrerequisite({format:'sabalan-protected-private-qualification-prerequisite/v1',
    releaseId:row.releaseId,manifestSha256:row.manifestSha256,qualificationCheckpointSha256:row.checkpointSha256,
    publicTrafficQualified:row.publicTrafficQualified,qualificationReports:row.qualificationReports},
    {...expected,qualificationCheckpointSha256:expected.checkpointSha256});
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
