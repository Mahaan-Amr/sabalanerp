import assert from 'node:assert/strict';
import test from 'node:test';
import { FEATURE_LABELS, FEATURES } from './feature';

test('every feature definition has a Persian-only display label', () => {
  for (const feature of Object.values(FEATURES)) {
    const label = FEATURE_LABELS[feature];
    assert.ok(label, `Missing display label for ${feature}`);
    assert.match(label, /[\u0600-\u06ff]/, `Expected a Persian label for ${feature}`);
    assert.doesNotMatch(label, /[A-Za-z]/, `Expected no Latin letters in the label for ${feature}`);
  }
});
