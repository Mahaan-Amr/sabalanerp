'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { once } = require('node:events');
const { createHash } = require('node:crypto');
const { createDurableUpload } = require('./services/durableUpload');
const express = require('/app/node_modules/express');
const { prisma, disconnectDatabase } = require('./lib/prisma');
const { loadOnlineRuntimeScope } = require('./services/onlineRuntimeScope');
const { createScopedRuntimeWork } = require('./services/onlineRuntimeWork');
const { runtimeHttpRequests } = require('./services/httpRequestLifecycle');
const { withRecoveryBackgroundWrite } = require('./services/recoveryRuntime');
const input = loadOnlineRuntimeScope();
let runtimeWork, server;

if (input.scope.purpose === 'capture') require('./native-worker.cjs');
else (async () => {
  // Mimic route modules capturing the default platform lifecycle BEFORE the
  // async runtime factory binds ownership. No lifecycle argument is supplied.
  const upload = input.scope.purpose === 'http' ? createDurableUpload({
    storage: { destination: input.scope.coordinationDirectory + '/diagnostic-uploads/' + input.scope.runtimeId,
      filename: (_request, _file, complete) => complete(null, 'proof.bin') }, limits: { fileSize: 8192 },
  }) : undefined;
  await assert.rejects(createScopedRuntimeWork({ registrySha256: 'c'.repeat(64), generation: 1, canJoin: () => true }), /REGISTRY_MISMATCH/);
  const work = await createScopedRuntimeWork({ registrySha256: input.scope.manifestSha256, generation: 1,
    canJoin: () => true });
  runtimeWork = work;
  assert.strictEqual(work.requests, runtimeHttpRequests);
  const workClaim = JSON.parse(fs.readFileSync(input.scope.boundaryDirectory + '/claim.json'));
  assert.equal(workClaim.format, 'sabalan-runtime-claim/v2');
  assert.deepEqual(workClaim.native, { scopeSha256: input.sha256, claimSha256: process.env.BACKEND_NATIVE_CLAIM_SHA256 });
  const [identity] = await prisma.$queryRawUnsafe("SELECT current_setting('application_name') AS name");
  const mode = process.argv[2];
  if (input.scope.purpose === 'http') {
    let incorrectlyAdmitted = false;
    await assert.rejects(work.runBackground(async () => { incorrectlyAdmitted = true; }), /WORKER_OWNERSHIP/);
    assert.equal(incorrectlyAdmitted, false);
    const app = express(); app.use(work.middleware);
    app.get('/read', async (request, response) => {
      const [value] = await prisma.$queryRawUnsafe("SELECT current_setting('application_name') AS name");
      response.json({ namespace: value.name });
    });
    app.post('/upload', upload.single('proof'), (request, response) => {
      const bytes = fs.readFileSync(request.file.path);
      response.json({ sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
    });
    app.post('/lost-runtime', async (_request, response) => {
      await prisma.$executeRawUnsafe("DO $$ BEGIN PERFORM pg_sleep(3); INSERT INTO online_native_probe VALUES ('lost-runtime', 123456789.12345678, 0.00000001); END $$");
      if (!response.destroyed) response.end('committed');
    });
    app.post('/pause-write', async (_request, response) => {
      await prisma.$executeRawUnsafe("DO $$ BEGIN PERFORM pg_sleep(2); INSERT INTO online_native_probe VALUES ('pause-before', 123456789.12345678, 0.00000001); END $$");
      response.end('committed-before');
    });
    app.post('/pause-queued', async (_request, response) => {
      await prisma.$executeRawUnsafe("INSERT INTO online_native_probe VALUES ('pause-after', 123456789.12345678, 0.00000001)");
      response.end('committed-after');
    });
    app.use((error, _request, response, _next) => response.status(503).json({ code: error.code || error.message }));
    work.requests.install(app);
    server = http.createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const observed = await new Promise((resolve, reject) => {
      const request = http.get({ host: '127.0.0.1', port: server.address().port, path: '/read' }, response => {
        let body = ''; response.on('data', bytes => { body += bytes; }); response.on('error', reject);
        response.once('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
      }); request.once('error', reject);
    });
    assert.deepEqual(observed, { namespace: identity.name });
    const payload = Buffer.from('native durable upload before binding\n');
    const boundary = 'sabalan-scoped-upload';
    const multipart = Buffer.concat([Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="proof"; filename="proof.bin"\r\nContent-Type: application/octet-stream\r\n\r\n'),
      payload, Buffer.from('\r\n--' + boundary + '--\r\n')]);
    const uploaded = await new Promise((resolve, reject) => {
      const request = http.request({ host: '127.0.0.1', port: server.address().port, path: '/upload', method: 'POST',
        headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': multipart.length } }, response => {
        let body = ''; response.on('data', bytes => { body += bytes; }); response.on('error', reject);
        response.once('end', () => { try { assert.equal(response.statusCode, 200); resolve(JSON.parse(body)); } catch (error) { reject(error); } });
      }); request.once('error', reject); request.end(multipart);
    });
    assert.deepEqual(uploaded, { sha256: createHash('sha256').update(payload).digest('hex'), bytes: payload.length });

  } else {
    let dispatched = false;
    const app = express(); app.use(work.middleware);
    app.get('/read', (_request, response) => { dispatched = true; response.end('UNSAFE'); });
    app.use((_error, _request, response, _next) => response.status(503).json({ refused: true }));
    work.requests.install(app);
    server = http.createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const status = await new Promise((resolve, reject) => {
      const request = http.get({ host: '127.0.0.1', port: server.address().port, path: '/read' }, response => {
        response.resume(); response.once('end', () => resolve(response.statusCode));
      }); request.once('error', reject);
    });
    assert.equal(status, 503); assert.equal(dispatched, false);
    if (mode === 'jobs') assert.equal(await withRecoveryBackgroundWrite(() => prisma.$executeRawUnsafe("INSERT INTO online_native_probe VALUES ('worker', 123456789.12345678, 0.00000001)")), 1);
  }
  console.log(JSON.stringify({ event: 'ready', pid: process.pid, namespace: identity.name,
    purpose: input.scope.purpose, ...(server ? { port: server.address().port } : {}) }));
  if (mode === 'lost-runtime') {
    await new Promise((resolve, reject) => {
      const request = http.request({ host: '127.0.0.1', port: server.address().port,
        path: '/lost-runtime', method: 'POST' }, response => { response.resume(); response.once('end', resolve); });
      request.once('error', reject); request.end();
    });
  } else if (mode === 'lost-worker') {
    await withRecoveryBackgroundWrite(() => prisma.$executeRawUnsafe("DO $$ BEGIN PERFORM pg_sleep(3); INSERT INTO online_native_probe VALUES ('lost-worker', 123456789.12345678, 0.00000001); END $$"));
  } else {
    while (!fs.existsSync(input.scope.coordinationDirectory + '/diagnostic-finish/' + input.scope.runtimeId)) await new Promise(resolve => setTimeout(resolve, 20));
  }
  await work.stopAndDrain(2000);
  if (server) await new Promise(resolve => server.close(resolve));
  await disconnectDatabase();
})().catch(async error => {
  console.error(error?.message === 'ONLINE_SCOPED_WORK_NOT_IMPLEMENTED' ? error.message : 'ONLINE_SCOPED_WORK_FAILED');
  try {
    if (runtimeWork) await runtimeWork.stopAndDrain(2000);
    if (server) await new Promise(resolve => server.close(resolve));
    await disconnectDatabase();
  } catch { console.error('ONLINE_SCOPED_WORK_FAILURE_DRAIN_UNPROVEN'); }
  finally { process.exitCode = 1; }
});
