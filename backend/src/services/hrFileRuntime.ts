import path from 'node:path';
import type { Request, RequestHandler } from 'express';
import { RuntimeWorkBoundary } from './runtimeWorkBoundary';
import { runtimeHttpRequests } from './httpRequestLifecycle';
import { HR_PERSONNEL_ERASURE_STORAGE_ROOTS } from './hrPersonnelErasureGraph';
import { HR_HIRING_STORAGE_DIR } from './hrHiringFileStorage';
import { VersionedFilePublication } from './versionedFilePublication';
import { createDurableUpload, createVersionedDurableUpload, type DurableUpload } from './durableUpload';

type Profile = Readonly<{ boundary: RuntimeWorkBoundary;
  roots: readonly Readonly<{ root: string; publication: VersionedFilePublication }>[];
  hiring: VersionedFilePublication }>;
let profile: Profile | undefined;
let observed = false;

/** Private composition, not a production admission mechanism. No environment or
 * request flag selects it. The release controller still owes complete writer,
 * generation/reference/privacy, native recovery and release qualifications. */
export function configurePrivateVersionedHrFiles(input: {
  boundary: RuntimeWorkBoundary; roots: readonly { root: string; publication: VersionedFilePublication }[];
}) {
  if (profile) throw new Error('HR_FILE_RUNTIME_ALREADY_BOUND');
  if (observed) throw new Error('HR_FILE_RUNTIME_ALREADY_OBSERVED');
  runtimeHttpRequests.assertBeforeFirstRequest();
  if (!(input?.boundary instanceof RuntimeWorkBoundary) || input.boundary.requests !== runtimeHttpRequests
    || !Array.isArray(input.roots)) throw new Error('HR_FILE_RUNTIME_SCOPE_INVALID');
  const roots = input.roots.map(scope => {
    if (!scope || !path.isAbsolute(scope.root) || path.resolve(scope.root) !== scope.root
      || !(scope.publication instanceof VersionedFilePublication) || !scope.publication.ownsRoot(scope.root)
      || !scope.publication.ownsWork(input.boundary.context)) throw new Error('HR_FILE_RUNTIME_SCOPE_INVALID');
    return Object.freeze({ root: scope.root, publication: scope.publication });
  });
  const names = roots.map(scope => scope.root).sort();
  if (JSON.stringify(names) !== JSON.stringify(HR_PERSONNEL_ERASURE_STORAGE_ROOTS)) throw new Error('HR_FILE_RUNTIME_ROOT_SET_INCOMPLETE');
  profile = Object.freeze({ boundary: input.boundary, roots: Object.freeze(roots),
    hiring: roots.find(scope => scope.root === HR_HIRING_STORAGE_DIR)!.publication });
}

export function versionedHrFileRuntime(): Profile | undefined {
  observed = true; return profile;
}

export function createHrHiringUpload(options: Parameters<typeof createDurableUpload>[0]): DurableUpload {
  let selected: DurableUpload | undefined;
  const requests = new WeakMap<Request, DurableUpload>();
  const owner = () => {
    if (!selected) {
      const runtime = versionedHrFileRuntime();
      selected = runtime ? createVersionedDurableUpload(options, HR_HIRING_STORAGE_DIR, runtime.hiring)
        : createDurableUpload(options);
    }
    return selected;
  };
  const wrap = (build: (upload: DurableUpload) => RequestHandler): RequestHandler => {
    let handler: RequestHandler | undefined;
    return (request, response, next) => {
      try {
        const upload = owner(); requests.set(request, upload);
        handler ||= build(upload);
        return handler(request, response, next);
      } catch (error) { next(error); }
    };
  };
  const original = (request: Request) => {
    const upload = requests.get(request);
    if (!upload) throw new Error('HR_FILE_UPLOAD_REQUEST_OWNER_UNPROVEN');
    return upload;
  };
  return {
    single: field => wrap(upload => upload.single(field)),
    array: (field, maximum) => wrap(upload => upload.array(field, maximum)),
    fields: fields => wrap(upload => upload.fields(fields)),
    none: () => wrap(upload => upload.none()),
    any: () => wrap(upload => upload.any()),
    retain: (request, file) => { if (file) original(request).retain(request, file); },
    discardUnreferenced: (request, file) => file ? original(request).discardUnreferenced(request, file) : Promise.resolve('ABSENT'),
  };
}
