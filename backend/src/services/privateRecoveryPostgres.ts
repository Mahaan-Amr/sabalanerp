import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { nativePostgresCliConnection } from './nativePostgresCli';
import { equivalentRecoverySchemas, recoveryDatabaseSemanticsSql, type RecoveryDatabaseSemantics } from './recoverySchemaIdentity';
import { APPLICATION_RECOVERY_CONTROL_TABLES } from './recoveryControlData';

const run = promisify(execFile);
const TEMPLATE = '/opt/recovery-postgres-root';
const LAUNCHER = '/usr/local/libexec/recovery-postgres-sandbox';
const environment = () => ({ PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', HOME: '/tmp' });
const reject = (reason: string): never => { throw Object.assign(new Error(reason), { code: 'PRIVATE_RECOVERY_POSTGRES_REJECTED' }); };

async function cli(tool: string, arguments_: string[], databaseUrl?: string) {
  const connection = databaseUrl ? nativePostgresCliConnection(databaseUrl) : undefined;
  return run(tool, [...(connection ? ['--dbname', connection.url] : []), ...arguments_], {
    env: { ...environment(), ...connection?.environment, PGOPTIONS: '-csearch_path=pg_catalog', PGCONNECT_TIMEOUT: '2' }, windowsHide: true,
    timeout: 30 * 60 * 1000, maxBuffer: 32 * 1024 * 1024,
  });
}

async function sql(url: string, text: string) {
  const result = await cli('psql', ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--tuples-only', '--no-align', '--command',
    text], url);
  return result.stdout.trim();
}

async function schema(url: string) {
  return (await cli('pg_dump', ['--schema-only', '--no-owner', '--no-privileges', '--no-comments'], url)).stdout;
}

async function chownData(directory: string) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) reject('Private PostgreSQL template data contains a symlink.');
    if (entry.isDirectory()) await chownData(filename);
    await fs.chown(filename, 65532, 65532);
  }
  await fs.chown(directory, 65532, 65532);
}

async function migrate(url: string, schemaFile: string) {
  await run(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', schemaFile], {
    env: { ...environment(), DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    timeout: 30 * 60 * 1000, windowsHide: true, maxBuffer: 32 * 1024 * 1024,
  });
}

/** Canonical bytes and actual archived Prisma receipts establish the only
 * historical schema on which the private superuser may run forward migrations. */
async function historicalPrefix(sourceUrl: string, schemaFile: string, destination: string) {
  const directory = path.join(path.dirname(schemaFile), 'migrations');
  const names = (await fs.readdir(directory, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  const receipts = JSON.parse(await sql(sourceUrl, `SELECT COALESCE(json_agg(row_to_json(receipt)), '[]'::json) FROM (
    SELECT migration_name, checksum, finished_at IS NOT NULL AS finished,
      rolled_back_at IS NOT NULL AS rolled_back, applied_steps_count
    FROM public._prisma_migrations ORDER BY migration_name, started_at, id) receipt`)) as Array<{
    migration_name: string; checksum: string; finished: boolean; rolled_back: boolean; applied_steps_count: number;
  }>;
  if (!Array.isArray(receipts) || !receipts.length || receipts.some(receipt => !receipt.finished && !receipt.rolled_back)) {
    reject('The recovery archive has an incomplete or absent Prisma migration ledger.');
  }
  const completed = receipts.filter(receipt => !receipt.rolled_back);
  if (!completed.length || completed.some((receipt, index) => receipt.migration_name !== names[index] || !receipt.finished || receipt.applied_steps_count !== 1)) {
    reject('The archived migration ledger is not a completed canonical prefix.');
  }
  const sourceBytes = new Map<string, Buffer>();
  for (const receipt of receipts) {
    if (!names.includes(receipt.migration_name)) reject('The archive names an unknown migration.');
    const bytes = sourceBytes.get(receipt.migration_name) || await fs.readFile(path.join(directory, receipt.migration_name, 'migration.sql'));
    sourceBytes.set(receipt.migration_name, bytes);
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== receipt.checksum) {
      reject('The archived migration checksum differs from the immutable application source.');
    }
  }
  await fs.mkdir(path.join(destination, 'migrations'), { recursive: true, mode: 0o700 });
  await fs.copyFile(schemaFile, path.join(destination, 'schema.prisma'));
  await fs.copyFile(path.join(directory, 'migration_lock.toml'), path.join(destination, 'migrations', 'migration_lock.toml'));
  for (const receipt of completed) {
    const target = path.join(destination, 'migrations', receipt.migration_name);
    await fs.mkdir(target, { mode: 0o700 });
    await fs.writeFile(path.join(target, 'migration.sql'), sourceBytes.get(receipt.migration_name)!, { mode: 0o600 });
  }
  return path.join(destination, 'schema.prisma');
}

/** No owner credential, production filesystem, process fd, TCP listener or
 * outgoing network syscall reaches this temporary PostgreSQL server. */
export async function migrateRecoveryArchivePrivately(input: {
  sourceDump: string;
  workDirectory: string;
  applyMigrations: boolean;
  databaseSemantics: RecoveryDatabaseSemantics;
  assertBoundary(): Promise<void>;
  verifyCurrentSchema(schema: string): Promise<void>;
}) {
  if (process.platform !== 'linux' || process.getuid?.() !== 0) reject('Private recovery migration requires the protected Linux owner container.');
  const imageId = process.env.SYSTEM_RECOVERY_POSTGRES_IMAGE_ID;
  const identity = JSON.parse(await fs.readFile(path.join(TEMPLATE, 'identity.json'), 'utf8'));
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId || '') || identity.imageId !== imageId) {
    reject('The private PostgreSQL template does not match the verified running database image.');
  }
  await input.assertBoundary();
  const temporary = await fs.mkdtemp('/tmp/sbr-');
  await fs.chmod(temporary, 0o700);
  const root = path.join(temporary, 'root');
  let started = false;
  let child: ReturnType<typeof spawn> | undefined;
  let failed: Error | undefined;
  try {
    await fs.cp(TEMPLATE, root, { recursive: true, verbatimSymlinks: true });
    await fs.chmod(root, 0o755);
    await chownData(path.join(root, 'data'));
    await fs.chown(path.join(root, 'run'), 65532, 65532);
    await fs.chmod(path.join(root, 'run'), 0o700);
    const url = (database: string, user = 'recovery_owner') => {
      const value = new URL(`postgresql://${user}@localhost/${database}`);
      value.searchParams.set('host', path.join(root, 'run'));
      return value.toString();
    };
    child = spawn(LAUNCHER, [root], { env: environment(), stdio: ['ignore', 'ignore', 'ignore'] });
    started = true;
    child.once('error', error => { failed = error; });
    child.once('exit', () => { failed = new Error('Private PostgreSQL stopped before migration completed.'); });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (failed) throw failed;
      try { await sql(url('postgres'), 'SELECT 1'); ready = true; break; } catch { /* Startup is bounded below. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) reject('Private PostgreSQL did not become ready.');
    await sql(url('postgres'), `CREATE ROLE recovery_import LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
    const locale = input.databaseSemantics;
    const literal = (value: string) => "'" + value.replace(/'/g, "''") + "'";
    if (!locale || !['c', 'i'].includes(locale.provider)) reject('Unsupported trusted target database locale.');
    const creation = `TEMPLATE template0 ENCODING ${literal(locale.encoding)} LC_COLLATE ${literal(locale.collate)} LC_CTYPE ${literal(locale.ctype)}
      LOCALE_PROVIDER ${locale.provider === 'i' ? 'icu' : 'libc'}${locale.provider === 'i' ? ` ICU_LOCALE ${literal(locale.icuLocale!)}` : ''}`;
    await sql(url('postgres'), `CREATE DATABASE recovery_source OWNER recovery_import ${creation}`);
    await sql(url('postgres'), `CREATE DATABASE recovery_expected ${creation}`);
    const actualSemantics = JSON.parse(await sql(url('recovery_expected'), `SELECT row_to_json(identity) FROM (${recoveryDatabaseSemanticsSql}) identity`));
    if (Object.entries(locale).some(([key, value]) => actualSemantics[key] !== value)) {
      reject('Private PostgreSQL version, provider or collation semantics differ from the trusted target.');
    }
    const source = url('recovery_source', 'recovery_import');
    await cli('pg_restore', ['--no-owner', '--no-privileges', '--exit-on-error', input.sourceDump], source);
    const schemaFile = path.join(process.cwd(), 'prisma', 'schema.prisma');
    const prefix = await historicalPrefix(source, schemaFile, path.join(input.workDirectory, 'canonical-prefix'));
    await migrate(url('recovery_expected'), prefix);
    // Compare before assigning any archive-controlled definition to the private
    // superuser. Trusted migrations must never invoke an uploaded replacement.
    await input.assertBoundary();
    const [expected, actual] = await Promise.all([schema(url('recovery_expected')), schema(source)]);
    if (!equivalentRecoverySchemas(expected, actual)) reject('The archive schema differs from its byte-pinned historical migration prefix.');
    await sql(url('recovery_source'), `ALTER DATABASE recovery_source RESET ALL;
      ALTER ROLE recovery_import RESET ALL; ALTER ROLE recovery_import NOLOGIN;
      SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'recovery_import' AND pid <> pg_backend_pid();
      REASSIGN OWNED BY recovery_import TO recovery_owner`);
    if (input.applyMigrations) await migrate(url('recovery_source'), schemaFile);
    await input.verifyCurrentSchema(await schema(url('recovery_source')));
    await input.assertBoundary();
    const dumpPath = path.join(input.workDirectory, 'migrated-application.dump');
    await cli('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--file', dumpPath,
      ...APPLICATION_RECOVERY_CONTROL_TABLES.map(table => `--exclude-table-data=${table}`)], url('recovery_source'));
    if (failed) throw failed;
    return { dumpPath };
  } finally {
    // The native owner uses pidfds and the exact jail-root inode, including
    // descendants whose PostgreSQL session startup legitimately calls setsid.
    if (started) await run(LAUNCHER, ['--stop', root], { env: environment(), timeout: 15000, maxBuffer: 1024 * 1024 });
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise<void>(resolve => { child!.once('exit', () => resolve()); });
    }
    await fs.rm(temporary, { recursive: true });
  }
}
