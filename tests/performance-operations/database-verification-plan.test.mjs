import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { performanceDatabaseChecks } from '../../scripts/run-performance-local-verification.mjs';

test('database collector routes shared-client suites through the migrated-clone wrapper', () => {
  const root = path.resolve('fixture-candidate');
  const checks = performanceDatabaseChecks(root, {});
  assert.deepEqual(checks.map(check => check.args.at(-1)), [
    'src/services/__tests__/dispatchDocumentsCandidateSchema.integration.test.ts',
    'src/services/__tests__/personnelPerformancePolicy.integration.test.ts',
    'src/services/__tests__/personnelPerformanceWorkflow.integration.test.ts',
    'src/services/__tests__/personnelPerformanceExportLineage.integration.test.ts',
    'src/services/__tests__/personnelPerformanceMonitoring.integration.test.ts',
    'src/services/__tests__/personnelPerformanceSafetyRaces.integration.test.ts',
  ]);
  for (const check of checks) {
    assert.equal(check.command, process.execPath);
    assert.deepEqual(check.args.slice(0, 2), ['--import', 'tsx']);
    assert.equal(check.cwd, path.join(root, 'backend'));
    const source = new URL(check.env.DATABASE_URL);
    assert.equal(source.host, '127.0.0.1:55432');
    assert.equal(source.pathname, '/sabalanerp');
    assert.equal(check.env.NODE_ENV, 'test');
    assert.equal(source.searchParams.get('pool_timeout'), '10');
    assert.equal(source.searchParams.get('connection_limit'), check.name.includes('lineage') ? '4' : '2');
  }
});

test('local race counts are explicit regression evidence with bounded clone overhead', () => {
  const environment = { DATABASE_URL: 'postgresql://never-use-this/production', PERFORMANCE_RACE_ITERATIONS: '100' };
  const checks = performanceDatabaseChecks('/candidate', environment);
  assert.equal(environment.DATABASE_URL, 'postgresql://never-use-this/production');
  assert.ok(checks.every(check => !check.env.DATABASE_URL.includes('never-use-this')));
  const race = checks.find(check => check.name.includes('safety-races'));
  assert.equal(race.env.PERFORMANCE_RACE_ITERATIONS, '100');
  assert.equal(race.timeoutMs, 305 * 60_000);
  assert.equal(performanceDatabaseChecks('/candidate', {}).at(-1).env.PERFORMANCE_RACE_ITERATIONS, '10');
  for (const value of ['0', '-1', '1001', '1.5', 'NaN', '']) {
    assert.throws(() => performanceDatabaseChecks('/candidate', { PERFORMANCE_RACE_ITERATIONS: value }), /Invalid local/);
  }
});
