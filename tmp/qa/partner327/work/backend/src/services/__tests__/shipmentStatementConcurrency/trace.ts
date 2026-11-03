import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type ConcurrencyTraceEvent = Readonly<{
  scenario: string;
  actor: string;
  phase: string;
  outcome: string;
  detail?: Readonly<Record<string, unknown>>;
}>;

export type ScenarioResult = Readonly<{ name: string; repetitions: number; anomalies: readonly string[]; durationMs?: number }>;

export class ConcurrencyTrace {
  private readonly events: Array<ConcurrencyTraceEvent & { runId: string; sequence: number; recordedAt: string }> = [];

  constructor(private readonly input: { runId: string; outputDirectory: string }) {}

  record(event: ConcurrencyTraceEvent): void {
    this.events.push({ ...event, runId: this.input.runId, sequence: this.events.length + 1, recordedAt: new Date().toISOString() });
  }

  async finish(scenarios: readonly ScenarioResult[]) {
    await mkdir(this.input.outputDirectory, { recursive: true });
    const tracePath = path.join(this.input.outputDirectory, 'trace.jsonl');
    const summaryPath = path.join(this.input.outputDirectory, 'summary.json');
    const anomalyCount = scenarios.reduce((count, scenario) => count + scenario.anomalies.length, 0);
    const summary = { runId: this.input.runId, status: anomalyCount === 0 ? 'ZERO_ANOMALIES' : 'ANOMALIES_DETECTED',
      eventCount: this.events.length, anomalyCount, scenarios };
    await writeFile(tracePath, `${this.events.map(event => JSON.stringify(event)).join('\n')}\n`, 'utf8');
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    return { tracePath, summaryPath, summary };
  }
}
