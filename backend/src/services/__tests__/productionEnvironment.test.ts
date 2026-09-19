import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateProductionEnvironment } from '../productionEnvironment';
import { generateKeyPairSync } from 'node:crypto';

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

const fixture: NodeJS.ProcessEnv = Object.fromEntries(fs.readFileSync('.env.production.example', 'utf8').split(/\r?\n/)
  .filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
const hash = 'a'.repeat(64);
Object.assign(fixture, {
  NODE_ENV: 'production', JWT_SECRET: secret, PUBLIC_APP_URL: 'https://erp.example.com',
  WEB_PUSH_VAPID_SUBJECT: 'mailto:test@example.com', WEB_PUSH_VAPID_PUBLIC_KEY: 'test-public', WEB_PUSH_VAPID_PRIVATE_KEY: 'test-private',
  SMS_IR_ENVIRONMENT: 'production', SMS_IR_HIRING_INVITATION_TEMPLATE_ID: '343660',
  SMS_IR_HIRING_INVITATION_TEMPLATE_PARAMETERS: 'CODE', SMS_IR_HIRING_CORRECTION_TEMPLATE_ID: '763918',
  SMS_IR_HIRING_CORRECTION_TEMPLATE_PARAMETERS: 'DETAILS,CODE', SMS_IR_HIRING_OFFER_TEMPLATE_ID: '894291',
  SMS_IR_HIRING_OFFER_TEMPLATE_PARAMETERS: 'CODE', SMS_IR_DISPATCH_CONFIRM_OTP_TEMPLATE_ID: '100',
  SMS_IR_DISPATCH_EXIT_TEMPLATE_ID: '101', SMS_IR_DISPATCH_EXIT_MANUAL_RETRY_TEMPLATE_ID: '102',
  PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_ID: 'vault-test-v1', PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 1).toString('base64'),
  PERSONNEL_PERFORMANCE_EXPORT_ENCRYPTION_KEY_ID: 'export-test-v1', PERSONNEL_PERFORMANCE_EXPORT_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 2).toString('base64'),
  PERFORMANCE_PROMOTION_ATTESTATION_KEY_ID: 'collector-test-v1', PERFORMANCE_PROMOTION_ATTESTATION_KEY_BASE64: Buffer.alloc(32, 3).toString('base64'),
  PERFORMANCE_MEASUREMENT_ATTESTATION_KEY_ID: 'measurement-test-v1',
  PERFORMANCE_MEASUREMENT_ATTESTATION_PUBLIC_KEY_BASE64: generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  PERFORMANCE_RELEASE_COMMIT: 'b'.repeat(40), PERFORMANCE_RELEASE_SOURCE_HASH: hash,
  PERFORMANCE_RELEASE_SCHEMA_HASH: hash, PERFORMANCE_RELEASE_POLICY_HASH: hash,
  PERFORMANCE_RELEASE_INFRASTRUCTURE_HASH: hash, PERFORMANCE_RUNTIME_INFRASTRUCTURE_HASH: hash,
  PERFORMANCE_RELEASE_BACKEND_IMAGE: `sha256:${hash}`, PERFORMANCE_RELEASE_FRONTEND_IMAGE: `sha256:${hash}`,
  PERFORMANCE_RELEASE_INQUIRY_IMAGE: `sha256:${hash}`, DEPLOYMENT_BACKEND_IMAGE: `sha256:${hash}`,
  DEPLOYMENT_FRONTEND_IMAGE: `sha256:${hash}`, DEPLOYMENT_INQUIRY_IMAGE: `sha256:${hash}`,
});
assert.doesNotThrow(() => validateProductionEnvironment(fixture));
assert.throws(() => validateProductionEnvironment({ ...fixture, PERFORMANCE_RELEASE_BACKEND_IMAGE: `sha256:${'c'.repeat(64)}` }), /measured runtime release identity/);
const inheritedHash = process.env.PERFORMANCE_RELEASE_SOURCE_HASH;
process.env.PERFORMANCE_RELEASE_SOURCE_HASH = hash;
try {
  assert.throws(() => validateProductionEnvironment({ ...fixture, PERFORMANCE_RELEASE_SOURCE_HASH: '' }), /Missing vars: PERFORMANCE_RELEASE_SOURCE_HASH/);
} finally {
  if (inheritedHash === undefined) delete process.env.PERFORMANCE_RELEASE_SOURCE_HASH;
  else process.env.PERFORMANCE_RELEASE_SOURCE_HASH = inheritedHash;
}

const deploy = fs.readFileSync(path.resolve(process.cwd(), '../deploy/scripts/deploy.sh'), 'utf8');
const preflight = deploy.indexOf('run_backend node dist/scripts/validate-production-environment.js');
assert.ok(preflight > 0);
assert.ok(preflight < deploy.indexOf('\ncontrol prepare\n'), 'invalid startup configuration must fail before the maintenance session exists');
const startup = fs.readFileSync(path.resolve(process.cwd(), 'src/index.ts'), 'utf8');
assert.match(startup, /import \{ validateProductionEnvironment \} from '\.\/services\/productionEnvironment'/);
assert.match(startup, /validateProductionEnvironment\(\)/);
console.log('production environment preflight tests passed');
