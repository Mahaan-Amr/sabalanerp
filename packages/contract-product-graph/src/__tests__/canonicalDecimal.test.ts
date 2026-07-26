import assert from 'node:assert/strict';
import { parseCanonicalDecimal } from '../canonicalDecimal';

assert.equal(parseCanonicalDecimal('۱۲٫۵'), '12.5');
assert.equal(parseCanonicalDecimal('١٢٫٥'), '12.5');
assert.equal(parseCanonicalDecimal('12.5'), '12.5');
assert.equal(parseCanonicalDecimal('۱٬۲۳۴٫۵۰'), '1234.5');
assert.equal(parseCanonicalDecimal('1,234.50'), '1234.5');
assert.equal(parseCanonicalDecimal('۰٫۳'), '0.3');

console.log('canonicalDecimal tests passed');
