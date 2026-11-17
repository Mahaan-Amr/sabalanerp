// Byte verification for private local diagnostics. No release/admission flags.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

export function inspectPrivateDockerArchive(file, expectedIdentity, { allowConfigIdentity = false } = {}) {
  assert.match(expectedIdentity, /^sha256:[a-f0-9]{64}$/);
  assert.equal(fs.realpathSync(file), file);
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(descriptor, { bigint: true }), entries = new Map();
    assert.ok(before.isFile() && before.nlink === 1n && before.size > 1024n && before.size < 2n * 1024n ** 3n);
    const length = Number(before.size), header = Buffer.alloc(512), block = Buffer.alloc(1024 * 1024);
    const text = bytes => bytes.toString('utf8').split('\0')[0];
    const octal = bytes => { const value = bytes.toString('ascii').replace(/\0.*$/, '').trim();
      assert.match(value, /^[0-7]*$/); return Number.parseInt(value || '0', 8); };
    for (let offset = 0, count = 0; offset + 512 <= length;) {
      assert.ok(++count < 250000);
      assert.equal(fs.readSync(descriptor, header, 0, 512, offset), 512);
      if (header.every(value => value === 0)) break;
      const checksum = header.reduce((sum, value, index) => sum + (index >= 148 && index < 156 ? 32 : value), 0);
      assert.equal(octal(header.subarray(148, 156)), checksum);
      const prefix = text(header.subarray(345, 500)), name = text(header.subarray(0, 100));
      const entry = prefix ? prefix + '/' + name : name, size = octal(header.subarray(124, 136));
      assert.ok(entry && !entry.startsWith('/') && !entry.split('/').includes('..') && !entry.includes('\\'));
      assert.ok(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= length);
      assert.ok([0, 48, 53].includes(header[156]));
      if (header[156] !== 53) { assert.ok(!entries.has(entry)); entries.set(entry, { offset: offset + 512, size }); }
      offset += 512 + Math.ceil(size / 512) * 512;
    }
    const hashRange = (offset, size) => {
      const hash = createHash('sha256');
      for (let read = 0; read < size;) {
        const count = Math.min(block.length, size - read);
        assert.equal(fs.readSync(descriptor, block, 0, count, offset + read), count);
        hash.update(block.subarray(0, count)); read += count;
      }
      return hash.digest('hex');
    };
    let blobs = 0;
    for (const [name, entry] of entries) if (name.startsWith('blobs/sha256/')) {
      assert.match(name, /^blobs\/sha256\/[a-f0-9]{64}$/);
      assert.equal(hashRange(entry.offset, entry.size), name.slice(13)); blobs++;
    }
    const json = name => {
      const entry = entries.get(name); assert.ok(entry && entry.size > 0 && entry.size <= 1024 * 1024);
      const bytes = Buffer.alloc(entry.size);
      assert.equal(fs.readSync(descriptor, bytes, 0, bytes.length, entry.offset), bytes.length);
      return JSON.parse(bytes.toString('utf8'));
    };
    const blob = value => { assert.match(value, /^sha256:[a-f0-9]{64}$/); return 'blobs/sha256/' + value.slice(7); };
    const identityDocument = json(blob(expectedIdentity));
    const isLinuxAmd64 = value => value?.os === 'linux' && value?.architecture === 'amd64';
    const readDescriptor = descriptor => {
      const name = blob(descriptor.digest);
      const document = json(name);
      assert.equal(entries.get(name).size, descriptor.size);
      assert.equal(document.schemaVersion, 2);
      return document;
    };
    let indexDigest = expectedIdentity;
    let platformDescriptor;
    if (Array.isArray(identityDocument.manifests)) {
      assert.equal(identityDocument.schemaVersion, 2);
      const platforms = identityDocument.manifests.filter(value => isLinuxAmd64(value.platform));
      assert.equal(platforms.length, 1);
      [platformDescriptor] = platforms;
    } else {
      assert.ok(allowConfigIdentity && isLinuxAmd64(identityDocument));
      const layout = json('index.json');
      assert.equal(layout.schemaVersion, 2);
      assert.ok(Array.isArray(layout.manifests));
      const matches = [];
      for (const root of layout.manifests) {
        if (root.platform && !isLinuxAmd64(root.platform)) continue;
        const document = readDescriptor(root);
        if (Array.isArray(document.manifests)) {
          for (const candidate of document.manifests.filter(value => isLinuxAmd64(value.platform))) {
            if (readDescriptor(candidate).config?.digest === expectedIdentity) {
              matches.push({ index: root.digest, descriptor: candidate });
            }
          }
        } else if (document.config?.digest === expectedIdentity) {
          matches.push({ index: null, descriptor: root });
        }
      }
      assert.equal(matches.length, 1);
      indexDigest = matches[0].index;
      platformDescriptor = matches[0].descriptor;
    }
    const platform = readDescriptor(platformDescriptor);
    const config = json(blob(platform.config.digest));
    assert.equal(entries.get(blob(platform.config.digest)).size, platform.config.size);
    assert.equal(config.os, 'linux'); assert.equal(config.architecture, 'amd64'); assert.equal(config.rootfs.type, 'layers');
    assert.equal(config.rootfs.diff_ids.length, platform.layers.length);
    for (const layer of platform.layers) assert.equal(entries.get(blob(layer.digest))?.size, layer.size);
    const compatibility = json('manifest.json'); assert.equal(compatibility.length, 1);
    assert.equal(compatibility[0].Config, blob(platform.config.digest));
    assert.deepEqual(compatibility[0].Layers, platform.layers.map(layer => blob(layer.digest)));
    const archiveSha256 = hashRange(0, length), after = fs.fstatSync(descriptor, { bigint: true }), named = fs.lstatSync(file, { bigint: true });
    // Node/Windows reports the named-path device as zero while fstat returns
    // the volume serial. Keep the same file index/times/size checks there.
    const identity = value => [process.platform === 'win32' ? 0n : value.dev,
      value.ino, value.size, value.mtimeNs, value.ctimeNs, value.nlink].map(String).join(':');
    assert.equal(identity(before), identity(after)); assert.equal(identity(before), identity(named));
    return { index: indexDigest, platform: platformDescriptor.digest, config: platform.config.digest,
      rootfsDiffIds: config.rootfs.diff_ids, blobs, archiveSha256, archiveBytes: length };
  } finally { fs.closeSync(descriptor); }
}
