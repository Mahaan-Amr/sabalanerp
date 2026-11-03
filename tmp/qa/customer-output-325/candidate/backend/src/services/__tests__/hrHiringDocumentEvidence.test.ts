import assert from 'node:assert/strict';
import { normalizeHiringDocumentTitle } from '../hrHiringDocumentEvidence';

assert.equal(normalizeHiringDocumentTitle('OTHER', '  گواهي   سلامت  '), 'گواهی سلامت');
assert.equal(normalizeHiringDocumentTitle('EDUCATION', 'عنوان دلخواه'), null);
assert.throws(() => normalizeHiringDocumentTitle('OTHER', '   '), /عنوان سند سایر/);

console.log('HR hiring document evidence tests passed.');
