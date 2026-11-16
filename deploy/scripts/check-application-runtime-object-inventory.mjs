#!/usr/bin/env node
// Read one JSON inventory from stdin, produced by the read-only SQL inventory.
// This gate remains closed until every object has an independently reviewed grant.
import fs from 'node:fs';

const baseline = JSON.parse(fs.readFileSync(new URL('../manifests/application-runtime-objects-v1.json', import.meta.url), 'utf8'));
const observed = JSON.parse(fs.readFileSync(0, 'utf8'));
function fail(code) {
  console.error(code);
  process.exitCode = 1;
}
function identities(manifest) {
  if (manifest.version !== 1 || manifest.database !== baseline.database || !Array.isArray(manifest.objects)) {
    throw new Error('APPLICATION_RUNTIME_INVENTORY_FORMAT');
  }
  const keys = manifest.objects.map((object) => `${object.kind}:${object.identity}`);
  if (keys.some((key, index) => !key || (index > 0 && keys[index - 1] >= key))) {
    throw new Error('APPLICATION_RUNTIME_INVENTORY_ORDER');
  }
  return keys;
}
try {
  const expected = identities(baseline);
  const actual = identities(observed);
  if (JSON.stringify(actual) !== JSON.stringify(expected) ||
      observed.objects.some((object, index) =>
        object.owner !== baseline.objects[index].owner ||
        object.relationKind !== baseline.objects[index].relationKind ||
        object.securityDefiner !== baseline.objects[index].securityDefiner)) {
    fail('APPLICATION_RUNTIME_INVENTORY_DRIFT');
  } else if (baseline.objects.some((object) => object.review !== 'REVIEWED' || !Array.isArray(object.grants))) {
    fail('APPLICATION_RUNTIME_GRANTS_UNREVIEWED');
  } else {
    // A reviewed manifest still needs a separate provisioner and direct-login audit.
    fail('APPLICATION_RUNTIME_PROVISIONER_NOT_IMPLEMENTED');
  }
} catch (error) {
  fail(error.message);
}
