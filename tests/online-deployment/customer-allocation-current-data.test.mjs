import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { planStorageCleanup, readStorageProtection } from '../../scripts/deployment-storage.mjs';
import { canonicalGoPayload } from '../../deploy/scripts/lib/customer-allocation-go-manifest.mjs';
import { createAllocationRetention, selectCurrentDataPredecessor } from '../../deploy/scripts/lib/customer-allocation-current-data.mjs';

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
    Mounts: [{ Destination: '/var/lib/clamav', Type: 'volume', Name: 'sabalanerp_clamav_database', RW: true }],
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

function retainedFixture() {
  const input = fixture();
  return { ...input, retention: createAllocationRetention(input.payload, input.readerBytes, digest(canonicalGoPayload(input.payload))) };
}

test('selects the original qualified scanner predecessor and binds closure to the historical GO digest', () => {
  const observed = retainedFixture();
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
    input => { input.scanner.Mounts[0].Name = 'foreign_scanner_database'; },
    input => { input.scanner.Config.Labels['com.docker.compose.project'] = 'other'; },
    input => { input.payload.migrationSha256 = 'f'.repeat(64); },
    input => { input.readerBytes = Buffer.from('{}'); },
    input => { delete input.retention; },
    input => { input.retention.predecessorImages.backend = id('9'); },
  ]) {
    const observed = retainedFixture();
    change(observed);
    assert.throws(() => selectCurrentDataPredecessor(observed), /CUSTOMER_ALLOCATION_CURRENT_DATA_UNPROVEN/);
  }
});


test('canonical cleanup preserves all retained predecessor images after the activation checkpoint ages out', async () => {
  const { retention } = retainedFixture();
  const directory = mkdtempSync(join(tmpdir(), 'allocation-retention-'));
  try {
    const reference = join(directory, 'customer-allocation-active-retention.json');
    writeFileSync(reference, JSON.stringify(retention));
    const protectedImages = await readStorageProtection([], [reference]);
    const images = [...Object.values(retention.predecessorImages), retention.scannerImage, id('9')].map(image => ({
      id: image, project: 'sabalanerp', createdAt: '2026-01-01T00:00:00Z',
    }));
    const plan = planStorageCleanup({ evidenceComplete: true, project: 'sabalanerp', protectedImages,
      protectedContainers: [], containers: [], images, now: Date.parse('2026-11-17T00:00:00Z') });
    assert.deepEqual(plan.images, [id('9')]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('scanner cleanup is limited to the retained stopped container recorded by the operation', { skip: !process.getuid }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'allocation-scanner-'));
  try {
    const { scanner } = fixture();
    const state = join(directory, 'scanner.json');
    const journal = join(directory, 'reviewed-operation.json');
    const helper = fileURLToPath(new URL('../../deploy/scripts/lib/customer-allocation-current-data.mjs', import.meta.url));
    const env = { ...process.env, PATH: directory + ':' + process.env.PATH, FIXTURE_SCANNER_FILE: state };
    writeFileSync(state, JSON.stringify(scanner));
    writeFileSync(join(directory, 'docker'), `#!/usr/bin/env node
const fs = require('node:fs');
const file = process.env.FIXTURE_SCANNER_FILE;
const scanner = JSON.parse(fs.readFileSync(file, 'utf8'));
const command = process.argv.slice(2);
if (command[0] === 'container' && command[1] === 'inspect') {
  console.log(JSON.stringify([scanner]));
} else if (command[0] === 'stop' && command.at(-1) === scanner.Id) {
  scanner.State = { Running: false, Status: 'exited' };
  fs.writeFileSync(file, JSON.stringify(scanner));
} else {
  process.exitCode = 1;
}
`, { mode: 0o700 });
    const run = args => spawnSync(process.execPath, [helper, ...args], { env });
    assert.equal(run(['stage-scanner', journal, scanner.Id, scanner.Image]).status, 0);
    assert.equal(statSync(journal).mode & 0o777, 0o600);

    scanner.State = { Running: true, Status: 'running' };
    writeFileSync(state, JSON.stringify({ ...scanner, Image: id('a') }));
    assert.equal(run(['stop-staged-scanner', journal]).status, 1);
    assert.equal(JSON.parse(readFileSync(state)).State.Running, true);

    writeFileSync(state, JSON.stringify(scanner));
    assert.equal(run(['stop-staged-scanner', journal]).status, 0);
    assert.equal(JSON.parse(readFileSync(state)).State.Status, 'exited');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
