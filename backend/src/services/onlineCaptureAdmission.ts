import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { OnlineRuntimeScopeInput } from './onlineRuntimeScope';

const failure = () => new Error('ONLINE_CAPTURE_ADMISSION_UNPROVEN');
const hash = (raw: Buffer) => createHash('sha256').update(raw).digest('hex');
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const encode = (value: unknown) => Buffer.from(JSON.stringify(canonical(value)).replace(/[\u007f-\uffff]/g,
  character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0')) + '\n', 'ascii');
const exact = (value: any, keys: string[]) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
const same = (left: unknown, right: unknown) => encode(left).equals(encode(right));
const identity = (value: fs.BigIntStats) => [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs,
  value.uid, value.mode, value.nlink].map(String).join(':');
const hex = (value: any) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function read(file: string, mode = 0o400) {
  if (fs.realpathSync(file) !== file) throw failure();
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.uid !== BigInt(process.getuid!())
      || (before.mode & 0o777n) !== BigInt(mode) || before.size < 1n || before.size > 16384n) throw failure();
    const raw = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < raw.length) {
      const count = fs.readSync(descriptor, raw, offset, raw.length - offset, null);
      if (count <= 0) throw failure();
      offset += count;
    }
    if (identity(before) !== identity(fs.fstatSync(descriptor, { bigint: true }))
      || identity(before) !== identity(fs.lstatSync(file, { bigint: true }))) throw failure();
    const value = JSON.parse(raw.toString('ascii'));
    if (!encode(value).equals(raw)) throw failure();
    return { value, raw, identity: identity(before) };
  } finally { fs.closeSync(descriptor); }
}

/** Read-only durable scheduling input. An OPEN event alone grants neither
 * serving admission nor capture/fleet closure. The native capture guardian owns
 * publication; no timeout, missing file or caller callback can reopen it. */
export class OnlineCaptureAdmission {
  private root?: string;
  private observed?: { generation: number; sha256: string };
  private head?: ReturnType<typeof read>;
  private failed = false;
  private readonly scope: OnlineRuntimeScopeInput['scope'];

  constructor(input: OnlineRuntimeScopeInput) {
    if (process.platform !== 'linux' || input.scope.format !== 'sabalan-online-runtime-scope/v2'
      || !input.scope.admission) throw failure();
    this.scope = input.scope;
  }

  private assertRoot() {
    const directory = this.scope.admission!.directory;
    if (directory !== this.scope.coordinationDirectory + '/online/admission') throw failure();
    for (const file of [directory, path.join(directory, 'staging')]) {
      const value = fs.lstatSync(file, { bigint: true });
      if (!value.isDirectory() || fs.realpathSync(file) !== file || value.uid !== BigInt(process.getuid!())
        || (value.mode & 0o077n) !== 0n) throw failure();
      if (file === directory) {
        const current = value.dev + ':' + value.ino;
        if (this.root !== undefined && this.root !== current) throw failure();
        this.root = current;
      }
    }
    const { value, raw } = read(path.join(directory, 'scope.json'));
    if (hash(raw) !== this.scope.admission!.scopeSha256
      || !exact(value, ['format', 'gate', 'interlock', 'worker', 'database'])
      || value.format !== 'sabalan-online-admission-scope/v1'
      || !(['gate', 'interlock', 'database'] as const).every(key => same(value[key], this.scope[key]))
      || !exact(value.worker, ['file', 'device', 'inode', 'ownerUid'])
      || value.worker.file !== this.scope.coordinationDirectory + '/deployment-online-worker.lock'
      || (this.scope.worker !== null && !same(value.worker, this.scope.worker))) throw failure();
  }

  private assertClosedCapture(value: any) {
    const { value: native, raw: nativeRaw } = read(path.join(this.scope.coordinationDirectory,
      'online/native', value.capture.runtimeId, 'deployment-runtime-native.json'), 0o600);
    if (hash(nativeRaw) !== value.closureSha256 || native.phase !== 'QUIESCENT'
      || native.nativeReaped !== true || native.databaseQuiet !== true || native.nativeStatus !== 0
      || native.stoppedBySignal !== false || !same(native.guardian, value.capture.guardian)
      || native.onlineScope?.sha256 !== value.capture.scopeSha256
      || native.onlineScope?.scope?.runtimeId !== value.capture.runtimeId) throw failure();
    const captured = native.onlineScope.scope;
    if (captured.purpose !== 'capture' || captured.format !== 'sabalan-online-runtime-scope/v2'
      || !(['coordinationDirectory', 'admission', 'gate', 'interlock', 'database'] as const)
        .every(key => same(captured[key], this.scope[key]))
      || !same(captured.worker, read(path.join(this.scope.admission!.directory, 'scope.json')).value.worker)) throw failure();
  }

  isOpen(): boolean {
    try {
      if (this.failed) throw failure();
      this.assertRoot();
      const directory = this.scope.admission!.directory;
      const names = fs.readdirSync(directory).sort();
      const events = names.filter(name => /^[0-9]{8}\.json$/.test(name));
      if (events.length < 1 || events.length > 8192 || names.length !== events.length + 2
        || !names.includes('scope.json') || !names.includes('staging')) throw failure();
      if (events.some((file, generation) => file !== String(generation).padStart(8, '0') + '.json')) throw failure();
      let previous: any, previousRaw: Buffer | undefined, head = this.head;
      let first = 0;
      if (this.observed && head) {
        if (events.length <= this.observed.generation) throw failure();
        const current = read(path.join(directory, events[this.observed.generation]));
        if (current.identity !== head.identity || hash(current.raw) !== this.observed.sha256) throw failure();
        previous = head.value; previousRaw = head.raw; first = this.observed.generation + 1;
        if (previous.phase === 'OPEN' && previous.capture !== null) this.assertClosedCapture(previous);
      }
      // A fresh incarnation validates the entire history. Thereafter the
      // already verified bytes remain trusted in this reader: only a contiguous
      // extension of that exact immutable head can change its admission state.
      // Old-byte corruption cannot rewrite this in-memory history; a fresh
      // reader and the capture publisher still reject the corrupted source.
      // Avoid rereading thousands of historical files on every HTTP request.
      for (let generation = first; generation < events.length; generation++) {
        const current = read(path.join(directory, events[generation]));
        const { value, raw } = current;
        if (!exact(value, ['format', 'generation', 'phase', 'previousSha256', 'capture', 'closureSha256'])
          || value.format !== 'sabalan-online-capture-admission/v1' || value.generation !== generation
          || value.previousSha256 !== (previousRaw ? hash(previousRaw) : null)) throw failure();
        if (generation === 0) {
          if (value.phase !== 'OPEN' || value.capture !== null || value.closureSha256 !== null) throw failure();
        } else if (previous.phase === 'OPEN') {
          const capture = value.capture, guardian = capture?.guardian;
          if (value.phase !== 'CLOSING' || value.closureSha256 !== null
            || !exact(capture, ['runtimeId', 'scopeSha256', 'guardian']) || !hex(capture.runtimeId) || !hex(capture.scopeSha256)
            || !exact(guardian, ['pid', 'bootId', 'pidNamespace', 'startTicks'])
            || !Number.isSafeInteger(guardian.pid) || guardian.pid < 1
            || typeof guardian.bootId !== 'string' || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(guardian.bootId)
            || typeof guardian.pidNamespace !== 'string' || !/^pid:\[[0-9]+\]$/.test(guardian.pidNamespace)
            || typeof guardian.startTicks !== 'string' || !/^[1-9][0-9]{0,24}$/.test(guardian.startTicks)) throw failure();
        } else {
          if (previous.phase !== 'CLOSING' || value.phase !== 'OPEN' || !same(value.capture, previous.capture)
            || !hex(value.closureSha256)) throw failure();
          this.assertClosedCapture(value);
        }
        previous = value; previousRaw = raw; head = current;
      }
      this.assertRoot();
      this.observed = { generation: previous.generation, sha256: hash(previousRaw!) };
      this.head = head;
      return previous.phase === 'OPEN';
    } catch {
      this.failed = true;
      throw failure();
    }
  }
}
