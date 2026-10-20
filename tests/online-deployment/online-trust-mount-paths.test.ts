import assert from 'node:assert/strict';
import test from 'node:test';
import { writableTrustKeyAliases } from '../../backend/src/services/onlineTrustMountPaths';

test('directory-bound trust mount projects writable aliases to key FILE, including a writable key-only bind', () => {
  const key = '/run/sabalan-online/release-controller-public-key.pem';
  const selected = { id: '100', device: '0:42', root: '/host/authority', target: '/run/sabalan-online', options: ['ro'] };
  const aliases = writableTrustKeyAliases([selected,
    { id: '101', device: '0:42', root: '/host/authority', target: '/writable', options: ['rw'] },
    { id: '102', device: '0:42', root: '/host', target: '/host-alias', options: ['rw'] },
    { id: '103', device: '0:42', root: '/host/authority/release-controller-public-key.pem', target: '/key-alias', options: ['rw'] },
    { id: '104', device: '0:43', root: '/host/authority', target: '/other-device', options: ['rw'] },
  ], selected, key);
  assert.deepEqual(aliases, ['/writable/release-controller-public-key.pem', '/host-alias/authority/release-controller-public-key.pem', '/key-alias']);
  assert.ok(!aliases.includes('/writable'));
});

test('exact key bind retains its original underlying file identity; unrelated writable descendants are excluded', () => {
  const key = '/run/sabalan-online/release-controller-public-key.pem';
  const selected = { id: '100', device: '0:42', root: '/host/authority/key.pem', target: key, options: ['ro'] };
  assert.deepEqual(writableTrustKeyAliases([selected,
    { id: '101', device: '0:42', root: '/host/authority', target: '/writable', options: ['rw'] },
    { id: '102', device: '0:42', root: '/host/authority/other', target: '/unrelated', options: ['rw'] },
  ], selected, key), ['/writable/key.pem']);
  assert.throws(() => writableTrustKeyAliases([], selected, '/different/file'), /OUTSIDE_SELECTED/);
});
