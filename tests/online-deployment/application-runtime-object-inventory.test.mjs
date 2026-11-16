import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const manifest = JSON.parse(fs.readFileSync(new URL('../../deploy/manifests/application-runtime-objects-v2.json', import.meta.url), 'utf8'));
const checker = fileURLToPath(new URL('../../deploy/scripts/check-application-runtime-object-inventory.mjs', import.meta.url));
function check(inventory) {
  return spawnSync(process.execPath, [checker], { input: JSON.stringify(inventory), encoding: 'utf8' });
}

test('runtime object inventory stays closed while business grants are unreviewed', () => {
  const result = check(manifest);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /APPLICATION_RUNTIME_GRANTS_UNREVIEWED/);
  assert.equal(manifest.objects.length, 985);
  assert.equal(manifest.review, 'UNREVIEWED');
  assert.deepEqual(manifest.defaultGrants, []);
  assert.equal(manifest.provenance.headMigration.name, '20261116133000_customer_allocation_controller_transition');
  for (const identity of [
    'public.customer_allocation_release_control',
    'public.customer_allocation_release_audit',
    'public.customer_allocation_controller_lock(p_deployment_id text, p_lease_token text)',
  ]) assert.ok(manifest.objects.some((object) => object.identity === identity), identity);
});

test('runtime object inventory rejects a restored schema with an extra object', () => {
  const changed = structuredClone(manifest);
  changed.objects.push({ kind: 'sequence', identity: 'public.zz_unreviewed', owner: 'postgres', relationKind: 'S' });
  const result = check(changed);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /APPLICATION_RUNTIME_INVENTORY_DRIFT/);
});

test('runtime object inventory rejects a schema missing candidate allocation control', () => {
  const missing = structuredClone(manifest);
  missing.objects = missing.objects.filter((object) => object.identity !== 'public.customer_allocation_release_control');
  assert.match(check(missing).stderr, /APPLICATION_RUNTIME_INVENTORY_DRIFT/);
});

test('runtime object inventory rejects owner, security-definer, and duplicate identity changes', () => {
  const changedOwner = structuredClone(manifest);
  changedOwner.objects[0].owner = 'other_owner';
  assert.match(check(changedOwner).stderr, /APPLICATION_RUNTIME_INVENTORY_DRIFT/);
  const changedDefiner = structuredClone(manifest);
  const controller = changedDefiner.objects.find((object) => object.identity.startsWith('public.customer_allocation_controller_lock('));
  controller.securityDefiner = false;
  assert.match(check(changedDefiner).stderr, /APPLICATION_RUNTIME_INVENTORY_DRIFT/);
  const duplicate = structuredClone(manifest);
  duplicate.objects.splice(1, 0, structuredClone(duplicate.objects[0]));
  assert.match(check(duplicate).stderr, /APPLICATION_RUNTIME_INVENTORY_DUPLICATE_OR_ORDER/);
  const malformed = structuredClone(manifest);
  malformed.objects[0].identity = 'unqualified_function()';
  assert.match(check(malformed).stderr, /APPLICATION_RUNTIME_INVENTORY_FORMAT/);
});

test('inventory SQL fixes search_path before rendering schema-qualified function identities', () => {
  const sql = fs.readFileSync(new URL('../../deploy/sql/inventory-application-runtime-objects.sql', import.meta.url), 'utf8');
  assert.match(sql, /SET LOCAL search_path = pg_catalog/);
  assert.match(sql, /format\('%I\.%I\(%s\)', n\.nspname, p\.proname, pg_get_function_identity_arguments\(p\.oid\)\)/);
});
