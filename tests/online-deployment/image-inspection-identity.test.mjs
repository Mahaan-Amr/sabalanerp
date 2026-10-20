import assert from 'node:assert/strict';
import test from 'node:test';
import { imageInspectionIdentity } from '../../scripts/lib/image-inspection-identity.mjs';

test('image identity accepts an omitted Volumes key and excludes environment configuration', () => {
  const id = 'sha256:' + 'a'.repeat(64), layer = 'sha256:' + 'b'.repeat(64);
  const result = imageInspectionIdentity([{ Id: id, RootFS: { Layers: [layer] },
    Config: { Labels: { 'io.sabalan.online-acceptance': 'retained-ui' }, Env: ['PRIVATE=must-not-appear'] } }]);
  assert.deepEqual(result, { id, layers: [layer], labels: { 'io.sabalan.online-acceptance': 'retained-ui' }, volumes: null });
  assert.equal(JSON.stringify(result).includes('must-not-appear'), false);
});

test('image identity preserves declared volume paths for the caller to reject', () => {
  const result = imageInspectionIdentity([{ Id: 'sha256:' + 'a'.repeat(64), RootFS: { Layers: [] },
    Config: { Volumes: { '/data': {} } } }]);
  assert.deepEqual(result.volumes, { '/data': {} });
});
