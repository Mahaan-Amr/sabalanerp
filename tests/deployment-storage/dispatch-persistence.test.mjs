import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertDispatchVolumeTransition } from '../../deploy/scripts/dispatch-volume-preflight.mjs';

const read = file => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const mount = 'backend_storage_dispatch_documents:/app/storage/dispatch-documents';

test('protected dispatch artifacts share one durable mount across restore and backend startup', () => {
  const production = read('docker-compose.prod.yml');
  const rehearsal = read('docker-compose.rehearsal.yml');
  const backend = production.match(/  backend:\r?\n([\s\S]*?)\r?\n  deployment:/)?.[1];
  assert.ok(backend?.includes(mount), 'backend must read the dispatch volume restored by deployment');
  assert.match(production, /  deployment:\r?\n\s+extends:\r?\n\s+service: backend/);
  assert.match(rehearsal, /  backend:\r?\n\s+extends:\r?\n\s+file: docker-compose\.prod\.yml\r?\n\s+service: backend/);
  assert.match(rehearsal, /  deployment:\r?\n\s+extends:\r?\n\s+file: docker-compose\.prod\.yml\r?\n\s+service: deployment/);
  for (const graph of [production, rehearsal]) {
    assert.match(graph, /^  backend_storage_dispatch_documents:\s*$/m);
  }
  assert.match(read('deploy/scripts/storage-preflight.sh'), /for volume in [^\n]*backend_storage_dispatch_documents/);
  assert.match(read('backend/src/scripts/deployment-checkpoint.ts'), /directorySize\(path\.join\(process\.cwd\(\), 'storage', 'dispatch-documents'\)\)/);
  assert.match(read('backend/src/services/systemRecoveryEngine.ts'), /payloadPath: 'files\/dispatch-documents', livePath: DISPATCH_DOCUMENT_STORAGE_DIR/);
  assert.match(read('backend/src/scripts/deployment-gates.ts'), /name: 'dispatch-storage', run: writableDirectoryGate\('\/app\/storage\/dispatch-documents'\)/);
  assert.match(read('backend/src/services/deploymentGates.ts'), /'dispatch-storage'/);
  assert.ok(read('deploy/scripts/deploy.sh').indexOf('dispatch-volume-preflight.mjs')
    < read('deploy/scripts/deploy.sh').indexOf('run_backend node dist/scripts/validate-production-environment.js'));
  for (const composeFile of ['docker-compose.prod.yml', 'docker-compose.rehearsal.yml']) {
    const config = JSON.parse(execFileSync('docker', ['compose', '--profile', 'deployment', '-p', 'sabalanerp', '-f', composeFile, 'config', '--format', 'json'], {
      cwd: repositoryRoot,
      env: { ...process.env, DEPLOYMENT_QA_REHEARSAL_PLAN_SHA256: 'a'.repeat(64) }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }));
    const target = '/app/storage/dispatch-documents';
    const restored = config.services.deployment.volumes.filter(volume => volume.target === target);
    const served = config.services.backend.volumes.filter(volume => volume.target === target);
    assert.deepEqual(restored, served, `${composeFile}: restored dispatch artifact must remain visible after one-off container removal`);
    assert.deepEqual(served.map(({ type, source, read_only }) => ({ type, source, writable: read_only !== true })), [
      { type: 'volume', source: 'backend_storage_dispatch_documents', writable: true },
    ]);
  }
});

test('protected preflight refuses legacy container-layer files before a new volume can mask them', () => {
  const config = { services: { backend: { volumes: [{ type: 'volume', source: 'backend_storage_dispatch_documents',
    target: '/app/storage/dispatch-documents' }] } },
  volumes: { backend_storage_dispatch_documents: { name: 'sabalanerp_backend_storage_dispatch_documents' } } };
  const backend = { State: { Running: true }, Mounts: [] };
  assert.doesNotThrow(() => assertDispatchVolumeTransition(config, backend, ''));
  assert.throws(() => assertDispatchVolumeTransition(config, backend, '/app/storage/dispatch-documents/issued.pdf'),
    /DISPATCH_LEGACY_LAYER_ADOPTION_REQUIRED/);
  const mounted = { ...backend, Mounts: [{ Destination: '/app/storage/dispatch-documents', Type: 'volume',
    Name: 'sabalanerp_backend_storage_dispatch_documents', RW: true }] };
  assert.doesNotThrow(() => assertDispatchVolumeTransition(config, mounted, ''));
  mounted.Mounts[0].Name = 'other_dispatch_volume';
  assert.throws(() => assertDispatchVolumeTransition(config, mounted, ''), /DISPATCH_PREVIOUS_MOUNT_INVALID/);
});
