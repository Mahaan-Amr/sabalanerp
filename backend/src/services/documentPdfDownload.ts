import type { Request, Response } from 'express';
import { runtimeHttpRequests } from './httpRequestLifecycle';
import { removeTemporaryDocumentPdf } from './documentPdfFileRuntime';

export type PdfDownloadCompletion = { removed: boolean; cleanupComplete: boolean; downloadError?: Error; cleanupError?: unknown };

/** Register future callback work before Express starts the download. Awaiting
 * this promise AND the reservation keeps the real request/gate alive through
 * abort callbacks and filesystem completion, not merely response finish. */
export async function downloadAndRemoveDocumentPdf(request: Request, response: Response,
  file: string, downloadName: string): Promise<PdfDownloadCompletion> {
  const completion = runtimeHttpRequests.reserveWrite(request);
  const result = await new Promise<PdfDownloadCompletion>(resolve => {
    let called = false;
    const done = (downloadError?: Error) => {
      if (called) return;
      called = true;
      return completion.run(async () => {
        return removeTemporaryDocumentPdf(file);
      }).then(removed => resolve({ removed, cleanupComplete: true, downloadError }),
        cleanupError => resolve({ removed: false, cleanupComplete: false, downloadError, cleanupError }));
    };
    try { response.download(file, downloadName, done); }
    catch (error) { done(error instanceof Error ? error : new Error('PDF_DOWNLOAD_FAILED')); }
  });
  const error = result.cleanupError ?? result.downloadError;
  if (error) {
    if (!response.headersSent && !response.destroyed) throw error;
    // The actual operation has settled. Report retained temporary bytes on
    // failure; never attempt a second response or claim cleanup succeeded.
    console.error('PDF_DOWNLOAD_COMPLETION_FAILED', { removed: result.removed,
      code: error instanceof Error ? error.message : 'PDF_DOWNLOAD_CLEANUP_FAILED' });
  }
  return result;
}
