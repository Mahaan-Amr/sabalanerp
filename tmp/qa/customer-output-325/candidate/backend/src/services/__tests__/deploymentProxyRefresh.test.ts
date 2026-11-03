import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const deployScript = fs.readFileSync(path.resolve(process.cwd(), '..', 'deploy', 'scripts', 'deploy.sh'), 'utf8');

assert.match(
  deployScript,
  /start_release_services\(\)[\s\S]*--no-deps --force-recreate --wait --wait-timeout "\$\{wait_seconds\}" nginx/,
  'release startup must refresh Nginx after application containers receive their final addresses',
);

const calls = deployScript.match(/^\s*(?:if )?start_release_services (?:300|"\$\{remaining\}")/gm) || [];
assert.equal(
  calls.length,
  4,
  'normal release, rollback, pre-mutation abort, and interrupted recovery must all refresh Nginx',
);

console.log('deployment proxy refresh tests passed');
