import path from 'node:path';
import fs from 'node:fs/promises';
import { constants, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { RuntimeWorkBoundary } from './runtimeWorkBoundary';
import { runtimeHttpRequests } from './httpRequestLifecycle';
import { VersionedFilePublication, type VersionedFileRootScope } from './versionedFilePublication';
import { createDurableUpload, createVersionedDurableUpload, type DurableUpload } from './durableUpload';
import { removeDurableFile } from './durableFilePublication';

export const supportTicketStorageDirectory = () => path.resolve(process.env.SUPPORT_TICKET_STORAGE_DIR
  || path.join(process.cwd(), 'storage', 'support-tickets'));
type Owner = { boundary: RuntimeWorkBoundary; root: string; publication: VersionedFilePublication; files: VersionedFileRootScope };
let phase: 'UNBOUND' | 'CONFIGURING' | 'READY' | 'FAILED' = 'UNBOUND';
let observed = false, selected: Owner | undefined;

/** Private exact-root startup composition. No reset, baseline adoption or environment activation. */
export async function configurePrivateVersionedSupportFiles(input: {
  boundary: RuntimeWorkBoundary; publication: VersionedFilePublication;
}): Promise<void> {
  if (phase !== 'UNBOUND') throw Error('SUPPORT_FILE_RUNTIME_ALREADY_BOUND');
  if (observed) throw Error('SUPPORT_FILE_RUNTIME_ALREADY_OBSERVED');
  runtimeHttpRequests.assertBeforeFirstRequest();
  const root = supportTicketStorageDirectory();
  if (!(input?.boundary instanceof RuntimeWorkBoundary) || input.boundary.requests !== runtimeHttpRequests
    || !(input.publication instanceof VersionedFilePublication) || !input.publication.ownsRoot(root)
    || !input.publication.ownsWork(input.boundary.context)) throw Error('SUPPORT_FILE_RUNTIME_SCOPE_INVALID');
  phase = 'CONFIGURING';
  try {
    const files = await input.publication.bindRoot(root);
    runtimeHttpRequests.assertBeforeFirstRequest();
    if (observed || root !== supportTicketStorageDirectory()) throw Error('SUPPORT_FILE_RUNTIME_ROOT_CHANGED');
    selected = { ...input, root, files }; phase = 'READY';
  } catch (error) { phase = 'FAILED'; throw error; }
}
function owner(active = true) {
  observed = true;
  if (phase === 'CONFIGURING' || phase === 'FAILED') throw Error('SUPPORT_FILE_RUNTIME_NOT_READY');
  if (selected) {
    if (selected.root !== supportTicketStorageDirectory()) throw Error('SUPPORT_FILE_RUNTIME_ROOT_CHANGED');
    if (active) selected.boundary.context.assertActive();
  }
  return selected;
}
function storageKey(name: string) {
  if (!name || path.basename(name) !== name || name === '.' || name === '..' || name.includes('\\') || name.includes('/')) {
    throw Error('SUPPORT_FILE_RUNTIME_PATH_INVALID');
  }
  return name;
}
/** Called by route construction. Configured roots already exist and are pinned;
 * ordinary startup retains its existing mkdir behavior. */
export function prepareSupportTicketStorage() {
  const bound = owner(false), root = supportTicketStorageDirectory();
  if (!bound) mkdirSync(root, { recursive: true });
  return root;
}
export function createSupportDurableUpload(options: Parameters<typeof createDurableUpload>[0]): DurableUpload {
  let chosen: DurableUpload | undefined;
  const requests = new WeakMap<Request, DurableUpload>();
  const select = () => {
    const bound = owner();
    return chosen ||= bound ? createVersionedDurableUpload(options, bound.root, bound.publication) : createDurableUpload(options);
  };
  const wrap = (build: (upload: DurableUpload) => RequestHandler): RequestHandler => {
    let handler: RequestHandler | undefined;
    return (request, response, next) => {
      try { const upload = select(); requests.set(request, upload); handler ||= build(upload); return handler(request, response, next); }
      catch (error) { next(error); }
    };
  };
  const original = (request: Request) => {
    const value = requests.get(request); if (!value) throw Error('SUPPORT_UPLOAD_REQUEST_OWNER_UNPROVEN'); return value;
  };
  return { single: field => wrap(upload => upload.single(field)),
    array: (field, maximum) => wrap(upload => upload.array(field, maximum)),
    fields: fields => wrap(upload => upload.fields(fields)), none: () => wrap(upload => upload.none()),
    any: () => wrap(upload => upload.any()),
    retain: (request, file) => { if (file) original(request).retain(request, file); },
    discardUnreferenced: (request, file) => file ? original(request).discardUnreferenced(request, file) : Promise.resolve('ABSENT'),
  };
}
export async function assertSupportStoredArtifact(name: string, sha256: string, size: number) {
  const bound = owner(), key = storageKey(name), target = path.join(supportTicketStorageDirectory(), key);
  let bytes: Buffer;
  if (bound) {
    const read = await bound.files.readSettledDigest(key, 25 * 1024 * 1024);
    if (!read.head || read.head.operation !== 'PUT' || read.byteLength !== size || read.sha256 !== sha256) {
      throw Error('SUPPORT_STAGED_ARTIFACT_UNPROVEN');
    }
    return;
  } else {
    const handle = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await handle.stat(), named = await fs.lstat(target);
      if (!before.isFile() || !named.isFile() || before.ino !== named.ino || before.size > 25 * 1024 * 1024) throw Error('SUPPORT_STAGED_ARTIFACT_UNPROVEN');
      bytes = await handle.readFile();
      const after = await handle.stat(), current = await fs.lstat(target);
      if (after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs
        || current.ino !== before.ino || current.dev !== before.dev) throw Error('SUPPORT_STAGED_ARTIFACT_UNPROVEN');
    } finally { await handle.close(); }
  }
  if (bytes.length !== size || createHash('sha256').update(bytes).digest('hex') !== sha256) throw Error('SUPPORT_STAGED_ARTIFACT_UNPROVEN');
}
/** Live deletion only. Immutable content/deletion ancestry and independent backups remain recoverable. */
export async function removeSupportStoredFile(name: string): Promise<boolean> {
  const bound = owner(), key = storageKey(name);
  if (bound) await bound.files.remove(key);
  else await removeDurableFile(path.join(supportTicketStorageDirectory(), key));
  return true;
}
export const supportRetainedCopyState = () => owner() ? 'VERSIONED_COPIES_PENDING_INDEPENDENT_ERASURE' : 'INDEPENDENT_BACKUP_LIFECYCLE';

export function runOwnedSupportFileWork<T>(work: () => Promise<T>): Promise<T> {
  const bound = owner(false);
  return bound ? bound.boundary.runBackground(work) : Promise.resolve().then(work);
}

/** Genuine settled storage port for the original domain deletion actor. */
export function versionedSupportDeletionFiles(): VersionedFileRootScope | undefined { return owner()?.files; }
