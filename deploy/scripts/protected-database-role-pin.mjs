import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, fsyncSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const bootstrapKeys = ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB'];
const changed = () => { throw new Error('PROTECTED_DATABASE_ROLE_CONFIGURATION_CHANGED'); };

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
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || decodeURIComponent(url.username) !== user
      || decodeURIComponent(url.password) !== password || url.host !== 'postgres:5432' || url.pathname !== '/' + database
      || url.hash || url.searchParams.getAll('schema').join(',') !== 'public'
      || [...url.searchParams.keys()].some(key => !['schema', 'connection_limit', 'pool_timeout', 'application_name'].includes(key))) changed();
  } catch { changed(); }
  return databaseRoleIdentity(rendered);
}

function observe(args) {
  if (args.length !== 2 || args.some(id => !/^[a-f0-9]{12,64}$/.test(id))) changed();
  const rows = JSON.parse(execFileSync('docker', ['container', 'inspect', ...args], { stdio: ['ignore', 'pipe', 'ignore'] }));
  function environment(index, role, keys) {
    const container = rows[index];
    if (container?.State?.Running !== true || !container.Id.startsWith(args[index])
      || container.Config.Labels?.['com.docker.compose.project'] !== 'sabalanerp'
      || container.Config.Labels?.['com.docker.compose.service'] !== role) changed();
    return Object.fromEntries(keys.map(key => {
      const entries = container.Config.Env.filter(entry => entry.startsWith(key + '='));
      if (entries.length !== 1) changed();
      return [key, entries[0].slice(key.length + 1)];
    }));
  }
  return [environment(0, 'backend', ['DATABASE_URL']).DATABASE_URL, environment(1, 'postgres', bootstrapKeys)];
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
    const [mode, file, ...args] = process.argv.slice(2);
    const rendered = JSON.parse(readFileSync(0, 'utf8'));
    if (mode === 'pin') writePin(file, pinExistingDatabaseRoles(rendered, ...observe(args)));
    else if (mode === 'verify') {
      const pin = args.length ? pinExistingDatabaseRoles(rendered, ...observe(args)) : databaseRoleIdentity(rendered);
      if (readPin(file) !== pin + '\n') changed();
    } else changed();
  } catch {
    // Docker inspection and Compose rendering contain private connection strings.
    console.error('PROTECTED_DATABASE_ROLE_CONFIGURATION_CHANGED');
    process.exitCode = 1;
  }
}
