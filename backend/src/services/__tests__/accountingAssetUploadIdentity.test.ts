import assert from 'node:assert/strict';
import test from 'node:test';
import { assetUploadIdentity, assertMatchingAssetUpload } from '../accountingAssetUploadIdentity';

test('upload retry identity scopes actor, asset, and key and rejects changed bytes and metadata', () => {
  const identity = assetUploadIdentity('user', 'asset', 'key-12345');
  assert.equal(identity, assetUploadIdentity('user', 'asset', 'key-12345'));
  assert.notEqual(identity, assetUploadIdentity('user', 'other', 'key-12345'));
  assert.notEqual(identity, assetUploadIdentity('other', 'asset', 'key-12345'));
  const input = { bookId: 'book', assetId: 'asset', actorId: 'user', evidenceType: 'ASSET_COST',
    contentHash: 'abc', sizeBytes: 12n, mimeType: 'application/pdf' };
  const prior = { bookId: 'book', sourceEntityId: 'asset', sourceEntityType: 'FIXED_ASSET', uploadedBy: 'user',
    evidenceType: 'ASSET_COST', contentHash: 'abc', sizeBytes: 12n, mimeType: 'application/pdf' };
  assert.doesNotThrow(() => assertMatchingAssetUpload(prior, input));
  for (const change of [{ contentHash: 'changed' }, { sizeBytes: 13n }, { mimeType: 'image/png' },
    { evidenceType: 'ASSET_READY_FOR_USE' }, { actorId: 'other' }, { bookId: 'other' }]) {
    assert.throws(() => assertMatchingAssetUpload(prior, { ...input, ...change }));
  }
});
