import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { archiveWritePath, resolveArchiveReadPath } from '../accountingArchiveStorage';

test('historical archive evidence remains readable while new evidence uses protected storage', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'accounting-archive-'));
  try {
    const oldRoot = path.join(root, 'storage', 'accounting-archive');
    const newRoot = path.join(root, 'storage', 'accounting-contracts', 'accounting-archive');
    await fs.mkdir(oldRoot, { recursive: true });
    await fs.mkdir(newRoot, { recursive: true });
    await fs.writeFile(path.join(oldRoot, 'historical.pdf'), 'historical evidence');
    assert.equal(await resolveArchiveReadPath('historical.pdf', root), path.join(oldRoot, 'historical.pdf'));
    assert.equal(archiveWritePath('new.pdf', root), path.join(newRoot, 'new.pdf'));
    await fs.writeFile(path.join(newRoot, 'new.pdf'), 'new evidence');
    assert.equal(await resolveArchiveReadPath('new.pdf', root), path.join(newRoot, 'new.pdf'));
    await assert.rejects(() => resolveArchiveReadPath('../outside.pdf', root), /معتبر نیست/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
