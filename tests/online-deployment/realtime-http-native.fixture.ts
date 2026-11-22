import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { PrismaClient } from '@prisma/client';
import { loadOnlineRuntimeScope } from '../../backend/src/services/onlineRuntimeScope';
import { runtimeNativePostgresApplicationName } from '../../backend/src/services/runtimeBoundaryJournal';
import { executeRealtimeCallback } from '../../backend/src/services/onlineRuntimeWork';

const until = async (condition: () => Promise<boolean> | boolean) => {
  const deadline = Date.now() + 10000;
  while (!await condition()) { assert.ok(Date.now() < deadline, 'NATIVE_REALTIME_OBSERVATION_TIMEOUT'); await new Promise(resolve => setTimeout(resolve, 10)); }
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

/** Run in a separate genuine HTTP actor BEFORE construction, or in an actual
 * jobs actor. The first refused HTTP observation deliberately prevents later
 * owner installation in that same process; it cannot be used as a reset. */
export async function qualifyOnlineRealtimeRefusal(db: PrismaClient, purpose: 'http' | 'jobs') {
  assert.equal(loadOnlineRuntimeScope()?.scope.purpose, purpose);
  let reachedSql = false;
  await assert.rejects(executeRealtimeCallback(async () => {
    reachedSql = true; await db.$queryRaw`SELECT 1`; return true;
  }), /ONLINE_REALTIME_OWNER_UNPROVEN/);
  assert.equal(reachedSql, false);
  return { genuinePurpose: purpose, refusedBeforeSqlCallback: true, productionAdmission: false };
}

/** Fixture-only alternate client owns an isolated database lock/observer.
 * Actual subject authentication still executes through the canonical app's
 * singleton and real HTTP-purpose callback owner. No fake callback or file
 * admission substitutes for the SQL query that is demonstrably blocked. */
export async function qualifyNativeHttpRealtime(input: { baseUrl: string; databaseUrl: string; sessionToken: string;
  reporterId: string; whileCallbackHeld?: () => Promise<void> }) {
  const scope = loadOnlineRuntimeScope(); assert.ok(scope); assert.equal(scope.scope.purpose, 'http');
  const base = new URL(input.baseUrl); assert.equal(base.protocol, 'http:');
  const enrolledHost = process.env.APPLICATION_NATIVE_BIND_HOST;
  assert.equal(typeof enrolledHost, 'string');
  assert.match(enrolledHost!, /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/);
  assert.equal(base.hostname, enrolledHost, 'NATIVE_REALTIME_ENROLLED_HOST_CHANGED');
  assert.ok(Object.values(networkInterfaces()).flat().some(value => value && !value.internal
    && value.family === 'IPv4' && value.address === enrolledHost), 'NATIVE_REALTIME_INTERFACE_ABSENT');
  assert.equal(base.username + base.password + base.search + base.hash, '');
  assert.equal(base.pathname, '/');
  const url = new URL(input.databaseUrl); assert.match(url.pathname, /^\/qa_[a-z_]+_[a-f0-9]{32}$/);
  url.searchParams.set('application_name', 'qa_realtime_observer_' + randomUUID().replaceAll('-', ''));
  url.searchParams.set('connection_limit', '2'); url.searchParams.set('pool_timeout', '10');
  const observer = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const gate = scope.scope.gate.file;
  const exclusive = () => {
    const result = spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', gate, '/usr/bin/true'], { stdio: 'ignore' });
    assert.equal(result.signal, null); assert.ok(result.status === 0 || result.status === 1);
    return result.status === 0;
  };
  const locked = deferred(), release = deferred(), authenticated = deferred();
  let blocker: Promise<unknown> | undefined, socket: any, failure: unknown;
  try {
    await until(exclusive);
    blocker = observer.$transaction(async tx => {
      await tx.$executeRawUnsafe('LOCK TABLE auth_sessions IN ACCESS EXCLUSIVE MODE');
      locked.resolve(); await release.promise;
    }, { timeout: 20000, maxWait: 1000 });
    void blocker.catch(error => { failure = error; locked.resolve(); });
    await locked.promise; if (failure) throw failure;
    // The test's SQL lock itself does not borrow the subject's application SH.
    assert.equal(exclusive(), true);
    const WebSocket = require('ws');
    socket = new WebSocket(input.baseUrl.replace(/^http:/, 'ws:') + '/socket.io/?EIO=4&transport=websocket', {
      headers: { cookie: 'sabalan_session=' + input.sessionToken },
    });
    socket.on('error', (error: unknown) => { failure = error; authenticated.resolve(); });
    socket.on('message', (data: Buffer) => {
      const message = data.toString();
      if (message.startsWith('0')) socket.send('40' + JSON.stringify({ expectedUserId: input.reporterId }));
      else if (message === '2') socket.send('3');
      else if (message.startsWith('40')) authenticated.resolve();
      else if (message.startsWith('44')) { failure = Error('NATIVE_REALTIME_AUTHENTICATION_REFUSED'); authenticated.resolve(); }
    });
    const namespace = runtimeNativePostgresApplicationName(scope.scope.runtimeId);
    await until(async () => {
      if (failure) throw failure;
      const [{ count }] = await observer.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM pg_stat_activity
        WHERE application_name = ${namespace} AND wait_event_type = 'Lock' AND query ILIKE '%auth_sessions%'`;
      return count > 0n;
    });
    assert.equal(exclusive(), false, 'actual blocked authentication must own application completion');
    // The joined controller may signal/observe an actual coherent capture
    // attempt here; completion must await the original SQL callback release.
    if (input.whileCallbackHeld) await input.whileCallbackHeld();
    release.resolve(); await blocker; blocker = undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([authenticated.promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('NATIVE_REALTIME_AUTHENTICATION_TIMEOUT')), 10000); })]);
    } finally { if (timer) clearTimeout(timer); }
    if (failure) throw failure;
    assert.equal(socket.readyState, WebSocket.OPEN);
    await until(exclusive);
    assert.equal(socket.readyState, WebSocket.OPEN, 'idle authenticated transport must coexist with a short exclusive capture gate');
    const closed = new Promise<void>((resolve, reject) => { socket.once('close', () => resolve()); socket.once('error', reject); });
    socket.close(); await closed; socket = undefined;
    return { actualAuthoritativeSessionQueryBlocked: true, blockedCallbackExcludedExclusiveGate: true,
      authenticatedAfterSqlRelease: true, idleAuthenticatedSocketAllowedExclusiveGate: true,
      joinedCaptureHookInvoked: Boolean(input.whileCallbackHeld), productionAdmission: false };
  } finally {
    release.resolve();
    if (blocker) await blocker.catch(() => undefined);
    if (socket && socket.readyState !== 3) {
      // Close only this original test-owned client, without terminating the
      // application, replacing its guard, or adopting unresolved work.
      const closed = new Promise<void>(resolve => socket.once('close', resolve)); socket.close(); await closed;
    }
    await observer.$disconnect();
  }
}
