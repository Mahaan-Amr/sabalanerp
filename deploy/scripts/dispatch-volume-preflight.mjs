import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const target = '/app/storage/dispatch-documents';
const source = 'backend_storage_dispatch_documents';

export function assertDispatchVolumeTransition(config, backend, legacyEntry) {
  const volumes = config.services?.backend?.volumes?.filter(volume => volume.target === target) ?? [];
  assert.equal(volumes.length, 1, 'DISPATCH_VOLUME_GRAPH_INVALID');
  assert.equal(volumes[0].type, 'volume', 'DISPATCH_VOLUME_GRAPH_INVALID');
  assert.equal(volumes[0].source, source, 'DISPATCH_VOLUME_GRAPH_INVALID');
  assert.notEqual(volumes[0].read_only, true, 'DISPATCH_VOLUME_GRAPH_INVALID');
  const name = config.volumes?.[source]?.name;
  assert.ok(name && typeof name === 'string', 'DISPATCH_VOLUME_GRAPH_INVALID');
  assert.equal(backend.State?.Running, true, 'DISPATCH_PREVIOUS_BACKEND_NOT_RUNNING');
  const mounts = backend.Mounts?.filter(mount => mount.Destination === target) ?? [];
  assert.ok(mounts.length <= 1, 'DISPATCH_PREVIOUS_MOUNT_INVALID');
  if (mounts.length) {
    assert.equal(mounts[0].Type, 'volume', 'DISPATCH_PREVIOUS_MOUNT_INVALID');
    assert.equal(mounts[0].Name, name, 'DISPATCH_PREVIOUS_MOUNT_INVALID');
    assert.equal(mounts[0].RW, true, 'DISPATCH_PREVIOUS_MOUNT_INVALID');
  } else {
    assert.equal(legacyEntry, '', 'DISPATCH_LEGACY_LAYER_ADOPTION_REQUIRED');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const [envFile, composeFile] = process.argv.slice(2);
    assert.ok(envFile && composeFile, 'DISPATCH_PREFLIGHT_ARGUMENTS_INVALID');
    const compose = args => execFileSync('docker', ['compose', '--env-file', envFile, '-f', composeFile, ...args],
      { encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
    const config = JSON.parse(compose(['config', '--format', 'json']));
    const id = compose(['ps', '-q', 'backend']).trim();
    assert.match(id, /^[a-f0-9]{12,64}$/, 'DISPATCH_PREVIOUS_BACKEND_ID_INVALID');
    const [backend] = JSON.parse(execFileSync('docker', ['inspect', id], { encoding: 'utf8', timeout: 30_000 }));
    assert.equal(backend.Id, id, 'DISPATCH_PREVIOUS_BACKEND_ID_INVALID');
    const mounted = backend.Mounts?.some(mount => mount.Destination === target);
    const legacyEntry = mounted ? '' : execFileSync('docker', ['exec', id, 'sh', '-c',
      'if [ -e /app/storage/dispatch-documents ] || [ -L /app/storage/dispatch-documents ]; then find /app/storage/dispatch-documents -mindepth 1 -print -quit; fi'],
    { encoding: 'utf8', timeout: 30_000 }).trim();
    assertDispatchVolumeTransition(config, backend, legacyEntry);
  } catch (error) {
    console.error(error?.message || 'DISPATCH_VOLUME_PREFLIGHT_FAILED');
    process.exitCode = 1;
  }
}
