import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateManifest } from './qa-zero-state-preflight.mjs';

const initial = 'net:[4026531833]';
const packageHash = 'c294a4df952b9ae54e19e0ab19ac09a7e398fbf7aa8969cfcae07f92dc4f30ac';
const valid = () => ({
  format: 'sabalan-qa-zero-state/v1', distro: 'sabalanerp-qa-debian', initialNetns: initial,
  engineId: '33f03eef-8f8d-45a2-af36-b98958ddacde', dataRoot: '/var/lib/docker', socket: '/run/docker.sock',
  slirpVersion: '1.2.1-1.1', slirpPackageSha256: packageHash,
  slirpBinarySha256: 'a'.repeat(64), slirpPackage: '/srv/sabalanerp-qa/packages/slirp4netns_1.2.1-1.1_amd64.deb',
  dockerVersion: '5:29.2.1-1~debian.13~trixie',
});

test('pinned zero-state manifest identity is accepted', () => assert.doesNotThrow(() => validateManifest(valid(), initial)));
test('other initial namespace refuses', () => assert.throws(() => validateManifest(valid(), 'net:[4026532999]')));
test('Desktop or changed native Engine ID refuses', () => assert.throws(() => validateManifest({ ...valid(), engineId: '587ad864-09c8-4149-ae53-89bb9d93ddfc' }, initial)));
test('package archive hash cannot stand in for measured installed binary', () => assert.throws(() => validateManifest({ ...valid(), slirpBinarySha256: packageHash }, initial)));
test('unscoped package location refuses', () => assert.throws(() => validateManifest({ ...valid(), slirpPackage: '/tmp/slirp.deb' }, initial)));
test('package path traversal refuses', () => assert.throws(() => validateManifest({ ...valid(), slirpPackage: '/srv/sabalanerp-qa/../../tmp/slirp.deb' }, initial)));
