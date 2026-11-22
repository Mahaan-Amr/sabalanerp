import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { createDurableUpload } from '../durableUpload';
import { HttpRequestLifecycle } from '../httpRequestLifecycle';
import { errorHandler } from '../../middleware/errorHandler';
import { publishDurableFile } from '../durableFilePublication';

test('multipart rejection removes every owned file before error handoff and never truncates a colliding artifact', async () => {
  const root = await fs.mkdtemp(path.join(process.env.ONLINE_FILE_TEST_ROOT || os.tmpdir(), 'sabalan-durable-upload-'));
  const lifecycle = new HttpRequestLifecycle(() => true), app = express(); let accepted = 0;
  const upload = createDurableUpload({ storage: { destination: root,
    filename: (_request, file, callback) => callback(null, file.originalname) },
    limits: { fileSize: 64, files: 2 } }, lifecycle);
  app.use(lifecycle.middleware);
  app.post('/upload', upload.array('files', 2), (request, response) => {
    accepted++; response.json({ sizes: (request.files as Express.Multer.File[]).map(file => file.size) });
  });
  app.use((error: any, _request: any, response: any, _next: any) => {
    assert.equal(error.storageErrors?.length || 0, 0, 'ordinary multipart rejection must complete every owned cleanup');
    response.status(400).json({ code: error.code });
  });
  lifecycle.install(app);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const valid = new FormData(); valid.append('files', new Blob(['approved attachment']), 'approved.pdf');
    assert.equal((await fetch(origin + '/upload', { method: 'POST', body: valid })).status, 200);
    assert.equal(await fs.readFile(path.join(root, 'approved.pdf'), 'utf8'), 'approved attachment');
    const collision = new FormData(); collision.append('files', new Blob(['wrong replacement']), 'approved.pdf');
    assert.equal((await fetch(origin + '/upload', { method: 'POST', body: collision })).status, 400);
    assert.equal(await fs.readFile(path.join(root, 'approved.pdf'), 'utf8'), 'approved attachment');
    const rejected = new FormData();
    rejected.append('files', new Blob(['first unaccepted attachment']), 'unaccepted.pdf');
    rejected.append('files', new Blob([Buffer.alloc(128, 5)]), 'too-large.pdf');
    const result = await fetch(origin + '/upload', { method: 'POST', body: rejected });
    assert.equal(result.status, 400); assert.equal((await result.json() as any).code, 'LIMIT_FILE_SIZE');
    await lifecycle.waitForDrain(2000);
    assert.equal(accepted, 1);
    assert.deepEqual(await fs.readdir(root), ['approved.pdf']);

    // Finish a real first part and wait until its complete file is visible,
    // then reject the next field. Fast in-memory FormData alone can reject
    // before any file was actually published and would miss this cleanup path.
    const streamed = http.request(origin + '/upload', { method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=owned-batch' } });
    const response = new Promise<{ status: number; code: string }>((resolve, reject) => {
      streamed.once('error', reject);
      streamed.once('response', incoming => {
        let body = ''; incoming.on('data', chunk => { body += chunk; });
        incoming.once('end', () => resolve({ status: incoming.statusCode!, code: JSON.parse(body).code }));
      });
    });
    streamed.write('--owned-batch\r\nContent-Disposition: form-data; name="files"; filename="completed-part.pdf"\r\nContent-Type: application/pdf\r\n\r\ncompleted first part\r\n--owned-batch\r\n');
    const deadline = performance.now() + 3000;
    while (!(await fs.readdir(root)).includes('completed-part.pdf')) {
      if (performance.now() > deadline) throw Error('FIRST_PART_NEVER_PUBLISHED');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(await fs.readFile(path.join(root, 'completed-part.pdf'), 'utf8'), 'completed first part');
    streamed.end('Content-Disposition: form-data; name="unexpected"; filename="rejected.pdf"\r\nContent-Type: application/pdf\r\n\r\nrejected\r\n--owned-batch--\r\n');
    assert.deepEqual(await response, { status: 400, code: 'LIMIT_UNEXPECTED_FILE' });
    await lifecycle.waitForDrain(2000);
    assert.equal(accepted, 1); assert.deepEqual(await fs.readdir(root), ['approved.pdf']);
  } finally {
    server.close(); server.closeAllConnections(); await once(server, 'close');
    await fs.rm(root, { recursive: true });
  }
});

test('an early upload response cannot release an ignored asynchronous business callback', async () => {
  const root = await fs.mkdtemp(path.join(process.env.ONLINE_FILE_TEST_ROOT || os.tmpdir(), 'sabalan-upload-callback-'));
  const lifecycle = new HttpRequestLifecycle(() => true), app = express(); let completed = 0;
  let businessStarted = false, businessFinished!: () => void;
  const businessDone = new Promise<void>(resolve => { businessFinished = resolve; });
  let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
  const upload = createDurableUpload({ storage: { destination: root,
    filename: (_request, _file, callback) => callback(null, 'approved.pdf') } }, lifecycle);
  app.use(lifecycle.middleware);
  app.post('/upload', (request, response, next) => {
    // Express 4/the caller deliberately ignores this middleware's return value.
    upload.single('file')(request, response, async (error?: unknown) => {
      businessStarted = true;
      try {
        if (error) return next(error);
        response.sendStatus(202);
        await barrier;
        await publishDurableFile(path.join(root, 'receipt.txt'), Buffer.from('one completed receipt'));
        completed++;
      } finally { businessFinished(); }
    });
  });
  app.use(errorHandler); lifecycle.install(app);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const body = new FormData(); body.append('file', new Blob(['approved attachment']), 'approved.pdf');
    const result = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/upload`, { method: 'POST', body });
    assert.equal(result.status, 202); await result.text();
    await assert.rejects(lifecycle.waitForDrain(20), /HTTP_REQUEST_DRAIN_TIMEOUT/);
    assert.equal(completed, 0);
    release(); await lifecycle.waitForDrain(2000);
    assert.equal(completed, 1);
    assert.equal(await fs.readFile(path.join(root, 'receipt.txt'), 'utf8'), 'one completed receipt');
  } finally {
    release(); server.close(); server.closeAllConnections(); await once(server, 'close');
    if (businessStarted) await businessDone;
    await lifecycle.waitForDrain(2000); await fs.rm(root, { recursive: true });
  }
});

test('a disconnected multipart request keeps actual file completion in the request drain', async () => {
  const root = await fs.mkdtemp(path.join(process.env.ONLINE_FILE_TEST_ROOT || os.tmpdir(), 'sabalan-aborted-upload-'));
  const lifecycle = new HttpRequestLifecycle(() => true), app = express(); let accepted = 0;
  const upload = createDurableUpload({ storage: { destination: root,
    filename: (_request, _file, callback) => callback(null, 'aborted.pdf') } }, lifecycle);
  app.use(lifecycle.middleware);
  app.post('/upload', upload.single('file'), (_request, response) => { accepted++; response.sendStatus(201); });
  app.use(errorHandler);
  lifecycle.install(app);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const request = http.request({ host: '127.0.0.1', port: (server.address() as { port: number }).port,
      path: '/upload', method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=sabalan-boundary' } });
    request.on('error', () => {});
    request.write('--sabalan-boundary\r\nContent-Disposition: form-data; name="file"; filename="aborted.pdf"\r\nContent-Type: application/pdf\r\n\r\n');
    request.write(Buffer.alloc(16384, 7));
    const deadline = performance.now() + 3000;
    while (!(await fs.readdir(root)).some(name => name.startsWith('.sabalan-file-'))) {
      if (performance.now() > deadline) throw Error('UPLOAD_NEVER_STARTED');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    request.destroy();
    await new Promise(resolve => setTimeout(resolve, 20));
    await lifecycle.waitForDrain(2000);
    assert.equal(accepted, 0); assert.deepEqual(await fs.readdir(root), []);
  } finally {
    server.close(); server.closeAllConnections(); await once(server, 'close');
    await fs.rm(root, { recursive: true });
  }
});
