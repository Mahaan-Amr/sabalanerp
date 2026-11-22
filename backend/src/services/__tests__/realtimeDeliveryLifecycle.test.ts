import assert from 'node:assert/strict';
import test from 'node:test';
import { RealtimeDeliveryLifecycle, type RealtimeSocket } from '../realtimeDeliveryLifecycle';
import { readAuthoritativeSession } from '../identitySessionService';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { deploymentMaintenanceActive, DEPLOYMENT_MAINTENANCE_FILE } from '../deploymentMaintenance';

test('maintenance admission treats every marker entry as closed, including a dangling link', async t => {
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'sabalan-realtime-maintenance-'));
  const marker = path.join(root, DEPLOYMENT_MAINTENANCE_FILE);
  try {
    assert.equal(deploymentMaintenanceActive(root), false);
    await fs.mkdir(marker);
    assert.equal(deploymentMaintenanceActive(root), true);
    await fs.rmdir(marker);
    try { await fs.symlink(path.join(root, 'absent'), marker); }
    catch (error: any) {
      if (process.platform === 'win32' && error.code === 'EPERM') { t.diagnostic('Windows symlink privilege unavailable; directory-marker case passed'); return; }
      throw error;
    }
    assert.equal(deploymentMaintenanceActive(root), true);
  } finally { assert.equal(path.dirname(await fs.realpath(root)), parent); await fs.rm(root, { recursive: true }); }
});

test('realtime rejects closed admission before querying the database', async () => {
  const socket = { handshake: { headers: {} }, data: {}, connected: true, emit: () => {}, disconnect: () => {} };
  const lifecycle = new RealtimeDeliveryLifecycle({} as any, () => [socket], async () => true, () => false);
  await assert.rejects(lifecycle.authenticate(socket), /REALTIME_DELIVERY_UNAVAILABLE/);
  await assert.rejects(lifecycle.invalidate('hr.changed'), /REALTIME_DELIVERY_UNAVAILABLE/);
  await lifecycle.stop(100);
});

for (const boundary of ['idleExpiresAt', 'absoluteExpiresAt']) {
  test(`session ${boundary} is evaluated after a delayed authoritative database read`, async () => {
    const database = { authSession: { findUnique: async () => {
      const session = { revokedAt: null, user: { isActive: true, erasedAt: null },
        idleExpiresAt: new Date(Date.now() + 60_000), absoluteExpiresAt: new Date(Date.now() + 60_000) };
      session[boundary as 'idleExpiresAt' | 'absoluteExpiresAt'] = new Date(Date.now() + 20);
      await new Promise(resolve => setTimeout(resolve, 40));
      return session;
    } } };
    assert.equal(await readAuthoritativeSession(database as any, 'qa-token'), null);
  });
}

test('realtime retirement owns every parallel authorization even after a sibling fails', async () => {
  let finish!: (value: unknown) => void, entered!: () => void;
  const pending = new Promise(resolve => { finish = resolve; });
  const began = new Promise<void>(resolve => { entered = resolve; });
  let reads = 0;
  const database = { $queryRaw: async (query: TemplateStringsArray) => query.join('').includes('min(boundary)')
    ? [{ deadline: null }] : [{ snapshot: '1:1:', now: new Date() }], authSession: { findUnique: async () => {
    if (++reads === 1) throw new Error('authorization unavailable');
    entered();
    return pending;
  } } };
  const sockets = ['a', 'b'].map(token => ({ handshake: { headers: { cookie: `sabalan_session=${token}` } },
    connected: true, data: { userId: 'qa-user' }, emit: () => { throw new Error('must not emit'); }, disconnect: () => undefined })) satisfies RealtimeSocket[];
  const lifecycle = new RealtimeDeliveryLifecycle(database as any, () => sockets, async () => false, () => true);
  const operation = lifecycle.invalidate('hr.changed');
  const failed = assert.rejects(operation, /authorization unavailable/);
  try {
    await began;
    await assert.rejects(lifecycle.stop(20), /REALTIME_DRAIN_TIMEOUT/);
    await assert.rejects(lifecycle.authenticate(sockets[0]), /REALTIME_DELIVERY_STOPPING/);
    finish(null);
    await failed;
    await lifecycle.stop(1000);
  } finally { finish(null); await failed; }
});
