import path from 'node:path';
import { RuntimeWorkBoundary } from './runtimeWorkBoundary';
import { runtimeHttpRequests } from './httpRequestLifecycle';
import { VersionedFilePublication, type VersionedFileRootScope } from './versionedFilePublication';
import { publishDurableFile, removeDurableFile } from './durableFilePublication';

export const performanceExportStorageDirectory = () => path.resolve(process.env.PERSONNEL_PERFORMANCE_EXPORT_DIR
  || path.join(process.cwd(), 'storage', 'performance-exports'));
let phase: 'UNBOUND' | 'CONFIGURING' | 'READY' | 'FAILED' = 'UNBOUND';
let observed = false;
let owner: { boundary: RuntimeWorkBoundary; root: string; files: VersionedFileRootScope } | undefined;

/** Private startup composition, before any HTTP/job work; never replaces a live owner. */
export async function configurePrivateVersionedPerformanceFiles(input: {
  boundary: RuntimeWorkBoundary; publication: VersionedFilePublication;
}): Promise<void> {
  if (phase !== 'UNBOUND') throw Error('PERFORMANCE_FILE_RUNTIME_ALREADY_BOUND');
  if (observed) throw Error('PERFORMANCE_FILE_RUNTIME_ALREADY_OBSERVED');
  runtimeHttpRequests.assertBeforeFirstRequest();
  const root = performanceExportStorageDirectory();
  if (!(input?.boundary instanceof RuntimeWorkBoundary) || input.boundary.requests !== runtimeHttpRequests
    || !(input.publication instanceof VersionedFilePublication) || !input.publication.ownsRoot(root)
    || !input.publication.ownsWork(input.boundary.context)) throw Error('PERFORMANCE_FILE_RUNTIME_SCOPE_INVALID');
  phase = 'CONFIGURING';
  try {
    const files = await input.publication.bindRoot(root);
    runtimeHttpRequests.assertBeforeFirstRequest();
    if (observed || performanceExportStorageDirectory() !== root) throw Error('PERFORMANCE_FILE_RUNTIME_ROOT_CHANGED');
    owner = { boundary: input.boundary, root, files }; phase = 'READY';
  } catch (error) { phase = 'FAILED'; throw error; }
}

function runtime(requireActive = true) {
  observed = true;
  if (phase === 'CONFIGURING' || phase === 'FAILED') throw Error('PERFORMANCE_FILE_RUNTIME_NOT_READY');
  if (owner) {
    if (performanceExportStorageDirectory() !== owner.root) throw Error('PERFORMANCE_FILE_RUNTIME_ROOT_CHANGED');
    if (requireActive) owner.boundary.context.assertActive();
  }
  return owner;
}
function key(root: string, target: string) {
  const relative = path.relative(root, target);
  if (!path.isAbsolute(target) || path.resolve(target) !== target || !relative || relative.startsWith('..')
    || path.isAbsolute(relative)) throw Error('PERFORMANCE_FILE_RUNTIME_PATH_INVALID');
  return relative.split(path.sep).join('/');
}

/** Register synchronously inside the actual source request/job; its original
 * lease waits for the full descendant promise even after the response ends. */
export function runOwnedPerformanceExport<T>(work: () => Promise<T>): Promise<T> {
  const bound = runtime();
  return bound ? bound.boundary.context.run(work) : Promise.resolve().then(work);
}
/** Periodic maintenance requires the actual native jobs owner before SQL. */
export function runOwnedPerformanceMaintenance<T>(work: () => Promise<T>): Promise<T> {
  const bound = runtime(false);
  return bound ? bound.boundary.runBackground(work) : Promise.resolve().then(work);
}
export function versionedPerformanceDeletionFiles() { return runtime()?.files; }
export function performanceExportFileKey(target: string) { return key(performanceExportStorageDirectory(), target); }
export async function publishPerformanceExportFile(target: string, ciphertext: Buffer) {
  const bound = runtime();
  if (bound) await bound.files.publish(key(bound.root, target), ciphertext, { replace: true });
  else await publishDurableFile(target, ciphertext, { replace: true });
}
export async function removePerformanceExportFile(target: string) {
  const bound = runtime();
  if (bound) await bound.files.remove(key(bound.root, target));
  else await removeDurableFile(target);
}
/** Retained ciphertext is recoverable. Existing manual absence evidence cannot
 * certify a newly enrolled version store; graph erasure stays restricted until
 * that independent copy is reconciled. Expiry records live deletion separately. */
export function assertPerformanceExportGraphErasureSupported() {
  if (runtime()) throw Object.assign(Error('PERFORMANCE_EXPORT_RETAINED_COPY_REVIEW_REQUIRED'), {
    code: 'PERFORMANCE_EXPORT_RETAINED_COPY_REVIEW_REQUIRED', status: 409,
  });
}
