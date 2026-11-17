import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isIPv4 } from 'node:net';
import { pathToFileURL } from 'node:url';

const runtimeUser = 'sabalan_application_runtime';
const controllerUser = 'sabalan_allocation_controller';
const unproven = () => { throw new Error('PREDECESSOR_DATABASE_TOPOLOGY_UNPROVEN'); };

function parse(value) {
  const url = new URL(value);
  if (url.protocol !== 'postgresql:' || url.host !== 'postgres:5432'
    || !/^\/[a-zA-Z0-9_]+$/.test(url.pathname) || url.hash
    || !url.username || !url.password
    || url.searchParams.getAll('schema').join(',') !== 'public'
    || [...url.searchParams.keys()].some(key => !['schema', 'connection_limit', 'pool_timeout', 'application_name'].includes(key))
    || ['connection_limit', 'pool_timeout'].some(key => !/^[1-9][0-9]*$/.test(url.searchParams.getAll(key).join(',')))) unproven();
  return { url, user: decodeURIComponent(url.username), password: decodeURIComponent(url.password) };
}

export function readPredecessorDatabaseTopology(config, installedRuntimeUrl) {
  try {
    const { backend, deployment, postgres } = config.services;
    const runtimeUrl = backend.environment.DATABASE_URL;
    const controlUrl = deployment.environment.DATABASE_URL;
    const { POSTGRES_USER: bootstrapUser, POSTGRES_PASSWORD: bootstrapPassword, POSTGRES_DB: database } = postgres.environment;
    if (!runtimeUrl || !controlUrl || !bootstrapUser || !bootstrapPassword || !database) unproven();
    const legacyPrefix = `postgresql://${bootstrapUser}:${bootstrapPassword}@postgres:5432/${database}?`;
    if (runtimeUrl === controlUrl && runtimeUrl.startsWith(legacyPrefix)
      && (!installedRuntimeUrl || new URL(installedRuntimeUrl).username === new URL(runtimeUrl).username)
      && bootstrapUser !== runtimeUser && bootstrapUser !== controllerUser) return { split: false };

    const runtime = parse(runtimeUrl);
    const control = parse(controlUrl);
    if (runtimeUrl !== installedRuntimeUrl || runtime.user !== runtimeUser || bootstrapUser === runtimeUser
      || bootstrapUser === controllerUser || control.user !== bootstrapUser || !/^[a-zA-Z0-9_]+$/.test(control.user)
      || runtime.password === bootstrapPassword || runtime.password === control.password
      || ![control.url.password, control.password].includes(bootstrapPassword)
      || runtime.url.pathname !== '/' + database || control.url.pathname !== runtime.url.pathname) unproven();
    return { split: true, controlUser: control.user };
  } catch {
    unproven();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [mode, containerId] = process.argv.slice(2);
    const config = JSON.parse(readFileSync(0, 'utf8'));
    if (!['retained', 'running'].includes(mode)
      || (containerId && !/^[0-9a-f]{12,64}$/.test(containerId))) unproven();
    const [container] = containerId
      ? JSON.parse(execFileSync('docker', ['inspect', containerId], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
      : [];
    const entries = container?.Config.Env.filter(value => value.startsWith('DATABASE_URL=')) ?? [];
    if (container && entries.length !== 1) unproven();
    const topology = readPredecessorDatabaseTopology(config, entries[0]?.slice('DATABASE_URL='.length));
    if (!topology.split) {
      console.log('legacy');
    } else {
      // The runner keeps this binding in memory across the rollout.
      const binding = 'split:' + createHash('sha256').update(JSON.stringify([
        entries[0], config.services.deployment.environment.DATABASE_URL,
      ])).digest('hex');
      if (mode === 'retained') {
        console.log(binding);
        process.exit(0);
      }
      const addresses = Object.values(container.NetworkSettings.Networks).map(network => network.IPAddress).filter(Boolean);
      if (!container.State.Running || addresses.length !== 1 || !isIPv4(addresses[0])) unproven();
      console.log([binding, topology.controlUser, addresses[0]].join(' '));
    }
  } catch {
    console.error('PREDECESSOR_DATABASE_TOPOLOGY_UNPROVEN');
    process.exitCode = 1;
  }
}
