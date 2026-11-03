import assert from 'node:assert/strict';
import { normalizeLoginPhone } from '../../routes/auth';

assert.equal(normalizeLoginPhone('۰۹۱۲-۱۲۳ ۴۵۶۷'), '09121234567');
assert.equal(normalizeLoginPhone('٠٩١٢-١٢٣ ٤٥٦٧'), '09121234567');
assert.equal(normalizeLoginPhone('(0912) 123-4567'), '09121234567');

console.log('login phone normalization tests passed');
