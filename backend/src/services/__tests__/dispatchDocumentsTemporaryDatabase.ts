import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const DATABASE_PREFIX = 'sabalanerp_dispatchdocs_';
const DATABASE_NAME = /^sabalanerp_dispatchdocs_[a-f0-9]{16}$/;
const LOCAL_ENDPOINTS = new Set(['127.0.0.1:55432', 'localhost:55432']);
type ComposeProcess = { Project?: string; Service?: string; Name?: string; State?: string; Health?: string };

const checkedName = (value: string) => {
  if (!DATABASE_NAME.test(value)) throw new Error(`Refusing unsafe dispatch-document test database name: ${value}`);
  return value;
};

const compose = (repositoryRoot: string, command: string) => execFileSync('docker', [
  'compose', '-f', path.join(repositoryRoot, 'docker-compose.local.yml'), 'exec', '-T', 'postgres',
  'sh', '-lc', command,
], { cwd: repositoryRoot, stdio: 'pipe', encoding: 'utf8', timeout: 120_000 });

export const assertSabalanerpLocalPostgres = (output: string) => {
  const trimmed = output.trim();
  let processes: ComposeProcess[] = [];
  try {
    const parsed = JSON.parse(trimmed) as ComposeProcess | ComposeProcess[];
    processes = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    processes = trimmed.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as ComposeProcess);
  }
  const postgres = processes.find(process => process.Project === 'sabalanerp-local'
    && process.Service === 'postgres' && process.Name === 'sabalanerp-local-postgres-1');
  if (!postgres || postgres.State !== 'running' || postgres.Health !== 'healthy') {
    throw new Error('The sabalanerp-local postgres service must be the running, healthy preflight target.');
  }
};

const verifySabalanerpLocalPostgres = (repositoryRoot: string) => {
  const output = execFileSync('docker', ['compose', '-f', path.join(repositoryRoot, 'docker-compose.local.yml'),
    'ps', '--format', 'json'], { cwd: repositoryRoot, stdio: 'pipe', encoding: 'utf8', timeout: 30_000 });
  assertSabalanerpLocalPostgres(output);
};

export const createDispatchDocumentsTemporaryDatabase = async (input: {
  repositoryRoot: string;
  sourceDatabaseUrl: string;
}) => {
  const runId = randomBytes(8).toString('hex');
  const databaseName = checkedName(`${DATABASE_PREFIX}${runId}`);
  const source = new URL(input.sourceDatabaseUrl);
  if (source.protocol !== 'postgresql:' || !LOCAL_ENDPOINTS.has(source.host) || source.pathname !== '/sabalanerp') {
    throw new Error(`Dispatch-document concurrency test only accepts sabalanerp-local; received ${source.host}${source.pathname}.`);
  }
  const databaseUrl = new URL(source);
  databaseUrl.pathname = `/${databaseName}`;
  const quoted = `"${databaseName}"`;
  verifySabalanerpLocalPostgres(input.repositoryRoot);
  compose(input.repositoryRoot, `psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres --command 'CREATE DATABASE ${quoted}'`);
  try {
    compose(input.repositoryRoot, `set -o pipefail; pg_dump --username postgres --dbname sabalanerp --no-owner --no-privileges | psql -v ON_ERROR_STOP=1 --username postgres --dbname ${quoted}`);
  } catch (error) {
    compose(input.repositoryRoot, `psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres --command 'DROP DATABASE IF EXISTS ${quoted}'`);
    throw error;
  }
  let cleaned = false;
  return {
    runId,
    databaseName,
    databaseUrl: databaseUrl.toString(),
    client: () => new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } }),
    cleanup: async () => {
      if (cleaned) return;
      checkedName(databaseName);
      let lastError: unknown;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          compose(input.repositoryRoot, `psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres --command "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid()"`);
          compose(input.repositoryRoot, `psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres --command 'DROP DATABASE IF EXISTS ${quoted}'`);
          const remaining = compose(input.repositoryRoot,
            `psql -v ON_ERROR_STOP=1 --tuples-only --no-align --username postgres --dbname postgres --command "SELECT count(*) FROM pg_database WHERE datname = '${databaseName}'"`).trim();
          if (remaining === '0') { cleaned = true; return; }
          lastError = new Error(`Exact database still exists after cleanup attempt ${attempt}.`);
        } catch (error) { lastError = error; }
      }
      throw new Error(`Temporary database cleanup failed for ${databaseName}: ${
        lastError instanceof Error ? lastError.message : String(lastError)}`);
    },
  };
};
