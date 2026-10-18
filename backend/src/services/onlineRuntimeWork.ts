import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { runtimeHttpRequests } from './httpRequestLifecycle';
import { loadOnlineRuntimeScope } from './onlineRuntimeScope';
import { applicationRuntimeDatabaseUrl } from './runtimeNativeAuthority';
import { KernelWriteAdmission } from './kernelWriteAdmission';
import { RuntimeBoundaryJournal, runtimeNativePostgresApplicationName } from './runtimeBoundaryJournal';
import { RuntimeTaskAdmission } from './runtimeTaskAdmission';
import { RuntimeWorkBoundary } from './runtimeWorkBoundary';
import { OnlineCaptureAdmission } from './onlineCaptureAdmission';
import { bindScopedRecoveryBackgroundOwner } from './recoveryRuntime';

type WorkInput = Readonly<{ registrySha256: string; generation: number; canJoin: () => boolean }>;
const failure = (code: string) => Object.assign(new Error(code), { code });
const identity = (value: fs.BigIntStats) => [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs,
  value.uid, value.mode, value.nlink].map(String).join(':');

/** Bind actual native ownership to one preprovisioned work journal and the
 * SAME lifecycle already captured by routes/uploads/audit callbacks. This is
 * private integration, not registry/manifest compatibility or release approval.
 * It starts no listener, worker, migration, recovery or cleanup operation. */
export async function createScopedRuntimeWork(configuration: WorkInput): Promise<RuntimeWorkBoundary> {
  if (!configuration || Object.keys(configuration).sort().join(',') !== 'canJoin,generation,registrySha256'
    || !/^[a-f0-9]{64}$/.test(configuration.registrySha256)
    || !Number.isSafeInteger(configuration.generation) || configuration.generation < 1
    || typeof configuration.canJoin !== 'function') {
    throw failure('ONLINE_RUNTIME_WORK_SCOPE_INVALID');
  }
  const { registrySha256, generation, canJoin: additionalCanJoin } = configuration;
  const input = loadOnlineRuntimeScope();
  if (!input || !['http', 'jobs'].includes(input.scope.purpose)) throw failure('ONLINE_RUNTIME_WORK_SCOPE_INVALID');
  if (registrySha256 !== input.scope.manifestSha256) throw failure('ONLINE_RUNTIME_WORK_REGISTRY_MISMATCH');
  const assertOwner = () => {
    if (loadOnlineRuntimeScope() !== input || !applicationRuntimeDatabaseUrl()) throw failure('ONLINE_RUNTIME_WORK_OWNER_UNPROVEN');
  };
  let workerIdentity: string | undefined;
  const assertWorker = () => {
    if (input.scope.purpose !== 'jobs' || input.scope.role !== 'control') throw failure('RUNTIME_WORKER_OWNERSHIP_REQUIRED');
    assertOwner(); // Proves actual guardian ancestry and inherited EX FD12.
    const file = path.join(input.scope.coordinationDirectory, 'deployment-online-worker-native.json');
    if (fs.realpathSync(file) !== file) throw failure('RUNTIME_WORKER_OWNERSHIP_REQUIRED');
    const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const before = fs.fstatSync(descriptor, { bigint: true });
      if (!before.isFile() || before.nlink !== 1n || before.uid !== BigInt(process.getuid!())
        || (before.mode & 0o077n) !== 0n || before.size < 1n || before.size > 16384n) throw failure('RUNTIME_WORKER_OWNERSHIP_REQUIRED');
      const bytes = Buffer.alloc(Number(before.size));
      let offset = 0;
      while (offset < bytes.length) {
        const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, null);
        if (count <= 0) throw failure('RUNTIME_WORKER_OWNERSHIP_REQUIRED');
        offset += count;
      }
      if (identity(before) !== identity(fs.fstatSync(descriptor, { bigint: true }))
        || identity(before) !== identity(fs.lstatSync(file, { bigint: true }))
        || (workerIdentity !== undefined && workerIdentity !== identity(before))
        || createHash('sha256').update(bytes).digest('hex') !== process.env.BACKEND_NATIVE_CLAIM_SHA256) {
        throw failure('RUNTIME_WORKER_OWNERSHIP_REQUIRED');
      }
      workerIdentity = identity(before);
    } finally { fs.closeSync(descriptor); }
  };
  assertOwner();
  if (input.scope.purpose === 'jobs') assertWorker();
  const capture = input.scope.format === 'sabalan-online-runtime-scope/v2' ? new OnlineCaptureAdmission(input) : undefined;
  if (capture && input.scope.purpose === 'jobs' && !capture.isOpen()) throw failure('ONLINE_CAPTURE_ADMISSION_CLOSED');
  const canJoin = () => (!capture || capture.isOpen()) && additionalCanJoin();
  const gate = { device: input.scope.gate.device, inode: input.scope.gate.inode, ownerUid: input.scope.gate.ownerUid };
  const journal = new RuntimeBoundaryJournal(input.scope.boundaryDirectory, {
    runtimeId: input.scope.runtimeId, image: input.scope.image, registrySha256,
    generation, postgresApplicationName: runtimeNativePostgresApplicationName(input.scope.runtimeId), gate,
  }, { scopeSha256: input.sha256, claimSha256: process.env.BACKEND_NATIVE_CLAIM_SHA256! });
  const kernel = new KernelWriteAdmission(input.scope.gate.file, gate, assertOwner);
  await journal.initialize();
  assertOwner();
  const tasks = new RuntimeTaskAdmission(kernel, journal, assertOwner, canJoin);
  const assertHttp = () => {
    if (input.scope.purpose !== 'http') throw failure('RUNTIME_HTTP_OWNERSHIP_REQUIRED');
    assertOwner();
  };
  const boundary = new RuntimeWorkBoundary(tasks, runtimeHttpRequests, assertWorker, assertHttp, assertOwner);
  if (input.scope.purpose === 'jobs') bindScopedRecoveryBackgroundOwner(boundary);
  return boundary;
}
