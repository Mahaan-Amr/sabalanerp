import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertNoSystemdWslConfig, inspectCustodyPath, validateManifest } from './qa-zero-state-preflight.mjs';

const initial = 'net:[4026531833]';
const packageHash = 'c294a4df952b9ae54e19e0ab19ac09a7e398fbf7aa8969cfcae07f92dc4f30ac';
const valid = () => ({
  format: 'sabalan-qa-zero-state/v1', distro: 'sabalanerp-qa-debian', initialNetns: initial,
  engineId: '33f03eef-8f8d-45a2-af36-b98958ddacde', dataRoot: '/var/lib/docker', socket: '/run/docker.sock',
  slirpVersion: '1.2.1-1.1', slirpPackageSha256: packageHash,
  slirpBinarySha256: 'a'.repeat(64), slirpPackage: '/srv/sabalanerp-qa/packages/slirp4netns_1.2.1-1.1_amd64.deb',
  dockerVersion: '5:29.2.1-1~debian.13~trixie', ipSha256: 'b'.repeat(64),
  dockerdSha256: 'c'.repeat(64), dockerSha256: 'd'.repeat(64),
  daemonConfigSha256: 'e'.repeat(64), dpkgQuerySha256: 'f'.repeat(64),
});

function fakeCustody(overrides = {}) {
  const entry = (kind, mode, uid = 0) => ({
    mode, uid, nlink: 1, isFile: () => kind === 'file',
    isDirectory: () => kind === 'dir', isSymbolicLink: () => kind === 'link',
  });
  const entries = {
    '/': entry('dir', 0o755), '/srv': entry('dir', 0o755),
    '/srv/sabalanerp-qa': entry('dir', 0o700),
    '/srv/sabalanerp-qa/pinned.json': entry('file', 0o400),
    ...overrides,
  };
  return {
    lstatSync: (name) => entries[name],
    realpathSync: (name) => entries[name]?.isSymbolicLink() ? '/tmp/escaped' : name,
  };
}

test('pinned zero-state manifest identity is accepted', () => assert.doesNotThrow(() => validateManifest(valid(), initial)));
test('other initial namespace refuses', () => assert.throws(() => validateManifest(valid(), 'net:[4026532999]')));
test('Desktop or changed native Engine ID refuses', () => assert.throws(() => validateManifest({ ...valid(), engineId: '587ad864-09c8-4149-ae53-89bb9d93ddfc' }, initial)));
test('package archive hash cannot stand in for measured installed binary', () => assert.throws(() => validateManifest({ ...valid(), slirpBinarySha256: packageHash }, initial)));
test('unscoped package location refuses', () => assert.throws(() => validateManifest({ ...valid(), slirpPackage: '/tmp/slirp.deb' }, initial)));
test('package path traversal refuses', () => assert.throws(() => validateManifest({ ...valid(), slirpPackage: '/srv/sabalanerp-qa/../../tmp/slirp.deb' }, initial)));
test('extra manifest field refuses', () => assert.throws(() => validateManifest({ ...valid(), unreviewed: true }, initial)));
test('manifest outside private custody refuses even with root ownership and mode 0400', () =>
  assert.throws(() => inspectCustodyPath('/tmp/pinned.json', '/srv/sabalanerp-qa', fakeCustody())));
test('symlink under private custody refuses even when its target could hash-pass', () => {
  const source = fakeCustody({
    '/srv/sabalanerp-qa/pinned.json': {
      mode: 0o400, uid: 0, nlink: 1,
      isFile: () => false, isDirectory: () => false, isSymbolicLink: () => true,
    },
  });
  assert.throws(() => inspectCustodyPath('/srv/sabalanerp-qa/pinned.json', '/srv/sabalanerp-qa', source));
});
test('root-owned mode 0400 file in private custody passes path inspection', () =>
  assert.doesNotThrow(() => inspectCustodyPath('/srv/sabalanerp-qa/pinned.json', '/srv/sabalanerp-qa', fakeCustody(), [0o400, 0o600])));
test('single no-systemd boot setting passes', () =>
  assert.doesNotThrow(() => assertNoSystemdWslConfig('[boot]\nsystemd=false\n')));
test('duplicate boot section with conflicting systemd setting refuses', () =>
  assert.throws(() => assertNoSystemdWslConfig('[boot]\nsystemd=false\n[boot]\nsystemd=true\n')));
test('duplicate systemd setting in one boot section refuses', () =>
  assert.throws(() => assertNoSystemdWslConfig('[boot]\nsystemd=false\nsystemd=false\n')));
test('later false setting cannot override an earlier true setting', () =>
  assert.throws(() => assertNoSystemdWslConfig('[boot]\nsystemd=true\nsystemd=false\n')));
