import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const DATABASE_PREFIX = 'sabalanerp_concurrency_';
const DATABASE_NAME = /^sabalanerp_concurrency_[a-f0-9]{16}$/;
const LOCAL_ENDPOINTS = new Set(['127.0.0.1:55432', 'localhost:55432']);

export const assertSabalanerpLocalPostgresTarget = (output: string) => {
  let rows: Array<Record<string, unknown>>;
  try {
    const parsed = JSON.parse(output) as Record<string, unknown> | Array<Record<string, unknown>>;
    rows = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    rows = output.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
  }
  const postgres = rows.find(row => row.Project === 'sabalanerp-local' && row.Service === 'postgres'
    && row.State === 'running' && row.Health === 'healthy'
    && /^sabalanerp-local-postgres-\d+$/.test(String(row.Name || '')));
  if (!postgres) throw new Error('Refusing Docker target: sabalanerp-local postgres is not the verified healthy running service.');
  return { project: 'sabalanerp-local', service: 'postgres', container: String(postgres.Name) };
};

export const assertTemporaryConcurrencyDatabaseName = (value: string): string => {
  if (!DATABASE_NAME.test(value)) throw new Error(`Refusing unsafe concurrency database name: ${value}`);
  return value;
};

export const temporaryDatabaseUrl = (sourceUrl: string, databaseName: string): string => {
  assertTemporaryConcurrencyDatabaseName(databaseName);
  const url = new URL(sourceUrl);
  if (url.protocol !== 'postgresql:' || !LOCAL_ENDPOINTS.has(url.host) || url.pathname !== '/sabalanerp') {
    throw new Error(`Concurrency harness only accepts sabalanerp-local at 127.0.0.1:55432; received ${url.host}${url.pathname}.`);
  }
  url.pathname = `/${databaseName}`;
  return url.toString();
};

const compose = (repositoryRoot: string, command: string) => execFileSync('docker', [
  'compose', '-f', path.join(repositoryRoot, 'docker-compose.local.yml'), 'exec', '-T', 'postgres',
  'sh', '-lc', command,
], { cwd: repositoryRoot, stdio: 'pipe', encoding: 'utf8', timeout: 120_000 });

const verifyComposeTarget = (repositoryRoot: string) => assertSabalanerpLocalPostgresTarget(execFileSync('docker', [
  'compose', '-f', path.join(repositoryRoot, 'docker-compose.local.yml'), 'ps', '--format', 'json', 'postgres',
], { cwd: repositoryRoot, stdio: 'pipe', encoding: 'utf8', timeout: 30_000 }));

export type TemporaryConcurrencyDatabase = {
  runId: string;
  databaseName: string;
  databaseUrl: string;
  client(): PrismaClient;
  cleanup(): Promise<void>;
};

export const createTemporaryConcurrencyDatabase = async (input: {
  repositoryRoot: string;
  sourceDatabaseUrl: string;
  runId?: string;
}): Promise<TemporaryConcurrencyDatabase> => {
  const runId = input.runId ?? randomBytes(8).toString('hex');
  if (!/^[a-f0-9]{16}$/.test(runId)) throw new Error('Concurrency runId must be exactly 16 lowercase hexadecimal characters.');
  const databaseName = assertTemporaryConcurrencyDatabaseName(`${DATABASE_PREFIX}${runId}`);
  const databaseUrl = temporaryDatabaseUrl(input.sourceDatabaseUrl, databaseName);
  const quoted = `"${databaseName}"`;
  verifyComposeTarget(input.repositoryRoot);
  compose(input.repositoryRoot, `psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres --command 'CREATE DATABASE ${quoted}'`);
  try {
    compose(input.repositoryRoot, `set -o pipefail; pg_dump --username postgres --dbname sabalanerp --no-owner --no-privileges | psql -v ON_ERROR_STOP=1 --username postgres --dbname ${quoted}`);
  } catch (error) {
    compose(input.repositoryRoot, `psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres --command 'DROP DATABASE IF EXISTS ${quoted}'`);
    throw error;
  }
  let cleaned = false;
  return {
    runId, databaseName, databaseUrl,
    client: () => new PrismaClient({ datasources: { db: { url: databaseUrl } } }),
    cleanup: async () => {
      if (cleaned) return;
      assertTemporaryConcurrencyDatabaseName(databaseName);
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
      throw new Error(`Temporary concurrency database cleanup failed for ${databaseName}: ${
        lastError instanceof Error ? lastError.message : String(lastError)}`);
    },
  };
};
