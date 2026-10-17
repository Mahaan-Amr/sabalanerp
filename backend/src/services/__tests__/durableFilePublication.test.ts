import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { publishDurableFile, publishDurableStream, removeDurableFile } from '../durableFilePublication';

test('a failed replacement stream preserves the complete prior artifact and an existing reader', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sabalan-file-publication-'));
  const target = path.join(root, 'artifact.pdf');
  try {
    await publishDurableFile(target, Buffer.from('approved original PDF'));
    const reader = await fs.open(target, 'r'); let closed = false;
    try {
      const interrupted = Readable.from((async function* () {
        yield Buffer.from('partial replacement');
        throw new Error('UPLOAD_INTERRUPTED');
      })());
      await assert.rejects(publishDurableStream(target, interrupted, { replace: true }), /UPLOAD_INTERRUPTED/);
      assert.equal(await fs.readFile(target, 'utf8'), 'approved original PDF');
      assert.equal(await reader.readFile('utf8'), 'approved original PDF');
      assert.deepEqual(await fs.readdir(root), ['artifact.pdf']);
      if (process.platform === 'win32') {
        // Windows refuses replacement while this reader owns the target. It
        // must retain the old bytes, never emulate rename by deleting them.
        await assert.rejects(publishDurableFile(target, Buffer.from('complete replacement PDF'), { replace: true }),
          (error: any) => error.code === 'EPERM');
        assert.equal(await fs.readFile(target, 'utf8'), 'approved original PDF');
        await reader.close(); closed = true;
      }
      await publishDurableFile(target, Buffer.from('complete replacement PDF'), { replace: true });
      assert.equal(await fs.readFile(target, 'utf8'), 'complete replacement PDF');
      if (!closed) {
        const original = Buffer.alloc(21);
        await reader.read(original, 0, original.length, 0);
        assert.equal(original.toString(), 'approved original PDF');
      }
    } finally { if (!closed) await reader.close(); }
    assert.equal(await removeDurableFile(target), true);
    assert.equal(await removeDurableFile(target), false);
  } finally { await fs.rm(root, { recursive: true }); }
});

test('concurrent creates never overwrite another complete artifact and render buffers are frozen at admission', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sabalan-file-create-'));
  try {
    const target = path.join(root, 'nested', 'artifact.pdf');
    const first = Buffer.from('first approved PDF');
    const pending = publishDurableFile(target, first);
    first.fill(0);
    const results = await Promise.allSettled([pending, publishDurableFile(target, Buffer.from('second approved PDF'))]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    assert.equal(rejected.reason.code, 'EEXIST');
    assert.equal(await fs.readFile(target, 'utf8'), results[0].status === 'fulfilled' ? 'first approved PDF' : 'second approved PDF');
    assert.deepEqual(await fs.readdir(path.dirname(target)), ['artifact.pdf']);
  } finally { await fs.rm(root, { recursive: true }); }
});

test('file and directory symlinks never replace or expose another storage target', { skip: process.platform === 'win32' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sabalan-file-alias-'));
  try {
    const actual = path.join(root, 'actual'); await fs.mkdir(actual, { mode: 0o700 });
    const outside = path.join(actual, 'retained.pdf'); await fs.writeFile(outside, 'retained private PDF');
    const alias = path.join(root, 'alias.pdf'); await fs.symlink(outside, alias);
    await assert.rejects(publishDurableFile(alias, Buffer.from('replacement'), { replace: true }), /TARGET_NOT_REGULAR/);
    const directory = path.join(root, 'alias-directory'); await fs.symlink(actual, directory);
    await assert.rejects(publishDurableFile(path.join(directory, 'other.pdf'), Buffer.from('replacement')), /DIRECTORY_ALIAS/);
    assert.equal(await fs.readFile(outside, 'utf8'), 'retained private PDF');
    assert.deepEqual(await fs.readdir(actual), ['retained.pdf']);
  } finally { await fs.rm(root, { recursive: true }); }
});
