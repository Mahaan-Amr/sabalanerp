import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const script = fs.readFileSync(path.resolve(process.cwd(), '..', 'deploy', 'scripts', 'deploy.sh'), 'utf8');

const migrations = script.indexOf('phase MIGRATIONS_APPLIED');
const liveLegacy = script.indexOf('shipment-statement-cutover.js legacy');
const liveCohort = script.indexOf('shipment-statement-cutover.js cohort');
const cutover = script.indexOf('Running the required Customer Shipment Statement cutover');
const release = script.indexOf('phase RELEASE_STARTED');

assert.ok(migrations >= 0 && cutover > migrations && release > cutover,
  'the required cutover must execute synchronously after migrations and before release startup');
assert.match(script, /SHIPMENT_STATEMENT_CUTOVER_REQUIRED.*true[\s\S]*run_backend_timed_with_heartbeat[\s\S]*shipment-statement-cutover\.js manifest/,
  'the manifest must run under the renewable deployment lease');
assert.match(script, /shipment-statement-cutover\.js manifest[\s\S]*run_backend_timed_with_heartbeat[\s\S]*shipment-statement-cutover\.js activate/,
  'activation must be ordered after the immutable manifest and use the heartbeat wrapper');
assert.match(script, /CUSTOMER_SHIPMENT_STATEMENTS_ENABLED=false/,
  'database activation must keep the process-local environment gate disabled');
assert.match(script, /DEPLOYMENT_LEASE_TOKEN/,
  'the exact lease token must be propagated to the transactional activation boundary');
assert.ok(liveLegacy > migrations && liveCohort > liveLegacy
  && liveCohort < script.indexOf('shipment-statement-cutover.js manifest'),
  'legacy dry-run/apply/repeat and the exact live cohort must be generated after writers drain and before the manifest');
assert.match(script, /wait_for_cutover_approval[\s\S]*control heartbeat/,
  'the in-boundary independent approval handoff must renew the lease');

const compose = fs.readFileSync(path.resolve(process.cwd(), '..', 'docker-compose.prod.yml'), 'utf8');
assert.match(compose, /SHIPMENT_STATEMENT_CUTOVER_SIGNING_KEY_FILE: \/run\/deployment-secrets\//);
assert.match(compose, /SHIPMENT_STATEMENT_COHORT_APPROVAL_KEY_FILE: \/run\/deployment-secrets\//);
assert.doesNotMatch(compose, /^\s+SHIPMENT_STATEMENT_(?:CUTOVER_SIGNING|COHORT_APPROVAL)_KEY:/m,
  'raw authorization secrets must not be materialized in Compose environment values');

const cutoverCli = fs.readFileSync(path.resolve(process.cwd(), 'scripts', 'shipment-statement-cutover.ts'), 'utf8');
assert.match(cutoverCli, /statSync\(file\)[\s\S]*metadata\.isFile\(\)[\s\S]*metadata\.mode & 0o077/,
  'production cutover secrets must be regular owner-only files');
const approvalHelper = fs.readFileSync(path.resolve(process.cwd(), '..', 'deploy', 'scripts',
  'approve-shipment-statement-cohort.mjs'), 'utf8');
assert.match(approvalHelper, /keyMetadata\.isFile\(\)[\s\S]*keyMetadata\.mode & 0o077/,
  'the independent approval helper must reject non-regular or over-permissive key files');
assert.match(approvalHelper, /handle\.sync\(\)[\s\S]*link\(temporary, approvalPath\)/,
  'the independent approval must be fsynced and atomically published');

const boundary = fs.readFileSync(path.resolve(process.cwd(), 'src', 'services',
  'shipmentStatementCutover', 'productionBoundary.ts'), 'utf8');
assert.match(boundary, /FOR UPDATE[\s\S]*clock_timestamp\(\)/,
  'lease wall-clock validation must happen after the locked deployment row is read');
assert.doesNotMatch(boundary, /Promise\.all\([\s\S]*FOR UPDATE/,
  'the lease clock must not race the deployment row lock');

console.log('shipment statement deployment cutover runtime: ok');
