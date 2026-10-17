import fs from 'node:fs/promises';
import {constants, fstatSync, lstatSync, readFileSync, realpathSync} from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {browserRoutingIdentity, compileBrowserRoutingRegistry} from './browser-release-routing.mjs';

const fail = code => { throw Object.assign(new Error(code), {code}); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const encode = value => Buffer.from(JSON.stringify(canonical(value)) + '\n');
const exact = (value, keys) => value && !Array.isArray(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const MAXIMUM_RECORD_BYTES = 4 * 1024 * 1024;
const MAXIMUM_HISTORY_BYTES = 64 * 1024 * 1024;
const filename = generation => `published-${String(generation).padStart(8, '0')}.json`;

/** The writer retains the same already-locked native open file description.
 * Merely opening the named file, a live PID, or a lease timestamp is insufficient.
 */
export class BrowserRoutingPublicationLock {
  #file; #descriptor; #identity;
  constructor({file, descriptor, identity}) {
    if (process.platform !== 'linux' || typeof file !== 'string' || !path.isAbsolute(file)
      || !Number.isSafeInteger(descriptor) || descriptor < 3 || descriptor > 1024
      || !exact(identity, ['device', 'inode', 'ownerUid']) || !/^[1-9][0-9]{0,24}$/.test(identity.device)
      || !/^[1-9][0-9]{0,24}$/.test(identity.inode) || identity.ownerUid !== process.getuid()) {
      fail('BROWSER_ROUTING_NATIVE_LOCK_REQUIRED');
    }
    this.#file = file; this.#descriptor = descriptor; this.#identity = Object.freeze({...identity});
    this.assertOwned();
  }
  assertOwned() {
    const named = lstatSync(this.#file, {bigint: true}), inherited = fstatSync(this.#descriptor, {bigint: true});
    const matches = value => value.isFile() && value.dev.toString() === this.#identity.device
      && value.ino.toString() === this.#identity.inode && value.uid === BigInt(this.#identity.ownerUid)
      && value.nlink === 1n && value.size === 0n && (value.mode & 0o077n) === 0n;
    const parent = lstatSync(path.dirname(this.#file), {bigint: true});
    if (realpathSync(this.#file) !== this.#file || !matches(named) || !matches(inherited)
      || !parent.isDirectory() || parent.uid !== BigInt(this.#identity.ownerUid) || (parent.mode & 0o077n) !== 0n) {
      fail('BROWSER_ROUTING_NATIVE_LOCK_CHANGED');
    }
    const info = readFileSync(`/proc/self/fdinfo/${this.#descriptor}`, 'utf8');
    const locked = [...info.matchAll(/^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+\S+\s+[0-9a-f]+:[0-9a-f]+:(\d+)\s+0\s+EOF\s*$/gm)];
    if (!locked.some(value => value[1] === this.#identity.inode)) fail('BROWSER_ROUTING_NATIVE_LOCK_UNPROVEN');
  }
}

/** Append-only routing publication, NOT release admission. The owned release
 * controller must establish recovery, compatibility and exact live slot proof
 * before invoking publish, and retain its exclusive native publication lock
 * through the supplied ownership checks. There is no CLI or public writer.
 *
 * Readers derive the head from contiguous immutable publications, rather than
 * a mutable current pointer that could silently regress after proxy restart.
 * A retirement cannot remove a build or shorten its browser support window.
 * Retention of stopped/expired builds needs a separate proven retirement path;
 * this store deliberately does not delete history, images or old browser work.
 */
export class BrowserRoutingStore {
  #directory;
  #assertOwner;
  #root;
  #busy = false;
  #maximumObserved = 0;

  constructor({directory, publicationLock, assertReleaseOwnership}) {
    if (process.platform !== 'linux' || typeof directory !== 'string' || !path.isAbsolute(directory) || path.resolve(directory) !== directory
      || ((publicationLock !== undefined || assertReleaseOwnership !== undefined)
        && (!(publicationLock instanceof BrowserRoutingPublicationLock) || typeof assertReleaseOwnership !== 'function'))) {
      fail('BROWSER_ROUTING_STORE_CONFIGURATION_INVALID');
    }
    this.#directory = directory;
    this.#assertOwner = async () => {
      if (!publicationLock) fail('BROWSER_ROUTING_READ_ONLY');
      publicationLock.assertOwned(); await assertReleaseOwnership(); publicationLock.assertOwned();
    };
  }

  async #assertRoot() {
    const value = await fs.lstat(this.#directory, {bigint: true});
    if (!value.isDirectory() || await fs.realpath(this.#directory) !== this.#directory
      || value.uid !== BigInt(process.getuid()) || (value.mode & 0o077n) !== 0n
      || (this.#root && (value.dev !== this.#root.dev || value.ino !== this.#root.ino))) fail('BROWSER_ROUTING_STORE_ROOT_UNPROVEN');
    this.#root ??= {dev: value.dev, ino: value.ino};
  }

  async #syncDirectory(directory = this.#directory) {
    const file = await fs.open(directory, 'r');
    try {await file.sync();} finally {await file.close();}
  }

  async #read(file) {
    await this.#assertRoot();
    const handle = await fs.open(path.join(this.#directory, file), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await handle.stat({bigint: true});
      if (!before.isFile() || before.nlink !== 1n || before.size < 1n || before.size > BigInt(MAXIMUM_RECORD_BYTES)
        || before.uid !== BigInt(process.getuid()) || (before.mode & 0o077n) !== 0n) {
        fail('BROWSER_ROUTING_PUBLICATION_UNSAFE');
      }
      const bytes = await handle.readFile();
      const after = await handle.stat({bigint: true}), named = await fs.lstat(path.join(this.#directory, file), {bigint: true});
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
        || before.dev !== named.dev || before.ino !== named.ino || after.nlink !== 1n) fail('BROWSER_ROUTING_PUBLICATION_CHANGED');
      let record;
      try {record = JSON.parse(bytes);} catch {fail('BROWSER_ROUTING_PUBLICATION_INVALID');}
      if (!bytes.equals(encode(record))) fail('BROWSER_ROUTING_PUBLICATION_INVALID');
      // A concurrent reader can see an atomic rename before the publisher's
      // directory fsync. Make the observed publication durable before routing.
      await handle.sync();
      await this.#syncDirectory(); await this.#assertRoot();
      return {record, bytes, sha256: sha(bytes)};
    } finally {await handle.close();}
  }

  async #head() {
    await this.#assertRoot();
    const entries = await fs.readdir(this.#directory);
    if (entries.length > 8192 || entries.some(name => !/^published-\d{8}\.json$/.test(name)
      && !/^\.prepared-[a-f0-9-]{36}\.json$/.test(name))) fail('BROWSER_ROUTING_INVENTORY_UNPROVEN');
    const published = entries.filter(name => name.startsWith('published-')).sort();
    if (published.length < this.#maximumObserved) fail('BROWSER_ROUTING_HISTORY_REGRESSED');
    let prior = null, total = 0;
    const supportPromises = new Map();
    for (let index = 0; index < published.length; index++) {
      if (published[index] !== filename(index + 1)) fail('BROWSER_ROUTING_HISTORY_GAP');
      const current = await this.#read(published[index]); total += current.bytes.length;
      if (total > MAXIMUM_HISTORY_BYTES) fail('BROWSER_ROUTING_HISTORY_CAPACITY');
      const {record} = current;
      if (!exact(record, ['format', 'generation', 'previousPublicationSha256', 'registryIdentity', 'registry'])
        || record.format !== 'sabalan-browser-publication/v1' || record.generation !== index + 1
        || record.registry?.generation !== index + 1 || record.previousPublicationSha256 !== (prior?.sha256 ?? null)
        || record.registryIdentity !== browserRoutingIdentity(record.registry)) fail('BROWSER_ROUTING_HISTORY_INVALID');
      assertTransition(prior?.record.registry, record.registry, supportPromises);
      prior = current;
    }
    this.#maximumObserved = Math.max(this.#maximumObserved, published.length);
    return {head: prior, total, supportPromises, prepared: entries.filter(name => name.startsWith('.prepared-'))};
  }

  async read() {
    return (await this.readPublication()).registry;
  }

  async readPublication() {
    const {head} = await this.#head();
    if (!head) fail('BROWSER_ROUTING_NOT_PUBLISHED');
    return {generation: head.record.generation, publicationSha256: head.sha256,
      registryIdentity: head.record.registryIdentity, registry: structuredClone(head.record.registry)};
  }

  async publish(registry, expectedPublicationSha256) {
    if (this.#busy) fail('BROWSER_ROUTING_PUBLICATION_BUSY');
    this.#busy = true;
    try {
      // Freeze caller-owned objects before any await.
      registry = structuredClone(registry);
      await this.#assertOwner();
      compileBrowserRoutingRegistry(registry);
      const {head, total, prepared, supportPromises} = await this.#head();
      if (prepared.length) fail('BROWSER_ROUTING_PREPARED_OPERATION_REQUIRES_INSPECTION');
      // A temporary intent consumes one entry before its atomic rename. Refuse
      // before creating it so exhausted publication capacity leaves reads live.
      if ((head?.record.generation ?? 0) >= 8192) fail('BROWSER_ROUTING_INVENTORY_CAPACITY');
      if ((head?.sha256 ?? null) !== expectedPublicationSha256) fail('BROWSER_ROUTING_PREDECESSOR_CHANGED');
      if (registry.generation !== (head?.record.generation ?? 0) + 1) fail('BROWSER_ROUTING_GENERATION_INVALID');
      assertTransition(head?.record.registry, registry, supportPromises);
      const record = {format: 'sabalan-browser-publication/v1', generation: registry.generation,
        previousPublicationSha256: expectedPublicationSha256, registryIdentity: browserRoutingIdentity(registry), registry};
      const bytes = encode(record);
      if (bytes.length > MAXIMUM_RECORD_BYTES || total + bytes.length > MAXIMUM_HISTORY_BYTES) fail('BROWSER_ROUTING_HISTORY_CAPACITY');
      await this.#assertOwner();
      for (let directory = this.#directory;; directory = path.dirname(directory)) {
        await this.#syncDirectory(directory); if (directory === path.dirname(directory)) break;
      }
      const temporary = `.prepared-${randomUUID()}.json`;
      const handle = await fs.open(path.join(this.#directory, temporary), 'wx', 0o600);
      try {await handle.writeFile(bytes); await handle.sync();} finally {await handle.close();}
      await this.#syncDirectory();
      const candidate = await this.#read(temporary);
      if (!candidate.bytes.equals(bytes)) fail('BROWSER_ROUTING_PREPARED_OPERATION_CHANGED');
      await this.#assertOwner(); await this.#assertRoot();
      const fresh = await this.#head();
      if ((fresh.head?.sha256 ?? null) !== expectedPublicationSha256 || fresh.prepared.length !== 1
        || fresh.prepared[0] !== temporary) fail('BROWSER_ROUTING_PREDECESSOR_CHANGED');
      const target = path.join(this.#directory, filename(registry.generation));
      try {await fs.lstat(target); fail('BROWSER_ROUTING_GENERATION_REUSED');}
      catch (error) {if (error.code !== 'ENOENT') throw error;}
      // The controller's exclusive native lock prevents another legitimate
      // writer between the last predecessor check and the atomic publication.
      await this.#assertOwner();
      await fs.rename(path.join(this.#directory, temporary), target);
      await this.#syncDirectory(); await this.#assertRoot(); await this.#assertOwner();
      const published = await this.#head();
      if (published.head?.sha256 !== candidate.sha256) fail('BROWSER_ROUTING_PUBLISHED_OPERATION_CHANGED');
      return {generation: registry.generation, publicationSha256: candidate.sha256, registryIdentity: record.registryIdentity};
    } finally {this.#busy = false;}
  }
}

function assertTransition(previous, next, supportPromises) {
  compileBrowserRoutingRegistry(next);
  for (const build of next.builds) {
    if (build.supportUntil !== null && Date.parse(build.supportUntil) < (supportPromises.get(build.id) ?? -Infinity)) {
      fail('BROWSER_ROUTING_HISTORICAL_SUPPORT_SHORTENED');
    }
  }
  if (!previous) {
    for (const build of next.builds) if (build.supportUntil !== null) supportPromises.set(build.id, Date.parse(build.supportUntil));
    return;
  }
  const before = new Map(previous.builds.map(build => [build.id, build]));
  const after = new Map(next.builds.map(build => [build.id, build]));
  for (const [id, old] of before) {
    const current = after.get(id);
    if (!current) fail('BROWSER_ROUTING_SUPPORTED_BUILD_REMOVED');
    const fixed = ({retiredAt, supportUntil, ...immutable}) => immutable;
    if (!encode(fixed(current)).equals(encode(fixed(old)))) fail('BROWSER_ROUTING_BUILD_IDENTITY_CHANGED');
    if (old.retiredAt !== null && current.retiredAt !== null
      && (current.retiredAt !== old.retiredAt || Date.parse(current.supportUntil) < Date.parse(old.supportUntil))) {
      fail('BROWSER_ROUTING_SUPPORT_WINDOW_SHORTENED');
    }
    if (old.retiredAt !== null && current.retiredAt === null && next.current[old.application] !== id) {
      fail('BROWSER_ROUTING_RETIREMENT_RESET');
    }
    if (previous.current[old.application] === id && next.current[old.application] !== id && current.retiredAt === null) {
      fail('BROWSER_ROUTING_RETIREMENT_REQUIRED');
    }
  }
  for (const application of ['erp', 'inquiry']) {
    // Uninstrumented pre-bootstrap tabs retain one immutable ambiguity owner.
    if (next.legacy[application] !== previous.legacy[application]) fail('BROWSER_ROUTING_LEGACY_OWNER_CHANGED');
  }
  for (const build of next.builds) if (build.supportUntil !== null) supportPromises.set(build.id, Date.parse(build.supportUntil));
}
