import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrationCatalogSha256 } from './customer-allocation-release.mjs';
import { privateDirectoryReader } from './lib/customer-allocation-controller.mjs';
import { enrollSepidarOpening, readSepidarOpeningEvidence } from './lib/sepidar-opening-controller.mjs';

const sha256 = /^[a-f0-9]{64}$/;
const imageId = /^sha256:[a-f0-9]{64}$/;
function requireRelease(condition) {
  if (!condition) throw new Error('SEPIDAR_OPENING_RELEASE_REJECTED');
}

export function sepidarOpeningTarget(rendered) {
  const { backend, deployment, postgres } = rendered.services;
  const networkNames = Object.keys(postgres.networks);
  const key = networkNames[0];
  const network = rendered.networks[key]?.name;
  const database = postgres.environment.POSTGRES_DB;
  requireRelease(rendered.name === 'sabalanerp' && networkNames.length === 1
    && Object.hasOwn(backend.networks, key) && Object.hasOwn(deployment.networks, key)
    && /^[a-zA-Z0-9_-]+$/.test(network ?? '') && /^[a-zA-Z0-9_]+$/.test(database ?? ''));
  for (const service of [backend, deployment]) {
    const url = new URL(service.environment.DATABASE_URL);
    requireRelease(url.host === 'postgres:5432' && url.pathname === '/' + database);
  }
  return { network, database };
}

export function sepidarControllerConnection(connectionString, database) {
  const url = new URL(connectionString);
  requireRelease(['postgres:', 'postgresql:'].includes(url.protocol)
    && decodeURIComponent(url.username) === 'sabalan_sepidar_opening_controller' && url.password
    && url.host === 'postgres:5432' && /^[a-zA-Z0-9_]+$/.test(database ?? '')
    && url.pathname === '/' + database && !url.hash && !url.search);
  return connectionString;
}

async function runController(input, prepareOnly) {
  const { deploymentId, releaseId, leaseToken, approvalKeySha256, qualificationSha256,
    candidateImage, retainedImage, database } = input;
  requireRelease([deploymentId, releaseId, leaseToken].every(value => typeof value === 'string' && value.length)
    && approvalKeySha256?.match(sha256) && qualificationSha256?.match(sha256)
    && candidateImage?.match(imageId) && retainedImage?.match(imageId));
  const authority = privateDirectoryReader('/sepidar-opening-authority');
  const read = privateDirectoryReader('/sepidar-opening-evidence');
  const { controllerUrl } = JSON.parse(authority('database.json', 16 * 1024));
  const connectionString = sepidarControllerConnection(controllerUrl, database);
  const evidence = readSepidarOpeningEvidence(read, { approvalKeySha256, qualificationSha256, prepareOnly },
    name => authority(name, 16 * 1024));
  const { qualification } = evidence;
  requireRelease(qualification.candidateImage === candidateImage && qualification.retainedImage === retainedImage
    && qualification.buildCommit === readFileSync('/app/.allocation-build-commit', 'utf8').trim()
    && qualification.migrationSha256 === migrationCatalogSha256('/app/prisma/migrations'));
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10_000,
    statement_timeout: 10_000, lock_timeout: 5_000, query_timeout: 15_000 });
  try {
    await client.connect();
    const { rows } = await client.query(`
      SELECT principal.rolname FROM pg_catalog.pg_roles AS principal
      WHERE rolname = session_user AND rolname = current_user AND rolname = 'sabalan_sepidar_opening_controller'
        AND rolcanlogin AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolreplication OR rolbypassrls)
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid = principal.oid OR member = principal.oid)
    `);
    requireRelease(rows.length === 1);
    if (prepareOnly) {
      const { rows: releases } = await client.query('SELECT * FROM public.sepidar_customer_opening_lock($1, $2, $3)',
        [deploymentId, releaseId, leaseToken]);
      requireRelease(releases.length === 1 && releases[0].build_commit === qualification.buildCommit);
      return JSON.stringify({ format: 'sepidar-customer-opening-approval-v1', decision: 'GO',
        ...qualification, deploymentId, releaseId, keyId: evidence.approver.keyId, checkpointHash: releases[0].checkpoint_hash });
    }
    return (await enrollSepidarOpening({ client, deploymentId, releaseId, leaseToken, ...evidence })).manifestSha256;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, ...args] = process.argv.slice(2);
    const input = JSON.parse(readFileSync(0, 'utf8'));
    if (mode === 'preflight' && args.length === 4) {
      const [evidenceDirectory, authorityDirectory, approvalKeySha256, qualificationSha256] = args;
      requireRelease([evidenceDirectory, authorityDirectory].every(directory => !/[,\r\n]/.test(directory))
        && evidenceDirectory !== authorityDirectory && sha256.test(approvalKeySha256) && sha256.test(qualificationSha256));
      const read = privateDirectoryReader(evidenceDirectory);
      const authority = privateDirectoryReader(authorityDirectory);
      const { network, database } = sepidarOpeningTarget(input);
      sepidarControllerConnection(JSON.parse(authority('database.json', 16 * 1024)).controllerUrl, database);
      readSepidarOpeningEvidence(read, { approvalKeySha256, qualificationSha256, prepareOnly: true },
        name => authority(name, 16 * 1024));
      process.stdout.write(network);
    } else if (mode === 'input' && args.length === 4) {
      const [approvalKeySha256, qualificationSha256, candidateImage, retainedImage] = args;
      const { DEPLOYMENT_ID: deploymentId, DEPLOYMENT_RELEASE_ID: releaseId,
        DEPLOYMENT_LEASE_TOKEN: leaseToken } = process.env;
      process.stdout.write(JSON.stringify({ deploymentId, releaseId, leaseToken, approvalKeySha256,
        qualificationSha256, candidateImage, retainedImage, database: sepidarOpeningTarget(input).database }));
    } else if ((mode === 'request' || mode === 'activate') && args.length === 0) {
      process.stdout.write(await runController(input, mode === 'request'));
    } else if (mode === 'publish-request' && args.length === 1) {
      privateDirectoryReader(args[0]);
      writeFileSync(resolve(args[0], 'request.json'), JSON.stringify(input) + '\n', { flag: 'wx', mode: 0o600 });
    } else {
      requireRelease(false);
    }
  } catch (error) {
    const message = /^SEPIDAR_OPENING_[A-Z_]+$/.test(error.message) ? error.message : 'SEPIDAR_OPENING_RELEASE_REJECTED';
    process.stderr.write(message + '\n');
    process.exitCode = 1;
  }
}
