import test from 'node:test';
import assert from 'node:assert/strict';
import { readPartnerCasePricingRows } from './partnerCasePricingRead';
import { createWizardFixtures } from '../../partner-sales/__tests__/wizardFixtures';
const fixture = createWizardFixtures();
const row = fixture.inquiry.rows[0];
const saved = { recoveryId: row.configurationRef.recoveryId, recoveryRevision: row.configurationRef.recoveryRevision };
const matches = { schemaVersion: 1 as const, ...saved, rows: [row], missingPricingSubjectIds: [] };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('published inquiry reads start while approval matching is still pending, and binding-only history is read once', async () => {
  const gate = deferred<typeof matches>(); const calls: string[][] = [];
  const pending = readPartnerCasePricingRows({ saved, matches: () => gate.promise,
    publishedIds: async () => ['published', 'published'], rows: async ids => { calls.push([...ids]); return []; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [['published']], 'the published inquiry must not wait for approval matching');
  gate.resolve(matches);
  assert.deepEqual((await pending).rows, [row]);
  assert.deepEqual(calls, [['published'], [row.approvedRowBinding!.inquiryId]]);
});

test('overlapping bindings are not requested twice and the latest current row keeps precedence', async () => {
  const calls: string[][] = [], id = row.approvedRowBinding!.inquiryId;
  const result = await readPartnerCasePricingRows({ saved, matches: async () => matches,
    publishedIds: async () => [id], rows: async ids => { calls.push([...ids]); return [row]; } });
  assert.deepEqual(calls, [[id]]); assert.deepEqual(result.rows, [row]);
});

test('failed independent reads or a mismatched approval revision cannot publish partial pricing', async () => {
  for (const denied of ['published', 'matches', 'rows', 'revision']) {
    const failure = new Error('denied');
    await assert.rejects(readPartnerCasePricingRows({ saved,
      matches: async () => { if (denied === 'matches') throw failure; return denied === 'revision'
        ? { ...matches, recoveryRevision: saved.recoveryRevision + 1 } : matches; },
      publishedIds: async () => { if (denied === 'published') throw failure; return ['published']; },
      rows: async () => { if (denied === 'rows') throw failure; return []; },
    }));
  }
});
