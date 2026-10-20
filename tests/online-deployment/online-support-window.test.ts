import assert from 'node:assert/strict';
import test from 'node:test';
import { snapshotOnlineSupportWindow } from '../../backend/src/services/onlineReleaseSupportWindow';

test('retained restart requires actual observed time inside the full retirement support window', () => {
  const retiredAt = new Date('2026-10-19T12:00:00Z');
  const browserSupportUntil = new Date(retiredAt.getTime() + 86_400_000);
  const input = { phase: 'RETAINED', retiredAt, browserSupportUntil, now: new Date(browserSupportUntil.getTime() - 1) };
  const snapshot = snapshotOnlineSupportWindow(input);
  assert.ok(Object.isFrozen(snapshot));
  assert.equal(snapshot.retiredAt, retiredAt.toISOString());
  assert.equal(snapshot.browserSupportUntil, browserSupportUntil.toISOString());
  for (const invalid of [
    { ...input, now: browserSupportUntil },
    { ...input, now: new Date(browserSupportUntil.getTime() + 1) },
    { ...input, browserSupportUntil: new Date(browserSupportUntil.getTime() - 1) },
    { ...input, retiredAt: null },
    { ...input, now: new Date(retiredAt.getTime() - 1) },
    { ...input, now: input.now.toISOString() },
  ]) assert.throws(() => snapshotOnlineSupportWindow(invalid), /SUPPORT_WINDOW_UNPROVEN/);
});

test('serving startup has no invented retirement deadline and dates confer no capability', () => {
  const now = new Date();
  assert.equal(snapshotOnlineSupportWindow({ phase: 'SERVING', now, retiredAt: null, browserSupportUntil: null }).browserSupportUntil, null);
  assert.throws(() => snapshotOnlineSupportWindow({ phase: 'SERVING', now, retiredAt: now, browserSupportUntil: null }));
  assert.throws(() => snapshotOnlineSupportWindow({ phase: 'RETIRED', now, retiredAt: null, browserSupportUntil: null }));
});
