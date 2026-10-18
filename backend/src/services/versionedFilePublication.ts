import { constants, promises as fs } from 'node:fs';
import * as nativeFs from 'node:fs';
import type { BigIntStats } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { RuntimeWorkContext } from './runtimeWorkContext';
import { publishDurableFile, removeDurableFile, syncExistingDurableFile } from './durableFilePublication';

type Identity = { device: string; inode: string; bytes: string; modified: string; changed: string };
type Version = { format: 'sabalan-file-version/v1'; key: string; generation: number; previousSha256: string | null;
  operation: 'PUT' | 'DELETE'; object: { name: string; sha256: string; bytes: number } | null; live: Identity | null };
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

  remove(key: string) { return this.change(key, null, true); }

  private change(key: string, bytes: Buffer | null, replace: boolean): Promise<string> {
    const { id, target } = this.key(key);
    return this.work.run(async () => {
      this.work.assertActive(); await this.assertDirectories();
      // Even an old QUIESCENT journal cannot settle an interrupted file intent.
      const pending = path.join(this.root, 'pending', id + '.json');
      const held = await fs.open(pending, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o400);
      let heldIdentity: Identity;
      try {
        await held.writeFile(encoded({ key, operationId: randomUUID(), operation: bytes === null ? 'DELETE' : 'PUT' }));
        await held.sync(); heldIdentity = identity(await held.stat({ bigint: true }));
        await syncDirectory(path.dirname(pending));
      } finally { await held.close(); }
      // Every exception from this point preserves the actual pending record.
      const previous = await this.head(key), actual = await this.current(target);
      if (!same(actual, previous?.value.live ?? null)) fail('FILE_VERSION_UNTRACKED_LIVE_CHANGE');
      const retireUnstarted = async () => {
        this.work.assertActive(); await this.assertDirectories();
        if ((await this.head(key))?.sha256 !== previous?.sha256 || !same(await this.current(target), actual)
          || !same(identity(await fs.lstat(pending, { bigint: true })), heldIdentity!)) fail('FILE_VERSION_COMPLETION_UNPROVEN');
        await fs.unlink(pending); await syncDirectory(path.dirname(pending));
      };
      const refusal = previous && previous.value.generation >= 10000 ? 'FILE_VERSION_HISTORY_CAPACITY'
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
        await publishDurableFile(objectPath, bytes);
        await fs.chmod(objectPath, 0o400); await syncExistingDurableFile(objectPath);
        if (!(await readImmutable(objectPath, bytes.length)).equals(bytes)) fail('FILE_VERSION_OBJECT_CHANGED');
        object = { name, bytes: bytes.length, sha256: hash(bytes) };
        this.work.assertActive(); await this.assertDirectories();
        await publishDurableFile(target, bytes, { replace });
        live = await this.current(target);
        if (!live || live.bytes !== String(bytes.length)) fail('FILE_VERSION_LIVE_CHANGED');
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
      await fs.unlink(pending); await syncDirectory(path.dirname(pending));
      return sha256;
    });
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

  /** Metadata-only private component cut. The caller must additionally prove
   * native fleet/SQL closure, coherent database/SQLite/privacy coverage and
   * dependency retention. This never publishes a healthy application point. */
  async seal(captureId: string, exclusiveGateFd: number) {
    if (typeof captureId !== 'string' || !shaPattern.test(captureId)) fail('FILE_VERSION_SELECTION_INVALID');
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
