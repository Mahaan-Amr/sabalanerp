import { parentPort, workerData } from 'node:worker_threads';
import { encodeSalesReportWorkbook, type SalesReportWorkbook, type SalesReportWorkbookConfig } from './salesReportWorkbook';

const port = parentPort;
if (!port) throw new Error('Sales workbook worker requires a parent port');

const { report, config }: { report: SalesReportWorkbook; config: SalesReportWorkbookConfig } = workerData;
try {
  const bytes = Uint8Array.from(encodeSalesReportWorkbook(report, config));
  port.postMessage({ bytes }, [bytes.buffer]);
} catch (error) {
  port.postMessage({ error: error instanceof Error ? error.message : 'Workbook encoding failed' });
}
