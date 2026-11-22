import assert from 'node:assert/strict';
import test from 'node:test';
import { withinPerformanceExportDeadline } from '../personnelPerformanceDisclosureStore';

test('timed-out export retains completion until the aborted renderer actually finishes', async () => {
  let finish!: () => void, aborted!: () => void;
  const observedAbort = new Promise<void>(resolve => { aborted = resolve; });
  let settled = false;
  const result = withinPerformanceExportDeadline(signal => new Promise<void>(resolve => {
    finish = resolve;
    signal.addEventListener('abort', aborted, { once: true });
  }), 10);
  const checked = assert.rejects(result, { code: 'PERFORMANCE_EXPORT_GENERATION_TIMEOUT' }).then(() => { settled = true; });
  await observedAbort;
  await new Promise(resolve => setTimeout(resolve, 20));
  try { assert.equal(settled, false, 'aborting is not proof that rendering ended'); }
  finally { finish(); await checked; }
});
