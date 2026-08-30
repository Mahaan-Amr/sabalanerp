import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { assertSabalanerpLocalPostgresTarget, temporaryDatabaseUrl } from './shipmentStatementConcurrency/database';

const namePattern = /^sabalanerp_concurrency_[a-f0-9]{16}$/;

const compose = (repositoryRoot: string, command: string) => execFileSync('docker', [
  'compose', '-f', path.join(repositoryRoot, 'docker-compose.local.yml'), 'exec', '-T', 'postgres', 'sh', '-lc', command,
], { cwd: repositoryRoot, stdio: 'pipe', encoding: 'utf8', timeout: 120_000 });

/** Exact-schema concurrency database without copying unrelated local data. */
export async function createPartnerLifecycleDatabase(input: { repositoryRoot: string; sourceDatabaseUrl: string }) {
  const runId = randomBytes(8).toString('hex');
  const databaseName = `sabalanerp_concurrency_${runId}`;
  if (!namePattern.test(databaseName)) throw new Error('Unsafe Partner lifecycle database name');
  const databaseUrl = temporaryDatabaseUrl(input.sourceDatabaseUrl, databaseName);
  const composeFile = path.join(input.repositoryRoot, 'docker-compose.local.yml');
  const status = execFileSync('docker', ['compose', '-f', composeFile, 'ps', '--format', 'json', 'postgres'],
    { cwd: input.repositoryRoot, encoding: 'utf8', timeout: 30_000 });
  assertSabalanerpLocalPostgresTarget(status);
  const quoted = `"${databaseName}"`;
  compose(input.repositoryRoot,
    `psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres --command 'CREATE DATABASE ${quoted}'`);
  try {
    compose(input.repositoryRoot, `set -o pipefail; pg_dump --schema-only --username postgres --dbname sabalanerp ` +
      `--no-owner --no-privileges | psql -v ON_ERROR_STOP=1 --username postgres --dbname ${quoted}`);
  } catch (error) {
    compose(input.repositoryRoot,
      `psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres --command 'DROP DATABASE IF EXISTS ${quoted}'`);
    throw error;
  }
  let cleaned = false;
  return {
    runId, databaseName, databaseUrl,
    client: () => new PrismaClient({ datasources: { db: { url: databaseUrl } } }),
    cleanup: async () => {
      if (cleaned) return;
      if (!namePattern.test(databaseName)) throw new Error('Unsafe Partner lifecycle cleanup target');
      compose(input.repositoryRoot, `psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres --command ` +
        `"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid()"`);
      compose(input.repositoryRoot,
        `psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres --command 'DROP DATABASE IF EXISTS ${quoted}'`);
      cleaned = true;
    },
  };
}
