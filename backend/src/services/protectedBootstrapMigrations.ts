import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { compileProtectedBridgeMigration, protectedBoundary, protectedBridgeMigrationNames } from './protectedBridgeMigrations';
import baseline from './protectedBootstrapBaseline.json';

type Owner = { deploymentId: string; releaseId: string; leaseToken: string };
const fail = (code: string): never => { throw Object.assign(new Error(code), { code }); };

export function assertProtectedBootstrapBoundary(owner: Owner) {
  if (process.env.DEPLOYMENT_INITIAL_SCHEMA_BOOTSTRAP !== 'true') fail('PROTECTED_BOOTSTRAP_REQUIRED');
  protectedBoundary(owner)();
  const file = path.join(process.env.RECOVERY_COORDINATION_DIR || '/app/recovery-coordination', 'deployment-checkpoint.json');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd, { bigint: true });
    if (!stat.isFile() || stat.nlink !== 1n || stat.uid !== BigInt(process.getuid!()) || (stat.mode & 0o022n) !== 0n
      || stat.size < 1n || stat.size > 16n * 1024n * 1024n || fs.realpathSync(file) !== file) fail('PROTECTED_BOOTSTRAP_CHECKPOINT_UNPROVEN');
    const point = JSON.parse(fs.readFileSync(fd, 'utf8'));
    const after = fs.fstatSync(fd, { bigint: true }), named = fs.lstatSync(file, { bigint: true });
    if (stat.dev !== after.dev || stat.ino !== after.ino || stat.size !== after.size || stat.mtimeNs !== after.mtimeNs
      || stat.ctimeNs !== after.ctimeNs || named.ino !== stat.ino || named.dev !== stat.dev || after.nlink !== 1n
      || point.deploymentId !== owner.deploymentId || point.releaseId !== owner.releaseId
      || point.localVerified !== true || point.remoteVerified !== true || point.restoreVerified !== true
      || point.manifestReadable !== true || !/^[a-f0-9]{64}$/.test(point.checksum)) fail('PROTECTED_BOOTSTRAP_CHECKPOINT_UNPROVEN');
    return point;
  } finally { fs.closeSync(fd); }
}

/** Frozen historical prefix only. The two new migrations must subsequently
 * use the owned transactional applier, never native history adoption. */
export function compileProtectedBootstrapSource(directory: string) {
  if (baseline.format !== 'sabalan-protected-bootstrap/v1' || baseline.migrations.length !== 425) fail('PROTECTED_BOOTSTRAP_BASELINE_UNPROVEN');
  const names = fs.readdirSync(directory, { withFileTypes: true }).filter(row => row.isDirectory()).map(row => row.name).sort();
  const expected = [...baseline.migrations.map(row => row.name), ...protectedBridgeMigrationNames].sort();
  if (new Set(expected).size !== expected.length || JSON.stringify(names) !== JSON.stringify(expected)) fail('PROTECTED_BOOTSTRAP_SOURCE_UNSUPPORTED');
  const files = baseline.migrations.map(row => {
    const bytes = fs.readFileSync(path.join(directory, row.name, 'migration.sql'));
    if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) fail('PROTECTED_BOOTSTRAP_SQL_IDENTITY_MISMATCH');
    return { name: row.name, bytes };
  });
  for (const name of protectedBridgeMigrationNames) compileProtectedBridgeMigration(name, fs.readFileSync(path.join(directory, name, 'migration.sql')));
  return files;
}

export async function runProtectedBootstrapBaseline(owner: Owner) {
  assertProtectedBootstrapBoundary(owner);
  const prismaRoot = path.resolve(__dirname, '../../prisma'), directory = path.join(prismaRoot, 'migrations');
  const files = compileProtectedBootstrapSource(directory);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-protected-bootstrap-'));
  try {
    fs.chmodSync(staging, 0o700);
    fs.mkdirSync(path.join(staging, 'migrations'), { mode: 0o700 });
    fs.copyFileSync(path.join(prismaRoot, 'schema.prisma'), path.join(staging, 'schema.prisma'));
    fs.copyFileSync(path.join(directory, 'migration_lock.toml'), path.join(staging, 'migrations/migration_lock.toml'));
    for (const { name, bytes } of files) {
      fs.mkdirSync(path.join(staging, 'migrations', name), { mode: 0o700 });
      fs.writeFileSync(path.join(staging, 'migrations', name, 'migration.sql'), bytes, { flag: 'wx', mode: 0o400 });
    }
    assertProtectedBootstrapBoundary(owner);
    await new Promise<void>((resolve, reject) => {
      // A native subreaper retains FD9 through descendant death AND fresh SQL
      // completion. Its durable ACTIVE record also fences container loss.
      const child = spawn('python3', [path.resolve(__dirname, '../../scripts/protected-bootstrap-owner.py'), process.execPath,
        path.join(path.dirname(require.resolve('prisma/package.json')), 'build/index.js'), path.join(staging, 'schema.prisma')],
      { env: { ...process.env, SABALAN_BOOTSTRAP_OWNER_JSON: JSON.stringify(owner) },
        stdio: ['ignore', 'inherit', 'inherit', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', 9] });
      child.once('error', reject);
      child.once('close', (code, signal) => code === 0 && signal === null ? resolve()
        : reject(Object.assign(new Error('PROTECTED_BOOTSTRAP_NATIVE_FAILED'), { code: 'PROTECTED_BOOTSTRAP_NATIVE_FAILED' })));
    });
    assertProtectedBootstrapBoundary(owner);
  } finally {
    if (path.dirname(staging) !== os.tmpdir() || !path.basename(staging).startsWith('sabalan-protected-bootstrap-')) fail('PROTECTED_BOOTSTRAP_STAGE_UNSAFE');
    fs.rmSync(staging, { recursive: true });
  }
}
