import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

type Journal = {
  phase: 'STAGED' | 'FILES_PROMOTED' | 'DATABASE_PROMOTED';
  currentDatabase: string;
  stagedDatabase: string;
  safetyDatabase: string;
};

const coordination = process.env.RECOVERY_COORDINATION_DIR || path.join(process.cwd(), 'storage', 'recovery', 'coordination');
const journalPath = path.join(coordination, 'pending-restore.json');

if (!fs.existsSync(journalPath)) process.exit(0);

const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as Journal;
const parsed = new URL(process.env.DATABASE_URL || '');
const baseArgs = [
  '--host', parsed.hostname,
  '--port', parsed.port || '5432',
  '--username', decodeURIComponent(parsed.username),
  '--dbname', 'postgres',
  '--set', 'ON_ERROR_STOP=1',
  '--tuples-only',
  '--no-align',
];
const commandEnvironment = { ...process.env, PGPASSWORD: decodeURIComponent(parsed.password) };
const safeIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;
const safeLiteral = (value: string) => value.replace(/'/g, "''");
const run = (sql: string) => execFileSync('psql', [...baseArgs, '--command', sql], {
  env: commandEnvironment,
  windowsHide: true,
  encoding: 'utf8',
}).trim();
const exists = (database: string) => run(`SELECT 1 FROM pg_database WHERE datname = '${safeLiteral(database)}'`) === '1';

const hasCurrent = exists(journal.currentDatabase);
const hasStaged = exists(journal.stagedDatabase);
const hasSafety = exists(journal.safetyDatabase);

if (!hasCurrent && hasStaged && hasSafety) {
  run(`ALTER DATABASE ${safeIdentifier(journal.stagedDatabase)} RENAME TO ${safeIdentifier(journal.currentDatabase)}`);
  journal.phase = 'DATABASE_PROMOTED';
  fs.writeFileSync(journalPath, JSON.stringify(journal), { encoding: 'utf8', mode: 0o600 });
  console.log('Completed interrupted recovery database promotion before backend startup.');
} else if (!hasCurrent && !hasStaged && hasSafety) {
  run(`ALTER DATABASE ${safeIdentifier(journal.safetyDatabase)} RENAME TO ${safeIdentifier(journal.currentDatabase)}`);
  console.log('Restored the safety database name before backend startup.');
} else if (!hasCurrent) {
  throw new Error('Recovery preflight could not locate the active, staged, or safety database.');
}
