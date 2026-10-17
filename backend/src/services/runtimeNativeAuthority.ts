import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadOnlineRuntimeScope } from './onlineRuntimeScope';

const failure = () => new Error('RUNTIME_NATIVE_AUTHORITY_UNPROVEN');
const authorityKeys = ['BACKEND_NATIVE_POSTGRES_APPLICATION_NAME', 'BACKEND_NATIVE_AUTHORITY_FILE', 'BACKEND_NATIVE_CLAIM_SHA256'];

/** Called while the existing control lock is held. Missing records retain the
 * protected legacy installation path; an existing ACTIVE or unreadable record
 * never permits a migration/restore command to bypass runtime completion. */
export function assertNativeRuntimeControlBoundary(environment: NodeJS.ProcessEnv = process.env) {
  // A protected command cannot treat an online namespace's QUIESCENT file as
  // fleet retirement. The host controller must prove SQL closure, revoke the
  // immutable grant and retire every slot before clearing these inventories.
  const coordination = environment.RECOVERY_COORDINATION_DIR || '/app/recovery-coordination';
  try {
    try {
      fs.lstatSync(path.join(coordination, 'deployment-online-worker-native.json'));
      throw failure();
    } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
    const online = path.join(coordination, 'online');
    const value = fs.lstatSync(online, { bigint: true });
    if (!value.isDirectory() || fs.realpathSync(online) !== online || value.uid !== BigInt(process.getuid!())
      || (value.mode & 0o022n) !== 0n || fs.readdirSync(online).some(name => !['native', 'work'].includes(name))) throw failure();
    for (const name of ['native', 'work']) {
      const directory = path.join(online, name);
      try {
        const entry = fs.lstatSync(directory, { bigint: true });
        if (!entry.isDirectory() || fs.realpathSync(directory) !== directory || entry.uid !== BigInt(process.getuid!())
          || (entry.mode & 0o022n) !== 0n || fs.readdirSync(directory).length !== 0) throw failure();
      } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
    }
  } catch (error: any) { if (error?.code !== 'ENOENT') throw failure(); }
  if (authorityKeys.some(key => environment[key] !== undefined)) {
    applicationRuntimeDatabaseUrl(environment);
    return;
  }
  const directory = environment.RECOVERY_COORDINATION_DIR || '/app/recovery-coordination';
  const file = path.join(directory, 'deployment-runtime-native.json');
  let fd: number;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch (error: any) { if (error?.code === 'ENOENT') return; throw failure(); }
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.uid !== BigInt(process.getuid!())
      || (before.mode & 0o077n) !== 0n || before.size < 1n || before.size > 16384n || fs.realpathSync(file) !== file) throw failure();
    const bytes = fs.readFileSync(fd), state = JSON.parse(bytes.toString('utf8'));
    const after = fs.fstatSync(fd, { bigint: true }), named = fs.lstatSync(file, { bigint: true });
    if (bytes.length > 16384 || before.dev !== named.dev || before.ino !== named.ino
      || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
      || state.format !== 'sabalan-runtime-native/v1' || state.phase !== 'QUIESCENT'
      || state.nativeReaped !== true || state.databaseQuiet !== true
      || !/^[a-f0-9]{48}$/.test(state.instanceId) || state.namespace !== `sabalan-rt-${state.instanceId}`
      || !/^[1-9][0-9]*$/.test(state.clusterIdentifier)) throw failure();
    if (!Number.isSafeInteger(state.guardian.pid) || state.guardian.pid < 1
      || !/^[1-9][0-9]*$/.test(state.guardian.startTicks)) throw failure();
    if (state.guardian.bootId === fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()
      && state.guardian.pidNamespace === fs.readlinkSync('/proc/self/ns/pid')) {
      let stat: string | undefined;
      try { stat = fs.readFileSync(`/proc/${state.guardian.pid}/stat`, 'utf8'); }
      catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
      if (stat) {
        const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
        if (fields[19] === state.guardian.startTicks && fields[0] !== 'Z') throw failure();
      }
    }
  } catch { throw failure(); }
  finally { fs.closeSync(fd); }
}

/** Bind the sole application pool before constructing Prisma. The native owner
 * has already published ACTIVE and retains FD9 until native descendants AND
 * tagged SQL finish. This validates that owner, not a serving-role permission.
 * No new serving/control role, migration or online admission is enabled here. */
export function applicationRuntimeDatabaseUrl(environment: NodeJS.ProcessEnv = process.env): string | undefined {
  const configured = authorityKeys.some(key => environment[key] !== undefined);
  const online = loadOnlineRuntimeScope(environment);
  const role = environment.BACKEND_RUNTIME_ROLE || 'standalone';
  // Short-lived control commands keep their existing protected FD9/checkpoint
  // admission. They cannot start the application listener (runtimeStartup
  // rejects that role). Their read-only preparation also runs while serving.
  if (!online && !configured && (environment.NODE_ENV !== 'production' || ['candidate', 'control'].includes(role))) return environment.DATABASE_URL;
  try {
    if (process.platform !== 'linux' || !(online ? ['serving', 'control'] : ['standalone', 'control']).includes(role)
      || authorityKeys.some(key => !environment[key]) || environment.BACKEND_CONTROL_LOCK_FD !== '9') throw failure();
    const directory = online?.scope.nativeDirectory || environment.RECOVERY_COORDINATION_DIR || '/app/recovery-coordination';
    const file = path.join(directory, 'deployment-runtime-native.json');
    if (!path.isAbsolute(directory) || environment.BACKEND_NATIVE_AUTHORITY_FILE !== file
      || fs.realpathSync(directory) !== directory || fs.realpathSync(file) !== file) throw failure();
    const parent = fs.lstatSync(directory, { bigint: true });
    if (!parent.isDirectory() || parent.uid !== BigInt(process.getuid!()) || (parent.mode & 0o022n) !== 0n) throw failure();
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    let bytes: Buffer;
    try {
      const before = fs.fstatSync(fd, { bigint: true });
      if (!before.isFile() || before.uid !== BigInt(process.getuid!()) || before.nlink !== 1n
        || (before.mode & 0o077n) !== 0n || before.size < 1n || before.size > 16384n) throw failure();
      bytes = fs.readFileSync(fd);
      const after = fs.fstatSync(fd, { bigint: true }), named = fs.lstatSync(file, { bigint: true });
      if (bytes.length > 16384 || before.dev !== named.dev || before.ino !== named.ino
        || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw failure();
    } finally { fs.closeSync(fd); }
    if (createHash('sha256').update(bytes).digest('hex') !== environment.BACKEND_NATIVE_CLAIM_SHA256) throw failure();
    const claim = JSON.parse(bytes.toString('utf8'));
    if (claim.format !== 'sabalan-runtime-native/v1' || claim.phase !== 'ACTIVE' || claim.role !== role
      || !/^[a-f0-9]{48}$/.test(claim.instanceId) || claim.namespace !== `sabalan-rt-${claim.instanceId}`
      || claim.namespace !== environment.BACKEND_NATIVE_POSTGRES_APPLICATION_NAME
      || claim.guardian.bootId !== fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()
      || claim.guardian.pidNamespace !== fs.readlinkSync('/proc/self/ns/pid')
      || !Number.isSafeInteger(claim.guardian.pid) || claim.guardian.pid < 1) throw failure();
    const lock = path.join(directory, 'deployment-runtime-control.lock');
    if (environment.BACKEND_CONTROL_LOCK_FILE !== lock || fs.realpathSync(lock) !== lock) throw failure();
    const inherited = fs.fstatSync(9, { bigint: true }), named = fs.lstatSync(lock, { bigint: true });
    if (!inherited.isFile() || inherited.nlink !== 1n || inherited.uid !== BigInt(process.getuid!())
      || (inherited.mode & 0o022n) !== 0n || inherited.dev !== named.dev || inherited.ino !== named.ino
      || claim.lock.device !== inherited.dev.toString() || claim.lock.inode !== inherited.ino.toString()
      || !fs.readFileSync('/proc/self/fdinfo/9', 'utf8').split('\n').some(line => new RegExp(
        `^lock:\\s+\\d+:\\s+FLOCK\\s+ADVISORY\\s+WRITE\\s+\\S+\\s+[0-9a-f]+:[0-9a-f]+:${inherited.ino}\\s+0\\s+EOF\\s*$`).test(line))) throw failure();
    if (online) {
      if (JSON.stringify(claim.onlineScope) !== JSON.stringify(online)
        || claim.instanceId !== createHash('sha256').update(online.scope.runtimeId, 'ascii').digest('hex').slice(0, 48)
        || claim.clusterIdentifier !== online.scope.database.systemIdentifier
        || claim.initialDatabase.name !== online.scope.database.name
        || environment.BACKEND_ONLINE_INTERLOCK_FD !== '11') throw failure();
      if (online.scope.purpose === 'capture') {
        const expected = online.scope.gate;
        const actual = fs.fstatSync(10, { bigint: true });
        const named = fs.lstatSync(expected.file, { bigint: true });
        const fact = claim.captureGate;
        if (environment.BACKEND_CAPTURE_GATE_FD !== '10' || environment.BACKEND_CAPTURE_GATE_FILE !== expected.file
          || environment.BACKEND_CAPTURE_GATE_DEVICE !== expected.device || environment.BACKEND_CAPTURE_GATE_INODE !== expected.inode
          || !actual.isFile() || actual.nlink !== 1n || actual.size !== 0n || actual.uid !== BigInt(expected.ownerUid)
          || (actual.mode & 0o022n) !== 0n || actual.dev !== named.dev || actual.ino !== named.ino
          || actual.dev.toString() !== expected.device || actual.ino.toString() !== expected.inode
          || !fact || fact.descriptor !== 10 || fact.file !== expected.file
          || fact.device !== expected.device || fact.inode !== expected.inode
          || !fs.readFileSync('/proc/self/fdinfo/10', 'utf8').split('\n').some(line => new RegExp(
            `^lock:\\s+\\d+:\\s+FLOCK\\s+ADVISORY\\s+WRITE\\s+\\S+\\s+[0-9a-f]+:[0-9a-f]+:${actual.ino}\\s+0\\s+EOF\\s*$`).test(line))) throw failure();
      } else if (claim.captureGate !== undefined || environment.BACKEND_CAPTURE_GATE_FD !== undefined) throw failure();
      for (const [name, descriptor, access] of [['interlock', 11, 'READ'], ['worker', 12, 'WRITE']] as const) {
        const expected = online.scope[name];
        if (!expected) {
          if (name !== 'worker' || environment.BACKEND_ONLINE_WORKER_FD !== undefined
            || claim.onlineLocks.worker !== undefined) throw failure();
          continue;
        }
        if (name === 'worker' && environment.BACKEND_ONLINE_WORKER_FD !== '12') throw failure();
        const actual = fs.fstatSync(descriptor, { bigint: true });
        const named = fs.lstatSync(expected.file, { bigint: true });
        const fact = claim.onlineLocks[name];
        if (!actual.isFile() || actual.nlink !== 1n || actual.size !== 0n || actual.uid !== BigInt(expected.ownerUid)
          || (actual.mode & 0o022n) !== 0n || actual.dev !== named.dev || actual.ino !== named.ino
          || actual.dev.toString() !== expected.device || actual.ino.toString() !== expected.inode
          || !fact || fact.descriptor !== descriptor || fact.file !== expected.file
          || fact.device !== expected.device || fact.inode !== expected.inode || fact.ownerUid !== expected.ownerUid
          || !fs.readFileSync(`/proc/self/fdinfo/${descriptor}`, 'utf8').split('\n').some(line => new RegExp(
            `^lock:\\s+\\d+:\\s+FLOCK\\s+ADVISORY\\s+${access}\\s+\\S+\\s+[0-9a-f]+:[0-9a-f]+:${actual.ino}\\s+0\\s+EOF\\s*$`).test(line))) throw failure();
      }
    } else if (claim.onlineScope !== undefined || claim.onlineLocks !== undefined) throw failure();
    // An arbitrary live process with a matching name is not our owner. Require
    // this incarnation's actual ancestor and immutable /proc birth tuple.
    let pid = process.pid, found = false;
    for (let depth = 0; depth < 32 && pid > 0; depth++) {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
      if (pid === claim.guardian.pid) { found = fields[19] === claim.guardian.startTicks; break; }
      pid = Number(fields[1]);
    }
    if (!found) throw failure();
    const url = new URL(environment.DATABASE_URL || '');
    if (!['postgresql:', 'postgres:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2
      || url.hash || url.searchParams.has('options')
      || url.hostname.replace(/^\[|\]$/g, '') !== claim.connection.host
      || Number(url.port || 5432) !== claim.connection.port || decodeURIComponent(url.username) !== claim.connection.user
      || decodeURIComponent(url.pathname.slice(1)) !== claim.initialDatabase.name) throw failure();
    for (const [key, maximum] of [['connection_limit', 128], ['pool_timeout', 120]] as const) {
      const values = url.searchParams.getAll(key);
      if (values.length !== 1 || !/^[1-9][0-9]*$/.test(values[0]) || Number(values[0]) > maximum) throw failure();
    }
    const names = url.searchParams.getAll('application_name');
    if (names.length !== 1 || names[0] !== claim.namespace) throw failure();
    return url.toString();
  } catch { throw failure(); }
}
