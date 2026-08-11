import assert from 'node:assert/strict';
import { assertMandatoryDeploymentGates, connectionUtilizationDecision, runMandatoryDeploymentGates } from '../deploymentGates';

const run = async () => {
  const results = await runMandatoryDeploymentGates([
    { name: 'healthy', run: async () => ({ ok: true }) },
    { name: 'broken', run: async () => { throw new Error('no'); } },
  ]);
  assert.equal(results[0].passed, true);
  assert.equal(results[1].passed, false);
  assert.throws(() => assertMandatoryDeploymentGates(results), (error: any) => error?.code === 'DEPLOYMENT_GATES_FAILED');
  assert.equal(connectionUtilizationDecision(59, 100).level, 'HEALTHY');
  assert.equal(connectionUtilizationDecision(60, 100).level, 'WARNING');
  assert.equal(connectionUtilizationDecision(75, 100).level, 'CRITICAL');
  assert.equal(connectionUtilizationDecision(85, 100).mayDeploy, false);
  console.log('deployment gates tests passed');
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
