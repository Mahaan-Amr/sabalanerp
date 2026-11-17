import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activateCustomerAllocation, closeCustomerAllocation, customerAllocationControllerDatabase, privateDirectoryReader } from './lib/customer-allocation-controller.mjs';
import { assertProductionDatabaseRoleConfiguration } from '../../scripts/production-database-role-boundary.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const image = value => /^sha256:[a-f0-9]{64}$/.test(value ?? '');
const commit = value => /^[a-f0-9]{40}$/.test(value ?? '');
const requireCondition = (condition, code) => { if (!condition) throw new Error(code); };
const checkImages = set => ['backend', 'frontend', 'inquiry'].every(role => image(set[role]));
const mismatch = 'CUSTOMER_ALLOCATION_RELEASE_IDENTITY_MISMATCH';

export function migrationCatalogSha256(directory) {
  const entries = readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory());
  const names = entries.map(entry => entry.name).sort();
  requireCondition(names.length > 0 && names.every(name => /^\d+_[a-zA-Z0-9_]+$/.test(name)), mismatch);
  return sha256(JSON.stringify(Object.fromEntries(names.map(name => [
    name, sha256(readFileSync(resolve(directory, name, 'migration.sql'))),
  ]))));
}

export function observeCustomerAllocationCompose(rendered, predecessor, previousRuntimeSha256) {
  const { backend, deployment, postgres } = rendered.services;
  const runtimeUrl = backend.environment.DATABASE_URL;
  const controlUrl = deployment.environment.DATABASE_URL;
  const bootstrapUser = postgres.environment.POSTGRES_USER;
  const runtimeSha256 = sha256(runtimeUrl);
  requireCondition(previousRuntimeSha256 === runtimeSha256, 'CUSTOMER_ALLOCATION_RUNTIME_CONFIGURATION_CHANGED');
  const configured = new URL(runtimeUrl);
  const networks = Object.keys(postgres.networks);
  requireCondition(networks.length === 1 && Object.hasOwn(backend.networks, networks[0])
    && Object.hasOwn(deployment.networks, networks[0])
    && configured.hostname === 'postgres' && configured.port === '5432'
    && configured.pathname === '/' + postgres.environment.POSTGRES_DB, 'CUSTOMER_ALLOCATION_DATABASE_TARGET_CHANGED');
  const network = rendered.networks[networks[0]].name;
  requireCondition(typeof network === 'string' && network === predecessor.network, 'CUSTOMER_ALLOCATION_DATABASE_TARGET_CHANGED');
  return { runtimeUrl, controlUrl, bootstrapUser, network };
}

export function assertCustomerAllocationReleasePlan(expected, reader) {
  requireCondition(checkImages(expected.candidateImages) && checkImages(expected.predecessorImages)
    && commit(expected.candidateCommit) && commit(expected.candidateTree) && commit(expected.inquiryCommit)
    && commit(expected.predecessorCommit) && image(expected.predecessorScannerImage)
    && /^[a-f0-9]{64}$/.test(expected.predecessorScannerContainerId ?? '')
    && /^erp_[a-z0-9_-]+$/.test(expected.predecessorBrowserBuildId ?? '')
    && /^[a-f0-9]{64}$/.test(expected.migrationSha256 ?? '')
    && expected.predecessorMigrationSha256 === expected.migrationSha256, mismatch);
  for (const key of ['predecessorCommit', 'predecessorScannerImage', 'predecessorScannerContainerId',
    'predecessorMigrationSha256', 'predecessorBrowserBuildId']) {
    requireCondition(expected[key] === reader[key], mismatch);
  }
}

function readCustomerAllocationAuthority(directory, approverSha256) {
  const read = privateDirectoryReader(directory);
  const { allocationControllerUrl, keyId, publicKeyPem } = JSON.parse(read('authority.json', 16 * 1024).toString('utf8'));
  const publicKey = createPublicKey(publicKeyPem);
  requireCondition(sha256(publicKeyPem) === approverSha256 && publicKey.asymmetricKeyType === 'ed25519'
    && typeof keyId === 'string' && keyId.length > 0 && keyId.trim() === keyId,
  'CUSTOMER_ALLOCATION_APPROVER_PIN_MISMATCH');
  return { allocationControllerUrl, approver: { keyId, publicKey } };
}

const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function inspectContainers(ids) {
  requireCondition(ids.every(id => /^[a-f0-9]{12,64}$/.test(id ?? '')), mismatch);
  const containers = JSON.parse(run('docker', ['inspect', '--type', 'container', ...ids]));
  requireCondition(containers.length === ids.length, mismatch);
  return containers;
}

const envValue = (container, key) => {
  const assignments = container.Config.Env.filter(entry => entry.startsWith(key + '='));
  requireCondition(assignments.length === 1, mismatch);
  return assignments[0].slice(key.length + 1);
};

function assertRunningService(container, service) {
  const labels = container.Config.Labels;
  requireCondition(container.State.Running && labels['com.docker.compose.service'] === service
    && labels['com.docker.compose.project'] === 'sabalanerp', mismatch);
}

function observeDatabase(backend, postgres) {
  assertRunningService(backend, 'backend');
  assertRunningService(postgres, 'postgres');
  const networks = Object.keys(postgres.NetworkSettings.Networks);
  requireCondition(networks.length === 1 && Object.hasOwn(backend.NetworkSettings.Networks, networks[0]), mismatch);
  return { network: networks[0], runtimeSha256: sha256(envValue(backend, 'DATABASE_URL')) };
}

function observePredecessor(ids) {
  const [backend, frontend, inquiry, scanner, postgres] = inspectContainers(ids);
  const database = observeDatabase(backend, postgres);
  assertRunningService(frontend, 'frontend');
  assertRunningService(inquiry, 'inquiry');
  assertRunningService(scanner, 'clamav');
  const predecessorMigrationSha256 = run('docker', ['exec', backend.Id, 'node', '-e',
    ["const {createHash}=require('node:crypto'),{readFileSync,readdirSync}=require('node:fs'),{resolve}=require('node:path');",
      sha256.toString().replace(/^/, 'const sha256='), requireCondition.toString().replace(/^/, ';const requireCondition='),
      '\x3bconst mismatch='+JSON.stringify(mismatch)+';', migrationCatalogSha256.toString(),
      "process.stdout.write(migrationCatalogSha256('/app/prisma/migrations'));"].join('\n')]);
  return {
    ...database,
    predecessorImages: { backend: backend.Image, frontend: frontend.Image, inquiry: inquiry.Image },
    predecessorCommit: backend.Config.Labels['io.sabalan.performance.source-commit'],
    predecessorScannerImage: scanner.Image, predecessorScannerContainerId: scanner.Id,
    predecessorBrowserBuildId: frontend.Config.Labels['io.sabalan.browser.build-id'], predecessorMigrationSha256,
  };
}

function releaseRequest([predecessorJson, candidateCommit, backend, frontend, inquiry, deploymentId, releaseId]) {
  const { runtimeSha256, network, ...predecessor } = JSON.parse(predecessorJson);
  const candidateImages = { backend, frontend, inquiry };
  requireCondition(checkImages(candidateImages) && commit(candidateCommit), mismatch);
  requireCondition(run('git', ['rev-parse', 'HEAD']) === candidateCommit
    && run('git', ['status', '--porcelain', '--untracked-files=no']) === '', mismatch);
  const inquiryCommit = run('git', ['rev-parse', 'HEAD:apps/sabalan-inquiry']);
  requireCondition(run('git', ['-C', 'apps/sabalan-inquiry', 'rev-parse', 'HEAD']) === inquiryCommit, mismatch);
  const imageData = JSON.parse(run('docker', ['image', 'inspect', ...Object.values(candidateImages)]));
  requireCondition(imageData.length === 3 && imageData.every((data, index) => data.Id === Object.values(candidateImages)[index]
    && data.Config.Labels['io.sabalan.performance.source-commit'] === candidateCommit), mismatch);
  const request = { deploymentId, releaseId, candidateCommit, candidateImages, inquiryCommit,
    candidateTree: run('git', ['rev-parse', 'HEAD^{tree}']),
    migrationSha256: migrationCatalogSha256('backend/prisma/migrations'), ...predecessor };
  assertCustomerAllocationReleasePlan(request, request);
  return request;
}

function verifyStarted([requestJson, predecessorJson, ...ids]) {
  const request = JSON.parse(requestJson);
  const predecessor = JSON.parse(predecessorJson);
  const [backend, frontend, inquiry, scanner] = inspectContainers(ids);
  for (const [container, role] of [[backend, 'backend'], [frontend, 'frontend'], [inquiry, 'inquiry']]) {
    requireCondition(container.State.Running && container.Image === request.candidateImages[role]
      && container.Config.Labels['com.docker.compose.service'] === role
      && container.Config.Labels['com.docker.compose.project'] === 'sabalanerp', mismatch);
  }
  requireCondition(sha256(envValue(backend, 'DATABASE_URL')) === predecessor.runtimeSha256
    && envValue(backend, 'DEPLOYMENT_RELEASE_ID') === request.releaseId
    && Object.hasOwn(backend.NetworkSettings.Networks, predecessor.network)
    && scanner.State.Status === 'exited' && scanner.Image === request.predecessorScannerImage
    && scanner.Id === request.predecessorScannerContainerId, mismatch);
  const address = backend.NetworkSettings.Networks[predecessor.network].IPAddress;
  requireCondition(typeof address === 'string' && address !== '', mismatch);
  return address;
}

async function runController(mode, { roles, expected, approverSha256, deploymentId, releaseId, leaseToken, manifestSha256 }) {
  const evidenceDirectory = '/allocation-evidence';
  const { allocationControllerUrl, approver } = readCustomerAllocationAuthority('/allocation-authority', approverSha256);
  const roleConfiguration = { ...roles, allocationControllerUrl };
  assertProductionDatabaseRoleConfiguration(roleConfiguration);
  const { default: pg } = await import('pg');
  const client = connectionString => new pg.Client({ connectionString, connectionTimeoutMillis: 10_000,
    statement_timeout: 10_000, lock_timeout: 5_000, query_timeout: 15_000 });
  const controller = client(allocationControllerUrl);
  const runtime = client(roles.runtimeUrl);
  try {
    await controller.connect();
    await runtime.connect();
    const db = customerAllocationControllerDatabase(controller, runtime, roleConfiguration);
    if (mode === 'close') {
      const receipt = await closeCustomerAllocation({ db, deploymentId, releaseId, leaseToken, manifestSha256 });
      return receipt.manifest_sha256;
    }
    const imageCommit = readFileSync('/app/.allocation-build-commit', 'utf8').trim();
    requireCondition(imageCommit === expected.candidateCommit
      && migrationCatalogSha256('/app/prisma/migrations') === expected.migrationSha256, mismatch);
    const receipt = await activateCustomerAllocation({
      db,
      expected, evidenceDirectory, deploymentId, leaseToken, approver,
      validateReader: reader => assertCustomerAllocationReleasePlan(expected, reader),
    });
    return receipt.manifest_sha256;
  } finally {
    await Promise.all([controller.end(), runtime.end()]);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, ...args] = process.argv.slice(2);
    if (mode === 'activate' || mode === 'close') {
      process.stdout.write(await runController(mode, JSON.parse(readFileSync(0, 'utf8'))));
    } else if (mode === 'observe-predecessor') {
      process.stdout.write(JSON.stringify(observePredecessor(args)));
    } else if (mode === 'observe-database') {
      process.stdout.write(JSON.stringify(observeDatabase(...inspectContainers(args))));
    } else if (mode === 'request') {
      process.stdout.write(JSON.stringify(releaseRequest(args)));
    } else if (mode === 'publish-request') {
      const [directory, requestJson] = args;
      privateDirectoryReader(directory);
      writeFileSync(resolve(directory, 'request.json'), requestJson + '\n', { flag: 'wx', mode: 0o600 });
    } else if (mode === 'prepare' || mode === 'input') {
      const [predecessorJson, authorityDirectory, approverSha256, operation, requestJson, manifestSha256] = args;
      const predecessor = JSON.parse(predecessorJson);
      const { runtimeUrl, controlUrl, bootstrapUser, network } = observeCustomerAllocationCompose(
        JSON.parse(readFileSync(0, 'utf8')), predecessor, predecessor.runtimeSha256);
      const roles = { runtimeUrl, controlUrl, bootstrapUser };
      const { allocationControllerUrl } = readCustomerAllocationAuthority(authorityDirectory, approverSha256);
      assertProductionDatabaseRoleConfiguration({ ...roles, allocationControllerUrl });
      if (mode === 'prepare') process.stdout.write(network);
      else {
        const expected = operation === 'activate' ? JSON.parse(requestJson) : undefined;
        const { DEPLOYMENT_ID: deploymentId, DEPLOYMENT_RELEASE_ID: releaseId,
          DEPLOYMENT_LEASE_TOKEN: leaseToken } = process.env;
        requireCondition(!expected || (expected.deploymentId === deploymentId && expected.releaseId === releaseId), mismatch);
        process.stdout.write(JSON.stringify({ roles, expected, approverSha256, deploymentId, releaseId, leaseToken, manifestSha256 }));
      }
    } else if (mode === 'verify-started') {
      process.stdout.write(verifyStarted(args));
    } else {
      throw new Error('CUSTOMER_ALLOCATION_COMMAND_INVALID');
    }
  } catch (error) {
    // Connection and JSON parser errors may include secret input.
    const code = /^CUSTOMER_ALLOCATION_[A-Z_]+$/.test(error.message)
      ? error.message : 'CUSTOMER_ALLOCATION_RELEASE_REJECTED';
    process.stderr.write(code + '\n');
    process.exitCode = 1;
  }
}
