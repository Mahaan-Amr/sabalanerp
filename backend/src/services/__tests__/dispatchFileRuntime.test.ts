import assert from 'node:assert/strict';
import test from 'node:test';
import { configurePrivateVersionedDispatchFiles, versionedDispatchDocumentFiles } from '../dispatchFileRuntime';

test('ordinary Dispatch composition remains ordinary and cannot switch file owners after observation', async () => {
  await assert.rejects(configurePrivateVersionedDispatchFiles({} as never), /DISPATCH_FILE_RUNTIME_SCOPE_INVALID/);
  assert.equal(versionedDispatchDocumentFiles(), undefined);
  await assert.rejects(configurePrivateVersionedDispatchFiles({} as never), /DISPATCH_FILE_RUNTIME_ALREADY_OBSERVED/);
  assert.equal(versionedDispatchDocumentFiles(), undefined);
});
