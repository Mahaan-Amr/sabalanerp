/** Protected same-image role cutover discovery. The observation grants no mutation or reopen authority. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { existingRelease } from '../../scripts/deployment-existing-release.mjs';
import { readPredecessorDatabaseTopology } from './predecessor-database-topology.mjs';
import { validateBinding, validateIdentity } from './preserved-clamav.mjs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const holdName = 'predecessor-role-cutover-active.json';
const services = ['backend', 'clamav', 'frontend', 'inquiry', 'nginx', 'postgres'];
const applicationServices = ['backend', 'frontend', 'inquiry'];
const imagePattern = /^sha256:[a-f0-9]{64}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function namedFile(file) {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

function readPrivate(file, before, limit) {
  if (!path.isAbsolute(file) || fs.realpathSync(file) !== file || !before.isFile() || before.nlink !== 1
    || before.size <= 0 || before.size > limit
    || (process.platform === 'linux' && (before.uid !== 0 || (before.mode & 0o077)))) throw new Error();
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  const pin = stat => [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs, stat.uid, stat.mode, stat.nlink].join(':');
  try {
    if (pin(fs.fstatSync(fd)) !== pin(before)) throw new Error();
    const bytes = fs.readFileSync(fd);
    if (bytes.length !== before.size || pin(fs.fstatSync(fd)) !== pin(before)
      || pin(fs.lstatSync(file)) !== pin(before)) throw new Error();
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

export function pendingRoleCutover(root, session) {
  if (namedFile(path.join(path.dirname(session), holdName)) || namedFile(path.join(root, '.deploy-state', holdName))
      || namedFile(path.join(path.dirname(session), 'predecessor-role-cutover-open-intent.json'))) return true;
  const stat = namedFile(session);
  if (!stat) return false;
  const current = JSON.parse(readPrivate(session, stat, 1024 * 1024));
  if (!current || Array.isArray(current) || typeof current !== 'object') throw new Error();
  return current.purpose === 'predecessor-role-cutover';
}

function verifyPlanShape(plan) {
  assert.deepEqual(Object.keys(plan).sort(), [
    'browserBuildId', 'composeSha256', 'containers', 'environmentSha256', 'format', 'images',
    'preservedClamav', 'sourceCommit', 'sourceHash',
  ]);
  assert.equal(plan.format, 'sabalan-predecessor-role-cutover-plan/v1');
  assert.match(plan.sourceCommit, /^[a-f0-9]{40}$/);
  assert.match(plan.browserBuildId, /^[A-Za-z0-9_-]{1,128}$/);
  for (const value of [plan.sourceHash, plan.environmentSha256, plan.composeSha256]) assert.match(value, digestPattern);
  assert.deepEqual(Object.keys(plan.images).sort(), services);
  assert.deepEqual(Object.keys(plan.containers).sort(), services);
  for (const service of services) {
    assert.match(plan.images[service], imagePattern);
    assert.match(plan.containers[service], digestPattern);
  }
  assert.equal(new Set(Object.values(plan.containers)).size, services.length);
  validateBinding(plan.preservedClamav);
}

export function verifySameImageCutoverPlan({ plan, rows, config, bytes }) {
  verifyPlanShape(plan);
  assert.equal(sha(bytes.environment), plan.environmentSha256);
  assert.equal(sha(bytes.compose), plan.composeSha256);
  assert.equal(config.name, 'sabalanerp');
  assert.equal(rows.length, services.length);
  const release = existingRelease(rows);
  assert.deepEqual(release.images, plan.images);
  assert.equal(release.identity.PERFORMANCE_RELEASE_COMMIT, plan.sourceCommit);
  assert.equal(release.identity.PERFORMANCE_RELEASE_SOURCE_HASH, plan.sourceHash);
  const observed = Object.fromEntries(rows.map(row => [row.Config.Labels['com.docker.compose.service'], row]));
  for (const service of services) {
    assert.equal(observed[service].Id, plan.containers[service]);
    assert.equal(observed[service].Config.Labels['com.docker.compose.project'], 'sabalanerp');
    assert.equal(config.services[service].image, plan.images[service]);
  }
  for (const service of applicationServices) {
    const labels = observed[service].Config.Labels;
    assert.equal(labels['io.sabalan.performance.source-commit'], plan.sourceCommit);
    assert.equal(labels['io.sabalan.performance.source-hash'], plan.sourceHash);
  }
  assert.equal(observed.frontend.Config.Labels['io.sabalan.browser.build-id'], plan.browserBuildId);
  validateIdentity(plan.preservedClamav.selection, observed.clamav);
  assert.equal(config.services.deployment.image, plan.images.backend);
  const runtime = observed.backend.Config.Env.filter(entry => entry.startsWith('DATABASE_URL='));
  assert.equal(runtime.length, 1);
  assert.deepEqual(observed.backend.Config.Env.filter(entry => entry.startsWith('APP_COMMIT=')), ['APP_COMMIT=' + plan.sourceCommit]);
  const installedUrl = runtime[0].slice('DATABASE_URL='.length);
  assert.equal(installedUrl, config.services.backend.environment.DATABASE_URL);
  assert.equal(readPredecessorDatabaseTopology(config, installedUrl).split, false);
  assert.equal(config.services.deployment.environment.DEPLOYMENT_CHECKPOINT_RUNTIME_USER,
    config.services.postgres.environment.POSTGRES_USER);
  return {
    format: 'sabalan-predecessor-role-cutover-preflight/v1',
    sourceCommit: plan.sourceCommit, sourceHash: plan.sourceHash, browserBuildId: plan.browserBuildId,
    images: plan.images, containers: plan.containers, preservedClamavSelectionSha256: plan.preservedClamav.selectionSha256,
    databaseTopology: 'legacy', canMutate: false, canOpenTraffic: false,
  };
}

function checkHostLock(root) {
  assert.equal(process.platform, 'linux');
  assert.equal(process.getuid(), 0);
  const file = path.join(root, '.deploy-state', 'deployment.lock');
  const named = fs.lstatSync(file, { bigint: true });
  const held = fs.fstatSync(9, { bigint: true });
  assert.equal(fs.realpathSync(file), file);
  assert.equal(fs.readlinkSync('/proc/self/fd/9'), file);
  assert.ok(named.isFile() && named.uid === 0n && named.nlink === 1n && !(named.mode & 0o022n));
  assert.equal(held.ino, named.ino);
  assert.equal(held.dev, named.dev);
  const lockPattern = new RegExp('^lock:\\s+\\d+:\\s+FLOCK\\s+ADVISORY\\s+WRITE\\s+\\S+\\s+[0-9a-f]+:[0-9a-f]+:'
    + held.ino + '\\s+0\\s+EOF\\s*$', 'm');
  assert.match(fs.readFileSync('/proc/self/fdinfo/9', 'utf8'), lockPattern);
}

function inspectSameImage(root, session, environment, composeFile, planFile, expectedPlanSha, includeScanner = false) {
  checkHostLock(root);
  assert.equal(pendingRoleCutover(root, session), false);
  assert.ok(!namedFile(session));
  const production = path.join(root, 'docker-compose.prod.yml');
  const rehearsal = path.join(root, 'docker-compose.rehearsal.yml');
  if (composeFile !== production) {
    assert.equal(composeFile, rehearsal);
    const supplied = process.env.DEPLOYMENT_QA_REHEARSAL_PLAN_FILE;
    const digest = process.env.DEPLOYMENT_QA_REHEARSAL_PLAN_SHA256;
    assert.ok(supplied && digestPattern.test(digest));
    const qaEnv = { ...process.env };
    if (qaEnv.DOCKER_HOST === 'unix:///var/run/docker.sock') delete qaEnv.DOCKER_HOST;
    if (qaEnv.COMPOSE_PROJECT_NAME === 'sabalanerp') delete qaEnv.COMPOSE_PROJECT_NAME;
    const selected = execFileSync(process.execPath, [
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'qa-rehearsal-target.mjs'),
      supplied, digest, root, environment,
    ], { cwd: root, env: qaEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000 }).trim();
    assert.equal(selected, 'docker-compose.rehearsal.yml');
  }
  assert.equal(fs.realpathSync(composeFile), composeFile);
  assert.match(expectedPlanSha, digestPattern);
  const rawPlan = readPrivate(planFile, fs.lstatSync(planFile), 64 * 1024);
  assert.equal(sha(rawPlan), expectedPlanSha);
  const plan = JSON.parse(rawPlan);
  verifyPlanShape(plan);
  const readEnv = () => readPrivate(environment, fs.lstatSync(environment), 8 * 1024 * 1024);
  const bytes = { environment: readEnv(), compose: fs.readFileSync(composeFile) };
  const env = { ...process.env };
  delete env.DOCKER_CONTEXT;
  delete env.COMPOSE_PROFILES;
  for (const [service, image] of Object.entries(plan.images)) env['DEPLOYMENT_' + service.toUpperCase() + '_IMAGE'] = image;
  const docker = args => execFileSync('docker', ['--host', 'unix:///var/run/docker.sock', ...args], {
    cwd: root, env, stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
  });
  const compose = ['compose', '--project-name', 'sabalanerp', '--env-file', environment, '--file', composeFile, '--profile', 'deployment'];
  const list = () => docker([...compose, 'ps', '--all', '--quiet', ...services]).toString().trim().split(/\s+/).sort();
  const expected = Object.values(plan.containers).sort();
  assert.deepEqual(list(), expected);
  const rows = JSON.parse(docker(['inspect', ...expected]));
  const config = JSON.parse(docker([...compose, 'config', '--format', 'json']));
  const receipt = verifySameImageCutoverPlan({ plan, rows, config, bytes });
  if (includeScanner) {
    const backend = rows.find(row => row.Id === plan.containers.backend);
    const volume = backend.Mounts.filter(mount => mount.Destination === '/app/storage/dispatch-documents');
    assert.ok(volume.length === 1 && volume[0].RW === true && volume[0].Type === 'volume'
      && volume[0].Name === 'sabalanerp_backend_storage_dispatch_documents');
  }
  checkHostLock(root);
  assert.equal(pendingRoleCutover(root, session), false);
  assert.ok(!namedFile(session));
  assert.deepEqual(list(), expected);
  assert.equal(sha(readEnv()), plan.environmentSha256);
  assert.equal(sha(fs.readFileSync(composeFile)), plan.composeSha256);
  const proof = { ...receipt, planSha256: expectedPlanSha };
  return includeScanner
    ? { proof, environmentSha256: plan.environmentSha256, scannerBindingHex: Buffer.from(JSON.stringify(plan.preservedClamav)).toString('hex') }
    : proof;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [mode, root, session, ...args] = process.argv.slice(2);
    if (!root || !session) throw new Error();
    if (['inspect', 'inspect-start'].includes(mode) && args.length === 4) {
      console.log(JSON.stringify(inspectSameImage(root, session, ...args, mode === 'inspect-start')));
    } else if (mode !== 'guard' || args.length !== 0) {
      throw new Error();
    } else if (pendingRoleCutover(root, session)) {
      console.error('PREDECESSOR_ROLE_CUTOVER_REQUIRES_OWNED_RECOVERY');
      process.exitCode = 1;
    }
  } catch {
    console.error('PREDECESSOR_ROLE_CUTOVER_DISCOVERY_UNPROVEN');
    process.exitCode = 1;
  }
}
