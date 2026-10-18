import { constants, promises as fs } from 'node:fs';
import * as nativeFs from 'node:fs';
import type { BigIntStats } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { RuntimeWorkContext } from './runtimeWorkContext';
import { publishDurableFile, publishDurableStream, removeDurableFile, syncExistingDurableFile } from './durableFilePublication';

type Identity = { device: string; inode: string; bytes: string; modified: string; changed: string };
type Version = { format: 'sabalan-file-version/v1'; key: string; generation: number; previousSha256: string | null;
  operation: 'PUT' | 'DELETE'; object: { name: string; sha256: string; bytes: number } | null; live: Identity | null };
type StreamInput = { source: Readable; assertReady(): void; finish(): Promise<void> };
type FileClaim = { key: string; id: string; target: string; pending: string; heldIdentity: Identity;
  previous: { sha256: string; value: Version } | null; actual: Identity | null };
export type VersionedFileRootHead = Readonly<{ versionSha256: string; operation: 'PUT' | 'DELETE'; byteLength: number }>;
export type VersionedFileRootScope = Readonly<{
  publish(key: string, bytes: Uint8Array, options?: { replace?: boolean }): Promise<string>;
  publishIfCurrent(key: string, bytes: Uint8Array, expectedVersionSha256: string | null): Promise<string>;
  publishUpload(key: string, source: Readable): ReturnType<VersionedFilePublication['publishUpload']>;
  remove(key: string): Promise<string>;
  removeUpload(key: string, versionSha256: string): Promise<string>;
  inspect(key: string): Promise<VersionedFileRootHead | null>;
  read(key: string): Promise<Buffer | null>;
  readVersion(key: string, versionSha256: string): Promise<Buffer | null>;
  moveTo(destination: VersionedFileRootScope, sourceKey: string, destinationKey: string, expectedSourceSha256: string): ReturnType<VersionedFilePublication['move']>;
}>;
const rootScopes = new WeakMap<VersionedFileRootScope, { owner: VersionedFilePublication; root: string; prefix: string }>();
export function assertVersionedFileRootScope(scope: VersionedFileRootScope, root: string) {
  if (!rootScopes.has(scope) || rootScopes.get(scope)!.root !== path.resolve(root)) {
    fail('FILE_VERSION_STORAGE_ROOT_MISMATCH');
  }
}
const hash = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');
const shaPattern = /^[a-f0-9]{64}$/;
const fail = (code: string): never => { throw Object.assign(new Error(code), { code }); };
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const encoded = (value: unknown) => Buffer.from(JSON.stringify(canonical(value)) + '\n');
const exact = (value: any, keys: string[]) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
const identity = (value: BigIntStats): Identity => ({ device: String(value.dev), inode: String(value.ino),
  bytes: String(value.size), modified: String(value.mtimeNs), changed: String(value.ctimeNs) });
const same = (left: unknown, right: unknown) => encoded(left).equals(encoded(right));

async function syncDirectory(directory: string) {
  const fd = await fs.open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await fd.sync(); } finally { await fd.close(); }
}

async function syncAncestors(directory: string) {
  for (let current = directory; ; current = path.dirname(current)) {
    const value = await fs.lstat(current);
    if (!value.isDirectory() || ((value.mode & 0o022) !== 0 && (value.mode & 0o1000) === 0)) fail('FILE_VERSION_DIRECTORY_UNSAFE');
    await syncDirectory(current);
    if (path.dirname(current) === current) return;
  }
}

async function privateDirectory(directory: string) {
  if (!path.isAbsolute(directory) || path.resolve(directory) !== directory || await fs.realpath(directory) !== directory) {
    fail('FILE_VERSION_DIRECTORY_ALIAS');
  }
  const value = await fs.lstat(directory, { bigint: true });
  if (!value.isDirectory() || value.uid !== BigInt(process.getuid!()) || (value.mode & 0o077n)) fail('FILE_VERSION_DIRECTORY_UNSAFE');
  return identity(value);
}

async function readImmutable(file: string, maximum: number) {
  const fd = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await fd.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.uid !== BigInt(process.getuid!()) || (before.mode & 0o222n)
      || before.size > BigInt(maximum)) fail('FILE_VERSION_RECORD_UNSAFE');
    const bytes = Buffer.alloc(Number(before.size)); let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await fd.read(bytes, offset, bytes.length - offset, null);
      if (!bytesRead) fail('FILE_VERSION_RECORD_CHANGED');
      offset += bytesRead;
    }
    if (!same(identity(before), identity(await fd.stat({ bigint: true })))
      || !same(identity(before), identity(await fs.lstat(file, { bigint: true })))) fail('FILE_VERSION_RECORD_CHANGED');
    await fd.sync(); return bytes;
  } finally { await fd.close(); }
}

/** Private admitted file writer. There is no environment activation or startup
 * hook. A controller must still prove complete protected-root/legacy/privacy
 * coverage before this can contribute to a coherent application cut.
 *
 * One persistent per-key intent serializes processes. Any uncertain operation
 * leaves that intent intact; no timeout, replay, reset or stale-lock removal is
 * provided. Each object has a distinct inode/name, including identical bytes,
 * so a future erasure owner can account for each retained copy independently. */
export class VersionedFilePublication {
  private readonly directories = new Map<string, Identity>();

  private constructor(private readonly root: string, private readonly liveRoot: string,
    private readonly work: RuntimeWorkContext) {}

  static async open(root: string, liveRoot: string, work: RuntimeWorkContext) {
    if (process.platform !== 'linux' || !(work instanceof RuntimeWorkContext)) fail('FILE_VERSION_ADMITTED_LINUX_REQUIRED');
    const owner = new VersionedFilePublication(root, liveRoot, work);
    await work.run(async () => {
      work.assertActive();
      const overlap = path.relative(root, liveRoot), reverse = path.relative(liveRoot, root);
      if (!overlap || (!overlap.startsWith('..' + path.sep) && !path.isAbsolute(overlap))
        || (!reverse.startsWith('..' + path.sep) && !path.isAbsolute(reverse))) fail('FILE_VERSION_ROOT_OVERLAP');
      for (const directory of [root, liveRoot]) owner.directories.set(directory, await privateDirectory(directory));
      for (const name of ['objects', 'versions', 'heads', 'pending', 'seals', 'reservations']) {
        const directory = path.join(root, name);
        try { await fs.mkdir(directory, { mode: 0o700 }); }
        catch (error: any) { if (error?.code !== 'EEXIST') throw error; }
        owner.directories.set(directory, await privateDirectory(directory));
        await syncDirectory(directory);
      }
      await syncAncestors(root); await syncAncestors(liveRoot);
      await owner.assertDirectories();
    });
    return owner;
  }

  private async assertDirectories() {
    for (const [directory, expected] of this.directories) {
      const actual = await privateDirectory(directory);
      if (actual.device !== expected.device || actual.inode !== expected.inode) fail('FILE_VERSION_DIRECTORY_CHANGED');
    }
  }

  ownsRoot(root: string) { return path.resolve(root) === this.liveRoot; }

  /** Bind existing private subdirectories to the same completion, capacity and
   * version owner. This grants a confined port, never release/root coverage.
   * No directories are created, no baseline is adopted and no caller can use
   * another scope's version receipt or move between independent owners. */
  bindRoot(root: string): Promise<VersionedFileRootScope> {
    return this.work.run(async () => {
      this.work.assertActive(); await this.assertDirectories();
      if (typeof root !== 'string' || !path.isAbsolute(root) || path.resolve(root) !== root) fail('FILE_VERSION_STORAGE_ROOT_MISMATCH');
      const relative = path.relative(this.liveRoot, root);
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) fail('FILE_VERSION_STORAGE_ROOT_MISMATCH');
      const additions: Array<[string, Identity]> = [];
      let current = this.liveRoot;
      for (const part of relative ? relative.split(path.sep) : []) {
        current = path.join(current, part); additions.push([current, await privateDirectory(current)]);
      }
      await this.assertDirectories();
      for (const [directory, expected] of additions) {
        const actual = await privateDirectory(directory);
        if (actual.device !== expected.device || actual.inode !== expected.inode) fail('FILE_VERSION_DIRECTORY_CHANGED');
      }
      // A concurrent binding may have pinned an incarnation while the final
      // filesystem observations awaited. Validate the whole batch, then commit
      // synchronously so no published pin can be overwritten or partly added.
      for (const [directory, expected] of additions) {
        const pinned = this.directories.get(directory);
        if (pinned && (pinned.device !== expected.device || pinned.inode !== expected.inode)) {
          fail('FILE_VERSION_DIRECTORY_CHANGED');
        }
      }
      for (const [directory, expected] of additions) this.directories.set(directory, expected);
      const prefix = relative.split(path.sep).join('/');
      // Preserve malformed keys until the writer validates them, so an upload
      // still transfers stream ownership and completes actual destruction.
      const key = (value: string) => typeof value === 'string' && prefix ? prefix + '/' + value : value;
      const inspect = (value: string) => this.work.run(async (): Promise<VersionedFileRootHead | null> => {
        this.work.assertActive(); await this.assertDirectories();
        const full = key(value), target = this.key(full).target;
        const head = await this.head(full), actual = await this.current(target);
        if (!same(actual, head?.value.live ?? null)) fail('FILE_VERSION_UNTRACKED_LIVE_CHANGE');
        return head ? Object.freeze({ versionSha256: head.sha256, operation: head.value.operation,
          byteLength: head.value.object?.bytes ?? 0 }) : null;
      });
      const readVersion = (value: string, sha256: string) => this.work.run(async () => {
        this.work.assertActive(); await this.assertDirectories();
        const full = key(value); this.key(full);
        if ((await this.version(sha256)).value.key !== full) fail('FILE_VERSION_SELECTION_INVALID');
        return this.readVersion(sha256);
      });
      const scope: VersionedFileRootScope = Object.freeze({
        publish: (value: string, bytes: Uint8Array, options?: { replace?: boolean }) => this.publish(key(value), bytes, options),
        publishIfCurrent: (value: string, bytes: Uint8Array, expected: string | null) => this.publishIfCurrent(key(value), bytes, expected),
        publishUpload: (value: string, source: Readable) => this.publishUpload(key(value), source),
        remove: (value: string) => this.remove(key(value)),
        removeUpload: (value: string, sha256: string) => this.removeUpload(key(value), sha256),
        inspect, readVersion,
        read: (value: string) => this.work.run(async () => {
          const head = await inspect(value);
          return head ? readVersion(value, head.versionSha256) : null;
        }),
        moveTo: async (destination: VersionedFileRootScope, sourceKey: string, destinationKey: string, expected: string) => {
          const binding = rootScopes.get(destination);
          if (!binding || binding.owner !== this) return fail('FILE_VERSION_STORAGE_ROOT_MISMATCH');
          const destinationFull = typeof destinationKey === 'string' && binding.prefix
            ? binding.prefix + '/' + destinationKey : destinationKey;
          return this.move(key(sourceKey), destinationFull, expected);
        },
      });
      rootScopes.set(scope, { owner: this, root, prefix });
      return scope;
    });
  }

  private async reservation(key: string) {
    const file = path.join(this.root, 'reservations', this.key(key).id + '.json');
    try {
      const bytes = await readImmutable(file, 8192);
      if (!bytes.equals(encoded({ format: 'sabalan-file-key-reservation/v1', key }))) fail('FILE_VERSION_RESERVATION_INVALID');
      return true;
    } catch (error: any) { if (error?.code === 'ENOENT') return false; throw error; }
  }

  private async reserve(key: string) {
    if (await this.reservation(key)) return;
    const pending = path.join(this.root, 'pending', 'capacity.json');
    let fd;
    try { fd = await fs.open(pending, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o400); }
    catch (error: any) { if (error?.code === 'EEXIST') fail('FILE_VERSION_CAPACITY_BUSY'); throw error; }
    let claim: Identity;
    try {
      await fd.writeFile(encoded({ operationId: randomUUID(), key })); await fd.sync();
      claim = identity(await fd.stat({ bigint: true })); await syncDirectory(path.dirname(pending));
    } finally { await fd.close(); }
    const release = async () => {
      this.work.assertActive(); await this.assertDirectories();
      if (!same(identity(await fs.lstat(pending, { bigint: true })), claim!)) fail('FILE_VERSION_COMPLETION_UNPROVEN');
      await fs.unlink(pending); await syncDirectory(path.dirname(pending));
    };
    const names = await fs.readdir(path.join(this.root, 'reservations'));
    if (names.length >= 10000) { await release(); fail('FILE_VERSION_INVENTORY_CAPACITY'); }
    const keys: string[] = [];
    for (const name of names) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) fail('FILE_VERSION_RESERVATION_INVALID');
      const raw = await readImmutable(path.join(this.root, 'reservations', name), 8192), value = JSON.parse(raw.toString());
      if (!exact(value, ['format', 'key']) || value.format !== 'sabalan-file-key-reservation/v1'
        || !raw.equals(encoded(value)) || this.key(value.key).id + '.json' !== name) fail('FILE_VERSION_RESERVATION_INVALID');
      keys.push(value.key);
    }
    // The global persistent owner serializes distinct-key reservations. A
    // reservation is retained even if a later operation has an uncertain ACK.
    // Limits account for tombstones and all potential live parent directories.
    keys.push(key);
    const directories = new Set<string>(['']);
    let metadataBytes = encoded(this.cutManifest('0'.repeat(64), [])).length;
    for (const reserved of keys) {
      const parts = reserved.split('/');
      metadataBytes += encoded({ key: reserved, sha256: '0'.repeat(64) }).length;
      if (metadataBytes > 16 * 1024 * 1024) { await release(); fail('FILE_VERSION_INVENTORY_CAPACITY'); }
      for (let index = 1; index < parts.length; index++) {
        directories.add(parts.slice(0, index).join('/'));
        if (directories.size > 10000) { await release(); fail('FILE_VERSION_INVENTORY_CAPACITY'); }
      }
    }
    if (directories.size > 10000 || metadataBytes > 16 * 1024 * 1024) {
      await release(); fail('FILE_VERSION_INVENTORY_CAPACITY');
    }
    const destination = path.join(this.root, 'reservations', this.key(key).id + '.json');
    const bytes = encoded({ format: 'sabalan-file-key-reservation/v1', key });
    await publishDurableFile(destination, bytes); await fs.chmod(destination, 0o400); await syncExistingDurableFile(destination);
    if (!(await readImmutable(destination, 8192)).equals(bytes)) fail('FILE_VERSION_RESERVATION_INVALID');
    await release();
  }

  private cutManifest(captureId: string, heads: Array<{ key: string; sha256: string }>) {
    return { format: 'sabalan-file-version-cut/v1', captureId, gate: this.work.gateIdentity(),
      source: { path: this.liveRoot, device: this.directories.get(this.liveRoot)!.device, inode: this.directories.get(this.liveRoot)!.inode }, heads };
  }

  private key(value: string) {
    if (typeof value !== 'string' || !value || value.length > 1024 || Buffer.from(value).toString('utf8') !== value
      || value.includes('\\') || value.includes('\0')
      || value.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.sabalan-file-'))
      || path.isAbsolute(value)) fail('FILE_VERSION_KEY_INVALID');
    return { id: hash(value), target: path.join(this.liveRoot, ...value.split('/')) };
  }

  private decode(bytes: Buffer): Version {
    const value = JSON.parse(bytes.toString('utf8'));
    if (!bytes.equals(encoded(value)) || !exact(value, ['format', 'key', 'generation', 'previousSha256', 'operation', 'object', 'live'])
      || value.format !== 'sabalan-file-version/v1' || !Number.isSafeInteger(value.generation) || value.generation < 1
      || (value.generation === 1 ? value.previousSha256 !== null : typeof value.previousSha256 !== 'string' || !shaPattern.test(value.previousSha256))
      || !['PUT', 'DELETE'].includes(value.operation)) fail('FILE_VERSION_RECORD_INVALID');
    this.key(value.key);
    if (value.operation === 'DELETE') {
      if (value.object !== null || value.live !== null) fail('FILE_VERSION_RECORD_INVALID');
    } else if (!exact(value.object, ['name', 'sha256', 'bytes']) || !/^[a-f0-9-]{36}$/.test(value.object.name)
      || typeof value.object.sha256 !== 'string' || !shaPattern.test(value.object.sha256)
      || !Number.isSafeInteger(value.object.bytes) || value.object.bytes < 0
      || !exact(value.live, ['device', 'inode', 'bytes', 'modified', 'changed'])
      || Object.values(value.live).some(item => typeof item !== 'string' || !/^[0-9]{1,30}$/.test(item))
      || value.live.bytes !== String(value.object.bytes)) fail('FILE_VERSION_RECORD_INVALID');
    return value;
  }

  private async version(sha256: string) {
    if (typeof sha256 !== 'string' || !shaPattern.test(sha256)) fail('FILE_VERSION_SELECTION_INVALID');
    const bytes = await readImmutable(path.join(this.root, 'versions', sha256 + '.json'), 16384);
    if (hash(bytes) !== sha256) fail('FILE_VERSION_RECORD_CHANGED');
    return { bytes, value: this.decode(bytes) };
  }

  private async head(key: string) {
    const { id } = this.key(key);
    let raw: Buffer;
    try { raw = await readImmutable(path.join(this.root, 'heads', id + '.json'), 16384); }
    catch (error: any) { if (error?.code === 'ENOENT') return null; throw error; }
    const sha256 = hash(raw), version = await this.version(sha256);
    if (version.value.key !== key || !version.bytes.equals(raw)) fail('FILE_VERSION_HEAD_CHANGED');
    return { sha256, value: version.value };
  }

  private async current(target: string): Promise<Identity | null> {
    let value: BigIntStats;
    try { value = await fs.lstat(target, { bigint: true }); }
    catch (error: any) { if (error?.code === 'ENOENT') return null; throw error; }
    if (!value.isFile() || value.nlink !== 1n || value.uid !== BigInt(process.getuid!())) fail('FILE_VERSION_LIVE_UNSAFE');
    if (await fs.realpath(target) !== target) fail('FILE_VERSION_DIRECTORY_ALIAS');
    return identity(value);
  }

  publish(key: string, bytes: Uint8Array, options: { replace?: boolean } = {}) {
    const frozen = Buffer.from(bytes), replace = options.replace === true;
    return this.change(key, frozen, replace);
  }

  /** Restore/compensate only the exact observed generation. Null selects a key
   * with no history; a deletion is an existing generation, never absence. */
  async publishIfCurrent(key: string, bytes: Uint8Array, expectedVersionSha256: string | null): Promise<string> {
    if (expectedVersionSha256 !== null && (typeof expectedVersionSha256 !== 'string'
      || !shaPattern.test(expectedVersionSha256))) fail('FILE_VERSION_SELECTION_INVALID');
    return this.change(key, Buffer.from(bytes), true, expectedVersionSha256);
  }

  /** Takes ownership of this input stream immediately. Observe errors before
   * asynchronous admission; no source bytes are consumed before admission.
   * Admitted cleanup remains inside the same actual completion reference. */
  publishStream(key: string, source: Readable, options: { replace?: boolean } = {}): Promise<string> {
    return this.publishStreamOwned(key, source, options, async sha256 => sha256);
  }

  private publishStreamOwned<T>(key: string, source: Readable, options: { replace?: boolean },
    receipt: (sha256: string) => Promise<T>): Promise<T> {
    if (!(source instanceof Readable)) return Promise.reject(Object.assign(new Error('FILE_VERSION_SOURCE_INVALID'), {
      code: 'FILE_VERSION_SOURCE_INVALID',
    }));
    const replace = options.replace === true;
    let sourceError: unknown = source.errored, entered = false;
    const observe = (error: unknown) => { sourceError ||= error; };
    source.on('error', observe); source.pause();
    const closeInput = async () => {
      source.destroy();
      // finished() can resolve on EOF when emitClose=false. Readable.closed
      // becomes true only after the actual _destroy callback has completed.
      // Unknown completion keeps admitted work held, without a timeout reset.
      while (!source.closed) await new Promise(resolve => setTimeout(resolve, 5));
      // Drain scheduled error/close emissions before detaching our observer,
      // including a synchronous _destroy callback reached from a microtask.
      await new Promise<void>(resolve => setImmediate(resolve));
      if (source.errored) throw source.errored;
      if (sourceError) throw sourceError;
    };
    const dispose = async () => {
      try {
        try { await closeInput(); }
        catch (error) {
          // Actual destruction is now complete. A known input failure was
          // already reported before any live publication or intent completion.
          if (error !== sourceError && error !== source.errored) throw error;
        }
      } finally { source.removeListener('error', observe); }
    };
    return this.work.run(async () => {
      entered = true;
      try {
        const sha256 = await this.change(key, { source, assertReady: () => { if (sourceError) throw sourceError; },
          finish: async () => {
            // EOF alone is not native input completion. A failed/unresolved
            // close must leave the existing intent before any live mutation.
            await closeInput();
          } }, replace);
        return await receipt(sha256);
      } finally { await dispose(); }
    }).finally(async () => { if (!entered) await dispose(); });
  }

  /** Upload cleanup carries the immutable publication identity, so rejection of
   * an old multipart request cannot delete a subsequent legitimate version. */
  publishUpload(key: string, source: Readable) {
    return this.publishStreamOwned(key, source, {}, async versionSha256 => {
      const { value } = await this.version(versionSha256);
      this.work.assertActive();
      if (!value.live || !value.object || value.operation !== 'PUT' || value.key !== key) return fail('FILE_VERSION_RECEIPT_INVALID');
      return { versionSha256, byteLength: value.object.bytes,
        identity: { device: value.live.device, inode: value.live.inode } };
    });
  }

  removeUpload(key: string, versionSha256: string) {
    if (!shaPattern.test(versionSha256)) fail('FILE_VERSION_SELECTION_INVALID');
    return this.change(key, null, true, versionSha256);
  }

  remove(key: string) { return this.change(key, null, true); }

  private async claim(key: string, operation: 'PUT' | 'DELETE' | 'MOVE', move?: {
    operationId: string; sourceKey: string; destinationKey: string; expectedSourceSha256: string;
  }): Promise<FileClaim> {
    const { id, target } = this.key(key);
    this.work.assertActive(); await this.assertDirectories();
    const pending = path.join(this.root, 'pending', id + '.json');
    const held = await fs.open(pending, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o400);
    let heldIdentity: Identity;
    try {
      await held.writeFile(encoded({ key, operationId: move?.operationId ?? randomUUID(), operation, ...(move ? { move } : {}) }));
      await held.sync(); heldIdentity = identity(await held.stat({ bigint: true })); await syncDirectory(path.dirname(pending));
    } finally { await held.close(); }
    const previous = await this.head(key), actual = await this.current(target);
    if (!same(actual, previous?.value.live ?? null)) fail('FILE_VERSION_UNTRACKED_LIVE_CHANGE');
    return { key, id, target, pending, heldIdentity: heldIdentity!, previous, actual };
  }

  private async assertClaim(claim: FileClaim, sha256 = claim.previous?.sha256, live = claim.actual) {
    this.work.assertActive(); await this.assertDirectories();
    if ((await this.head(claim.key))?.sha256 !== sha256 || !same(await this.current(claim.target), live)
      || !same(identity(await fs.lstat(claim.pending, { bigint: true })), claim.heldIdentity)) fail('FILE_VERSION_COMPLETION_UNPROVEN');
  }

  private async releaseClaim(claim: FileClaim, sha256 = claim.previous?.sha256, live = claim.actual) {
    await this.assertClaim(claim, sha256, live);
    await fs.unlink(claim.pending); await syncDirectory(path.dirname(claim.pending));
  }

  /** A private two-key relocation. Both durable intents remain held until the
   * destination and source deletion histories plus the pair receipt are durable.
   * An interrupted pair is never retried or rolled back implicitly. Expected
   * source identity and no-clobber destination also protect stale HR restores. */
  move(sourceKey: string, destinationKey: string, expectedSourceSha256: string) {
    this.key(sourceKey); this.key(destinationKey);
    if (sourceKey === destinationKey || !shaPattern.test(expectedSourceSha256)) fail('FILE_VERSION_SELECTION_INVALID');
    return this.work.run(async () => {
      const move = { operationId: randomUUID(), sourceKey, destinationKey, expectedSourceSha256 };
      const claims: FileClaim[] = [];
      for (const key of [sourceKey, destinationKey].sort()) {
        try { claims.push(await this.claim(key, 'MOVE', move)); }
        catch (error: any) {
          // O_EXCL collision did not create a second claim. Only the known
          // untouched first claim may be retired; never clear another owner.
          if (error?.code === 'EEXIST') for (const claimed of claims) await this.releaseClaim(claimed);
          throw error;
        }
      }
      const source = claims.find(claim => claim.key === sourceKey)!;
      const destination = claims.find(claim => claim.key === destinationKey)!;
      const refusal = source.previous?.sha256 !== expectedSourceSha256 ? 'FILE_VERSION_MOVE_SOURCE_CHANGED'
        : !source.actual || !source.previous?.value.object ? 'FILE_VERSION_MOVE_SOURCE_MISSING'
        : destination.actual ? 'FILE_VERSION_ALREADY_EXISTS'
        : claims.some(claim => (claim.previous?.value.generation ?? 0) >= 10000) ? 'FILE_VERSION_HISTORY_CAPACITY' : null;
      if (refusal) {
        for (const claim of claims) await this.assertClaim(claim);
        for (const claim of claims) await this.releaseClaim(claim);
        fail(refusal);
      }
      const object = source.previous!.value.object!;
      const input = Readable.from(this.objectChunks(path.join(this.root, 'objects', object.name), object), {
        objectMode: false, highWaterMark: 262144,
      });
      // Own the internal iterator through its actual destruction, including
      // refusal before consumption. No arbitrary external stream is accepted.
      let inputError: unknown;
      const observe = (error: unknown) => { inputError ||= error; }; input.on('error', observe);
      const closeInput = async () => {
        input.destroy();
        while (!input.closed) await new Promise(resolve => setTimeout(resolve, 5));
        await new Promise<void>(resolve => setImmediate(resolve));
      };
      try {
        let destinationVersionSha256: string;
        try {
          destinationVersionSha256 = await this.change(destinationKey, { source: input,
            assertReady: () => { if (inputError) throw inputError; },
            finish: async () => { await closeInput(); if (inputError) throw inputError; } }, false, undefined, destination);
        } catch (error: any) {
          // These two reserve refusals precede object/live mutation. The pair
          // owner may settle only its exact unchanged claims, after disposing
          // its unconsumed iterator. Other failures preserve both intents.
          if (['FILE_VERSION_CAPACITY_BUSY', 'FILE_VERSION_INVENTORY_CAPACITY'].includes(error?.code)) {
            await closeInput();
            for (const claim of claims) await this.assertClaim(claim);
            for (const claim of claims) await this.releaseClaim(claim);
          }
          throw error;
        }
        const sourceVersionSha256 = await this.change(sourceKey, null, true, expectedSourceSha256, source);
        const destinationHead = await this.head(destinationKey);
        await this.assertClaim(source, sourceVersionSha256, null);
        await this.assertClaim(destination, destinationVersionSha256, destinationHead!.value.live);
        const receipt = encoded({ format: 'sabalan-file-move/v1', ...move, sourceVersionSha256, destinationVersionSha256 });
        const receiptPath = path.join(this.root, 'move-' + move.operationId + '.json');
        await publishDurableFile(receiptPath, receipt); await fs.chmod(receiptPath, 0o400); await syncExistingDurableFile(receiptPath);
        if (!(await readImmutable(receiptPath, 16384)).equals(receipt)) fail('FILE_VERSION_RECORD_CHANGED');
        await this.releaseClaim(source, sourceVersionSha256, null);
        await this.releaseClaim(destination, destinationVersionSha256, destinationHead!.value.live);
        return { sourceVersionSha256, destinationVersionSha256, receiptSha256: hash(receipt) };
      } finally { await closeInput(); input.removeListener('error', observe); }
    });
  }

  private change(key: string, bytes: Buffer | StreamInput | null, replace: boolean, expectedVersion?: string | null,
    retainedClaim?: FileClaim): Promise<string> {
    return this.work.run(async () => {
      this.work.assertActive(); await this.assertDirectories();
      if (bytes !== null && !Buffer.isBuffer(bytes)) bytes.assertReady();
      // Even an old QUIESCENT journal cannot settle an interrupted file intent.
      const claim = retainedClaim ?? await this.claim(key, bytes === null ? 'DELETE' : 'PUT');
      if (claim.key !== key) fail('FILE_VERSION_SELECTION_INVALID');
      await this.assertClaim(claim);
      const { id, target, pending, heldIdentity, previous, actual } = claim;
      // Every exception from this point preserves the actual pending record.
      const retireUnstarted = async () => {
        if (!retainedClaim) await this.releaseClaim(claim);
      };
      const refusal = expectedVersion !== undefined && (previous?.sha256 ?? null) !== expectedVersion ? 'FILE_VERSION_UPLOAD_CHANGED'
        : previous && previous.value.generation >= 10000 ? 'FILE_VERSION_HISTORY_CAPACITY'
        : actual && bytes !== null && !replace ? 'FILE_VERSION_ALREADY_EXISTS' : null;
      if (refusal) {
        // No object/live mutation was started. Settle only this exact newly
        // created refusal, never an earlier process's unresolved intent.
        await retireUnstarted();
        fail(refusal);
      }
      try { await this.reserve(key); }
      catch (error: any) {
        if (['FILE_VERSION_INVENTORY_CAPACITY', 'FILE_VERSION_CAPACITY_BUSY'].includes(error?.code)) await retireUnstarted();
        throw error;
      }
      let object: Version['object'] = null, live: Identity | null = null;
      this.work.assertActive();
      if (bytes !== null) {
        const name = randomUUID(), objectPath = path.join(this.root, 'objects', name);
        if (Buffer.isBuffer(bytes)) {
          await publishDurableFile(objectPath, bytes);
          await fs.chmod(objectPath, 0o400); await syncExistingDurableFile(objectPath);
          if (!(await readImmutable(objectPath, bytes.length)).equals(bytes)) fail('FILE_VERSION_OBJECT_CHANGED');
          object = { name, bytes: bytes.length, sha256: hash(bytes) };
          this.work.assertActive(); await this.assertDirectories();
          await publishDurableFile(target, bytes, { replace });
        } else {
          const digest = createHash('sha256'), work = this.work, input = bytes;
          let byteLength = 0;
          async function* frozenChunks() {
            for await (const chunk of input.source) {
              work.assertActive(); input.assertReady();
              const frozen = Buffer.from(chunk); byteLength += frozen.length;
              if (!Number.isSafeInteger(byteLength)) fail('FILE_VERSION_OBJECT_TOO_LARGE');
              digest.update(frozen); yield frozen;
            }
            input.assertReady();
          }
          const published = await publishDurableStream(objectPath, Readable.from(frozenChunks(), {
            objectMode: false, highWaterMark: 262144,
          }));
          if (published.byteLength !== byteLength) fail('FILE_VERSION_OBJECT_CHANGED');
          await fs.chmod(objectPath, 0o400); await syncExistingDurableFile(objectPath);
          await input.finish();
          object = { name, bytes: published.byteLength, sha256: digest.digest('hex') };
          this.work.assertActive(); await this.assertDirectories();
          // Read back the separately persisted object while staging the live
          // copy. Its full hash/identity must match before atomic publication.
          await publishDurableStream(target, Readable.from(this.objectChunks(objectPath, object), {
            objectMode: false, highWaterMark: 262144,
          }), { replace });
        }
        live = await this.current(target);
        if (!live || live.bytes !== String(object.bytes)) fail('FILE_VERSION_LIVE_CHANGED');
      } else {
        const removed = await removeDurableFile(target);
        if (removed !== Boolean(actual) || await this.current(target) !== null) fail('FILE_VERSION_LIVE_CHANGED');
      }
      const version: Version = { format: 'sabalan-file-version/v1', key, generation: (previous?.value.generation ?? 0) + 1,
        previousSha256: previous?.sha256 ?? null, operation: bytes === null ? 'DELETE' : 'PUT', object, live };
      const raw = encoded(version), sha256 = hash(raw); this.decode(raw);
      this.work.assertActive(); await this.assertDirectories();
      for (const [file, replacing] of [[path.join(this.root, 'versions', sha256 + '.json'), false],
        [path.join(this.root, 'heads', id + '.json'), Boolean(previous)]] as const) {
        await publishDurableFile(file, raw, { replace: replacing });
        await fs.chmod(file, 0o400); await syncExistingDurableFile(file);
        if (!(await readImmutable(file, 16384)).equals(raw)) fail('FILE_VERSION_RECORD_CHANGED');
      }
      this.work.assertActive(); await this.assertDirectories();
      if (!same(await this.current(target), live) || !same(identity(await fs.lstat(pending, { bigint: true })), heldIdentity!)) {
        fail('FILE_VERSION_COMPLETION_UNPROVEN');
      }
      if (!retainedClaim) { await fs.unlink(pending); await syncDirectory(path.dirname(pending)); }
      return sha256;
    });
  }

  private async *objectChunks(file: string, object: NonNullable<Version['object']>, assertOwned = () => this.work.assertActive()) {
    const descriptor = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await descriptor.stat({ bigint: true });
      if (!before.isFile() || before.nlink !== 1n || before.uid !== BigInt(process.getuid!())
        || (before.mode & 0o222n) || before.size !== BigInt(object.bytes)) fail('FILE_VERSION_OBJECT_CHANGED');
      const digest = createHash('sha256'); let count = 0;
      for (;;) {
        assertOwned();
        const chunk = Buffer.alloc(262144), { bytesRead } = await descriptor.read(chunk, 0, chunk.length, null);
        if (!bytesRead) break;
        count += bytesRead;
        if (count > object.bytes) fail('FILE_VERSION_OBJECT_CHANGED');
        const bytes = chunk.subarray(0, bytesRead); digest.update(bytes); yield bytes;
      }
      if (count !== object.bytes || digest.digest('hex') !== object.sha256
        || !same(identity(before), identity(await descriptor.stat({ bigint: true })))
        || !same(identity(before), identity(await fs.lstat(file, { bigint: true })))) fail('FILE_VERSION_OBJECT_CHANGED');
      await descriptor.sync(); await this.assertDirectories();
    } finally { await descriptor.close(); }
  }

  async readVersion(sha256: string): Promise<Buffer | null> {
    await this.assertDirectories();
    const { value } = await this.version(sha256);
    let predecessor = value, count = 1;
    while (predecessor.previousSha256 !== null) {
      if (++count > 10000) fail('FILE_VERSION_HISTORY_CAPACITY');
      const previous = (await this.version(predecessor.previousSha256)).value;
      if (previous.key !== value.key || previous.generation !== predecessor.generation - 1) fail('FILE_VERSION_HISTORY_INVALID');
      predecessor = previous;
    }
    if (value.operation === 'DELETE') { await this.assertDirectories(); return null; }
    const bytes = await readImmutable(path.join(this.root, 'objects', value.object!.name), value.object!.bytes);
    if (bytes.length !== value.object!.bytes || hash(bytes) !== value.object!.sha256) fail('FILE_VERSION_OBJECT_CHANGED');
    await this.assertDirectories(); return bytes;
  }

  private exclusiveGate(exclusiveGateFd: number) {
    const expected = this.work.gateIdentity();
    const assertGate = () => {
      const value = nativeFs.fstatSync(exclusiveGateFd, { bigint: true });
      const named = nativeFs.readlinkSync('/proc/self/fd/' + exclusiveGateFd);
      const parent = nativeFs.lstatSync(path.dirname(named), { bigint: true });
      if (!value.isFile() || value.nlink !== 1n || value.size !== 0n || (value.mode & 0o022n)
        || String(value.dev) !== expected.device || String(value.ino) !== expected.inode || Number(value.uid) !== expected.ownerUid
        || nativeFs.realpathSync(named) !== named || path.basename(named) !== 'deployment-write-admission.lock'
        || !same(identity(value), identity(nativeFs.lstatSync(named, { bigint: true })))
        || !parent.isDirectory() || parent.uid !== value.uid || (parent.mode & 0o022n)) fail('FILE_VERSION_GATE_CHANGED');
      const details = nativeFs.readFileSync('/proc/self/fdinfo/' + exclusiveGateFd, 'utf8');
      if (!new RegExp('^lock:\\s+\\d+:\\s+FLOCK\\s+ADVISORY\\s+WRITE\\s+\\S+\\s+[0-9a-f]+:[0-9a-f]+:'
        + expected.inode + '\\s+0\\s+EOF\\s*$', 'm').test(details)) fail('FILE_VERSION_EXCLUSIVE_GATE_REQUIRED');
    };
    assertGate(); return assertGate;
  }

  /** One initial baseline under the real exclusive gate, without rewriting any
   * live inode. The controller must first retire unregistered/legacy writers;
   * this method cannot fence a noncooperating process or certify application
   * coherence. Every post-intent failure leaves adoption unresolved. There is
   * deliberately no resume, overwrite or timeout-based ownership reset. */
  async adoptLegacy(captureId: string, exclusiveGateFd: number) {
    if (typeof captureId !== 'string' || !shaPattern.test(captureId)) fail('FILE_VERSION_SELECTION_INVALID');
    const assertGate = this.exclusiveGate(exclusiveGateFd);
    await this.assertDirectories();
    const parts = ['objects', 'versions', 'heads', 'pending', 'seals', 'reservations'];
    if (!same((await fs.readdir(this.root)).sort(), [...parts].sort())) fail('FILE_VERSION_ADOPTION_REQUIRES_EMPTY_STORE');
    for (const part of parts) {
      if ((await fs.readdir(path.join(this.root, part))).length) fail('FILE_VERSION_ADOPTION_REQUIRES_EMPTY_STORE');
    }
    const assertMounts = async () => {
      const mounts = (await fs.readFile('/proc/self/mountinfo', 'utf8')).trim().split('\n').map(line =>
        line.split(' ')[4].replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8))));
      if (mounts.some(mount => [this.root, this.liveRoot].some(root => mount.startsWith(root + '/')))) fail('FILE_VERSION_NESTED_MOUNT');
    };
    const inventory = async () => {
      await assertMounts();
      const files: Array<{ key: string; live: Identity }> = [], directories: string[] = [];
      let totalBytes = 0, metadataBytes = encoded(this.cutManifest(captureId, [])).length;
      const device = this.directories.get(this.liveRoot)!.device;
      const walk = async (directory: string, prefix: string) => {
        assertGate(); const before = await fs.lstat(directory, { bigint: true });
        if (!before.isDirectory() || before.uid !== BigInt(process.getuid!()) || (before.mode & 0o022n)
          || String(before.dev) !== device || await fs.realpath(directory) !== directory) fail('FILE_VERSION_LEGACY_INVENTORY_UNSAFE');
        directories.push(directory);
        if (directories.length > 10000) fail('FILE_VERSION_INVENTORY_CAPACITY');
        const children = (await fs.readdir(directory)).sort();
        // Future reservations count every parent prefix of retained keys.
        // An empty legacy directory has no such key and cannot be silently
        // omitted from that budget. Its explicit preparation belongs to the
        // controller; adoption never removes an existing directory.
        if (directory !== this.liveRoot && !children.length) fail('FILE_VERSION_LEGACY_EMPTY_DIRECTORY_UNSUPPORTED');
        for (const child of children) {
          const key = prefix + child, target = path.join(directory, child), value = await fs.lstat(target, { bigint: true });
          this.key(key);
          if (value.isDirectory()) await walk(target, key + '/');
          else {
            if (!value.isFile() || value.nlink !== 1n || value.uid !== BigInt(process.getuid!()) || (value.mode & 0o022n)
              || String(value.dev) !== device) fail('FILE_VERSION_LEGACY_INVENTORY_UNSAFE');
            if (value.size > 2n * 1024n ** 3n) fail('FILE_VERSION_INVENTORY_CAPACITY');
            totalBytes += Number(value.size); metadataBytes += encoded({ key, sha256: '0'.repeat(64) }).length;
            files.push({ key, live: identity(value) });
            if (files.length > 10000 || totalBytes > 32 * 1024 ** 3 || metadataBytes > 16 * 1024 * 1024) {
              fail('FILE_VERSION_INVENTORY_CAPACITY');
            }
          }
        }
        if (!same(identity(before), identity(await fs.lstat(directory, { bigint: true })))) fail('FILE_VERSION_LEGACY_SOURCE_CHANGED');
      };
      await walk(this.liveRoot, ''); await assertMounts();
      files.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
      return { files, directories, totalBytes };
    };
    const original = await inventory(), inventorySha256 = hash(encoded(original));
    const capacity = await fs.statfs(this.root, { bigint: true });
    if (capacity.bsize <= 0n || capacity.bsize > 1024n ** 2n) fail('FILE_VERSION_ADOPTION_CAPACITY_REQUIRED');
    const blocks = (bytes: bigint) => (bytes + capacity.bsize - 1n) / capacity.bsize * capacity.bsize;
    const metadataBudget = BigInt(original.files.length) * (2n * blocks(16384n) + blocks(8192n) + 4n * capacity.bsize)
      + 64n * 1024n ** 2n;
    if (capacity.ffree < BigInt(original.files.length) * 4n + 64n
      || capacity.bavail * capacity.bsize < BigInt(original.totalBytes) + metadataBudget + 1024n ** 3n) {
      fail('FILE_VERSION_ADOPTION_CAPACITY_REQUIRED');
    }
    assertGate(); await this.assertDirectories();
    const pending = path.join(this.root, 'pending', 'legacy-adoption.json');
    const held = await fs.open(pending, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o400);
    let heldIdentity: Identity;
    try {
      await held.writeFile(encoded({ format: 'sabalan-file-legacy-adoption-intent/v1', captureId, inventorySha256,
        source: this.cutManifest(captureId, []).source, gate: this.work.gateIdentity() }));
      await held.sync(); heldIdentity = identity(await held.stat({ bigint: true })); await syncDirectory(path.dirname(pending));
    } finally { await held.close(); }
    // The whole inventory was bounded once under EX. Do not rescan N existing
    // reservations for each of N legacy files while ordinary writers are fenced.
    for (const selected of original.files) {
      assertGate(); await this.assertDirectories();
      const { id, target } = this.key(selected.key), name = randomUUID(), objectPath = path.join(this.root, 'objects', name);
      const descriptor = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const digest = createHash('sha256'); let bytes = 0;
      try {
        if (!same(identity(await descriptor.stat({ bigint: true })), selected.live)) fail('FILE_VERSION_LEGACY_SOURCE_CHANGED');
        async function* chunks() {
          for (;;) {
            assertGate(); const buffer = Buffer.alloc(262144), { bytesRead } = await descriptor.read(buffer, 0, buffer.length, null);
            if (!bytesRead) break;
            bytes += bytesRead;
            if (bytes > Number(selected.live.bytes)) fail('FILE_VERSION_LEGACY_SOURCE_CHANGED');
            const chunk = buffer.subarray(0, bytesRead); digest.update(chunk); yield chunk;
          }
        }
        const copied = await publishDurableStream(objectPath, Readable.from(chunks(), { objectMode: false, highWaterMark: 262144 }));
        assertGate();
        if (copied.byteLength !== bytes || bytes !== Number(selected.live.bytes)
          || !same(identity(await descriptor.stat({ bigint: true })), selected.live)
          || !same(await this.current(target), selected.live)) fail('FILE_VERSION_LEGACY_SOURCE_CHANGED');
        await descriptor.sync();
      } finally { await descriptor.close(); }
      await fs.chmod(objectPath, 0o400); await syncExistingDurableFile(objectPath);
      const object = { name, bytes, sha256: digest.digest('hex') };
      for await (const _chunk of this.objectChunks(objectPath, object, assertGate)) { /* bounded independent read-back */ }
      const version: Version = { format: 'sabalan-file-version/v1', key: selected.key, generation: 1,
        previousSha256: null, operation: 'PUT', object, live: selected.live };
      const raw = encoded(version), sha256 = hash(raw); this.decode(raw);
      for (const [targetPath, content] of [
        [path.join(this.root, 'reservations', id + '.json'), encoded({ format: 'sabalan-file-key-reservation/v1', key: selected.key })],
        [path.join(this.root, 'versions', sha256 + '.json'), raw], [path.join(this.root, 'heads', id + '.json'), raw],
      ] as const) {
        assertGate(); await this.assertDirectories();
        await publishDurableFile(targetPath, content); await fs.chmod(targetPath, 0o400); await syncExistingDurableFile(targetPath);
        if (!(await readImmutable(targetPath, 16384)).equals(content)) fail('FILE_VERSION_RECORD_CHANGED');
      }
    }
    if (!same(original, await inventory())) fail('FILE_VERSION_LEGACY_SOURCE_CHANGED');
    for (const directory of original.directories) { assertGate(); await syncDirectory(directory); }
    await syncAncestors(this.liveRoot);
    const proof = encoded({ format: 'sabalan-file-legacy-adoption/v1', captureId, inventorySha256,
      files: original.files.length, bytes: original.totalBytes, source: this.cutManifest(captureId, []).source,
      gate: this.work.gateIdentity(), publicOnlineAdmission: false });
    const proofPath = path.join(this.root, 'legacy-adoption-' + captureId + '.json');
    assertGate(); await this.assertDirectories();
    await publishDurableFile(proofPath, proof); await fs.chmod(proofPath, 0o400); await syncExistingDurableFile(proofPath);
    if (!(await readImmutable(proofPath, 16384)).equals(proof)
      || !same(identity(await fs.lstat(pending, { bigint: true })), heldIdentity!)
      || !same(await fs.readdir(path.dirname(pending)), ['legacy-adoption.json'])) fail('FILE_VERSION_COMPLETION_UNPROVEN');
    assertGate(); await this.assertDirectories();
    await fs.unlink(pending); await syncDirectory(path.dirname(pending));
    return { sha256: hash(proof), files: original.files.length, bytes: original.totalBytes, publicOnlineAdmission: false };
  }

  /** Metadata-only private component cut. The caller must additionally prove
   * native fleet/SQL closure, coherent database/SQLite/privacy coverage and
   * dependency retention. This never publishes a healthy application point. */
  async seal(captureId: string, exclusiveGateFd: number) {
    if (typeof captureId !== 'string' || !shaPattern.test(captureId)) fail('FILE_VERSION_SELECTION_INVALID');
    const assertGate = this.exclusiveGate(exclusiveGateFd);
    assertGate(); await this.assertDirectories();
    if ((await fs.readdir(path.join(this.root, 'pending'))).length) fail('FILE_VERSION_PENDING_OPERATION');
    // Device equality alone does not detect same-device bind aliases.
    const mounts = (await fs.readFile('/proc/self/mountinfo', 'utf8')).trim().split('\n').map(line =>
      line.split(' ')[4].replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8))));
    if (mounts.some(mount => [this.root, this.liveRoot].some(root => mount.startsWith(root + '/')))) fail('FILE_VERSION_NESTED_MOUNT');
    const names = (await fs.readdir(path.join(this.root, 'heads'))).sort();
    if (names.length > 10000) fail('FILE_VERSION_INVENTORY_CAPACITY');
    const heads: Array<{ key: string; sha256: string }> = [], present = new Map<string, Identity>();
    for (const name of names) {
      assertGate();
      if (!/^[a-f0-9]{64}\.json$/.test(name)) fail('FILE_VERSION_HEAD_CHANGED');
      const raw = await readImmutable(path.join(this.root, 'heads', name), 16384), value = this.decode(raw);
      const sha256 = hash(raw), retained = await this.version(sha256);
      if (hash(value.key) + '.json' !== name || !retained.bytes.equals(raw)) fail('FILE_VERSION_HEAD_CHANGED');
      if (!await this.reservation(value.key)) fail('FILE_VERSION_RESERVATION_INVALID');
      const { target } = this.key(value.key);
      if (!same(await this.current(target), value.live)) fail('FILE_VERSION_UNTRACKED_LIVE_CHANGE');
      heads.push({ key: value.key, sha256 });
      if (value.operation === 'PUT') present.set(value.key, value.live!);
    }
    let observed = 0, directories = 0;
    const rootDevice = this.directories.get(this.liveRoot)!.device;
    const walk = async (directory: string, prefix: string) => {
      assertGate();
      if (++directories > 10000) fail('FILE_VERSION_INVENTORY_CAPACITY');
      const before = await fs.lstat(directory, { bigint: true });
      if (!before.isDirectory() || (before.mode & 0o022n) || String(before.dev) !== rootDevice) fail('FILE_VERSION_LIVE_UNSAFE');
      const children = await fs.readdir(directory);
      if (children.length > 10000) fail('FILE_VERSION_INVENTORY_CAPACITY');
      for (const child of children) {
        assertGate();
        const relative = prefix + child, target = path.join(directory, child), value = await fs.lstat(target, { bigint: true });
        if (child.startsWith('.sabalan-file-')) fail('FILE_VERSION_PENDING_OPERATION');
        if (value.isDirectory()) await walk(target, relative + '/');
        else if (!value.isFile() || value.nlink !== 1n || value.uid !== BigInt(process.getuid!())
          || !same(identity(value), present.get(relative) ?? null) || ++observed > 10000) fail('FILE_VERSION_UNTRACKED_LIVE_CHANGE');
      }
      if (!same(identity(before), identity(await fs.lstat(directory, { bigint: true })))) fail('FILE_VERSION_UNTRACKED_LIVE_CHANGE');
    };
    await walk(this.liveRoot, '');
    if (observed !== present.size || (await fs.readdir(path.join(this.root, 'pending'))).length) fail('FILE_VERSION_UNTRACKED_LIVE_CHANGE');
    assertGate(); await this.assertDirectories();
    heads.sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
    const manifest = this.cutManifest(captureId, heads);
    const bytes = encoded(manifest), destination = path.join(this.root, 'seals', captureId + '.json');
    if (bytes.length > 16 * 1024 * 1024) fail('FILE_VERSION_INVENTORY_CAPACITY');
    await publishDurableFile(destination, bytes);
    await fs.chmod(destination, 0o400); await syncExistingDurableFile(destination);
    if (!(await readImmutable(destination, bytes.length)).equals(bytes)) fail('FILE_VERSION_RECORD_CHANGED');
    assertGate(); await this.assertDirectories();
    return { sha256: hash(bytes), manifest };
  }
}
