import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, fsyncSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { existingRelease, releaseServices } from '../../scripts/deployment-existing-release.mjs';

const bootstrapKeys = ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB'];
const allowedDatabaseOptions = ['schema', 'connection_limit', 'pool_timeout', 'application_name'];
const changed = () => { throw new Error('PROTECTED_DATABASE_ROLE_CONFIGURATION_CHANGED'); };

function isComposeDatabaseUrl(url, database) {
  return ['postgres:', 'postgresql:'].includes(url.protocol) && url.host === 'postgres:5432'
    && url.pathname === '/' + database && !url.hash && url.searchParams.getAll('schema').join(',') === 'public'
    && [...url.searchParams.keys()].every(key => allowedDatabaseOptions.includes(key));
}

function databaseConfiguration({ services }) {
  const runtime = services?.backend?.environment?.DATABASE_URL;
  const control = services?.deployment?.environment?.DATABASE_URL;
  const bootstrap = bootstrapKeys.map(key => services?.postgres?.environment?.[key]);
  if ([runtime, control, ...bootstrap].some(value => typeof value !== 'string' || !value)) changed();
  return { runtime, control, bootstrap };
}

export function databaseRoleIdentity(rendered) {
  return createHash('sha256').update(JSON.stringify(databaseConfiguration(rendered))).digest('hex');
}

export function pinExistingDatabaseRoles(rendered, runningRuntimeUrl, runningBootstrap) {
  const { runtime, control, bootstrap } = databaseConfiguration(rendered);
  if (runningRuntimeUrl !== runtime || bootstrap.some((value, index) => value !== runningBootstrap[bootstrapKeys[index]])) changed();
  try {
    const [user, password, database] = bootstrap;
    const url = new URL(control);
    if (!isComposeDatabaseUrl(url, database) || decodeURIComponent(url.username) !== user
      || decodeURIComponent(url.password) !== password) changed();
  } catch { changed(); }
  return databaseRoleIdentity(rendered);
}

/** Observe the configuration delta for a separately owned first role split. */
export function preflightFirstDatabaseRoleSplit(before, after, runningRuntimeUrl, runningBootstrap) {
  const beforePin = pinExistingDatabaseRoles(before, runningRuntimeUrl, runningBootstrap);
  const baseline = databaseConfiguration(before);
  const proposed = databaseConfiguration(after);
  const [owner, ownerPassword, database] = baseline.bootstrap;
  const runtimeRole = 'sabalan_application_runtime';
  try {
    const previousUrl = new URL(baseline.runtime);
    const runtimeUrl = new URL(proposed.runtime);
    const restrictedPassword = decodeURIComponent(runtimeUrl.password);
    if (before.name !== 'sabalanerp' || after.name !== before.name || !isComposeDatabaseUrl(previousUrl, database)
      || decodeURIComponent(previousUrl.username) !== owner
      || decodeURIComponent(previousUrl.password) !== ownerPassword
      || decodeURIComponent(runtimeUrl.username) !== runtimeRole
      || !restrictedPassword || restrictedPassword === ownerPassword
      || before.services.deployment.environment.DEPLOYMENT_CHECKPOINT_RUNTIME_USER !== owner
      || after.services.deployment.environment.DEPLOYMENT_CHECKPOINT_RUNTIME_USER !== runtimeRole) changed();

    runtimeUrl.username = previousUrl.username;
    runtimeUrl.password = previousUrl.password;
    if (runtimeUrl.href !== previousUrl.href) changed();

    const restored = structuredClone(after);
    restored.services.backend.environment.DATABASE_URL = baseline.runtime;
    restored.services.deployment.environment.DEPLOYMENT_CHECKPOINT_RUNTIME_USER = owner;
    if (!isDeepStrictEqual(restored, before)) changed();
  } catch { changed(); }

  return { beforePin, afterPin: databaseRoleIdentity(after), runtimeRole };
}

function inspectContainers(args) {
  if (new Set(args).size !== args.length || args.some(id => !/^[a-f0-9]{12,64}$/.test(id))) changed();
  const rows = JSON.parse(execFileSync('docker', ['container', 'inspect', ...args], { stdio: ['ignore', 'pipe', 'ignore'] }));
  if (rows.length !== args.length || rows.some((container, i) => !container.Id.startsWith(args[i]))) changed();
  return rows;
}

function containerEnvironment(container, service, keys) {
  if (container?.State?.Running !== true || container.Config.Labels?.['com.docker.compose.project'] !== 'sabalanerp'
    || container.Config.Labels?.['com.docker.compose.service'] !== service) changed();
  return Object.fromEntries(keys.map(key => {
    const entries = container.Config.Env.filter(entry => entry.startsWith(key + '='));
    if (entries.length !== 1) changed();
    return [key, entries[0].slice(key.length + 1)];
  }));
}

function observe(args) {
  if (args.length !== 2) changed();
  const [backend, postgres] = inspectContainers(args);
  return [containerEnvironment(backend, 'backend', ['DATABASE_URL']).DATABASE_URL,
    containerEnvironment(postgres, 'postgres', bootstrapKeys)];
}

/** Bind the read-only configuration observation to the current serving graph. */
export function preflightFirstDatabaseRoleSplitRelease(before, after, rows) {
  const containers = Object.fromEntries(rows.map(row => [row.Config.Labels?.['com.docker.compose.service'], row]));
  const services = releaseServices(containers.backend);
  const release = existingRelease(rows);
  if (rows.length !== services.length || new Set(rows.map(row => row.Id)).size !== rows.length
    || services.some(service => !/^[a-f0-9]{64}$/.test(containers[service]?.Id ?? '')
      || containers[service].Config.Labels?.['com.docker.compose.project'] !== 'sabalanerp'
      || before.services[service]?.image !== release.images[service])
    || Object.hasOwn(before.services, 'clamav') !== services.includes('clamav')
    || before.services.deployment?.image !== release.images.backend) changed();

  const backend = containerEnvironment(containers.backend, 'backend', ['DATABASE_URL', 'APP_COMMIT']);
  if (backend.APP_COMMIT !== release.identity.PERFORMANCE_RELEASE_COMMIT) changed();
  const bootstrap = containerEnvironment(containers.postgres, 'postgres', bootstrapKeys);
  const roles = preflightFirstDatabaseRoleSplit(before, after, backend.DATABASE_URL, bootstrap);
  return {
    ...roles,
    releaseCommit: release.identity.PERFORMANCE_RELEASE_COMMIT,
    images: release.images,
    containers: Object.fromEntries(services.map(service => [service, containers[service].Id])),
  };
}

function writePin(file, pin) {
  const fd = openSync(file, 'wx', 0o400);
  try {
    writeFileSync(fd, pin + '\n');
    fsyncSync(fd);
  } finally { closeSync(fd); }
  const directory = openSync(dirname(file), constants.O_DIRECTORY | constants.O_RDONLY);
  try { fsyncSync(directory); } finally { closeSync(directory); }
}

function readPin(file) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid() || stat.nlink !== 1
      || (stat.mode & 0o777) !== 0o400 || stat.size !== 65) changed();
    return readFileSync(fd, 'utf8');
  } finally { closeSync(fd); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, ...commandArgs] = process.argv.slice(2);
    const rendered = JSON.parse(readFileSync(0, 'utf8'));
    if (mode === 'preflight-first-split') {
      const { before, after } = rendered;
      if (![5, 6].includes(commandArgs.length)) changed();
      process.stdout.write(JSON.stringify(preflightFirstDatabaseRoleSplitRelease(before, after, inspectContainers(commandArgs))) + '\n');
    } else {
      const [file, ...args] = commandArgs;
      if (mode === 'pin') writePin(file, pinExistingDatabaseRoles(rendered, ...observe(args)));
      else if (mode === 'verify') {
        const pin = args.length ? pinExistingDatabaseRoles(rendered, ...observe(args)) : databaseRoleIdentity(rendered);
        if (readPin(file) !== pin + '\n') changed();
      } else changed();
    }
  } catch {
    // Docker inspection and Compose rendering contain private connection strings.
    console.error('PROTECTED_DATABASE_ROLE_CONFIGURATION_CHANGED');
    process.exitCode = 1;
  }
}
