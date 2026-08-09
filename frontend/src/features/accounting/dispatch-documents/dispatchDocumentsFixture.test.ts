import assert from 'node:assert/strict';
import test from 'node:test';
import { createFixtureDispatchDocumentsClient } from './dispatchDocumentsFixture';

test('fixture accept publishes one complete bundle and replays an idempotent command', async () => {
  const client = createFixtureDispatchDocumentsClient('MANAGE');
  const first = await client.decide('dispatch-ready', { action: 'ACCEPT', reason: '', idempotencyKey: 'same-command' });
  const replay = await client.decide('dispatch-ready', { action: 'ACCEPT', reason: '', idempotencyKey: 'same-command' });
  assert.equal(first.bundle?.artifacts.filter((item) => item.kind === 'WAYBILL').length, 1);
  assert.equal(first.bundle?.artifacts.filter((item) => item.kind === 'STATEMENT').length, 1);
  assert.equal(replay.bundle?.id, first.bundle?.id);
});

test('fixture unauthorized workspace returns no cases', async () => {
  const client = createFixtureDispatchDocumentsClient('UNAUTHORIZED');
  assert.deepEqual((await client.load()).cases, []);
});

test('fixture reject requires a reason and replacement retains immutable history', async () => {
  const client = createFixtureDispatchDocumentsClient('MANAGE');
  await assert.rejects(() => client.decide('dispatch-ready', { action: 'REJECT', reason: '', idempotencyKey: 'reject' }));
  const replacement = await client.replace('dispatch-issued', { reason: 'اصلاح مشخصات سند', idempotencyKey: 'replace' });
  assert.equal(replacement.bundle?.history.some((item) => item.number === '۱۲۵۸' && item.status === 'REPLACED'), true);
  assert.notEqual(replacement.bundle?.number, '۱۲۵۸');
  assert.equal(replacement.bundle?.adjustments[0]?.sharedNumber, '۱۲۵۸');
});

test('print-both records a handoff without persisting a third artifact', async () => {
  const client = createFixtureDispatchDocumentsClient('VIEW');
  const before = (await client.load()).cases.find((item) => item.id === 'dispatch-issued')!;
  const handoff = await client.handoff('dispatch-issued', { kind: 'PRINT_BOTH' });
  const after = (await client.load()).cases.find((item) => item.id === 'dispatch-issued')!;
  assert.equal(after.bundle?.artifacts.length, before.bundle?.artifacts.length);
  assert.equal(after.bundle?.printHistory.length, (before.bundle?.printHistory.length || 0) + 1);
  assert.equal(after.bundle?.printHistory.at(-1)?.action, 'BOTH');
  assert.deepEqual(handoff.artifacts.map((item) => item.kind), ['WAYBILL', 'STATEMENT']);
  assert.equal(handoff.artifacts.some((item) => item.fileName.includes('dispatch-')), false);
});
