import { deepStrictEqual } from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const project = 'sabalanerp-local';
const compose = ['compose', '-p', project, '-f', 'docker-compose.local.yml'];
const projectDirectory = fileURLToPath(new URL('../', import.meta.url));
const nativeRecord = '/app/recovery-coordination/deployment-runtime-native.json';

function docker(args, cwd = projectDirectory) {
  const result = spawnSync('docker', args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Docker ${args[0]} failed (exit ${result.status ?? result.signal}).`);
  return result.stdout;
}

function copyNativeRecord(id) {
  const directory = mkdtempSync(join(tmpdir(), 'sabalan-local-shutdown-'));
  const filename = 'native.json';
  try {
    docker(['cp', `${id}:${nativeRecord}`, filename], directory);
    return readFileSync(join(directory, filename));
  } finally {
    rmSync(join(directory, filename), { force: true });
    rmdirSync(directory);
  }
}

export function stopLocalDocker({ runDocker = docker, readNativeRecord = copyNativeRecord } = {}) {
  runDocker([...compose, 'ps']);
  const serviceId = (service) => {
    const id = runDocker([...compose, 'ps', '--all', '--quiet', service]).trim();
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error(`Expected exactly one local ${service} container.`);
    return id;
  };
  const inspect = (id, service) => {
    const [container] = JSON.parse(runDocker(['inspect', '--type', 'container', id]));
    const labels = container?.Config?.Labels;
    if (container?.Id !== id || labels?.['com.docker.compose.project'] !== project
        || labels?.['com.docker.compose.service'] !== service) {
      throw new Error(`Could not verify the local ${service} container identity.`);
    }
    return container;
  };

  const backend = serviceId('backend');
  const postgres = serviceId('postgres');
  const backendBefore = inspect(backend, 'backend');
  const postgresBefore = inspect(postgres, 'postgres');
  if (backendBefore.State.Status !== 'running' || postgresBefore.State.Status !== 'running') {
    throw new Error('A running local backend and PostgreSQL are required to prove this shutdown.');
  }
  if (backendBefore.Config.StopSignal && !['SIGTERM', '15'].includes(backendBefore.Config.StopSignal)) {
    throw new Error('The local backend is configured with a stop signal other than SIGTERM.');
  }
  const claimBytes = readNativeRecord(backend);
  const claim = JSON.parse(claimBytes);
  if (claim?.format !== 'sabalan-runtime-native/v1' || claim.role !== 'standalone'
      || claim.phase !== 'ACTIVE' || typeof claim.instanceId !== 'string' || !/^[a-f0-9]{48}$/.test(claim.instanceId)) {
    throw new Error('The running local backend has no valid ACTIVE native claim.');
  }

  console.log('Draining the local backend with PostgreSQL still running. Allow up to five minutes.');
  runDocker(['stop', '--time', '300', backend]);
  const { State: backendAfter } = inspect(backend, 'backend');
  if (backendAfter.Status !== 'exited' || backendAfter.ExitCode !== 0 || backendAfter.OOMKilled
      || backendAfter.StartedAt !== backendBefore.State.StartedAt) {
    throw new Error('The original local backend did not exit cleanly.');
  }
  const closure = JSON.parse(readNativeRecord(backend));
  const { activeClaimSha256, nativeReaped, databaseQuiet, nativeStatus, stoppedBySignal, ...original } = closure ?? {};
  if (original.phase !== 'QUIESCENT'
      || activeClaimSha256 !== createHash('sha256').update(claimBytes).digest('hex')
      || nativeReaped !== true || databaseQuiet !== true || nativeStatus !== 0 || stoppedBySignal !== true) {
    throw new Error('The local backend did not publish a matching, successful QUIESCENT native closure.');
  }
  deepStrictEqual({ ...original, phase: 'ACTIVE' }, claim, 'The native closure changed the original claim identity.');

  const { State: postgresAfter } = inspect(postgres, 'postgres');
  if (postgresAfter.Status !== 'running' || postgresAfter.StartedAt !== postgresBefore.State.StartedAt) {
    throw new Error('The original local PostgreSQL did not stay running through the backend drain.');
  }
  const { State: backendFinal } = inspect(backend, 'backend');
  if (backendFinal.Status !== 'exited' || backendFinal.FinishedAt !== backendAfter.FinishedAt
      || serviceId('backend') !== backend || serviceId('postgres') !== postgres) {
    throw new Error('The local Compose services changed during shutdown.');
  }
  console.log('Verified the local backend native closure. Stopping the remaining local services.');
  runDocker([...compose, 'down']);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    stopLocalDocker();
  } catch (error) {
    console.error(`Local shutdown failed. Keep Docker Desktop and Windows running. ${error.message}`);
    process.exitCode = 1;
  }
}
