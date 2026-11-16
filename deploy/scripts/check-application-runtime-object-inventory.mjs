#!/usr/bin/env node
// Read one JSON inventory from stdin, produced by the read-only SQL inventory.
// This gate remains closed until every object has an independently reviewed grant.
import fs from 'node:fs';

const baseline = JSON.parse(fs.readFileSync(new URL('../manifests/application-runtime-objects-v2.json', import.meta.url), 'utf8'));
const observed = JSON.parse(fs.readFileSync(0, 'utf8'));
function fail(code) {
  console.error(code);
  process.exitCode = 1;
}
function identities(manifest) {
  if (manifest.version !== 2 || manifest.schema !== 'public' || !Array.isArray(manifest.objects)) {
    throw new Error('APPLICATION_RUNTIME_INVENTORY_FORMAT');
  }
  const keys = manifest.objects.map((object) => {
    if (!object || !['relation', 'sequence', 'function'].includes(object.kind) ||
        typeof object.identity !== 'string' || !object.identity.startsWith('public.') ||
        typeof object.owner !== 'string' || !object.owner ||
        (object.kind === 'function' && (typeof object.securityDefiner !== 'boolean' || !/^public\.[^(]+\(.*\)$/.test(object.identity))) ||
        (object.kind === 'relation' && !['r', 'p', 'v', 'm'].includes(object.relationKind)) ||
        (object.kind === 'sequence' && object.relationKind !== 'S')) {
      throw new Error('APPLICATION_RUNTIME_INVENTORY_FORMAT');
    }
    return `${object.kind}:${object.identity}`;
  });
  if (new Set(keys).size !== keys.length || keys.some((key, index) => index > 0 && keys[index - 1] > key)) {
    throw new Error('APPLICATION_RUNTIME_INVENTORY_DUPLICATE_OR_ORDER');
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
  } else if (baseline.review !== 'REVIEWED' || !Array.isArray(baseline.defaultGrants) || baseline.defaultGrants.length !== 0) {
    fail('APPLICATION_RUNTIME_GRANTS_UNREVIEWED');
  } else {
    // A reviewed manifest still needs a separate provisioner and direct-login audit.
    fail('APPLICATION_RUNTIME_PROVISIONER_NOT_IMPLEMENTED');
  }
} catch (error) {
  fail(error.message);
}
