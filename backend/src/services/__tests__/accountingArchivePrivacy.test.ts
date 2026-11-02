import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApplication } from '../../application';

test('anonymous HTTP cannot fetch private accounting asset evidence', async () => {
  const initial = process.cwd();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'accounting-archive-http-'));
  const files = path.join(root, 'storage', 'accounting-contracts');
  await fs.mkdir(path.join(files, '.official-reports', 'archive-evidence'), { recursive: true });
  await fs.writeFile(path.join(files, '.official-reports', 'archive-evidence', 'private.pdf'), 'private evidence');
  await fs.writeFile(path.join(files, 'public.pdf'), 'public contract');
  process.chdir(root);
  const { server, io } = createApplication({ runtimeRole: 'standalone', isShuttingDown: () => false });
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const publicResponse = await fetch(`${base}/files/accounting-contracts/public.pdf`);
    assert.equal(publicResponse.status, 200);
    assert.equal(await publicResponse.text(), 'public contract');
    for (const privateUrl of [
      '/files/accounting-contracts/.official-reports/archive-evidence/private.pdf',
      '/files/accounting-contracts/%2eofficial-reports/archive-evidence/private.pdf',
    ]) {
      const response = await fetch(`${base}${privateUrl}`);
      assert.ok(response.status >= 400, `${privateUrl}: ${response.status}`);
      assert.notEqual(await response.text(), 'private evidence');
    }
  } finally {
    await new Promise<void>(resolve => io.close(() => resolve()));
    process.chdir(initial);
    await fs.rm(root, { recursive: true, force: true });
  }
});
