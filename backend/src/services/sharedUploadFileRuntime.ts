import path from 'node:path';
import type { Request, RequestHandler } from 'express';
import { RuntimeWorkBoundary } from './runtimeWorkBoundary';
import { runtimeHttpRequests } from './httpRequestLifecycle';
import { VersionedFilePublication } from './versionedFilePublication';
import { createDurableUpload, createVersionedDurableUpload, type DurableUpload } from './durableUpload';

export const SHARED_UPLOAD_ROOTS = Object.freeze(['images', 'security-shift-log', 'security-vehicle-pairs']
  .map(name => path.resolve(process.cwd(), 'uploads', name)).sort());
type Root = Readonly<{ root: string; publication: VersionedFilePublication }>;
let phase: 'UNBOUND' | 'CONFIGURING' | 'READY' | 'FAILED' = 'UNBOUND';
let observed = false;
let roots: readonly Root[] = [];

/** Private startup composition. No environment switch or reset can activate
 * this registry. All owners must share the original global HTTP admission. */
export async function configurePrivateVersionedSharedUploads(input: {
  boundary: RuntimeWorkBoundary; roots: readonly Root[];
}): Promise<void> {
  if (phase !== 'UNBOUND') throw Error('SHARED_UPLOAD_RUNTIME_ALREADY_BOUND');
  if (observed) throw Error('SHARED_UPLOAD_RUNTIME_ALREADY_OBSERVED');
  runtimeHttpRequests.assertBeforeFirstRequest();
  if (!(input?.boundary instanceof RuntimeWorkBoundary) || input.boundary.requests !== runtimeHttpRequests
    || !Array.isArray(input.roots)) throw Error('SHARED_UPLOAD_RUNTIME_SCOPE_INVALID');
  const selected = input.roots.map(scope => {
    if (!scope || !SHARED_UPLOAD_ROOTS.includes(scope.root) || !(scope.publication instanceof VersionedFilePublication)
      || !scope.publication.ownsRoot(scope.root) || !scope.publication.ownsWork(input.boundary.context)) {
      throw Error('SHARED_UPLOAD_RUNTIME_SCOPE_INVALID');
    }
    return Object.freeze({ root: scope.root, publication: scope.publication });
  });
  if (JSON.stringify(selected.map(scope => scope.root).sort()) !== JSON.stringify(SHARED_UPLOAD_ROOTS)) {
    throw Error('SHARED_UPLOAD_RUNTIME_ROOT_SET_INCOMPLETE');
  }
  phase = 'CONFIGURING';
  try {
    // Existing pinned identities only: no mkdir, adoption or replacement.
    for (const scope of selected) await scope.publication.bindRoot(scope.root);
    runtimeHttpRequests.assertBeforeFirstRequest();
    if (observed) throw Error('SHARED_UPLOAD_RUNTIME_ALREADY_OBSERVED');
    roots = Object.freeze(selected); phase = 'READY';
  } catch (error) { phase = 'FAILED'; throw error; }
}

export function createSharedDurableUpload(root: string, options: Parameters<typeof createDurableUpload>[0]): DurableUpload {
  if (!SHARED_UPLOAD_ROOTS.includes(root)) throw Error('SHARED_UPLOAD_ROOT_INVALID');
  let selected: DurableUpload | undefined;
  const requests = new WeakMap<Request, DurableUpload>();
  const owner = () => {
    observed = true;
    if (phase === 'CONFIGURING' || phase === 'FAILED') throw Error('SHARED_UPLOAD_RUNTIME_NOT_READY');
    if (!selected) {
      const scope = roots.find(value => value.root === root);
      selected = scope ? createVersionedDurableUpload(options, root, scope.publication) : createDurableUpload(options);
    }
    return selected;
  };
  const wrap = (build: (upload: DurableUpload) => RequestHandler): RequestHandler => {
    let handler: RequestHandler | undefined;
    return (request, response, next) => {
      try {
        const upload = owner(); requests.set(request, upload); handler ||= build(upload);
        return handler(request, response, next);
      } catch (error) { next(error); }
    };
  };
  const original = (request: Request) => {
    const upload = requests.get(request);
    if (!upload) throw Error('SHARED_UPLOAD_REQUEST_OWNER_UNPROVEN');
    return upload;
  };
  return {
    single: field => wrap(upload => upload.single(field)),
    array: (field, maximum) => wrap(upload => upload.array(field, maximum)),
    fields: fields => wrap(upload => upload.fields(fields)),
    none: () => wrap(upload => upload.none()), any: () => wrap(upload => upload.any()),
    retain: (request, file) => { if (file) original(request).retain(request, file); },
    discardUnreferenced: (request, file) => file ? original(request).discardUnreferenced(request, file) : Promise.resolve('ABSENT'),
  };
}
