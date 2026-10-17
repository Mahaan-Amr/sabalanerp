import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

type LockInput = Readonly<{ file: string; device: string; inode: string; ownerUid: number }>;
export type OnlineRuntimeScopeInput = Readonly<{
  scope: Readonly<{
    format: 'sabalan-online-runtime-scope/v1' | 'sabalan-online-runtime-scope/v2'; runtimeId: string; releaseId: string;
    manifestSha256: string; sourceCommit: string; image: string; nonce: string;
    purpose: 'http' | 'jobs' | 'capture'; role: 'serving' | 'control';
    coordinationDirectory: string; nativeDirectory: string; boundaryDirectory: string;
    gate: LockInput; interlock: LockInput; worker: LockInput | null;
    database: Readonly<{ systemIdentifier: string; name: string }>;
    admission?: Readonly<{ directory: string; scopeSha256: string }>;
  }>;
  file: string; sha256: string; device: string; inode: string; mountId: string;
  mountNamespace: string; mountInfoSha256: string; helperSha256: string;
}>;

const keys = ['BACKEND_ONLINE_SCOPE_FILE', 'BACKEND_ONLINE_SCOPE_SHA256'];
const failure = () => new Error('ONLINE_RUNTIME_SCOPE_UNPROVEN');
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const identity = (value: fs.BigIntStats) => [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs,
  value.mode, value.uid, value.nlink].map(String).join(':');
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const encoded = (value: unknown) => Buffer.from(JSON.stringify(canonical(value)).replace(/[\u007f-\uffff]/g,
  character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0')) + '\n', 'ascii');
function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

function readStable(file: string, maximum: number, privateGrant: boolean) {
  if (!path.isAbsolute(file) || path.resolve(file) !== file || fs.realpathSync(file) !== file) throw failure();
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.uid !== BigInt(process.getuid!())
      || before.size < 1n || before.size > BigInt(maximum)
      || (privateGrant && (before.mode & 0o777n) !== 0o400n)) throw failure();
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, null);
      if (count <= 0) throw failure();
      offset += count;
    }
    const mountId = fs.readFileSync(`/proc/self/fdinfo/${fd}`, 'utf8').match(/^mnt_id:\s+([0-9]+)\s*$/m)?.[1];
    if (!mountId || identity(before) !== identity(fs.fstatSync(fd, { bigint: true }))
      || identity(before) !== identity(fs.lstatSync(file, { bigint: true }))) throw failure();
    return { bytes, value: before, identity: identity(before), mountId };
  } finally { fs.closeSync(fd); }
}

function mountSnapshot() {
  const fd = fs.openSync('/proc/self/mountinfo', fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const buffer = Buffer.alloc(262145);
    let offset = 0;
    while (offset < buffer.length) {
      const count = fs.readSync(fd, buffer, offset, buffer.length - offset, null);
      if (!count) break;
      offset += count;
    }
    if (offset < 1 || offset > 262144) throw failure();
    return buffer.subarray(0, offset);
  } finally { fs.closeSync(fd); }
}

type Cache = { key: string; input: OnlineRuntimeScopeInput; grantIdentity: string;
  helperIdentity: string; helperFile: string };
let cached: Cache | undefined;
let legacyObserved = false;
let failed = false;

function assertFresh(value: Cache) {
  const input = value.input;
  const grant = readStable(input.file, 16384, true);
  const helper = readStable(value.helperFile, 131072, false);
  if (grant.identity !== value.grantIdentity || grant.value.dev.toString() !== input.device
    || grant.value.ino.toString() !== input.inode || grant.mountId !== input.mountId
    || hash(grant.bytes) !== input.sha256 || helper.identity !== value.helperIdentity
    || hash(helper.bytes) !== input.helperSha256
    || fs.readlinkSync('/proc/self/ns/mnt') !== input.mountNamespace
    || hash(mountSnapshot()) !== input.mountInfoSha256) throw failure();
}

/** Native identity INPUT only, not image/registry/release/public authority.
 * One incarnation cannot change or disable its source after first observation.
 * The single reviewed Python parser verifies actual read-only mount aliases;
 * this adapter freezes its result and rechecks source/mount identity on use.
 * The fixed adjacent helper receives no DB credentials or caller command.
 */
export function loadOnlineRuntimeScope(environment: NodeJS.ProcessEnv = process.env): OnlineRuntimeScopeInput | undefined {
  try {
    if (failed) throw failure();
    const configured = keys.some(key => environment[key] !== undefined);
    if (!configured) {
      if (cached) throw failure();
      legacyObserved = true;
      return undefined;
    }
    if (process.platform !== 'linux' || legacyObserved || keys.some(key => !environment[key])) throw failure();
    const key = JSON.stringify([...keys.map(name => environment[name]), environment.BACKEND_RUNTIME_ROLE,
      environment.RECOVERY_COORDINATION_DIR || '/app/recovery-coordination']);
    if (cached) {
      if (cached.key !== key) throw failure();
      assertFresh(cached);
      return cached.input;
    }
    const helperFile = path.join(__dirname, 'online-runtime-scope.py');
    const helper = readStable(helperFile, 131072, false);
    const result = spawnSync('/usr/bin/python3', ['-I', '-B', helperFile], {
      env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8',
        BACKEND_ONLINE_SCOPE_FILE: environment.BACKEND_ONLINE_SCOPE_FILE!,
        BACKEND_ONLINE_SCOPE_SHA256: environment.BACKEND_ONLINE_SCOPE_SHA256!,
        BACKEND_RUNTIME_ROLE: environment.BACKEND_RUNTIME_ROLE,
        RECOVERY_COORDINATION_DIR: environment.RECOVERY_COORDINATION_DIR || '/app/recovery-coordination' },
      stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 5000, maxBuffer: 65536,
    });
    // This bounded helper performs reads only and spawns no descendants. A
    // timeout/error cannot admit a pool, task or write, and poisons this input.
    if (result.error || result.signal || result.status !== 0) throw failure();
    const input = JSON.parse(result.stdout) as OnlineRuntimeScopeInput;
    const expectedKeys = ['scope', 'file', 'sha256', 'device', 'inode', 'mountId', 'mountNamespace', 'mountInfoSha256', 'helperSha256'];
    if (!input || typeof input !== 'object' || Object.keys(input).length !== expectedKeys.length
      || expectedKeys.some(name => !Object.prototype.hasOwnProperty.call(input, name))
      || input.file !== environment.BACKEND_ONLINE_SCOPE_FILE || input.sha256 !== environment.BACKEND_ONLINE_SCOPE_SHA256
      || !/^[a-f0-9]{64}$/.test(input.sha256) || !/^[a-f0-9]{64}$/.test(input.mountInfoSha256)
      || !/^[1-9][0-9]*$/.test(input.device) || !/^[1-9][0-9]*$/.test(input.inode)
      || !/^[1-9][0-9]*$/.test(input.mountId) || !/^mnt:\[[0-9]+\]$/.test(input.mountNamespace)
      || input.helperSha256 !== hash(helper.bytes) || !input.scope || typeof input.scope !== 'object') throw failure();
    const grant = readStable(input.file, 16384, true);
    if (!encoded(input.scope).equals(grant.bytes)) throw failure();
    const value: Cache = { key, input: freezeDeep(input), grantIdentity: grant.identity,
      helperIdentity: helper.identity, helperFile };
    assertFresh(value);
    cached = value;
    return cached.input;
  } catch {
    failed = true;
    throw failure();
  }
}
