import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { SalesReportWorkbook, SalesReportWorkbookConfig } from './salesReportWorkbook';

const MAX_ENCODING_MS = 45_000;
let activeExport: symbol | undefined;

/** The slot includes database hydration and delivery to avoid retaining several large reports. */
export function tryAcquireSalesReportWorkbookSlot(): (() => void) | null {
  if (activeExport) return null;
  const slot = Symbol();
  activeExport = slot;
  return () => {
    if (activeExport === slot) activeExport = undefined;
  };
}

type WorkerResult = { bytes: Uint8Array } | { error: string };

export class SalesReportWorkbookUnavailable extends Error {}

export async function buildSalesReportWorkbook(
  report: SalesReportWorkbook,
  config: SalesReportWorkbookConfig,
  signal: AbortSignal,
): Promise<Buffer> {
  signal.throwIfAborted();
  const extension = path.extname(__filename);
  const worker = new Worker(path.join(__dirname, 'salesReportWorkbookWorker' + extension), {
    workerData: { report, config },
    execArgv: extension === '.ts' ? ['--require', require.resolve('tsx/cjs')] : [],
    env: extension === '.ts' ? { TSX_DISABLE_CACHE: '1' } : {},
    resourceLimits: { maxOldGenerationSizeMb: 256 },
  });

  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      timer = setTimeout(() => reject(new SalesReportWorkbookUnavailable('Sales workbook generation timed out')), MAX_ENCODING_MS);
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
      worker.once('error', () => reject(new SalesReportWorkbookUnavailable('Sales workbook generation failed')));
      worker.once('exit', () => reject(new SalesReportWorkbookUnavailable('Sales workbook worker exited early')));
      worker.once('message', (result: WorkerResult) => {
        if ('error' in result) return reject(new Error(result.error));
        resolve(Buffer.from(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength));
      });
    });
  } finally {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
    await worker.terminate();
  }
}
