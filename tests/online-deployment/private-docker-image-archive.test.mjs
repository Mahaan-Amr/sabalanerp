import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { inspectPrivateDockerArchive } from '../../scripts/lib/private-docker-image-archive.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function graph(wrongLayerSize = false) {
  const entries = [], add = bytes => {
    const digest = 'sha256:' + sha(bytes); entries.push(['blobs/sha256/' + digest.slice(7), bytes]);
    return { digest, size: bytes.length };
  };
  const layer = add(Buffer.from('immutable private layer'));
  const config = add(Buffer.from(JSON.stringify({ os: 'linux', architecture: 'amd64', rootfs: { type: 'layers', diff_ids: [layer.digest] } })));
  const platform = add(Buffer.from(JSON.stringify({ schemaVersion: 2, config, layers: [{ ...layer, size: layer.size + Number(wrongLayerSize) }] })));
  const index = add(Buffer.from(JSON.stringify({ schemaVersion: 2, manifests: [{ ...platform, platform: { os: 'linux', architecture: 'amd64' } }] })));
  entries.push(['manifest.json', Buffer.from(JSON.stringify([{ Config: 'blobs/sha256/' + config.digest.slice(7), Layers: ['blobs/sha256/' + layer.digest.slice(7)] }]))]);
  return { entries, index: index.digest, config: config.digest };
}
function tar(entries) {
  const blocks = [];
  for (const [name, bytes] of entries) {
    const header = Buffer.alloc(512);
    header.write(name); header.write('0000600\0', 100); header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124);
    header.fill(32, 148, 156); header[156] = 48; header.write('ustar\0', 257);
    const checksum = header.reduce((sum, value) => sum + value, 0);
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return Buffer.concat([...blocks, Buffer.alloc(1024)]);
}
function withArchive(bytes, run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-private-image-archive-'));
  const file = path.join(directory, 'image.tar');
  try { fs.writeFileSync(file, bytes, { flag: 'wx' }); run(fs.realpathSync(file)); }
  finally {
    // Only these two exact, newly-created local test entries are removed.
    assert.equal(fs.realpathSync(path.dirname(directory)), fs.realpathSync(os.tmpdir()));
    assert.equal(fs.realpathSync(directory), directory);
    fs.unlinkSync(file); fs.rmdirSync(directory);
  }
}
test('verifies the actual index/platform/config/layer bytes and whole archive', () => {
  const value = graph(), bytes = tar(value.entries);
  withArchive(bytes, file => {
    const result = inspectPrivateDockerArchive(file, value.index);
    assert.equal(result.index, value.index); assert.equal(result.config, value.config);
    assert.equal(result.archiveSha256, sha(bytes)); assert.equal(result.blobs, 4);
  });
});
test('rejects a changed layer even when tar metadata and graph names are unchanged', () => {
  const value = graph(); value.entries[0][1][0] ^= 1;
  withArchive(tar(value.entries), file => assert.throws(() => inspectPrivateDockerArchive(file, value.index)));
});
test('rejects a content-addressed graph with the wrong referenced layer size', () => {
  const value = graph(true);
  withArchive(tar(value.entries), file => assert.throws(() => inspectPrivateDockerArchive(file, value.index)));
});
test('rejects duplicate archive entries and altered header checksums', () => {
  const value = graph();
  withArchive(tar([...value.entries, value.entries[0]]), file => assert.throws(() => inspectPrivateDockerArchive(file, value.index)));
  const altered = tar(value.entries); altered[0] ^= 1;
  withArchive(altered, file => assert.throws(() => inspectPrivateDockerArchive(file, value.index)));
});
test('rejects an unrelated requested root index', () => {
  const value = graph();
  withArchive(tar(value.entries), file => assert.throws(() => inspectPrivateDockerArchive(file, 'sha256:' + '0'.repeat(64))));
});
