import { deepStrictEqual } from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
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

function saveShutdownProof(directory, file, proof) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporaryDirectory = mkdtempSync(join(directory, 'write-'));
  const temporaryFile = join(temporaryDirectory, 'proof.json');
  try {
    writeFileSync(temporaryFile, JSON.stringify(proof), { mode: 0o600, flag: 'wx', flush: true });
    renameSync(temporaryFile, file);
  } finally {
    rmSync(temporaryFile, { force: true });
    rmdirSync(temporaryDirectory);
  }
}

function loadShutdownProof(file) {
  try {
    return JSON.parse(readFileSync(file));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('The stopped local backend has no saved shutdown proof.');
    throw error;
  }
}

function parseActiveClaim(bytes) {
  const claim = JSON.parse(bytes);
  if (claim?.format !== 'sabalan-runtime-native/v1' || claim.role !== 'standalone'
      || claim.phase !== 'ACTIVE' || typeof claim.instanceId !== 'string' || !/^[a-f0-9]{48}$/.test(claim.instanceId)) {
    throw new Error('The local backend has no valid ACTIVE native claim for this shutdown.');
  }
  return claim;
}

export function stopLocalDocker({
  runDocker = docker, readNativeRecord = copyNativeRecord, backendOnly = false,
  proofDirectory = join(homedir(), '.sabalanerp-local-shutdown'),
} = {}) {
  if (!runDocker([...compose, 'ps', '--all', '--quiet']).trim()) {
    if (backendOnly) throw new Error('There is no local backend to drain.');
    console.log('The local Docker stack is already down.');
    return;
  }
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
  if (postgresBefore.State.Status !== 'running') {
    throw new Error('A running local PostgreSQL is required to prove this shutdown.');
  }
  const identity = {
    backend, postgres,
    backendStartedAt: backendBefore.State.StartedAt,
    postgresStartedAt: postgresBefore.State.StartedAt,
  };
  if (!identity.backendStartedAt || !identity.postgresStartedAt) {
    throw new Error('Could not verify the local backend and PostgreSQL start times.');
  }
  const proofFile = join(proofDirectory, 'shutdown.json');
  let claimBytes;
  let claim;
  if (backendBefore.State.Status === 'running') {
    if (backendBefore.Config.StopSignal && !['SIGTERM', '15'].includes(backendBefore.Config.StopSignal)) {
      throw new Error('The local backend is configured with a stop signal other than SIGTERM.');
    }
    claimBytes = readNativeRecord(backend);
    claim = parseActiveClaim(claimBytes);
    saveShutdownProof(proofDirectory, proofFile, { identity, claimBase64: claimBytes.toString('base64') });
    console.log('Draining the local backend with PostgreSQL still running. Allow up to five minutes.');
    runDocker(['stop', '--time', '300', backend]);
  } else if (backendBefore.State.Status === 'exited') {
    const proof = loadShutdownProof(proofFile);
    deepStrictEqual(proof.identity, identity, 'The saved shutdown proof is for a different backend or PostgreSQL run.');
    claimBytes = Buffer.from(proof.claimBase64, 'base64');
    claim = parseActiveClaim(claimBytes);
  } else {
    throw new Error('The local backend must be running or have exited after a verified shutdown attempt.');
  }
  const { State: backendAfter } = inspect(backend, 'backend');
  if (backendAfter.Status !== 'exited' || backendAfter.ExitCode !== 0 || backendAfter.OOMKilled
      || !backendAfter.FinishedAt || backendAfter.StartedAt !== identity.backendStartedAt) {
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
  if (backendOnly) {
    console.log('Verified the local backend native closure with PostgreSQL still running.');
    return;
  }
  console.log('Verified the local backend native closure. Stopping the remaining local services.');
  runDocker([...compose, 'down']);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== '--backend-only')) {
      throw new Error('Usage: node scripts/stop-local-docker.mjs [--backend-only]');
    }
    stopLocalDocker({ backendOnly: args[0] === '--backend-only' });
  } catch (error) {
    console.error(`Local shutdown failed. Keep Docker Desktop and Windows running. ${error.message}`);
    process.exitCode = 1;
  }
}
