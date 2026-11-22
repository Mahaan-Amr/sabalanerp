import assert from 'node:assert/strict';
import test from 'node:test';
import { assetEvidenceContentDigest, buildAssetEvidenceForm } from '../assetEvidenceContentDigest';

test('same-name and same-size different documents use different retry identity while exact retries match', async () => {
  const a = new File(['abc'], 'document.pdf', { type: 'application/pdf' });
  const retry = new File(['abc'], 'document.pdf', { type: 'application/pdf' });
  const changed = new File(['xyz'], 'document.pdf', { type: 'application/pdf' });
  assert.equal(await assetEvidenceContentDigest(a), await assetEvidenceContentDigest(retry));
  assert.notEqual(await assetEvidenceContentDigest(a), await assetEvidenceContentDigest(changed));
});

test('asset upload form binds the file digest to the retry fingerprint input', async () => {
  const a = new File(['abc'], 'document.pdf', { type: 'application/pdf' });
  const b = new File(['xyz'], 'document.pdf', { type: 'application/pdf' });
  const first = await buildAssetEvidenceForm('book', 'COST', a);
  const second = await buildAssetEvidenceForm('book', 'COST', b);
  assert.equal(first.get('file'), a);
  assert.notEqual(first.get('contentDigest'), second.get('contentDigest'));
});
