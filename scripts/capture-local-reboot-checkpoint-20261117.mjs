import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, realpath, stat, statfs, writeFile, constants } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const project = 'sabalanerp-local';
const primary = 'D:/sabalanerp-local-recovery-20261117';
const secondary = 'C:/Users/PC/Documents/Codex/sabalanerp-local-recovery-20261117';
const backendId = '054134c71149589d36eeaec7d80b9f0932e92a675a2f5e91147fbd47748e1cbf';
const backendImage = 'sha256:86899cc48ba087f22ee2385c20b6ca7cf2f568ff15d51fd44f1b6e57f021d4af';
const inquiryImage = 'sha256:861da55794e7dac1e98c972c3f8f3bbb2ec3b3289df10d27e1556d246b2c32c8';
const activeSha256 = '334255f21ce1dc1eed916c26e47cc70c535cb81654552b760743e0e1cec997fd';
const observedBootId = 'e758296d-c127-49c1-94d4-636136f61d1b';
const clusterIdentifier = '7703877635514671138';
const databaseOid = '57567';
const volumes = [
  'backend_recovery', 'backend_storage_accounting_contracts', 'backend_storage_contracts',
  'backend_storage_dispatch_documents', 'backend_storage_hr_hiring', 'backend_storage_sepidar_backups',
  'backend_storage_support_tickets', 'backend_uploads', 'inquiry_data', 'recovery_coordination', 'redis_data',
];
const names = ['backend', 'clamav', 'frontend', 'inquiry', 'postgres', 'redis'];
const container = service => `${project}-${service}-1`;
const docker = (args, options = {}) => execFileSync('docker', args, {
  timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'], ...options,
});
const exec = (service, ...args) => docker(['exec', container(service), ...args]).toString().trim();
const inspect = service => JSON.parse(docker(['inspect', container(service)]))[0];
const digest = async file => {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
};

async function stream(args, file) {
  const subprocess = spawn('docker', args, {
    stdio: ['ignore', 'pipe', 'ignore'], timeout: 20 * 60_000,
  });
  const done = new Promise((resolve, reject) => {
    subprocess.once('error', reject);
    subprocess.once('close', (code, signal) => code === 0
      ? resolve()
      : reject(new Error(`Docker ${args[0]} failed: ${code ?? signal}`)));
  });
  await Promise.all([pipeline(subprocess.stdout, createWriteStream(file, { flags: 'wx' })), done]);
}

function observe() {
  const scope = docker(['compose', '-f', 'docker-compose.local.yml', 'ps', '-a', '-q'])
    .toString().trim().split(/\r?\n/).sort();
  const containers = Object.fromEntries(names.map(service => [service, inspect(service)]));
  assert.deepEqual(scope, names.map(service => containers[service].Id).sort());
  for (const service of names) {
    assert.equal(containers[service].Config.Labels['com.docker.compose.project'], project);
    assert.equal(containers[service].Config.Labels['com.docker.compose.service'], service);
    if (service !== 'backend') assert.equal(containers[service].State.Health.Status, 'healthy');
  }
  const backend = containers.backend;
  assert.equal(backend.Id, backendId);
  assert.equal(backend.Image, backendImage);
  assert.equal(backend.State.ExitCode, 75);
  assert(['restarting', 'exited'].includes(backend.State.Status));
  assert.equal(containers.inquiry.Image, inquiryImage);
  assert.equal(exec('postgres', 'cat', '/proc/sys/kernel/random/boot_id'), observedBootId);
  const active = docker(['exec', container('inquiry'), 'cat', '/app/recovery-coordination/deployment-runtime-native.json']);
  assert.equal(createHash('sha256').update(active).digest('hex'), activeSha256);
  const observation = exec('postgres', 'psql', '-XqtA', '-U', 'postgres', '-d', 'postgres', '-c',
    `SELECT system_identifier::text,
       (SELECT oid FROM pg_database WHERE datname='sabalanerp'),
       (SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'sabalan-rt-%'),
       (SELECT count(*) FROM pg_prepared_xacts) FROM pg_control_system();`);
  assert.equal(observation, `${clusterIdentifier}|${databaseOid}|0|0`);
  return containers;
}

async function capture() {
  assert.deepEqual(process.argv.slice(2), ['--capture-current-local-incident']);
  assert.equal(process.platform, 'win32');
  const operator = execFileSync('whoami.exe', { encoding: 'utf8' }).trim();
  const captureStartedAt = new Date().toISOString();
  const containers = observe();
  for (const directory of [primary, secondary]) {
    const parent = path.dirname(directory);
    assert.equal(path.resolve(await realpath(parent)).toLowerCase(), path.resolve(parent).toLowerCase());
    const disk = await statfs(parent, { bigint: true });
    assert(disk.bavail * disk.bsize > 8n * 1024n ** 3n, `Insufficient checkpoint space at ${parent}`);
    await mkdir(directory);
    execFileSync('icacls.exe', [directory, '/inheritance:r', '/grant:r',
      `${operator}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F']);
  }
  assert.notEqual((await stat(primary)).dev, (await stat(secondary)).dev);
  const selected = new Map();
  for (const service of ['backend', 'inquiry', 'redis']) {
    for (const mount of containers[service].Mounts) {
      if (mount.Type !== 'volume' || !mount.Name.startsWith(`${project}_`)) continue;
      const name = mount.Name.slice(project.length + 1);
      if (volumes.includes(name) && !selected.has(name)) selected.set(name, [service, mount.Destination]);
    }
  }
  assert.deepEqual([...selected.keys()].sort(), volumes.toSorted());
  const entries = [];
  async function record(name, operation) {
    const file = path.join(primary, name);
    await operation(file);
    const bytes = (await stat(file)).size;
    assert(bytes > 0, `Empty checkpoint object: ${name}`);
    entries.push({ name, bytes, sha256: await digest(file) });
    console.log(`${name}: ${bytes} bytes`);
  }
  const temporary = `/tmp/sabalan-local-checkpoint-${randomUUID()}`;
  for (const [service, image] of [['backend', backendImage], ['inquiry', inquiryImage]]) {
    await record(`${service}-image.tar`, file => stream(['image', 'save', image], file));
  }
  await record('postgres.dump', async file => {
    await stream(['exec', container('postgres'), 'pg_dump', '-U', 'postgres', '-d', 'sabalanerp', '-Fc'], file);
    const target = `${temporary}.dump`;
    try {
      docker(['cp', file, `${container('postgres')}:${target}`]);
      assert.equal(exec('postgres', 'sha256sum', target).split(/\s+/)[0], await digest(file));
      exec('postgres', 'sh', '-c', 'pg_restore --list "$1" >/dev/null', 'verify-checkpoint', target);
    } finally {
      exec('postgres', 'rm', '-f', target);
    }
  });
  for (const [name, [service, destination]] of selected) {
    await record(`${name}.tar`, file => stream(['cp', `${container(service)}:${destination}`, '-'], file));
  }
  async function copyVerified(service, target, file) {
    const expected = exec(service, 'sha256sum', target).split(/\s+/)[0];
    docker(['cp', `${container(service)}:${target}`, file]);
    assert.equal(await digest(file), expected);
  }
  await record('inquiry-consistent.db', async file => {
    const target = `${temporary}.db`;
    try {
      exec('inquiry', 'sqlite3', '/data/inquiry.db', `.backup ${target}`);
      assert.equal(exec('inquiry', 'sqlite3', target, 'PRAGMA integrity_check;'), 'ok');
      await copyVerified('inquiry', target, file);
    } finally {
      exec('inquiry', 'rm', '-f', target);
    }
  });
  await record('redis-consistent.rdb', async file => {
    const target = `${temporary}.rdb`;
    try {
      exec('redis', 'redis-cli', '--rdb', target);
      assert.match(exec('redis', 'redis-check-rdb', target), /RDB looks OK/);
      await copyVerified('redis', target, file);
    } finally {
      exec('redis', 'rm', '-f', target);
    }
  });
  const after = observe();
  for (const service of names) assert.equal(after[service].Id, containers[service].Id);
  for (const entry of entries) {
    const copy = path.join(secondary, entry.name);
    await copyFile(path.join(primary, entry.name), copy, constants.COPYFILE_EXCL);
    assert.equal(await digest(copy), entry.sha256);
  }
  const manifest = { format: 'sabalan-local-dual-checkpoint/v1', captureStartedAt,
    sourceProject: project, backendImage, inquiryImage, activeSha256, backendContainerId: backendId,
    observedBootId, clusterIdentifier, databaseOid, entries };
  const bytes = Buffer.from(JSON.stringify(manifest) + '\n');
  for (const directory of [primary, secondary]) {
    await writeFile(path.join(directory, 'manifest.json'), bytes, { flag: 'wx' });
  }
  assert.equal(await digest(path.join(primary, 'manifest.json')), await digest(path.join(secondary, 'manifest.json')));
  console.log('Local checkpoint objects and second-filesystem readback verified.');
}

capture().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
