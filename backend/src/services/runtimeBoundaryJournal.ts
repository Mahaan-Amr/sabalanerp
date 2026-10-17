import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { KernelGateIdentity } from './kernelWriteAdmission';

export type RuntimeBoundaryScope = {
  runtimeId: string; image: string; registrySha256: string; generation: number;
  postgresApplicationName: string; gate: KernelGateIdentity;
};
type Birth = { bootId: string; pidNamespace: string; pid: number; startTicks: string };
export type RuntimeNativeBinding = Readonly<{ scopeSha256: string; claimSha256: string }>;
type State = { format: 'sabalan-runtime-boundary/v1'; claimSha256: string; epoch: number;
  phase: 'ACTIVE' | 'QUIESCENT'; previousStateSha256: string | null; updatedAt: string };
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;
const fail = (code: string): never => { throw Object.assign(new Error(code), { code }); };
const exact = (value: any, keys: string[]) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const encode = (value: unknown) => Buffer.from(JSON.stringify(canonical(value)) + '\n');
const timestamp = (value: any) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export function runtimePostgresApplicationName(runtimeId: string) {
  if (!hashPattern.test(runtimeId)) fail('RUNTIME_BOUNDARY_SCOPE_INVALID');
  // PostgreSQL truncates application_name at 63 bytes. Freeze an exact unique
  // 192-bit namespace rather than relying on implicit truncation of a full ID.
  return `sabalan-${runtimeId.slice(0, 48)}`;
}

/** Native guardian namespace. Hash all 256 identity bits before encoding a
 * bounded PostgreSQL name; historical journal namespaces remain readable. */
export function runtimeNativePostgresApplicationName(runtimeId: string) {
  if (!hashPattern.test(runtimeId)) fail('RUNTIME_BOUNDARY_SCOPE_INVALID');
  return `sabalan-rt-${createHash('sha256').update(runtimeId, 'ascii').digest('hex').slice(0, 48)}`;
}

function validateScope(scope: RuntimeBoundaryScope) {
  if (!exact(scope, ['runtimeId', 'image', 'registrySha256', 'generation', 'postgresApplicationName', 'gate'])
    || !hashPattern.test(scope.runtimeId) || !/^sha256:[a-f0-9]{64}$/.test(scope.image)
    || !hashPattern.test(scope.registrySha256) || !Number.isSafeInteger(scope.generation) || scope.generation < 1
    || ![runtimePostgresApplicationName(scope.runtimeId), runtimeNativePostgresApplicationName(scope.runtimeId)].includes(scope.postgresApplicationName)
    || !exact(scope.gate, ['device', 'inode', 'ownerUid'])
    || !/^[1-9][0-9]{0,24}$/.test(scope.gate.device) || !/^[1-9][0-9]{0,24}$/.test(scope.gate.inode)
    || !Number.isSafeInteger(scope.gate.ownerUid) || scope.gate.ownerUid < 0) fail('RUNTIME_BOUNDARY_SCOPE_INVALID');
}

/** Bytes for an owned controller's exclusive preprovisioning. This function
 * neither creates authority nor claims a runtime. The controller must validate
 * release/lease/image/slot evidence before provisioning this private namespace. */
export function runtimeBoundaryProvisionBytes(scope: RuntimeBoundaryScope): Buffer {
  validateScope(scope);
  return encode({ format: 'sabalan-runtime-namespace/v1', scope });
}

function validBirth(birth: any): birth is Birth {
  return exact(birth, ['bootId', 'pidNamespace', 'pid', 'startTicks'])
    && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(birth.bootId)
    && /^pid:\[[0-9]+\]$/.test(birth.pidNamespace) && Number.isSafeInteger(birth.pid) && birth.pid > 0
    && /^[1-9][0-9]{0,24}$/.test(birth.startTicks);
}

async function currentBirth(): Promise<Birth> {
  const proc = await fs.readFile('/proc/self/stat', 'utf8');
  const fields = proc.slice(proc.lastIndexOf(')') + 2).trim().split(/\s+/);
  const value = { bootId: (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim(),
    pidNamespace: await fs.readlink('/proc/self/ns/pid'), pid: process.pid, startTicks: fields[19] };
  if (!validBirth(value)) fail('RUNTIME_BOUNDARY_BIRTH_UNPROVEN');
  return value;
}

/** Constant-space busy-epoch ownership, not business success or SQL drain.
 * A claim is exclusive and immutable. A restarted incarnation cannot claim or
 * settle the old namespace. ACTIVE persists before any task starts; QUIESCENT
 * persists only after every owned task and completion callback has finished.
 * A crashed process still requires exact PostgreSQL/descendant completion proof,
 * even if its last durable state was QUIESCENT. No expiry or reset exists here.
 */
export class RuntimeBoundaryJournal {
  private root?: { device: bigint; inode: bigint };
  private claimSha256?: string;
  private current?: { state: State; sha256: string };
  private failed = false;
  private busy = false;
  private readonly scope: RuntimeBoundaryScope;
  private readonly provision: Buffer;
  private readonly native?: RuntimeNativeBinding;

  constructor(private readonly directory: string, scope: RuntimeBoundaryScope, native?: RuntimeNativeBinding) {
    validateScope(scope);
    if (process.platform !== 'linux' || !path.isAbsolute(directory) || path.resolve(directory) !== directory
      || path.basename(directory) !== scope.runtimeId) fail('RUNTIME_BOUNDARY_NAMESPACE_INVALID');
    this.provision = runtimeBoundaryProvisionBytes(scope);
    this.scope = JSON.parse(JSON.stringify(scope));
    if (native !== undefined) {
      if (!exact(native, ['scopeSha256', 'claimSha256']) || typeof native.scopeSha256 !== 'string'
        || typeof native.claimSha256 !== 'string' || !hashPattern.test(native.scopeSha256)
        || !hashPattern.test(native.claimSha256)) fail('RUNTIME_BOUNDARY_NATIVE_BINDING_INVALID');
      this.native = Object.freeze({ ...native });
    }
  }

  private async assertRoot() {
    const value = await fs.lstat(this.directory, { bigint: true });
    if (!value.isDirectory() || value.uid !== BigInt(process.getuid!()) || (value.mode & 0o077n) !== 0n
      || await fs.realpath(this.directory) !== this.directory
      || (this.root && (value.dev !== this.root.device || value.ino !== this.root.inode))) fail('RUNTIME_BOUNDARY_ROOT_UNSAFE');
    this.root ??= { device: value.dev, inode: value.ino };
  }

  private async read(name: string) {
    await this.assertRoot();
    const file = path.join(this.directory, name);
    const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await handle.stat({ bigint: true });
      if (!before.isFile() || before.nlink !== 1n || before.size < 1n || before.size > 8192n
        || before.uid !== BigInt(process.getuid!()) || (before.mode & 0o077n) !== 0n) fail('RUNTIME_BOUNDARY_RECORD_UNSAFE');
      const bytes = await handle.readFile();
      const after = await handle.stat({ bigint: true }), named = await fs.lstat(file, { bigint: true });
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
        || named.dev !== before.dev || named.ino !== before.ino || after.nlink !== 1n) fail('RUNTIME_BOUNDARY_RECORD_CHANGED');
      let value: any;
      try { value = JSON.parse(bytes.toString('utf8')); } catch { fail('RUNTIME_BOUNDARY_RECORD_INVALID'); }
      if (!encode(value).equals(bytes)) fail('RUNTIME_BOUNDARY_RECORD_INVALID');
      await this.assertRoot();
      return { value, sha256: digest(bytes), bytes };
    } finally { await handle.close(); }
  }

  private async syncDirectory(directory = this.directory) {
    const handle = await fs.open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  }

  private async writeExclusive(name: string, bytes: Buffer) {
    await this.assertRoot();
    const handle = await fs.open(path.join(this.directory, name), 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await this.syncDirectory(); await this.assertRoot();
  }

  async initialize() {
    if (this.claimSha256 || this.failed) fail('RUNTIME_BOUNDARY_ALREADY_CLAIMED');
    try {
      await this.assertRoot();
      const entries = await fs.readdir(this.directory);
      if (entries.length !== 1 || entries[0] !== 'scope.json') fail('RUNTIME_BOUNDARY_ALREADY_CLAIMED');
      const scope = await this.read('scope.json');
      if (!scope.bytes.equals(this.provision)) fail('RUNTIME_BOUNDARY_SCOPE_CHANGED');
      // Persist namespace ancestry before claiming authority or acknowledging work.
      for (let directory = this.directory;; directory = path.dirname(directory)) {
        await this.syncDirectory(directory); if (directory === path.dirname(directory)) break;
      }
      const claim = encode({ format: this.native ? 'sabalan-runtime-claim/v2' : 'sabalan-runtime-claim/v1',
        scopeSha256: scope.sha256, birth: await currentBirth(), ...(this.native ? { native: this.native } : {}) });
      await this.writeExclusive('claim.json', claim); this.claimSha256 = digest(claim);
      await this.publish({ format: 'sabalan-runtime-boundary/v1', claimSha256: this.claimSha256,
        epoch: 0, phase: 'QUIESCENT', previousStateSha256: null, updatedAt: new Date().toISOString() });
    } catch (error) { this.failed = true; throw error; }
  }

  private async publish(state: State) {
    const bytes = encode(state), temporary = `.state-${randomUUID()}.tmp`;
    // Failed/torn temporary records remain visible to inspection. Never erase
    // uncertain publication evidence or recreate a missing/replaced namespace.
    await this.writeExclusive(temporary, bytes);
    await this.assertRoot();
    await fs.rename(path.join(this.directory, temporary), path.join(this.directory, 'state.json'));
    await this.syncDirectory(); await this.assertRoot();
    this.current = { state, sha256: digest(bytes) };
  }

  private async transition(phase: State['phase'], epoch?: number) {
    if (!this.claimSha256 || !this.current || this.failed || this.busy) fail('RUNTIME_BOUNDARY_NOT_OWNED');
    const current = this.current!;
    this.busy = true;
    try {
      const snapshot = await this.inspect();
      if (snapshot.stateSha256 !== current.sha256 || snapshot.claimSha256 !== this.claimSha256) fail('RUNTIME_BOUNDARY_STATE_CHANGED');
      const previous = current.state;
      if (phase === 'ACTIVE' ? previous.phase !== 'QUIESCENT' : previous.phase !== 'ACTIVE' || previous.epoch !== epoch) fail('RUNTIME_BOUNDARY_EPOCH_INVALID');
      const nextEpoch = phase === 'ACTIVE' ? previous.epoch + 1 : previous.epoch;
      if (!Number.isSafeInteger(nextEpoch)) fail('RUNTIME_BOUNDARY_EPOCH_INVALID');
      await this.publish({ ...previous, phase, epoch: nextEpoch, previousStateSha256: current.sha256, updatedAt: new Date().toISOString() });
      return nextEpoch;
    } catch (error) { this.failed = true; throw error; }
    finally { this.busy = false; }
  }

  activate() { return this.transition('ACTIVE'); }
  settle(epoch: number) { return this.transition('QUIESCENT', epoch); }
  gateIdentity(): KernelGateIdentity { return { ...this.scope.gate }; }

  /** Read-only inspection can observe a dead incarnation; it cannot complete it. */
  async inspect() {
    await this.assertRoot();
    const entries = (await fs.readdir(this.directory)).sort();
    if (JSON.stringify(entries) !== JSON.stringify(['claim.json', 'scope.json', 'state.json'])) fail('RUNTIME_BOUNDARY_INVENTORY_UNPROVEN');
    const scope = await this.read('scope.json'), claim = await this.read('claim.json'), state = await this.read('state.json');
    if (!scope.bytes.equals(this.provision)) fail('RUNTIME_BOUNDARY_SCOPE_CHANGED');
    const native = claim.value.native as RuntimeNativeBinding | undefined;
    const versionTwo = claim.value.format === 'sabalan-runtime-claim/v2';
    if (!exact(claim.value, ['format', 'scopeSha256', 'birth', ...(versionTwo ? ['native'] : [])])
      || (!versionTwo && claim.value.format !== 'sabalan-runtime-claim/v1')
      || (versionTwo && (!exact(native, ['scopeSha256', 'claimSha256']) || typeof native!.scopeSha256 !== 'string'
        || typeof native!.claimSha256 !== 'string' || !hashPattern.test(native!.scopeSha256)
        || !hashPattern.test(native!.claimSha256)))
      || (this.native && (!versionTwo || !encode(this.native).equals(encode(native))))
      || claim.value.scopeSha256 !== scope.sha256 || !validBirth(claim.value.birth)) fail('RUNTIME_BOUNDARY_CLAIM_INVALID');
    const value = state.value;
    if (!exact(value, ['format', 'claimSha256', 'epoch', 'phase', 'previousStateSha256', 'updatedAt'])
      || value.format !== 'sabalan-runtime-boundary/v1' || value.claimSha256 !== claim.sha256
      || !Number.isSafeInteger(value.epoch) || value.epoch < 0 || !['ACTIVE', 'QUIESCENT'].includes(value.phase)
      || (value.epoch === 0 ? value.phase !== 'QUIESCENT' || value.previousStateSha256 !== null : !hashPattern.test(value.previousStateSha256))
      || !timestamp(value.updatedAt)) fail('RUNTIME_BOUNDARY_STATE_INVALID');
    return { scope: JSON.parse(JSON.stringify(this.scope)) as RuntimeBoundaryScope, birth: claim.value.birth as Birth,
      epoch: value.epoch as number, phase: value.phase as State['phase'], scopeSha256: scope.sha256,
      claimSha256: claim.sha256, stateSha256: state.sha256,
      ...(native ? { nativeBinding: { ...native } } : {}),
      namespaceIdentity: { device: this.root!.device.toString(), inode: this.root!.inode.toString() } };
  }
}
