import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/qualify-accounting-production-state.mjs', import.meta.url));
const sha = 'a'.repeat(64);
const sample = (surface, durationMs, i, extra = {}) => ({ surface, durationMs, status: 200, requestId: `${surface}-${i}`, phase: i === 0 ? 'cold' : 'warm', ...extra });
const input = () => ({
  format: 'sabalan-accounting-production-state-requests/v1',
  provenance: { kind: 'protected-production-state-recovery-copy', recoveryManifestSha256: sha, populationEvidenceSha256: sha, sourcePopulation: { ordinaryContracts: 935, committedPartnerCases: 30 }, privateIngress: true, evidenceRef: 'private/restore-123', workloadSource: 'recovery-copy-123' },
  candidate: { commit: '1'.repeat(40), tree: '2'.repeat(40), backendImage: `sha256:${sha}`, frontendImage: `sha256:${'b'.repeat(64)}` },
  workload: { actorClass: 'authorized-accountant', actorSha256: 'c'.repeat(64), ordinaryContracts: 935, committedPartnerCases: 30, concurrency: 1, filters: ['reviewable'], pageSize: 100, observation: 'full HTTP responses', endpoints: { dashboard: '/api/accounting/dashboard', 'reviewable-list': '/api/accounting/contracts?view=reviewable' } },
  requests: [...Array.from({ length: 20 }, (_, i) => sample('dashboard', 1000 + i, i)), ...Array.from({ length: 20 }, (_, i) => sample('reviewable-list', 2000 + i, i))],
});
function run(data) {
  const dir = mkdtempSync(join(tmpdir(), 'accounting-gate-'));
  const inFile = join(dir, 'input.json'); const outFile = join(dir, 'receipt.json');
  writeFileSync(inFile, JSON.stringify(data));
  const result = spawnSync(process.execPath, [script, '--input', inFile, '--output', outFile], { encoding: 'utf8' });
  return { process: result, receipt: JSON.parse(readFileSync(outFile, 'utf8')) };
}
test('complete request measurements pass below 3000 ms and retain workload shape', () => {
  const { process, receipt } = run(input());
  assert.equal(process.status, 0);
  assert.equal(receipt.decision, 'MEASUREMENT_PASS_ONLY');
  assert.equal(receipt.surfaces.dashboard.p95Ms, 1018);
  assert.equal(receipt.surfaces['reviewable-list'].p95Ms, 2018);
  assert.equal(receipt.workload.ordinaryContracts, 935);
  assert.equal(receipt.surfaces.dashboard.count, 20);
  assert.equal(receipt.surfaces.dashboard.p2024Count, 0);
  assert.equal(receipt.workload.endpoints['reviewable-list'], '/api/accounting/contracts?view=reviewable');
});
test('p95 at 3000 ms and P2028 block measurement even with successful status', () => {
  const data = input();
  data.requests[18].durationMs = 3000;
  data.requests[19].durationMs = 3100;
  data.requests[20].errorCode = 'P2028';
  const { process, receipt } = run(data);
  assert.equal(process.status, 2);
  assert.equal(receipt.decision, 'MEASUREMENT_FAIL');
  assert.equal(receipt.surfaces.dashboard.p95Ms, 3000);
  assert.equal(receipt.surfaces['reviewable-list'].p2028Count, 1);
});
test('unproven provenance and incomplete samples cannot pass', () => {
  const data = input();
  data.provenance.kind = 'local-fixture';
  data.requests = data.requests.slice(0, 3);
  const { process, receipt } = run(data);
  assert.equal(process.status, 2);
  assert.equal(receipt.decision, 'MEASUREMENT_FAIL');
  assert.match(receipt.reasons.join(' '), /provenance|samples/);
});
test('P2024 and malformed durations fail closed', () => {
  const data = input();
  data.requests[0].errorCode = 'P2024';
  data.requests[1].durationMs = null;
  const { process, receipt } = run(data);
  assert.equal(process.status, 2);
  assert.equal(receipt.surfaces.dashboard.p2024Count, 1);
  assert.match(receipt.reasons.join(' '), /Invalid request record/);
});
test('unmatched population and empty error code cannot produce a pass receipt', () => {
  const data = input();
  data.workload.ordinaryContracts = 0;
  data.workload.committedPartnerCases = 0;
  data.requests[0].errorCode = '';
  const { process, receipt } = run(data);
  assert.equal(process.status, 2);
  assert.equal(receipt.decision, 'MEASUREMENT_FAIL');
  assert.match(receipt.reasons.join(' '), /population invalid/);
  assert.match(receipt.reasons.join(' '), /Invalid request record/);
  assert.equal(receipt.surfaces.dashboard.errorCount, 1);
});
test('actual production population can contain no ordinary contracts when independently bound to the source', () => {
  const data = input();
  data.provenance.sourcePopulation.ordinaryContracts = 0;
  data.workload.ordinaryContracts = 0;
  const { process, receipt } = run(data);
  assert.equal(process.status, 0);
  assert.equal(receipt.decision, 'MEASUREMENT_PASS_ONLY');
  assert.equal(receipt.provenance.sourcePopulation.ordinaryContracts, 0);
});
test('null request records fail with a receipt', () => {
  const data = input();
  data.requests[0] = null;
  const { process, receipt } = run(data);
  assert.equal(process.status, 2);
  assert.equal(receipt.decision, 'MEASUREMENT_FAIL');
  assert.match(receipt.reasons.join(' '), /Invalid request record/);
});
