import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectIntegratedRegressionMeasurements } from '../../scripts/performance-integrated-measurements.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');

test('binds integrated checks and both review axes to one candidate', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'performance-integrated-'));
  const shared = 'PASS personnelPerformanceFoundation\nPASS personnelPerformanceDisclosure\nPASS personnelPerformanceOperations\n';
  await writeFile(path.join(directory, '8.log'), shared);
  const direct = ['backend-build', 'frontend-build', 'lint', 'architecture', 'design-system',
    'performance-unit', 'performance-policy-database', 'performance-workflow-database'];
  const report = {
    status: 'PASS', blockers: [],
    identity: { commit: 'a'.repeat(40) }, finalIdentity: { commit: 'a'.repeat(40) },
    checks: [
      ...direct.map((name) => ({ name, status: 'PASS' })),
      { name: 'performance-shared-client-database', status: 'PASS', log: '8.log', logHash: digest(shared) },
    ],
  };
  const review = {
    schemaVersion: 1, contract: 'PERSONNEL_PERFORMANCE_CODE_REVIEW_V1', commit: 'a'.repeat(40),
    standards: { status: 'PASS', findings: [] }, spec: { status: 'PASS', findings: [] },
  };
  const result = await collectIntegratedRegressionMeasurements({ report, review, directory });
  assert.equal(result.checks.length, 11);
  assert.ok(result.checks.every(({ status }) => status === 'PASS'));
  assert.deepEqual({ openP0: result.openP0, openP1: result.openP1, skipped: result.skipped },
    { openP0: 0, openP1: 0, skipped: 0 });
});

test('rejects review drift and a claimed subcheck missing from the raw log', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'performance-integrated-'));
  const shared = 'PASS personnelPerformanceFoundation\n';
  await writeFile(path.join(directory, '8.log'), shared);
  const report = { status: 'PASS', blockers: [], identity: { commit: 'a'.repeat(40) },
    finalIdentity: { commit: 'a'.repeat(40) }, checks: [{ name: 'performance-shared-client-database',
      status: 'PASS', log: '8.log', logHash: digest(shared) }] };
  const review = { schemaVersion: 1, contract: 'PERSONNEL_PERFORMANCE_CODE_REVIEW_V1', commit: 'b'.repeat(40),
    standards: { status: 'PASS', findings: [] }, spec: { status: 'PASS', findings: [] } };
  await assert.rejects(() => collectIntegratedRegressionMeasurements({ report, review, directory }),
    /INTEGRATED_REVIEW_CANDIDATE_MISMATCH|INTEGRATED_CHECK_MISSING/);
});
