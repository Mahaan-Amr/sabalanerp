import assert from 'node:assert/strict';

/** Filter Docker's full image-inspect result immediately. Config.Env and other
 * runtime configuration never enter diagnostic identity receipts or logs. A
 * missing Volumes key means no declared volumes, as with Docker's JSON API. */
export function imageInspectionIdentity(rows) {
  assert.ok(Array.isArray(rows) && rows.length === 1);
  const image = rows[0]; assert.match(image.Id, /^sha256:[a-f0-9]{64}$/);
  assert.ok(Array.isArray(image.RootFS?.Layers));
  for (const layer of image.RootFS.Layers) assert.match(layer, /^sha256:[a-f0-9]{64}$/);
  assert.ok(image.Config && typeof image.Config === 'object');
  return { id: image.Id, layers: image.RootFS.Layers, labels: image.Config.Labels ?? null,
    volumes: image.Config.Volumes ?? null };
}
