import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import express from 'express';
import { configurePrivateVersionedSupportFiles, createSupportDurableUpload, prepareSupportTicketStorage } from '../supportFileRuntime';
import { runtimeHttpRequests, bindRuntimeHttpWriteAdmission } from '../httpRequestLifecycle';

test('original rejected Support uploads are removed but uncertain SQL references are retained', async () => {
  await assert.rejects(configurePrivateVersionedSupportFiles({} as never), /SUPPORT_FILE_RUNTIME_SCOPE_INVALID/);
  const old = process.env.SUPPORT_TICKET_STORAGE_DIR;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sabalan-support-upload-'));
  process.env.SUPPORT_TICKET_STORAGE_DIR = root;
  bindRuntimeHttpWriteAdmission(() => true);
  prepareSupportTicketStorage();
  const upload = createSupportDurableUpload({ storage: { destination: root,
    filename: (_request, file, callback) => callback(null, file.originalname) } });
  const app = express(); app.use(runtimeHttpRequests.middleware);
  app.post('/:outcome', upload.single('file'), async (request, response, next) => {
    try {
      if (request.params.outcome === 'uncertain') upload.retain(request, request.file);
      const result = await upload.discardUnreferenced(request, request.file);
      response.status(400).json({ result });
    } catch (error) { next(error); }
  });
  runtimeHttpRequests.install(app);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as { port:number }).port}`;
  try {
    for (const outcome of ['rejected', 'uncertain']) {
      const body = new FormData(); body.append('file', new Blob(['ORIGINAL SUPPORT EVIDENCE']), outcome + '.txt');
      const response = await fetch(url + '/' + outcome, { method: 'POST', body });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { result: outcome === 'uncertain' ? 'RETAINED' : 'REMOVED' });
    }
    await assert.rejects(fs.readFile(path.join(root, 'rejected.txt')), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(root, 'uncertain.txt'), 'utf8'), 'ORIGINAL SUPPORT EVIDENCE');
    assert.throws(() => upload.retain({} as never, { path: path.join(root, 'uncertain.txt') }), /SUPPORT_UPLOAD_REQUEST_OWNER_UNPROVEN/);
    await assert.rejects(configurePrivateVersionedSupportFiles({} as never), /SUPPORT_FILE_RUNTIME_ALREADY_OBSERVED/);
  } finally {
    server.close(); server.closeAllConnections(); await once(server, 'close');
    await runtimeHttpRequests.waitForDrain(2000);
    if (old === undefined) delete process.env.SUPPORT_TICKET_STORAGE_DIR; else process.env.SUPPORT_TICKET_STORAGE_DIR = old;
    await fs.rm(root, { recursive: true });
  }
});
