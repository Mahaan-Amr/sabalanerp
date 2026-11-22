import path from 'node:path';
import { RuntimeWorkBoundary } from './runtimeWorkBoundary';
import { runtimeHttpRequests } from './httpRequestLifecycle';
import { VersionedFilePublication, type VersionedFileRootScope } from './versionedFilePublication';

export const DISPATCH_DOCUMENT_STORAGE_ROOT = path.resolve(process.cwd(), 'storage', 'dispatch-documents');
let phase: 'UNBOUND' | 'CONFIGURING' | 'READY' | 'FAILED' = 'UNBOUND';
let observed = false;
let files: VersionedFileRootScope | undefined;

/** Private startup composition, before importing the Accounting router. The
 * actual installed Dispatch service and adjustment preparer share this owner.
 * This does not admit production or enroll the separate recovery filesystem. */
export async function configurePrivateVersionedDispatchFiles(input: {
  boundary: RuntimeWorkBoundary; publication: VersionedFilePublication;
}): Promise<void> {
  if (phase !== 'UNBOUND') throw Error('DISPATCH_FILE_RUNTIME_ALREADY_BOUND');
  if (observed) throw Error('DISPATCH_FILE_RUNTIME_ALREADY_OBSERVED');
  runtimeHttpRequests.assertBeforeFirstRequest();
  if (!(input?.boundary instanceof RuntimeWorkBoundary) || input.boundary.requests !== runtimeHttpRequests
    || !(input.publication instanceof VersionedFilePublication)
    || !input.publication.ownsRoot(DISPATCH_DOCUMENT_STORAGE_ROOT)
    || !input.publication.ownsWork(input.boundary.context)) throw Error('DISPATCH_FILE_RUNTIME_SCOPE_INVALID');
  phase = 'CONFIGURING';
  try {
    const bound = await input.publication.bindRoot(DISPATCH_DOCUMENT_STORAGE_ROOT);
    runtimeHttpRequests.assertBeforeFirstRequest();
    if (observed) throw Error('DISPATCH_FILE_RUNTIME_ALREADY_OBSERVED');
    files = bound;
    phase = 'READY';
  } catch (error) {
    phase = 'FAILED';
    throw error;
  }
}

export function versionedDispatchDocumentFiles(): VersionedFileRootScope | undefined {
  observed = true;
  if (phase === 'CONFIGURING' || phase === 'FAILED') throw Error('DISPATCH_FILE_RUNTIME_NOT_READY');
  return files;
}
