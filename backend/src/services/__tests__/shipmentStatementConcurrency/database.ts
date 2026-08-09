import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const DATABASE_PREFIX = 'sabalanerp_concurrency_';
const DATABASE_NAME = /^sabalanerp_concurrency_[a-f0-9]{16}$/;
const LOCAL_ENDPOINTS = new Set(['127.0.0.1:55432', 'localhost:55432']);

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
      cleaned = true;
      assertTemporaryConcurrencyDatabaseName(databaseName);
      compose(input.repositoryRoot, `psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres --command "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid()"`);
      compose(input.repositoryRoot, `psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres --command 'DROP DATABASE ${quoted}'`);
    },
  };
};
