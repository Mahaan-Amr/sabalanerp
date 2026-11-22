import path from 'node:path';
import { RuntimeWorkBoundary } from './runtimeWorkBoundary';
import { runtimeHttpRequests } from './httpRequestLifecycle';
import { VersionedFilePublication, type VersionedFileRootScope } from './versionedFilePublication';

export const ACCOUNTING_PDF_STORAGE_ROOT = path.resolve(process.cwd(), 'storage', 'accounting-contracts');
export const ACCOUNTING_OFFICIAL_REPORT_ROOT = path.resolve(process.cwd(), 'storage', 'accounting-contracts', '.official-reports');
let phase: 'UNBOUND' | 'CONFIGURING' | 'READY' | 'FAILED' = 'UNBOUND';
let observed = false;
let files: VersionedFileRootScope | undefined;
let owner: { boundary: RuntimeWorkBoundary; publication: VersionedFilePublication } | undefined;

/** Private startup composition only; no production admission or reset path.
 * The same HTTP owner must retain actual work through the export transaction.
 * Failure after selecting a genuine owner permanently closes this boot choice. */
export async function configurePrivateVersionedAccountingFiles(input: {
  boundary: RuntimeWorkBoundary; publication: VersionedFilePublication;
}): Promise<void> {
  if (phase !== 'UNBOUND') throw Error('ACCOUNTING_FILE_RUNTIME_ALREADY_BOUND');
  if (observed) throw Error('ACCOUNTING_FILE_RUNTIME_ALREADY_OBSERVED');
  runtimeHttpRequests.assertBeforeFirstRequest();
  if (!(input?.boundary instanceof RuntimeWorkBoundary) || input.boundary.requests !== runtimeHttpRequests
    || !(input.publication instanceof VersionedFilePublication)
    || !(input.publication.ownsRoot(ACCOUNTING_OFFICIAL_REPORT_ROOT) || input.publication.ownsRoot(ACCOUNTING_PDF_STORAGE_ROOT))
    || !input.publication.ownsWork(input.boundary.context)) throw Error('ACCOUNTING_FILE_RUNTIME_SCOPE_INVALID');
  phase = 'CONFIGURING';
  try {
    const bound = await input.publication.bindRoot(ACCOUNTING_OFFICIAL_REPORT_ROOT);
    runtimeHttpRequests.assertBeforeFirstRequest();
    if (observed) throw Error('ACCOUNTING_FILE_RUNTIME_ALREADY_OBSERVED');
    files = bound; owner = { boundary: input.boundary, publication: input.publication }; phase = 'READY';
  } catch (error) { phase = 'FAILED'; throw error; }
}

export function versionedAccountingReportFiles(): VersionedFileRootScope | undefined {
  observed = true;
  if (phase === 'CONFIGURING' || phase === 'FAILED') throw Error('ACCOUNTING_FILE_RUNTIME_NOT_READY');
  return files;
}

/** The parent PDF registry must use this SAME publisher, independent of startup
 * order. A prior child publisher, even one already observed, cannot be replaced
 * by an overlapping parent store. No second binding or reset is performed. */
export async function configureAccountingPdfParentFiles(input: {
  boundary: RuntimeWorkBoundary; publication: VersionedFilePublication;
}): Promise<void> {
  runtimeHttpRequests.assertBeforeFirstRequest();
  if (!(input?.boundary instanceof RuntimeWorkBoundary) || input.boundary.requests !== runtimeHttpRequests
    || !(input.publication instanceof VersionedFilePublication)
    || !input.publication.ownsRoot(ACCOUNTING_PDF_STORAGE_ROOT)
    || !input.publication.ownsWork(input.boundary.context)) throw Error('ACCOUNTING_FILE_RUNTIME_PARENT_SCOPE_INVALID');
  if (phase === 'READY') {
    if (owner?.boundary !== input.boundary || owner.publication !== input.publication) {
      throw Error('ACCOUNTING_FILE_RUNTIME_PARENT_OWNER_CONFLICT');
    }
    return;
  }
  await configurePrivateVersionedAccountingFiles(input);
}
