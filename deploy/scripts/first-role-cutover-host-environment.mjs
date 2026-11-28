import { createHash } from 'node:crypto';
import { closeSync, constants, fchmodSync, fchownSync, fstatSync, fsyncSync, lstatSync, mkdtempSync, openSync,
  readFileSync, readlinkSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const limit = 1024 * 1024;
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const digest = value => createHash('sha256').update(value).digest('hex');
const check = condition => {
  if (!condition) throw new Error('FIRST_ROLE_CUTOVER_HOST_ENVIRONMENT_UNPROVEN');
};

function privateDirectory(directory) {
  const st = lstatSync(directory);
  check(path.isAbsolute(directory) && realpathSync(directory) === directory && st.isDirectory()
    && st.uid === process.getuid() && (st.mode & 0o022) === 0);
}

export function readFirstRolePrivateFile(file) {
  privateDirectory(path.dirname(file));
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd, { bigint: true });
    check(before.isFile() && before.nlink === 1n && before.uid === BigInt(process.getuid())
      && (before.mode & 0o077n) === 0n && before.size > 0n && before.size <= BigInt(limit));
    const bytes = readFileSync(fd);
    const pin = st => [st.dev, st.ino, st.mode, st.uid, st.gid, st.nlink, st.size, st.ctimeNs, st.mtimeNs];
    check(BigInt(bytes.length) === before.size && isDeepStrictEqual(pin(before), pin(fstatSync(fd, { bigint: true })))
      && isDeepStrictEqual(pin(before), pin(lstatSync(file, { bigint: true }))));
    return { bytes, mode: Number(before.mode & 0o777n), gid: Number(before.gid) };
  } finally { closeSync(fd); }
}

function syncDirectory(directory) {
  const fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

export function assertFirstRoleHostLock(root) {
  const lock = path.join(root, '.deploy-state/deployment.lock');
  privateDirectory(path.dirname(lock));
  const fd = fstatSync(9, { bigint: true });
  const st = lstatSync(lock, { bigint: true });
  const expected = new RegExp(`^lock:\\s+\\d+:\\s+FLOCK\\s+ADVISORY\\s+WRITE\\s+\\S+\\s+[a-f0-9]+:[a-f0-9]+:${fd.ino}\\s+0\\s+EOF\\s*$`, 'm');
  check(readlinkSync('/proc/self/fd/9') === lock && st.isFile() && st.ino === fd.ino && st.dev === fd.dev
    && st.uid === BigInt(process.getuid()) && st.nlink === 1n && (st.mode & 0o022n) === 0n
    && expected.test(readFileSync('/proc/self/fdinfo/9', 'utf8')));
}

export function withFirstRoleRuntimeEnvironment(original, credential) {
  check(Buffer.isBuffer(original) && original.length > 0 && original.length <= limit - 160
    && Buffer.isBuffer(credential) && credential.length === 43);
  const password = credential.toString('ascii');
  check(/^[a-zA-Z0-9_-]{43}$/.test(password)
    && Buffer.from(Buffer.from(password, 'base64url').toString('base64url'), 'ascii').equals(credential)
    && !/(?:^|\n)[\t ]*(?:export[\t ]+)?BACKEND_DATABASE_(?:USER|PASSWORD)[\t ]*(?:[=:]|\r?$)/m.test(original.toString('utf8')));
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const prefix = original[original.length - 1] === 10 ? '' : eol;
  return Buffer.concat([original, Buffer.from(`${prefix}BACKEND_DATABASE_USER=sabalan_application_runtime${eol}BACKEND_DATABASE_PASSWORD=`),
    credential, Buffer.from(eol)]);
}

function hasOpenIntent(directory) {
  try { lstatSync(path.join(directory, 'first-role-cutover-open-intent.json')); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function replacePrivate(file, bytes, metadata, beforeRename) {
  const parent = path.dirname(file);
  const staging = mkdtempSync(path.join(parent, '.first-role-environment-'));
  const staged = path.join(staging, 'environment');
  try {
    const fd = openSync(staged, 'wx', 0o600);
    try {
      fchownSync(fd, -1, metadata.gid);
      fchmodSync(fd, metadata.mode);
      writeFileSync(fd, bytes);
      fsyncSync(fd);
    } finally { closeSync(fd); }
    if (beforeRename) await beforeRename();
    renameSync(staged, file);
    syncDirectory(parent);
  } finally {
    try { unlinkSync(staged); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    rmdirSync(staging);
  }
}

/** The lifecycle caller supplies an authenticated checkpoint/lease readback for each filesystem transition. */
export async function switchFirstRoleEnvironment(input) {
  const { root, reportDir, environment, expected, action, proveBoundary } = input;
  check(['apply', 'restore'].includes(action) && path.isAbsolute(environment)
    && /^[A-Za-z0-9_-]{1,160}$/.test(expected?.deploymentId ?? '')
    && [expected.beforeSha256, expected.afterSha256].every(sha) && expected.beforeSha256 !== expected.afterSha256);
  assertFirstRoleHostLock(root);
  check(!hasOpenIntent(reportDir));
  const session = JSON.parse(readFirstRolePrivateFile(path.join(reportDir, 'active-deployment-session.json')).bytes);
  const requiredPhase = action === 'apply' ? 'MUTATION_STARTED' : 'ROLLBACK_STARTED';
  check(session.deploymentId === expected.deploymentId && session.purpose === 'first-database-role-cutover'
    && session.phase === requiredPhase && session.bootstrap === false);
  const current = readFirstRolePrivateFile(environment);
  const pin = digest(current.bytes);
  check([expected.beforeSha256, expected.afterSha256].includes(pin));
  const original = path.join(reportDir, `first-role-environment-${expected.deploymentId}.previous`);
  let backup;
  try { backup = readFirstRolePrivateFile(original); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  check((!backup && pin === expected.beforeSha256)
    || (backup && digest(backup.bytes) === expected.beforeSha256 && backup.mode === current.mode && backup.gid === current.gid));

  const next = action === 'apply' ? input.afterBytes : backup?.bytes ?? current.bytes;
  const nextHash = action === 'apply' ? expected.afterSha256 : expected.beforeSha256;
  check(Buffer.isBuffer(next) && next.length <= limit && digest(next) === nextHash
    && await proveBoundary({ deploymentId: expected.deploymentId, phase: requiredPhase }) === true);
  assertFirstRoleHostLock(root);
  const stillCurrent = () => {
    const observed = readFirstRolePrivateFile(environment);
    check(!hasOpenIntent(reportDir) && digest(observed.bytes) === pin
      && observed.mode === current.mode && observed.gid === current.gid);
  };
  stillCurrent();
  if (pin === nextHash) return { environmentSha256: nextHash, alreadyApplied: true };
  if (!backup) {
    await replacePrivate(original, current.bytes, current);
  }
  await replacePrivate(environment, next, current, async () => {
    check(await proveBoundary({ deploymentId: expected.deploymentId, phase: requiredPhase }) === true);
    assertFirstRoleHostLock(root);
    stillCurrent();
  });
  check(digest(readFirstRolePrivateFile(environment).bytes) === nextHash);
  return { environmentSha256: nextHash, alreadyApplied: false };
}
