// Source-only inspection primitive. The host launcher has not been wired to it.
// Input must come from the trusted host's Docker inspect, never from a container.
import assert from 'node:assert/strict';
import { assertProductionImageInspection } from './production-image-execution-binding.mjs';

export function inspectMigrationControl({ container, image, binding, graph, resolved, expectedId, expectedImage, projectionSource, keeperCommand, previous }) {
  assert.match(expectedId, /^[a-f0-9]{64}$/);
  assert.match(expectedImage, /^sha256:[a-f0-9]{64}$/);
  assert.equal(container.Id, expectedId);
  assert.equal(container.Image, expectedImage);
  assert.equal(binding.role, 'backend');
  assert.equal(binding.executionImageId, expectedImage);
  assertProductionImageInspection(binding, image, graph);
  const service = resolved.services?.deployment;
  assert.equal(service?.image, expectedImage);
  assert.deepEqual(container.Config?.Entrypoint, ['/usr/bin/python3']);
  assert.deepEqual(container.Config?.Cmd, keeperCommand);
  assert.equal(container.State?.Running, true);
  assert.ok(container.State.StartedAt && container.State.StartedAt !== '0001-01-01T00:00:00Z');
  assert.ok(Array.isArray(image.RootFS?.Layers) && image.RootFS.Layers.length > 0);
  const roles = container.Config?.Env?.filter(v => v.startsWith('BACKEND_RUNTIME_ROLE='));
  assert.deepEqual(roles, ['BACKEND_RUNTIME_ROLE=control']);
  assert.ok(typeof projectionSource === 'string' && projectionSource.startsWith('/'));
  const mounts = container.Mounts;
  assert.ok(Array.isArray(mounts));
  assert.ok(Array.isArray(service.volumes));
  const expected = service.volumes.map(v => ({ type: v.type, target: v.target,
    source: v.type === 'volume' ? resolved.volumes?.[v.source]?.name : v.source, rw: v.read_only !== true }));
  expected.push({ type: 'bind', target: '/run/deployment-migration-projection.json', source: projectionSource, rw: false });
  assert.equal(mounts.length, expected.length);
  assert.equal(new Set(expected.map(v => v.target)).size, expected.length);
  for (const want of expected) {
    assert.ok(['volume', 'bind'].includes(want.type) && typeof want.source === 'string' && want.source.length > 0);
    assert.equal(mounts.filter(m => m.Type === want.type && m.Destination === want.target && m.RW === want.rw && (want.type === 'volume' ? m.Name : m.Source) === want.source).length, 1);
  }
  const projection = mounts.filter(m => m.Destination === '/run/deployment-migration-projection.json');
  assert.equal(projection.length, 1);
  assert.equal(projection[0].Type, 'bind');
  assert.equal(projection[0].Source, projectionSource);
  assert.equal(projection[0].RW, false);
  for (const target of ['/app/dist', '/app/prisma', '/app/scripts']) {
    assert.ok(!mounts.some(m => typeof m.Destination !== 'string' || m.Destination === '/' || target === m.Destination || target.startsWith(m.Destination + '/') || m.Destination.startsWith(target + '/')));
  }
  const observed = { id: container.Id, image: container.Image, startedAt: container.State.StartedAt,
    entrypoint: container.Config.Entrypoint, command: container.Config.Cmd, mounts, layers: image.RootFS.Layers };
  if (previous) assert.deepEqual(observed, previous);
  return observed;
}
