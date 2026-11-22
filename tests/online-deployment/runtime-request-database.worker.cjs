'use strict';
// Native test helper, never loaded by the application entrypoint.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const readline = require('node:readline');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('/app/node_modules/@prisma/client');
const express = require('/app/node_modules/express');
const { KernelWriteAdmission } = require('./kernelWriteAdmission');
const { RuntimeBoundaryJournal } = require('./runtimeBoundaryJournal');
const { RuntimeTaskAdmission } = require('./runtimeTaskAdmission');
const { RuntimeWorkBoundary } = require('./runtimeWorkBoundary');
const { runtimeDatabaseUrl } = require('./runtimeDatabaseBoundary');
const { root, scope, databaseName } = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
assert.match(root, /^\/app\/online-runtime-acceptance\/request-database-[a-f0-9]{32}$/);
assert.match(databaseName, /^sabalanerp_concurrency_[a-f0-9]{16}$/);
assert.equal(fs.realpathSync(root), root);
const gateFile = path.join(root, 'deployment-write-admission.lock');
const journal = new RuntimeBoundaryJournal(path.join(root, scope.runtimeId), scope);
const gate = new KernelWriteAdmission(gateFile, scope.gate, () => {});
const admission = new RuntimeTaskAdmission(gate, journal, () => {});
const boundary = new RuntimeWorkBoundary(admission, () => true, () => {});
const source = new URL(process.env.DATABASE_URL);
assert.equal(source.hostname, 'postgres'); assert.equal(source.port, '5432'); assert.equal(source.pathname, '/sabalanerp');
assert.equal(source.searchParams.get('application_name'), 'sabalanerp-online-candidate');
source.pathname = '/' + databaseName; source.searchParams.delete('application_name');
// Exactly one temporary fixture client, finally closed after actual drain.
const database = new PrismaClient({ datasources: { db: { url: runtimeDatabaseUrl(source.toString(), scope) } } });
const deferred = () => { let resolve; const promise = new Promise(value => { resolve = value; }); return { promise, resolve }; };
const work = new Map(); let exclusive, server, port, handlers = 0, stopping = false;
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
function item(id, mode) {
  assert.match(id, /^[a-z][a-z0-9-]{0,40}$/); assert.equal(work.has(id), false);
  const value = { id, mode, entered: deferred(), finish: deferred(), done: deferred(), closed: deferred(), response: deferred(), error: undefined };
  work.set(id, value); return value;
}
async function transaction(value, response) {
  try {
    await database.$transaction(async tx => {
      await tx.$executeRaw`INSERT INTO runtime_request_probe (id, runtime_id, amount, quantity) VALUES (${value.id}, ${scope.runtimeId}, 123456789.12345678, 0.00000001)`;
      if (value.mode === 'early') response.status(202).end('accepted');
      value.entered.resolve();
      await value.finish.promise;
    }, { maxWait: 5000, timeout: 180000 });
    if (response && !response.destroyed && !response.writableEnded) response.status(200).end('committed');
  } catch (error) { value.error = error; throw error; }
  finally { value.done.resolve(); }
}
const application = express();
application.use(boundary.middleware);
application.post('/probe/:id', async (request, response) => {
  handlers++;
  const value = work.get(request.params.id); assert.ok(value);
  response.once('close', () => value.closed.resolve());
  await transaction(value, response);
});
application.use((error, _request, response, _next) => response.status(error.status || error.statusCode || 503).end(error.code || error.message));
boundary.requests.install(application);
function request(value) {
  const client = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/probe/' + value.id, agent: false }, response => {
    response.resume(); response.once('end', () => value.response.resolve({ status: response.statusCode }));
  });
  client.on('error', error => value.response.resolve({ lost: true, code: error.code })); client.end(); return client;
}
async function run(command) {
  switch (command.operation) {
    case 'begin': {
      const value = item(command.reference, command.mode);
      if (command.mode === 'background') {
        value.background = boundary.runBackground(() => transaction(value));
        value.background.catch(() => {});
      } else value.client = request(value);
      await Promise.race([value.entered.promise, value.done.promise.then(() => { throw value.error || Error('WORK_ENDED_BEFORE_ENTRY'); })]);
      if (command.mode === 'early') assert.equal((await value.response.promise).status, 202);
      if (command.mode === 'disconnect') {
        value.client.destroy(); await value.closed.promise; assert.equal((await value.response.promise).lost, true);
      }
      return { handlers, snapshot: await journal.inspect() };
    }
    case 'finish': {
      const value = work.get(command.reference); assert.ok(value); value.finish.resolve(); await value.done.promise;
      if (value.background) await value.background;
      if (value.error) throw value.error;
      // HTTP's promise adapter owns its final release; the parent asserts drain separately.
      return { committed: true };
    }
    case 'refused-http': {
      const before = handlers, value = item(command.reference, 'refused'); value.client = request(value);
      const result = await value.response.promise; assert.equal(result.status, 503); assert.equal(handlers, before);
      return { status: result.status, handlerEntered: false };
    }
    case 'waiting-http': {
      // Control commands must remain available while a new HTTP admission
      // waits outside an actual EX capture. Do not await this response here.
      const before = handlers, value = item(command.reference, 'early');
      let answered = false; void value.response.promise.then(() => { answered = true; });
      value.client = request(value);
      await new Promise(resolve => setTimeout(resolve, 30));
      assert.equal(handlers, before); assert.equal(answered, false);
      return { handlerEntered: false, answered: false, snapshot: await journal.inspect() };
    }
    case 'await-http-entry': {
      const value = work.get(command.reference); assert.ok(value);
      await Promise.race([value.entered.promise, value.done.promise.then(() => { throw value.error || Error('WORK_ENDED_BEFORE_ENTRY'); })]);
      assert.equal((await value.response.promise).status, 202);
      return { entered: true };
    }
    case 'snapshot': return journal.inspect();
    case 'drain': await boundary.stopAndDrain(command.timeoutMs); return {};
    case 'exclusive': {
      assert.equal(exclusive, undefined);
      const descriptor = fs.openSync(gateFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const result = spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', '3'], { stdio: ['ignore', 'ignore', 'ignore', descriptor] });
      assert.equal(result.signal, null); assert.ok([0, 1].includes(result.status));
      if (result.status === 1) { fs.closeSync(descriptor); return { acquired: false }; }
      assert.match(fs.readFileSync(`/proc/self/fdinfo/${descriptor}`, 'utf8'), /FLOCK\s+ADVISORY\s+WRITE/);
      exclusive = descriptor; return { acquired: true };
    }
    case 'unlock': assert.notEqual(exclusive, undefined); fs.closeSync(exclusive); exclusive = undefined; return {};
    case 'stop': {
      assert.equal(exclusive, undefined); await boundary.stopAndDrain(1000);
      for (const value of work.values()) if (value.mode !== 'refused') { await value.done.promise; if (value.error) throw value.error; }
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      stopping = true; return { stopped: true, handlers };
    }
    default: throw Error('UNKNOWN_FIXTURE_OPERATION');
  }
}
(async () => {
  try {
  await journal.initialize(); await database.$connect();
  await new Promise(resolve => { server = application.listen(0, '127.0.0.1', resolve); }); port = server.address().port;
  emit({ ready: true, snapshot: await journal.inspect() });
  let queue = Promise.resolve();
  const lines = readline.createInterface({ input: process.stdin });
  await new Promise(resolveStopped => {
  lines.on('line', line => { queue = queue.then(async () => {
    let command;
    try {
      assert.ok(line.length < 1024); command = JSON.parse(line); const value = await run(command);
      emit({ id: command.id, ok: true, value }); if (value.stopped) { lines.close(); process.stdin.destroy(); resolveStopped(); }
    } catch (error) { emit({ id: command?.id, ok: false, code: error.code || error.message }); }
  }); });
  // EOF is not a completion signal: live SQL and native ownership stay inspectable.
  lines.on('close', () => { void queue.then(() => { if (!stopping) setInterval(() => {}, 60000); }); });
  });
  } finally { await database.$disconnect(); }
})().catch(error => { emit({ failed: true, code: error.code || error.message }); process.exitCode = 1; });
