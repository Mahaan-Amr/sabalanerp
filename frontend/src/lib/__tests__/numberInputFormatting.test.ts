import assert from 'node:assert/strict';
import { formatNumericInputText, normalizeIdentifierDigits, normalizeNumericText } from '../numberFormat';

assert.deepEqual(formatNumericInputText('12'), {
  canonicalText: '12',
  displayText: '12',
  caretPosition: 2
});
assert.deepEqual(formatNumericInputText('12500.75'), {
  canonicalText: '12500.75',
  displayText: '12,500.75',
  caretPosition: 9
});
assert.deepEqual(formatNumericInputText('۱۲۵۰۰٫۷۵'), {
  canonicalText: '12500.75',
  displayText: '12,500.75',
  caretPosition: 9
});
assert.deepEqual(formatNumericInputText('2.'), {
  canonicalText: '2.',
  displayText: '2.',
  caretPosition: 2
});
assert.deepEqual(formatNumericInputText('12345.678901', 7, null), {
  canonicalText: '12345.678901',
  displayText: '12,345.678901',
  caretPosition: 8
});
assert.deepEqual(formatNumericInputText('12345.678901', 12, 4), {
  canonicalText: '12345.6789',
  displayText: '12,345.6789',
  caretPosition: 11
});
assert.deepEqual(formatNumericInputText('۲۰٬۰۰۰٬۰۰۰', 10, 0), {
  canonicalText: '20000000',
  displayText: '20,000,000',
  caretPosition: 10
});
assert.deepEqual(formatNumericInputText('٢٠،٠٠٠،٠٠٠', 10, 0), {
  canonicalText: '20000000',
  displayText: '20,000,000',
  caretPosition: 10
});
assert.deepEqual(formatNumericInputText('', 0, 0), {
  canonicalText: '',
  displayText: '',
  caretPosition: 0
});

assert.equal(normalizeIdentifierDigits('۰۹1٢- ۳۴'), '091234');
assert.equal(normalizeIdentifierDigits('۰۰۱۲۳'), '00123', 'identifier normalization preserves leading zeroes');
assert.equal(normalizeNumericText('۱۲٬۳۴۵٫۶۷', 2), '12345.67');
assert.equal(normalizeNumericText('۰۹1٢.۳', 2), '0912.3');

console.log('numeric input formatting tests passed');
