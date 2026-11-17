import assert from 'node:assert/strict';
import test from 'node:test';
import { completePredecessorRoleGateReport, mandatoryReleaseDeploymentGateNames, predecessorRoleGateModes } from '../deploymentGates';

const checkpoint = { checksum: 'f'.repeat(64), releaseId: 'role-cutover-455' };
const rolloutOnly = new Set(['migration-history', 'shipment-statement-runtime-state', 'contract-financial-evidence']);

for (const [mode, names] of [
  [predecessorRoleGateModes.applied, [...mandatoryReleaseDeploymentGateNames]],
  [predecessorRoleGateModes.rollback, mandatoryReleaseDeploymentGateNames.filter(name => !rolloutOnly.has(name))],
] as const) {
  test(mode + ' requires the exact gate inventory and checkpoint readback', () => {
    const report = {
      format: 'sabalan-deployment-report', version: 1, mode, releaseId: checkpoint.releaseId,
      gates: names.map(name => ({ name, passed: true,
        details: name === 'checkpoint-manifest' ? { ...checkpoint, remoteReadBack: true } : {} })),
    };
    assert.equal(completePredecessorRoleGateReport(report, checkpoint), true);
    const missing = { ...report, gates: report.gates.slice(1) };
    assert.equal(completePredecessorRoleGateReport(missing, checkpoint), false);
    const duplicate = { ...report, gates: [report.gates[1], ...report.gates.slice(1)] };
    assert.equal(completePredecessorRoleGateReport(duplicate, checkpoint), false);
    assert.equal(completePredecessorRoleGateReport(report, { ...checkpoint, checksum: '0'.repeat(64) }), false);
    const wrongMode = { ...report, mode: 'RELEASE' };
    assert.equal(completePredecessorRoleGateReport(wrongMode, checkpoint), false);
  });
}
