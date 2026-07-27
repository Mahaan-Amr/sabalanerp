import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { Client } from 'pg';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const testDatabaseName = 'sabalanerp_design_system_e2e';
const databaseDirectory = path.join(
  repositoryRoot,
  '.scratch',
  'design-system-e2e',
  'postgres'
);
const postgresBin = path.join(
  repositoryRoot,
  'node_modules',
  '@embedded-postgres',
  'windows-x64',
  'native',
  'bin'
);
const initdb = path.join(postgresBin, 'initdb.exe');
const pgControl = path.join(postgresBin, 'pg_ctl.exe');
const databaseUrl =
  `postgresql://postgres@127.0.0.1:55435/${testDatabaseName}?schema=public`;

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error(
    'The local design-system browser suite currently requires Windows x64; use the CI database adapter elsewhere.'
  );
}

if (!fs.existsSync(initdb) || !fs.existsSync(pgControl)) {
  throw new Error('Embedded PostgreSQL is not installed. Run npm install at the repository root.');
}

fs.mkdirSync(databaseDirectory, { recursive: true });

if (!fs.existsSync(path.join(databaseDirectory, 'PG_VERSION'))) {
  execFileSync(
    initdb,
    [
      '-D',
      databaseDirectory,
      '--username=postgres',
      '--auth-host=trust',
      '--auth-local=trust',
      '--encoding=UTF8'
    ],
    { stdio: 'inherit' }
  );
}

execFileSync(
  pgControl,
  ['-D', databaseDirectory, '-o', '-p 55435 -h 127.0.0.1', '-w', 'start'],
  { stdio: 'inherit' }
);

let exitCode = 1;
try {
  const admin = new Client({
    connectionString: 'postgresql://postgres@127.0.0.1:55435/postgres'
  });
  await admin.connect();
  try {
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [testDatabaseName]
    );
    await admin.query(`DROP DATABASE IF EXISTS "${testDatabaseName}"`);
    await admin.query(`CREATE DATABASE "${testDatabaseName}"`);
  } finally {
    await admin.end();
  }

  const result = spawnSync(
    process.execPath,
    [
      path.join(repositoryRoot, 'node_modules', '@playwright', 'test', 'cli.js'),
      'test',
      '--config=playwright.design-system.config.ts',
      ...process.argv.slice(2)
    ],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl
      },
      stdio: 'inherit'
    }
  );
  if (result.error) throw result.error;
  exitCode = result.status ?? 1;
} finally {
  execFileSync(
    pgControl,
    ['-D', databaseDirectory, '-m', 'fast', '-w', 'stop'],
    { stdio: 'inherit' }
  );
}

process.exitCode = exitCode;
