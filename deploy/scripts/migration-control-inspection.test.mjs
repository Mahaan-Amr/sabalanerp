import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectMigrationControl } from './migration-control-inspection.mjs';
import { sanitizeProductionImageInspection, productionInspectionSha256 } from './production-image-execution-binding.mjs';

function fixture(store = 'classic') {
  const id = 'a'.repeat(64), config = 'sha256:' + 'b'.repeat(64), index = 'sha256:' + 'c'.repeat(64), source = '/reviewed/projection.json';
  const imageId = store === 'classic' ? config : index, layer = 'sha256:' + 'd'.repeat(64);
  const graph = { config, index, rootfsDiffIds: [layer] };
  const image = { Id: imageId, Descriptor: store === 'classic' ? null : { digest: index, mediaType: 'application/vnd.oci.image.index.v1+json', size: 500 }, RootFS: { Type: 'layers', Layers: [layer] }, Os: 'linux', Architecture: 'amd64', Config: { Labels: null } };
  const nativeInspection = sanitizeProductionImageInspection(image);
  const binding = { format:'sabalan-production-image-execution-binding/v1', role:'backend', store, graph, executionImageId:imageId, nativeInspection, inspectionSha256:productionInspectionSha256(nativeInspection) };
  const keeperCommand = ['-I','-B','-c','fixed keeper'];
  return { expectedId: id, expectedImage: imageId, projectionSource: source,
    image, graph, binding, keeperCommand, resolved: { services: { deployment: { image: imageId, volumes: [] } }, volumes: {} },
    container: { Id: id, Image: imageId, State: { Running: true, StartedAt: '2026-11-02T00:00:00Z' },
      Config: { Env: ['BACKEND_RUNTIME_ROLE=control'], Entrypoint: ['/usr/bin/python3'], Cmd: keeperCommand },
      Mounts: [{ Type: 'bind', Source: source, Destination: '/run/deployment-migration-projection.json', RW: false }] } };
}
test('binds same original container, image, projection and incarnation before and after', () => {
  const input = fixture(), previous = inspectMigrationControl(input);
  assert.deepEqual(inspectMigrationControl({ ...input, previous }), previous);
  input.container.State.StartedAt = '2026-11-03T00:00:00Z';
  assert.throws(() => inspectMigrationControl({ ...input, previous }));
});
test('containerd INDEX selection uses the existing native binding', () => {
  const input = fixture('containerd'); inspectMigrationControl(input);
  input.image.Descriptor.digest = input.graph.config;
  assert.throws(() => inspectMigrationControl(input));
});
test('resolved named volumes must match without omissions or extras', () => {
  const input = fixture();
  input.resolved.volumes = { data: { name: 'sabalanerp-local-data' } };
  input.resolved.services.deployment.volumes = [{ type: 'volume', source: 'data', target: '/data' }];
  input.container.Mounts.push({ Type: 'volume', Name: 'sabalanerp-local-data', Destination: '/data', RW: true });
  inspectMigrationControl(input);
  input.container.Mounts[1].Name = 'unexpected-volume';
  assert.throws(() => inspectMigrationControl(input));
});
test('fails closed on changed image, writable projection, role or code mount', () => {
  for (const change of [x => x.image.Id = 'sha256:' + 'c'.repeat(64), x => x.container.Mounts[0].RW = true,
    x => x.container.Config.Env = [], x => x.container.Mounts.push({ Destination: '/app' }),
    x => x.container.State.Running = false]) {
    const input = fixture(); change(input); assert.throws(() => inspectMigrationControl(input));
  }
});
