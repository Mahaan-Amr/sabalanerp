import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeStructuredNumerals } from './normalizeStructuredNumerals';

test('normalizes Persian and Arabic numerals recursively at the server boundary', () => {
  assert.deepEqual(normalizeStructuredNumerals({ amount: '۱۲۳٫۴۵', nested: ['٠٩١٢٣', 'نسخه ۲'] }), {
    amount: '123.45', nested: ['09123', 'نسخه 2'],
  });
});
