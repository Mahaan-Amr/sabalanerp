import assert from 'node:assert/strict';
import test from 'node:test';
import { VersionedFilePublication } from '../versionedFilePublication';
import { NativeFileCaptureAuthority } from '../nativeFileCaptureAuthority';

test('capture port refuses a structural stand-in before touching any filesystem root', async () => {
  assert.equal(typeof VersionedFilePublication.openForCapture, 'function');
  await assert.rejects(VersionedFilePublication.openForCapture({} as NativeFileCaptureAuthority),
    /FILE_CAPTURE_NATIVE_AUTHORITY_REQUIRED/);
  await assert.rejects(VersionedFilePublication.openForCapture(Object.create(NativeFileCaptureAuthority.prototype)),
    /FILE_CAPTURE_NATIVE_AUTHORITY_REQUIRED/);
});

test('ordinary processes cannot construct native capture authority from caller paths', () => {
  assert.throws(() => NativeFileCaptureAuthority.open({
    componentScopeFile: '/unowned/capture.json', componentScopeSha256: 'a'.repeat(64),
    componentDirectory: '/unowned', sourceName: 'uploads', storeIdentity: { device: '1', inode: '2' },
  }), /FILE_CAPTURE_NATIVE_AUTHORITY_UNPROVEN|ONLINE_RUNTIME_SCOPE_UNPROVEN/);
});
