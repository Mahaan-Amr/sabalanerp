import { constants, promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

type PublicationOptions = { replace?: boolean };
type PublicationResult = { byteLength: number; identity: { device: string; inode: string } };
const failure = (code: string) => Object.assign(new Error(code), { code });
const samePath = (left: string, right: string) => process.platform === 'win32'
  ? path.toNamespacedPath(left).toLowerCase() === path.toNamespacedPath(right).toLowerCase() : left === right;

async function syncDirectory(directory: string) {
  // Windows remains a supported developer environment, but it does not offer
  // the Linux directory-fsync contract through Node. Recovery/release evidence
  // must exercise this module on Linux, never infer it from Windows tests.
  if (process.platform === 'win32') return;
  const handle = await fs.open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function assertDirectory(directory: string) {
  if (!samePath(await fs.realpath(directory), directory)) throw failure('FILE_PUBLICATION_DIRECTORY_ALIAS');
  const value = await fs.lstat(directory);
  if (!value.isDirectory() || (process.platform === 'linux'
    && (value.uid !== process.getuid!() || (value.mode & 0o022) !== 0))) throw failure('FILE_PUBLICATION_DIRECTORY_UNSAFE');
}

async function prepareDirectory(directory: string) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await assertDirectory(directory);
  await syncAncestors(directory);
}

async function syncAncestors(directory: string) {
  if (process.platform === 'win32') return;
  const device = (await fs.lstat(directory)).dev;
  // Always sync the ancestry, even when mkdir reports "already exists": a
  // concurrent creator may not yet have persisted any of those new entries.
  // Stop at the existing filesystem/mount root; do not modify other filesystems.
  for (let current = directory; ; current = path.dirname(current)) {
    const value = await fs.lstat(current);
    if (value.dev !== device) break;
    if (!value.isDirectory() || ((value.mode & 0o022) !== 0 && (value.mode & 0o1000) === 0)) {
      throw failure('FILE_PUBLICATION_DIRECTORY_UNSAFE');
    }
    await syncDirectory(current);
    if (path.dirname(current) === current) break;
  }
}

/** One complete file becomes visible atomically. The prior inode is never
 * truncated, including while another reader or a future recovery version still
 * references it. This is local publication, NOT immutable version retention,
 * cross-file/database coherence, a privacy watermark or a checkpoint proof.
 * Callers retain their domain transaction/storage-key ownership. */
export async function publishDurableStream(target: string, source: Readable,
  options: PublicationOptions = {}): Promise<PublicationResult> {
  const replace = options.replace === true, directory = path.dirname(target);
  let temporary: string | undefined, handle: FileHandle | undefined;
  let identity: PublicationResult['identity'] | undefined;
  let published = false, byteLength = 0;
  const output = new Writable({
    construct(callback) {
      void (async () => {
        if (!path.isAbsolute(target) || path.resolve(target) !== target || path.basename(target).startsWith('.sabalan-file-')) {
          throw failure('FILE_PUBLICATION_TARGET_INVALID');
        }
        await prepareDirectory(directory);
        if (replace) {
          try { if (!(await fs.lstat(target)).isFile()) throw failure('FILE_PUBLICATION_TARGET_NOT_REGULAR'); }
          catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
        }
        const staged = path.join(directory, `.sabalan-file-${randomUUID()}.tmp`);
        handle = await fs.open(staged, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        temporary = staged; // Only this successfully created inode is ours to clean up.
      })().then(() => callback(), callback);
    },
    write(chunk: Buffer, _encoding, callback) {
      byteLength += chunk.length;
      // Backpressure owns each chunk until its actual native writes finish.
      void handle!.writeFile(chunk).then(() => callback(), callback);
    },
    final(callback) {
      void (async () => {
        await handle!.sync();
        const value = await handle!.stat({ bigint: true });
        identity = { device: value.dev.toString(), inode: value.ino.toString() };
      })().then(() => callback(), callback);
    },
    destroy(error, callback) {
      if (!handle) { callback(error); return; }
      void handle.close().then(() => callback(error), closeError => callback(error || closeError));
    },
  });
  try {
    // Observe source errors immediately, before asynchronous mkdir/open. Node
    // waits for _construct before _destroy, so early aborts cannot leak an FD.
    await pipeline(source, output);
    await assertDirectory(directory);
    if (replace) await fs.rename(temporary!, target);
    else await fs.link(temporary!, target); // atomic, no-clobber create; never follow a target symlink.
    published = true;
    await syncDirectory(directory);
    if (!replace) {
      await fs.unlink(temporary!);
      await syncDirectory(directory);
    }
    return { byteLength, identity: identity! };
  } catch (error) {
    if (published) {
      // The complete new file may already be durable. Never delete it, restore
      // older data, or silently replay after an uncertain acknowledgement.
      throw Object.assign(failure('FILE_PUBLICATION_COMPLETION_UNPROVEN'), { cause: error });
    }
    if (temporary) {
      await fs.unlink(temporary);
      await syncDirectory(directory);
    }
    throw error;
  }
}

export function publishDurableFile(target: string, bytes: Uint8Array, options: PublicationOptions = {}) {
  // Freeze caller-owned render buffers before the first asynchronous operation.
  const snapshot = Buffer.from(bytes);
  return publishDurableStream(target, Readable.from([snapshot]), { replace: options.replace === true });
}

/** Use only after the domain owner verified existing frozen bytes under its
 * storage-key/transaction lock. This does not authenticate their hash itself. */
export async function syncExistingDurableFile(target: string) {
  if (!path.isAbsolute(target) || path.resolve(target) !== target) throw failure('FILE_PUBLICATION_TARGET_INVALID');
  await assertDirectory(path.dirname(target));
  const handle = await fs.open(target, (process.platform === 'win32' ? constants.O_RDWR : constants.O_RDONLY)
    | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!(await handle.stat()).isFile()) throw failure('FILE_PUBLICATION_TARGET_NOT_REGULAR');
    await handle.sync();
  } finally { await handle.close(); }
  await syncAncestors(path.dirname(target));
}

export async function removeDurableFile(target: string): Promise<boolean> {
  if (!path.isAbsolute(target) || path.resolve(target) !== target) throw failure('FILE_PUBLICATION_TARGET_INVALID');
  try { await assertDirectory(path.dirname(target)); }
  catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
    let current = path.dirname(target);
    for (;;) {
      current = path.dirname(current);
      try { await assertDirectory(current); break; }
      catch (parentError: any) { if (parentError?.code !== 'ENOENT') throw parentError; }
    }
    await syncAncestors(current);
    return false;
  }
  try { await fs.unlink(target); }
  catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
    // A previous unlink may have lost its acknowledgement before directory
    // sync. Persist the observed absence before a deletion receipt can commit.
    await syncAncestors(path.dirname(target));
    return false;
  }
  await syncDirectory(path.dirname(target));
  return true;
}
