import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import express from 'express';
import { createSharedDurableUpload, configurePrivateVersionedSharedUploads, SHARED_UPLOAD_ROOTS } from '../sharedUploadFileRuntime';
import { runtimeHttpRequests, bindRuntimeHttpWriteAdmission } from '../httpRequestLifecycle';

test('shared upload preserves uncertain SQL references, removes only original unreferenced files and closes late binding', async () => {
  await assert.rejects(configurePrivateVersionedSharedUploads({ boundary: {} as any, roots: [] }), /SHARED_UPLOAD_RUNTIME_SCOPE_INVALID/);
  bindRuntimeHttpWriteAdmission(() => true);
  const root = SHARED_UPLOAD_ROOTS[0];
  const existed = await fs.stat(root).then(() => true, () => false);
  await fs.mkdir(root, { recursive: true });
  const prefix = `shared-${Date.now()}-`;
  const upload = createSharedDurableUpload(root, { storage: { destination: root,
    filename: (_request, file, cb) => cb(null, prefix + file.originalname) } });
  const app = express(); app.use(runtimeHttpRequests.middleware);
  app.post('/upload/:outcome', upload.single('file'), async (request, response, next) => {
    try {
      if (request.params.outcome === 'uncertain') upload.retain(request, request.file);
      const result = await upload.discardUnreferenced(request, request.file);
      response.status(request.params.outcome === 'uncertain' ? 500 : 400).json({ result });
    } catch (error) { next(error); }
  });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as { port:number }).port}`;
  try {
    for (const outcome of ['rejected', 'uncertain']) {
      const body = new FormData(); body.append('file', new Blob(['original bytes']), `${outcome}.png`);
      const response = await fetch(origin + '/upload/' + outcome, { method: 'POST', body });
      assert.equal(response.status, outcome === 'uncertain' ? 500 : 400);
      assert.deepEqual(await response.json(), { result: outcome === 'uncertain' ? 'RETAINED' : 'REMOVED' });
    }
    await assert.rejects(fs.readFile(path.join(root, prefix + 'rejected.png')), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(root, prefix + 'uncertain.png'), 'utf8'), 'original bytes');
    assert.throws(() => upload.retain({} as any, { path: path.join(root, prefix + 'uncertain.png') }), /SHARED_UPLOAD_REQUEST_OWNER_UNPROVEN/);
    await assert.rejects(configurePrivateVersionedSharedUploads({ boundary: {} as any, roots: [] }), /SHARED_UPLOAD_RUNTIME_ALREADY_OBSERVED/);
    assert.throws(() => createSharedDurableUpload(path.join(os.tmpdir(), 'unowned'), {} as any), /SHARED_UPLOAD_ROOT_INVALID/);
  } finally {
    server.close(); server.closeAllConnections(); await once(server, 'close');
    await runtimeHttpRequests.waitForDrain(2000);
    await fs.rm(path.join(root, prefix + 'uncertain.png'), { force: true });
    if (!existed) await fs.rmdir(root);
  }
});
