import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { RuntimeWorkBoundary } from '../../backend/src/services/runtimeWorkBoundary';
import { VersionedFilePublication } from '../../backend/src/services/versionedFilePublication';

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
/** Actual native worker owns every stream and claim. Deliberately damaged
 * stores remain private diagnostics with unresolved READ intents: they are
 * never enrolled as successfully settled/capturable application sources. */
export async function qualifySettledDigest(input: {
  boundary: RuntimeWorkBoundary; publication: VersionedFilePublication; root: string; diagnosticsDirectory: string;
}) {
  const { boundary, publication, root } = input;
  assert.ok(publication.ownsRoot(root) && publication.ownsWork(boundary.context));
  return boundary.runBackground(async () => {
    const files = await publication.bindRoot(root), key = 'digest-' + randomUUID() + '.bin';
    const chunk = Buffer.alloc(262144, 0xa7), chunks = 68, size = chunks * chunk.length;
    const expected = createHash('sha256'); for (let i = 0; i < chunks; i++) expected.update(chunk);
    const expectedSha256 = expected.digest('hex');
    async function* source() { for (let i = 0; i < chunks; i++) yield chunk; }
    const uploaded = await files.publishUpload(key, Readable.from(source(), { objectMode: false, highWaterMark: 262144 }));
    assert.equal(uploaded.byteLength, size); assert.ok(size > 16 * 1024 * 1024);
    // The previous buffer API remains bounded at16MiB; the new streaming
    // API admits a larger legitimate domain object without relaxing it.
    assert.throws(() => files.readSettled(key, size), /FILE_VERSION_READ_LIMIT/);
    assert.throws(() => files.readSettledDigest(key, 101 * 1024 * 1024 + 1), /FILE_VERSION_READ_LIMIT/);
    await assert.rejects(files.readSettledDigest(key, size - 1), /FILE_VERSION_READ_LIMIT/);
    const first = await files.readSettledDigest(key, size);
    assert.deepEqual(first, { head: { operation: 'PUT', versionSha256: uploaded.versionSha256, byteLength: size }, sha256: expectedSha256, byteLength: size });
    // Exact history through another PUT and DELETE remains independently
    // readable; a refused lower limit retired only its own untouched claim.
    const replacement = Buffer.from('settled-digest second generation');
    const second = await files.publish(key, replacement, { replace: true });
    assert.equal((await files.readSettledDigest(key, size)).sha256, sha(replacement));
    const original = await files.readVersion(key, uploaded.versionSha256); assert.ok(original);
    assert.equal(original.length, size); assert.equal(sha(original), expectedSha256);
    const deletion = await files.removeUpload(key, second);
    assert.deepEqual(await files.readSettledDigest(key, 0), { head: { operation: 'DELETE', versionSha256: deletion, byteLength: 0 }, sha256: null, byteLength: 0 });
    assert.deepEqual(await files.readSettledDigest('absent-' + randomUUID(), 0), { head: null, sha256: null, byteLength: 0 });
    await assert.rejects(files.readSettledDigest('../escape', size), /FILE_VERSION_KEY_INVALID/);

    const unknowns: Array<{ reason: string; directory: string; originalVersion: string; pending: number; noAdoption: true }> = [];
    for (const reason of ['corrupt-object', 'missing-ancestor']) {
      const directory = path.join(input.diagnosticsDirectory, 'digest-' + reason + '-' + randomUUID());
      const store = path.join(directory, 'store'), live = path.join(directory, 'live');
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      await fs.mkdir(store, { mode: 0o700 }); await fs.mkdir(live, { mode: 0o700 });
      const diagnostic = await VersionedFilePublication.open(store, live, boundary.context), port = await diagnostic.bindRoot(live);
      const firstVersion = await port.publish('evidence.bin', Buffer.from('private immutable digest evidence'));
      if (reason === 'corrupt-object') {
        const version = JSON.parse(await fs.readFile(path.join(store, 'versions', firstVersion + '.json'), 'utf8'));
        const target = path.join(store, 'objects', version.object.name), bytes = await fs.readFile(target); bytes[0] ^= 0xff;
        await fs.chmod(target, 0o600); await fs.writeFile(target, bytes); await fs.chmod(target, 0o400);
      } else {
        await port.publish('evidence.bin', Buffer.from('private second generation'), { replace: true });
        await fs.unlink(path.join(store, 'versions', firstVersion + '.json'));
      }
      await assert.rejects(port.readSettledDigest('evidence.bin', size), reason === 'corrupt-object' ? /FILE_VERSION_OBJECT_CHANGED/ : /ENOENT/);
      const pendingBefore = await fs.readdir(path.join(store, 'pending')); assert.equal(pendingBefore.length, 1);
      const intent = JSON.parse(await fs.readFile(path.join(store, 'pending', pendingBefore[0]), 'utf8'));
      assert.equal(intent.operation, 'READ'); assert.equal(intent.key, 'evidence.bin');
      await assert.rejects(port.readSettledDigest('evidence.bin', size), /FILE_VERSION_KEY_UNSETTLED/);
      await assert.rejects(port.remove('evidence.bin'), /EEXIST/);
      assert.deepEqual(await fs.readdir(path.join(store, 'pending')), pendingBefore);
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(store, 'pending', pendingBefore[0]), 'utf8')), intent);
      unknowns.push({ reason, directory, originalVersion: firstVersion, pending: 1, noAdoption: true });
    }
    return { format: 'sabalan-native-settled-digest/v1', nativeJobsOwner: true, streamingChunkBytes: chunk.length,
      largeObjectBytes: size, sha256: expectedSha256, originalVersionSha256: uploaded.versionSha256,
      finalVersionSha256: deletion, oldBufferLimitUnchanged: true, refusedLimitClaimRetired: true,
      exactHistoricalBytesVerified: true, unknowns, diagnosticStoresExcludedFromCapture: true };
  });
}
