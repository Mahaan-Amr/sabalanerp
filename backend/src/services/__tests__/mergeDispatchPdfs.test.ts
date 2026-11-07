import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeDispatchPdfs } from '../mergeDispatchPdfs';

test('combined printing rejects missing, malformed, and oversized document sets', async () => {
  const pdf = Buffer.from('%PDF-example');
  await assert.rejects(() => mergeDispatchPdfs([pdf]), /کامل یا معتبر/);
  await assert.rejects(() => mergeDispatchPdfs([pdf, Buffer.from('not a pdf')]), /کامل یا معتبر/);
  await assert.rejects(() => mergeDispatchPdfs(Array.from({ length: 102 }, () => pdf)), /کامل یا معتبر/);
});
