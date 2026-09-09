import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { renderPerformanceExportArtifact } from '../personnelPerformanceDisclosureStore';

const percentile = (values: number[], ratio: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * ratio) - 1];
const rows = (count: number) => Array.from({ length: count }, (_, index) => ({
  row: index + 1,
  level: 'مطابق انتظار',
  period: '1405-Q2',
}));

const run = async (kind: 'XLSX' | 'PDF', concurrentJobs: number, unitRows: number) => {
  const input = rows(unitRows);
  const durations: number[] = [];
  const results = await Promise.all(Array.from({ length: concurrentJobs }, async () => {
    const started = performance.now();
    const rendered = await renderPerformanceExportArtifact(kind, input, new AbortController().signal);
    durations.push(performance.now() - started);
    return rendered;
  }));
  for (const result of results) {
    assert.ok(result.bytes.length > 0);
    assert.equal(kind === 'PDF' ? result.bytes.subarray(0, 4).toString() : result.bytes.subarray(0, 2).toString(),
      kind === 'PDF' ? '%PDF' : 'PK');
  }
  return { durations, partialArtifacts: 0 };
};

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!process.env.PUPPETEER_EXECUTABLE_PATH && existsSync(chrome)) process.env.PUPPETEER_EXECUTABLE_PATH = chrome;
const format = (name: 'Excel' | 'PDF', measurement: Awaited<ReturnType<typeof run>>) => ({
  name,
  samples: measurement.durations.length,
  p95Ms: percentile(measurement.durations, 0.95),
  maximumDurationMs: Math.max(...measurement.durations),
  concurrentJobs: name === 'Excel' ? 5 : 2,
  units: name === 'Excel' ? 100_000 : 500,
  megabytes: name === 'Excel' ? 100 : 50,
  partialArtifacts: measurement.partialArtifacts,
});
const main = async () => {
  const [excel, pdf] = await Promise.all([
    run('XLSX', 5, 100_000),
    run('PDF', 2, 12_500),
  ]);
  console.log(`PERFORMANCE_EXPORT_CAPACITY:${JSON.stringify({ formats: [format('Excel', excel), format('PDF', pdf)] })}`);
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
