import multer from 'multer';
import type { Request, RequestHandler } from 'express';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { publishDurableStream, removeDurableFile } from './durableFilePublication';
import { runtimeHttpRequests, type HttpRequestLifecycle } from './httpRequestLifecycle';
import { VersionedFilePublication } from './versionedFilePublication';

type OwnedFile = { path: string; device: bigint; inode: bigint; versionSha256?: string; removal?: Promise<void> };
type UploadWork = { accepting: boolean; error?: Error; tasks: Set<Promise<unknown>>;
  guards: Set<Transform>; files: Map<string, OwnedFile> };
type Options = Omit<multer.Options, 'storage' | 'dest'> & { storage: multer.DiskStorageOptions };
const aborted = () => Object.assign(new Error('FILE_UPLOAD_ABORTED'), { code: 'FILE_UPLOAD_ABORTED' });

function invoke<T>(execute: (callback: (error: Error | null, value: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    try { execute((error, value) => error ? reject(error) : resolve(value)); }
    catch (error) { reject(error); }
  });
}

/** Multer's response/error callback is not actual filesystem completion. Own
 * the entire multipart phase through source abort, durable file completion and
 * all cleanup before handing any file to a business handler. Domain filters,
 * limits, field names and storage names remain owned by the calling route.
 * No business write is replayed and a colliding file is never overwritten. */
export function createDurableUpload(options: Options,
  requests: Pick<HttpRequestLifecycle, 'trackWork'> = runtimeHttpRequests): multer.Multer {
  return createUpload(options, requests);
}

/** Explicit admitted composition only. Ordinary routes retain their existing
 * storage until the controller proves complete protected-root coverage. */
export function createVersionedDurableUpload(options: Options, root: string, versions: VersionedFilePublication,
  requests: Pick<HttpRequestLifecycle, 'trackWork'> = runtimeHttpRequests): multer.Multer {
  if (!(versions instanceof VersionedFilePublication) || !versions.ownsRoot(root)) throw new Error('FILE_VERSION_STORAGE_ROOT_MISMATCH');
  return createUpload(options, requests, { root: path.resolve(root), owner: versions });
}

function createUpload(options: Options, requests: Pick<HttpRequestLifecycle, 'trackWork'>,
  versions?: { root: string; owner: VersionedFilePublication }): multer.Multer {
  const key = (target: string) => {
    const relative = path.relative(versions!.root, target);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      throw new Error('FILE_VERSION_STORAGE_ROOT_MISMATCH');
    }
    return relative.split(path.sep).join('/');
  };
  const { storage, ...uploadOptions } = options;
  if ((!storage || !['string', 'function'].includes(typeof storage.destination)) || typeof storage.filename !== 'function') {
    throw new Error('FILE_UPLOAD_STORAGE_CONFIGURATION_REQUIRED');
  }
  const states = new WeakMap<Request, UploadWork>();
  const own = <T>(state: UploadWork, work: () => Promise<T>) => {
    const task = Promise.resolve().then(work); state.tasks.add(task);
    void task.then(() => state.tasks.delete(task), () => state.tasks.delete(task));
    return task;
  };
  const discard = (state: UploadWork, file: OwnedFile) => {
    if (!file.removal) file.removal = (async () => {
      const named = await fs.lstat(file.path, { bigint: true });
      if (!named.isFile()) throw new Error('FILE_UPLOAD_CLEANUP_IDENTITY_UNPROVEN');
      const handle = await fs.open(file.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        // Compare the actual opened file, not a lossy path-stat device value
        // (Windows lstat reports dev=0). Both platforms retain the full volume
        // and inode identity captured from our private publication descriptor.
        const current = await handle.stat({ bigint: true });
        if (!current.isFile() || current.dev !== file.device || current.ino !== file.inode || named.ino !== current.ino) {
          throw new Error('FILE_UPLOAD_CLEANUP_IDENTITY_UNPROVEN');
        }
      } finally { await handle.close(); }
      if (versions) {
        if (!file.versionSha256) throw new Error('FILE_VERSION_RECEIPT_INVALID');
        await versions.owner.removeUpload(key(file.path), file.versionSha256);
      } else await removeDurableFile(file.path);
      state.files.delete(file.path);
    })();
    return file.removal;
  };
  const engine: multer.StorageEngine = {
    _handleFile(request, file, callback) {
      const state = states.get(request);
      if (!state?.accepting) { callback(aborted()); return; }
      const guard = new Transform({ transform(chunk, _encoding, done) { done(null, chunk); } });
      state.guards.add(guard);
      const fail = (error: Error) => { state.error ||= error; guard.destroy(error); };
      // A limit invalidates the private stage before atomic publication. Do not
      // destroy Multer's original stream: its own pending counter also observes
      // errors, and can report completion earlier than the storage callback.
      const limit = () => fail(new multer.MulterError('LIMIT_FILE_SIZE', file.fieldname));
      const closed = () => { if (!file.stream.readableEnded) fail(aborted()); };
      guard.on('error', (error: Error) => { state.error ||= error; });
      file.stream.on('error', fail); file.stream.once('limit', limit); file.stream.once('close', closed);
      file.stream.pipe(guard);
      const task = own(state, async () => {
        try {
          const destination = typeof storage.destination === 'string' ? storage.destination
            : await invoke<string>(done => (storage.destination as Function)(request, file, done));
          const filename = await invoke<string>(done => storage.filename!(request, file, done));
          if (state.error || request.aborted) throw state.error || aborted();
          if (typeof destination !== 'string' || typeof filename !== 'string' || !filename
            || filename === '.' || filename === '..' || path.basename(filename) !== filename) throw new Error('FILE_UPLOAD_STORAGE_NAME_INVALID');
          const directory = path.resolve(destination), target = path.resolve(directory, filename);
          if (path.dirname(target) !== directory) throw new Error('FILE_UPLOAD_STORAGE_NAME_INVALID');
          let versionSha256: string | undefined;
          const result = versions ? await versions.owner.publishUpload(key(target), guard) : await publishDurableStream(target, guard);
          if ('versionSha256' in result && typeof result.versionSha256 === 'string') versionSha256 = result.versionSha256;
          state.files.set(target, { path: target, device: BigInt(result.identity.device), inode: BigInt(result.identity.inode),
            versionSha256 });
          return { destination, filename, path: target, size: result.byteLength };
        } catch (error) { state.error ||= error as Error; throw error; }
        finally {
          file.stream.unpipe(guard); guard.destroy(); state.guards.delete(guard);
          file.stream.removeListener('error', fail); file.stream.removeListener('limit', limit); file.stream.removeListener('close', closed);
        }
      });
      void task.then(info => callback(null, info), error => callback(error)).catch(error => request.destroy(error));
    },
    _removeFile(request, file, callback) {
      const state = states.get(request), owned = state?.files.get(file.path);
      if (!state || !owned) { callback(null); return; }
      void own(state, () => discard(state, owned)).then(() => callback(null), error => callback(error))
        .catch(error => request.destroy(error));
    },
  };
  const upload = multer({ ...uploadOptions, storage: engine });
  const wrap = (middleware: RequestHandler): RequestHandler => (request, response, next) => {
    if (states.has(request)) return next(new Error('FILE_UPLOAD_SCOPE_ALREADY_ACTIVE'));
    const state: UploadWork = { accepting: true, tasks: new Set(), guards: new Set(), files: new Map() };
    let onAbort: () => void = () => {};
    let callbackStarted = false;
    const multipart = () => new Promise<void>((resolve, reject) => {
      states.set(request, state);
      let finishing = false;
      const finish = (error?: any) => {
        if (error) state.error ||= error;
        if (finishing) return;
        finishing = true; state.accepting = false;
        void (async () => {
          while (state.tasks.size) await Promise.allSettled([...state.tasks]);
          if (!state.error && !request.aborted) return;
          const uploadError = state.error || aborted();
          const failures: unknown[] = [];
          for (const file of state.files.values()) {
            try { await discard(state, file); } catch (cleanupError) { failures.push(cleanupError); }
          }
          if (failures.length) (uploadError as any).storageErrors = [...((uploadError as any).storageErrors || []), ...failures];
          throw uploadError;
        })().then(resolve, reject);
      };
      onAbort = () => {
        const error = aborted(); state.error ||= error;
        for (const guard of state.guards) guard.destroy(error);
        finish(error);
      };
      request.once('aborted', onAbort);
      if (request.aborted) { onAbort(); return; }
      try { middleware(request, response, finish); } catch (error) { finish(error); }
    });
    return requests.trackWork(request, async () => {
      let uploadError: unknown;
      try { await multipart(); } catch (error) { uploadError = error; }
      callbackStarted = true;
      // Some routes call upload.single(req,res,async callback) and ignore its
      // return value. That callback's actual promise still owns completion,
      // including after an early response or client loss. Never invoke it twice.
      await next(uploadError);
    }).catch(error => {
      if (!callbackStarted) return next(error);
      console.error('Upload completion callback failed', { code: 'FILE_UPLOAD_CALLBACK_FAILED' });
      request.destroy();
    }).finally(() => {
      request.removeListener('aborted', onAbort); states.delete(request);
    });
  };
  for (const method of ['single', 'array', 'fields', 'any', 'none'] as const) {
    const original = upload[method].bind(upload) as (...args: any[]) => RequestHandler;
    (upload as any)[method] = (...args: any[]) => wrap(original(...args));
  }
  return upload;
}
