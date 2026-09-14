import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateProductionEnvironment } from '../productionEnvironment';

const secret = 'a-private-value-that-must-not-appear-in-errors';
assert.throws(() => validateProductionEnvironment({ NODE_ENV: 'production', JWT_SECRET: secret }), (error: unknown) => {
  assert.ok(error instanceof Error);
  assert.match(error.message, /Missing vars:/);
  assert.match(error.message, /PERFORMANCE_PROMOTION_ATTESTATION_KEY_ID/);
  assert.match(error.message, /PERFORMANCE_MEASUREMENT_ATTESTATION_PUBLIC_KEY_BASE64/);
  assert.match(error.message, /PERFORMANCE_RELEASE_SOURCE_HASH/);
  assert.ok(!error.message.includes(secret));
  return true;
});
assert.doesNotThrow(() => validateProductionEnvironment({ NODE_ENV: 'development' }));

const deploy = fs.readFileSync(path.resolve(process.cwd(), '../deploy/scripts/deploy.sh'), 'utf8');
const preflight = deploy.indexOf('run_backend node dist/scripts/validate-production-environment.js');
assert.ok(preflight > 0);
assert.ok(preflight < deploy.indexOf('\ncontrol prepare\n'), 'invalid startup configuration must fail before the maintenance session exists');
const startup = fs.readFileSync(path.resolve(process.cwd(), 'src/index.ts'), 'utf8');
assert.match(startup, /import \{ validateProductionEnvironment \} from '\.\/services\/productionEnvironment'/);
assert.match(startup, /validateProductionEnvironment\(\)/);
console.log('production environment preflight tests passed');
