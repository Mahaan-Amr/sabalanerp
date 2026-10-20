import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadOnlineRuntimeScope } from './onlineRuntimeScope';
import { applicationRuntimeDatabaseUrl } from './runtimeNativeAuthority';
import { OnlineCaptureAdmission } from './onlineCaptureAdmission';

type DirectoryIdentity = Readonly<{ device: string; inode: string }>;
type CaptureInput = Readonly<{
  componentScopeFile: string; componentScopeSha256: string; componentDirectory: string;
  sourceName: string; storeIdentity: DirectoryIdentity;
}>;
const fail = (): never => { throw new Error('FILE_CAPTURE_NATIVE_AUTHORITY_UNPROVEN'); };
const issuedAuthorities = new WeakSet<NativeFileCaptureAuthority>();
export function assertNativeFileCaptureAuthority(value: NativeFileCaptureAuthority) {
  if (!issuedAuthorities.has(value)) throw new Error('FILE_CAPTURE_NATIVE_AUTHORITY_REQUIRED');
  value.assertOwned();
}
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const exact = (value: any, keys: string[]) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function directory(file: string, expected?: DirectoryIdentity) {
  if (!path.isAbsolute(file) || path.resolve(file) !== file || fs.realpathSync(file) !== file) fail();
  const stat = fs.lstatSync(file, { bigint: true });
  if (!stat.isDirectory() || stat.uid !== BigInt(process.getuid!()) || (stat.mode & 0o077n)
    || (expected && (String(stat.dev) !== expected.device || String(stat.ino) !== expected.inode))) fail();
  return { device: String(stat.dev), inode: String(stat.ino) };
}
function record(file: string, maximum = 262144, mode = 0o400) {
  if (fs.realpathSync(file) !== file) fail();
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.uid !== BigInt(process.getuid!())
      || (before.mode & 0o777n) !== BigInt(mode) || before.size < 1n || before.size > BigInt(maximum)) fail();
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, null);
      if (!count) fail();
      offset += count;
    }
    if (fs.readSync(fd, Buffer.alloc(1), 0, 1, null) !== 0) fail();
    const after = fs.fstatSync(fd, { bigint: true }), named = fs.lstatSync(file, { bigint: true });
    const identity = (value: fs.BigIntStats) => [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs,
      value.uid, value.mode, value.nlink].map(String).join(':');
    if (identity(before) !== identity(after) || identity(before) !== identity(named) || bytes.length !== Number(before.size)) fail();
    return { value: JSON.parse(bytes.toString('utf8')), sha256: hash(bytes), identity: identity(before) };
  } finally { fs.closeSync(fd); }
}

/** Confined capture authority, never application work or release admission.
 * The genuine capture guardian owns FD9/10/11/12 and durable CLOSING. Its
 * component worker must already have published the actual fleet census.
 * This port cannot adopt a baseline, create a root, or write live files. */
export class NativeFileCaptureAuthority {
  private constructor(private readonly input: CaptureInput,
    private readonly online: NonNullable<ReturnType<typeof loadOnlineRuntimeScope>>,
    private readonly admission: OnlineCaptureAdmission,
    private readonly scopeRecord: ReturnType<typeof record>,
    private readonly intentRecord: ReturnType<typeof record>,
    private readonly censusRecord: ReturnType<typeof record>,
    private readonly componentIdentity: DirectoryIdentity,
    readonly captureId: string,
    readonly source: Readonly<{ root: string; liveRoot: string; storeIdentity: DirectoryIdentity; liveIdentity: DirectoryIdentity }>,
  ) {}

  static open(input: CaptureInput) {
    if (process.platform !== 'linux' || !exact(input, ['componentScopeFile', 'componentScopeSha256', 'componentDirectory', 'sourceName', 'storeIdentity'])
      || !/^[a-f0-9]{64}$/.test(input.componentScopeSha256) || !/^[a-z][a-z0-9-]{0,63}$/.test(input.sourceName)
      || !exact(input.storeIdentity, ['device', 'inode'])
      || !Object.values(input.storeIdentity).every(value => typeof value === 'string' && /^[1-9][0-9]{0,24}$/.test(value))) fail();
    input = Object.freeze({ ...input, storeIdentity: Object.freeze({ ...input.storeIdentity }) });
    if (path.dirname(input.componentScopeFile) !== input.componentDirectory) fail();
    const online = loadOnlineRuntimeScope();
    if (!online || online.scope.format !== 'sabalan-online-runtime-scope/v2' || online.scope.purpose !== 'capture'
      || online.scope.role !== 'control' || !online.scope.worker || !applicationRuntimeDatabaseUrl()) return fail();
    const componentIdentity = directory(input.componentDirectory), scopeRecord = record(input.componentScopeFile);
    const scope = scopeRecord.value;
    if (scopeRecord.sha256 !== input.componentScopeSha256
      || !exact(scope, ['format', 'captureId', 'handshake', 'systemIdentifier', 'databaseName', 'storeRoot', 'sources', 'inquiry', 'logicalDump', 'sealer'])
      || scope.format !== 'sabalan-coherent-capture-scope/v3' || scope.storeRoot !== null
      || !/^[a-f0-9]{64}$/.test(scope.captureId) || !/^[a-f0-9]{64}$/.test(scope.handshake)
      || scope.systemIdentifier !== online.scope.database.systemIdentifier || scope.databaseName !== online.scope.database.name
      || !Array.isArray(scope.sources) || scope.sources.length < 1 || scope.sources.length > 32) fail();
    const selected = scope.sources.filter((source: any) => source.name === input.sourceName);
    if (selected.length !== 1 || !exact(selected[0], ['name', 'path', 'device', 'inode', 'storeRoot'])) fail();
    if (!exact(scope.sealer, ['script', 'sha256', 'stores']) || !Array.isArray(scope.sealer.stores)
      || scope.sealer.stores.length !== scope.sources.length
      || !scope.sealer.stores.every((store: any, index: number) => exact(store, ['name', 'device', 'inode'])
        && store.name === scope.sources[index].name
        && typeof store.device === 'string' && /^[1-9][0-9]{0,24}$/.test(store.device)
        && typeof store.inode === 'string' && /^[1-9][0-9]{0,24}$/.test(store.inode))) fail();
    const enrolledStore = scope.sealer.stores.find((store: any) => store.name === input.sourceName);
    if (!enrolledStore || enrolledStore.device !== input.storeIdentity.device || enrolledStore.inode !== input.storeIdentity.inode) fail();
    const source = selected[0], liveIdentity = { device: source.device, inode: source.inode };
    directory(source.path, liveIdentity); directory(source.storeRoot, input.storeIdentity);
    const authority = new NativeFileCaptureAuthority(input, online, new OnlineCaptureAdmission(online), scopeRecord,
      record(path.join(input.componentDirectory, 'intent.json')), record(path.join(input.componentDirectory, 'registered-backend-boundary.json')),
      componentIdentity, scope.captureId, Object.freeze({ root: source.storeRoot, liveRoot: source.path,
        storeIdentity: input.storeIdentity, liveIdentity: Object.freeze(liveIdentity) }));
    authority.assertOwned();
    issuedAuthorities.add(authority);
    Object.freeze(authority);
    return authority;
  }

  gateIdentity() { return Object.freeze({ device: this.online.scope.gate.device, inode: this.online.scope.gate.inode, ownerUid: this.online.scope.gate.ownerUid }); }

  assertOwned() {
    if (loadOnlineRuntimeScope() !== this.online || !applicationRuntimeDatabaseUrl() || this.admission.isOpen()) fail();
    directory(this.input.componentDirectory, this.componentIdentity);
    directory(this.source.root, this.source.storeIdentity); directory(this.source.liveRoot, this.source.liveIdentity);
    for (const [file, expected] of [[this.input.componentScopeFile, this.scopeRecord],
      [path.join(this.input.componentDirectory, 'intent.json'), this.intentRecord],
      [path.join(this.input.componentDirectory, 'registered-backend-boundary.json'), this.censusRecord]] as const) {
      const actual = record(file);
      if (actual.identity !== expected.identity || actual.sha256 !== expected.sha256) fail();
    }
    const intent = this.intentRecord.value, census = this.censusRecord.value;
    if (!exact(intent, ['format', 'captureId', 'scopeSha256', 'nativeClaimSha256', 'namespace'])
      || intent.format !== 'sabalan-coherent-capture-intent/v1' || intent.captureId !== this.captureId
      || intent.scopeSha256 !== this.scopeRecord.sha256 || intent.nativeClaimSha256 !== process.env.BACKEND_NATIVE_CLAIM_SHA256
      || intent.namespace !== process.env.BACKEND_NATIVE_POSTGRES_APPLICATION_NAME
      || !exact(census, ['format', 'captureScopeSha256', 'gate', 'runtimes', 'database', 'hostImageAdmission', 'inquiryBoundary', 'productionRecoveryPoint'])
      || census.format !== 'sabalan-registered-backend-boundary/v1' || census.captureScopeSha256 !== this.online.sha256
      || !same(census.gate, this.online.scope.gate) || census.productionRecoveryPoint !== false
      || !same(census.database, { system: this.online.scope.database.systemIdentifier, database: this.online.scope.database.name,
        visible: true, prepared: 0, busy: 0, closed: 0 }) || !Array.isArray(census.runtimes)
      || !census.runtimes.some((runtime: any) => runtime.runtimeId === this.online.scope.runtimeId
        && runtime.phase === 'CAPTURING' && runtime.nativeSha256 === process.env.BACKEND_NATIVE_CLAIM_SHA256)) fail();
    // isOpen() validates the entire immutable history. Bind its CLOSING head to
    // THIS guardian; another capture's pause cannot authorize this sealer.
    const admissionRoot = this.online.scope.admission!.directory;
    const events = fs.readdirSync(admissionRoot).filter(name => /^[0-9]{8}\.json$/.test(name)).sort();
    const head = record(path.join(admissionRoot, events[events.length - 1]), 16384).value;
    const native = record(path.join(this.online.scope.nativeDirectory, 'deployment-runtime-native.json'), 16384, 0o600);
    if (head.phase !== 'CLOSING' || head.capture?.runtimeId !== this.online.scope.runtimeId
      || head.capture.scopeSha256 !== this.online.sha256 || native.sha256 !== process.env.BACKEND_NATIVE_CLAIM_SHA256
      || !same(head.capture.guardian, native.value.guardian)) fail();
  }
}
