import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { canonicalGoPayload } from '../../deploy/scripts/lib/customer-allocation-go-manifest.mjs';
import { selectCurrentDataPredecessor } from '../../deploy/scripts/lib/customer-allocation-current-data.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const id = character => 'sha256:' + character.repeat(64);
const commit = character => character.repeat(40);
const label = {
  source: 'io.sabalan.performance.source-commit',
  hash: 'io.sabalan.performance.source-hash',
  upload: 'io.sabalan.release.upload-policy',
  browser: 'io.sabalan.browser.build-id',
};
const roles = ['backend', 'frontend', 'inquiry'];
const fixture = () => {
  const currentCommit = commit('a');
  const predecessorCommit = commit('b');
  const targetSha256 = 'c'.repeat(64);
  const scanner = { Id: 'd'.repeat(64), Image: id('e'), State: { Running: false, Status: 'exited' },
    Config: { Labels: { 'com.docker.compose.project': 'sabalanerp', 'com.docker.compose.service': 'clamav' } } };
  const current = Object.fromEntries(roles.map((role, index) => [role, { Id: id(String(index + 1)),
    Config: { Labels: { [label.source]: currentCommit, ...(role === 'backend' ? { [label.upload]: 'no-malware-scan' } : {}) } } }]));
  const selected = Object.fromEntries(roles.map((role, index) => [role, { Id: id(String(index + 4)),
    Config: { Labels: { [label.source]: predecessorCommit, [label.hash]: targetSha256,
      ...(role === 'frontend' ? { [label.browser]: 'erp_retained_build' } : {}) } } }]));
  const readerBytes = Buffer.from(JSON.stringify({ predecessorCommit, predecessorMigrationSha256: targetSha256,
    predecessorScannerContainerId: scanner.Id, predecessorScannerImage: scanner.Image, predecessorBrowserBuildId: 'erp_retained_build' }));
  const projectImages = images => Object.fromEntries(roles.map(role => [role, images[role].Id]));
  const payload = { schemaVersion: 1, decision: 'GO', operation: 'GROUPED_ALLOCATION', candidateCommit: currentCommit,
    migrationSha256: targetSha256, candidateImages: projectImages(current), predecessorImages: projectImages(selected),
    evidence: { reader: digest(readerBytes) } };
  return { payload, readerBytes, current, selected, scanner };
};

test('selects the original qualified scanner predecessor and binds closure to the historical GO digest', () => {
  const observed = fixture();
  assert.deepEqual(selectCurrentDataPredecessor(observed), {
    manifestSha256: digest(canonicalGoPayload(observed.payload)),
    targetCommit: commit('b'), targetSourceHash: 'c'.repeat(64), browserBuildId: 'erp_retained_build',
    images: { backend: id('4'), frontend: id('5'), inquiry: id('6') },
    scannerId: 'd'.repeat(64), scannerImage: id('e'),
  });
});

test('refuses rollback when the running release or retained dependencies drift', () => {
  for (const change of [
    input => { input.current.backend.Id = id('9'); },
    input => { input.selected.inquiry.Id = id('9'); },
    input => { input.scanner.State.Running = true; },
    input => { input.scanner.Id = 'f'.repeat(64); },
    input => { input.scanner.Image = id('f'); },
    input => { input.scanner.Config.Labels['com.docker.compose.project'] = 'other'; },
    input => { input.payload.migrationSha256 = 'f'.repeat(64); },
    input => { input.readerBytes = Buffer.from('{}'); },
  ]) {
    const observed = fixture();
    change(observed);
    assert.throws(() => selectCurrentDataPredecessor(observed), /CUSTOMER_ALLOCATION_CURRENT_DATA_UNPROVEN/);
  }
});

