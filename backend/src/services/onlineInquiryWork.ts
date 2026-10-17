import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadOnlineRuntimeScope } from './onlineRuntimeScope';
import { OnlineCaptureAdmission } from './onlineCaptureAdmission';
import { KernelWriteAdmission } from './kernelWriteAdmission';
import { RuntimeBoundaryJournal, runtimeNativePostgresApplicationName } from './runtimeBoundaryJournal';
import { RuntimeTaskAdmission } from './runtimeTaskAdmission';
import { RuntimeWorkContext } from './runtimeWorkContext';

const failure = () => new Error('INQUIRY_NATIVE_OWNERSHIP_UNPROVEN');
const hash = (raw: Buffer) => createHash('sha256').update(raw).digest('hex');
const identity = (value: fs.BigIntStats) => [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs,
  value.uid, value.mode, value.nlink].map(String).join(':');

function stableClaim(file: string) {
  if (fs.realpathSync(file) !== file) throw failure();
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.uid !== BigInt(process.getuid!())
      || (before.mode & 0o077n) !== 0n || before.size < 1n || before.size > 16384n) throw failure();
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, null);
      if (count <= 0) throw failure();
      offset += count;
    }
    if (identity(before) !== identity(fs.fstatSync(descriptor, { bigint: true }))
      || identity(before) !== identity(fs.lstatSync(file, { bigint: true }))) throw failure();
    return { bytes, identity: identity(before), claim: JSON.parse(bytes.toString('utf8')) };
  } finally { fs.closeSync(descriptor); }
}

function inheritedLock(descriptor: number, file: string, device: string, inode: string, access: 'READ' | 'WRITE') {
  if (fs.realpathSync(file) !== file) throw failure();
  const inherited = fs.fstatSync(descriptor, { bigint: true }), named = fs.lstatSync(file, { bigint: true });
  if (!inherited.isFile() || inherited.nlink !== 1n || inherited.uid !== BigInt(process.getuid!())
    || inherited.size !== 0n || (inherited.mode & 0o022n) !== 0n
    || inherited.dev !== named.dev || inherited.ino !== named.ino
    || inherited.dev.toString() !== device || inherited.ino.toString() !== inode
    || !fs.readFileSync(`/proc/self/fdinfo/${descriptor}`, 'utf8').split('\n').some(line => new RegExp(
      `^lock:\\s+\\d+:\\s+FLOCK\\s+ADVISORY\\s+${access}\\s+\\S+\\s+[0-9a-f]+:[0-9a-f]+:${inode}\\s+0\\s+EOF\\s*$`).test(line))) throw failure();
}

function actualAncestor(guardian: { pid: number; bootId: string; pidNamespace: string; startTicks: string }) {
  if (!guardian || !Number.isSafeInteger(guardian.pid) || guardian.pid < 1
    || !/^[1-9][0-9]*$/.test(guardian.startTicks)
    || guardian.bootId !== fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()
    || guardian.pidNamespace !== fs.readlinkSync('/proc/self/ns/pid')) throw failure();
  let pid = process.pid;
  for (let depth = 0; depth < 128 && pid >= 1; depth++) {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
    if (pid === guardian.pid) {
      if (fields[0] === 'Z' || fields[19] !== guardian.startTicks) throw failure();
      return;
    }
    const parent = Number(fields[1]);
    if (!Number.isSafeInteger(parent) || parent < 1 || parent === pid) throw failure();
    pid = parent;
  }
  throw failure();
}

let constructed = false;

/** Private SQLite completion owner. It grants no public serving, migration or
 * recovery authority. Bundle these pure modules in the Inquiry image; never
 * import the backend Prisma pool or give Inquiry PostgreSQL credentials. */
export async function createScopedInquiryWork(configuration: Readonly<{ registrySha256: string; generation: number }>) {
  if (constructed) throw failure();
  constructed = true; // Failed construction cannot be retried with another scope.
  if (!configuration || Object.keys(configuration).sort().join(',') !== 'generation,registrySha256'
    || !/^[a-f0-9]{64}$/.test(configuration.registrySha256)
    || !Number.isSafeInteger(configuration.generation) || configuration.generation < 1) throw failure();
  const input = loadOnlineRuntimeScope();
  if (!input || input.scope.format !== 'sabalan-online-runtime-scope/v2' || input.scope.purpose !== 'http'
    || input.scope.role !== 'serving' || input.scope.worker !== null
    || configuration.registrySha256 !== input.scope.manifestSha256) throw failure();
  const file = path.join(input.scope.nativeDirectory, 'deployment-runtime-native.json');
  let pinned: string | undefined;
  const assertOwner = () => {
    if (loadOnlineRuntimeScope() !== input || process.env.INQUIRY_NATIVE_AUTHORITY_FILE !== file
      || !/^[a-f0-9]{64}$/.test(process.env.INQUIRY_NATIVE_CLAIM_SHA256 || '')
      || Object.keys(process.env).some(key => key.startsWith('PG') || key.startsWith('BACKEND_NATIVE_'))
      || process.env.BACKEND_CONTROL_LOCK_FD !== '9' || process.env.BACKEND_ONLINE_INTERLOCK_FD !== '11'
      || process.env.BACKEND_CONTROL_LOCK_FILE !== path.join(input.scope.nativeDirectory, 'deployment-runtime-control.lock')) throw failure();
    const value = stableClaim(file), claim = value.claim;
    if ((pinned !== undefined && pinned !== value.identity) || hash(value.bytes) !== process.env.INQUIRY_NATIVE_CLAIM_SHA256
      || claim.format !== 'sabalan-inquiry-native/v2' || claim.phase !== 'ACTIVE'
      || JSON.stringify(claim.onlineScope) !== JSON.stringify(input)) throw failure();
    actualAncestor(claim.guardian);
    inheritedLock(9, process.env.BACKEND_CONTROL_LOCK_FILE!, claim.lock.device, claim.lock.inode, 'WRITE');
    inheritedLock(11, input.scope.interlock.file, input.scope.interlock.device, input.scope.interlock.inode, 'READ');
    const database = claim.sqlite;
    if (!database || !/^[a-f0-9]{64}$/.test(database.databaseUrlSha256)
      || !process.env.DATABASE_URL || hash(Buffer.from(process.env.DATABASE_URL, 'utf8')) !== database.databaseUrlSha256
      || !process.env.DATABASE_URL.startsWith('file:' + database.file + '?') || !path.isAbsolute(database.file)
      || fs.realpathSync(database.file) !== database.file || database.ownerUid !== process.getuid!()) throw failure();
    const current = fs.lstatSync(database.file, { bigint: true });
    const parent = fs.lstatSync(path.dirname(database.file), { bigint: true });
    if (!current.isFile() || current.nlink !== 1n || current.uid !== BigInt(database.ownerUid)
      || (current.mode & 0o022n) !== 0n || current.dev.toString() !== database.device || current.ino.toString() !== database.inode
      || !parent.isDirectory() || parent.uid !== BigInt(database.ownerUid) || (parent.mode & 0o022n) !== 0n) throw failure();
    pinned = value.identity;
  };
  assertOwner();
  const capture = new OnlineCaptureAdmission(input);
  const gate = { device: input.scope.gate.device, inode: input.scope.gate.inode, ownerUid: input.scope.gate.ownerUid };
  const journal = new RuntimeBoundaryJournal(input.scope.boundaryDirectory, {
    runtimeId: input.scope.runtimeId, image: input.scope.image, registrySha256: configuration.registrySha256,
    generation: configuration.generation, gate,
    // Existing journal field is a full-ID audit namespace only; this SQLite
    // runtime neither opens PostgreSQL nor claims PostgreSQL SQL completion.
    postgresApplicationName: runtimeNativePostgresApplicationName(input.scope.runtimeId),
  }, { scopeSha256: input.sha256, claimSha256: process.env.INQUIRY_NATIVE_CLAIM_SHA256! });
  const kernel = new KernelWriteAdmission(input.scope.gate.file, gate, assertOwner);
  await journal.initialize(); assertOwner();
  const tasks = new RuntimeTaskAdmission(kernel, journal, assertOwner, () => capture.isOpen());
  return new RuntimeWorkContext(tasks, assertOwner);
}
