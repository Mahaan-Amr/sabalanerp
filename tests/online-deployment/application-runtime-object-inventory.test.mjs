import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const manifest = JSON.parse(fs.readFileSync(new URL('../../deploy/manifests/application-runtime-objects-v1.json', import.meta.url), 'utf8'));
const checker = fileURLToPath(new URL('../../deploy/scripts/check-application-runtime-object-inventory.mjs', import.meta.url));
function check(inventory) {
  return spawnSync(process.execPath, [checker], { input: JSON.stringify(inventory), encoding: 'utf8' });
}

test('runtime object inventory stays closed while business grants are unreviewed', () => {
  const result = check(manifest);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /APPLICATION_RUNTIME_GRANTS_UNREVIEWED/);
  assert.equal(manifest.objects.length, 965);
  assert.ok(manifest.objects.every((object) => object.review === 'UNREVIEWED' && object.grants.length === 0));
});

test('runtime object inventory rejects a restored schema with an extra object', () => {
  const changed = structuredClone(manifest);
  changed.objects.push({ kind: 'sequence', identity: 'public.zz_unreviewed', owner: 'postgres', review: 'UNREVIEWED', grants: [] });
  const result = check(changed);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /APPLICATION_RUNTIME_INVENTORY_DRIFT/);
});
