// Source-only inspection primitive. The host launcher has not been wired to it.
// Input must come from the trusted host's Docker inspect, never from a container.
import assert from 'node:assert/strict';
import { assertProductionImageInspection, sanitizeProductionImageInspection, productionInspectionSha256 } from './production-image-execution-binding.mjs';
import { validateDeploymentRoleBinding } from './deployment-role-binding.mjs';
import { inspectPrivateDockerArchive, inspectPrivateDockerArchiveForExecution } from '../../scripts/lib/private-docker-image-archive.mjs';

/** Reconcile an actual retained Docker archive against the host's native image
 * inspection. This is image identity evidence, not a migration authority. */
export function inspectMaintenanceMigrationImage({ archive, expectedIndex, image, store }) {
  const graph = expectedIndex === undefined
    ? inspectPrivateDockerArchiveForExecution(archive, image.Id, store)
    : inspectPrivateDockerArchive(archive, expectedIndex);
  const nativeInspection = sanitizeProductionImageInspection(image);
  const binding = { format: 'sabalan-production-image-execution-binding/v1', role: 'backend', store, graph,
    executionImageId: image.Id, nativeInspection, inspectionSha256: productionInspectionSha256(nativeInspection) };
  assertProductionImageInspection(binding, image, graph);
  return { graph, binding };
}

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
  // Compose configuration can contain credentials. Validate it in memory and
  // compare without passing either URL to an assertion that could print it.
  validateDeploymentRoleBinding(resolved);
  const actualUrls = container.Config?.Env?.filter(v => v.startsWith('DATABASE_URL='));
  assert.ok(Array.isArray(actualUrls) && actualUrls.length === 1, 'MIGRATION_CONTROL_DB_BINDING_UNPROVEN');
  assert.ok(actualUrls[0].slice('DATABASE_URL='.length) === service.environment.DATABASE_URL,
    'MIGRATION_CONTROL_DB_BINDING_UNPROVEN');
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

/** The host owns both callbacks and must retain the same container throughout.
 * An unsuccessful or ambiguous child is never represented as a completed
 * migration; this function creates no container or authorization token. */
export async function executeInspectedMigrationControl({ observe, execute }) {
  assert.equal(typeof observe, 'function');
  assert.equal(typeof execute, 'function');
  const first = inspectMigrationControl(await observe());
  let child;
  try { child = await execute(first.id); }
  catch { child = undefined; }
  // Check the actual incarnation again even when the child reports failure.
  inspectMigrationControl({ ...(await observe()), previous: first });
  assert.ok(child && child.exitCode === 0 && child.signal === null && child.stdoutClosed === true && child.stderrClosed === true,
    'MIGRATION_CONTROL_EXECUTION_UNPROVEN');
}
