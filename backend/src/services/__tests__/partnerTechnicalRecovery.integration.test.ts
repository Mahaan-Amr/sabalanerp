import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { partnerError, type PartnerTechnicalCheckpoint, type PartnerTechnicalRecoveryAccess } from '@sabalanerp/partner-sales-contracts';
import { createPartnerTechnicalRecoveryService } from '../partnerSales/cases/technicalRecovery';

function localDatabaseUrl(): string {
  const value = process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL;
  if (!value) throw new Error('Explicit existing local recovery test database required');
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', 'postgres'].includes(url.hostname) || url.pathname !== '/sabalanerp') {
    throw new Error('Non-local recovery test database refused');
  }
  url.searchParams.set('connection_limit', '2');
  url.searchParams.set('pool_timeout', '10');
  return url.toString();
}

async function fixture(run: (tx: Prisma.TransactionClient, actorId: string, access: PartnerTechnicalRecoveryAccess) => Promise<void>) {
  const database = new PrismaClient({ datasources: { db: { url: localDatabaseUrl() } } });
  const rollback = new Error('successful test rollback');
  try {
    await database.$transaction(async tx => {
      const actorId = `technical-recovery-${randomUUID()}`;
      const access: PartnerTechnicalRecoveryAccess = { schemaVersion: 1, recoveryId: actorId,
        browserSessionId: 'test-browser', leaseToken: randomUUID(), baseRevision: 0 };
      await tx.salesContractEditSession.create({ data: { draftId: actorId, ownerUserId: actorId,
        browserSessionId: access.browserSessionId, leaseToken: access.leaseToken, schemaVersion: 2, baseRevision: 0 } });
      await run(tx, actorId, access);
      // Command receipts are append-only. Roll back all fixture writes instead
      // of deleting evidence, disabling triggers or creating another database.
      throw rollback;
    }, { timeout: 20_000 });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally { await database.$disconnect(); }
}

test('incomplete technical input is durably acknowledged and can be read by a new service instance without issuing configuration refs', async () => {
  await fixture(async (tx, actorId, access) => {
    const dependencies = { actorId, transaction: <T>(run: (tx: Prisma.TransactionClient) => Promise<T>) => run(tx),
      authorize: async () => ({ ok: true as const, value: undefined }) };
    const service = createPartnerTechnicalRecoveryService(dependencies);
    const command: PartnerTechnicalCheckpoint = { ...access, expectedRecoveryRevision: 0, idempotencyKey: 'save-1',
      draft: { schemaVersion: 1, inputRevision: 4, rows: [],
        editingValues: [{ entityId: 'new-row', field: 'quantity', text: '۲٫' }] } };
    const saved = await service.checkpoint(command);
    if (!saved.ok) throw new Error(saved.error.code);
    assert.equal(saved.value.recoveryRevision, 1);
    assert.equal(saved.value.inputRevision, 4);
    assert.equal(saved.value.replayed, false);
    assert.equal('configurationRef' in saved.value, false);
    const loaded = await createPartnerTechnicalRecoveryService(dependencies).read(access);
    if (!loaded.ok) throw new Error(loaded.error.code);
    assert.equal(loaded.value.recoveryRevision, 1);
    assert.deepEqual(loaded.value.draft, command.draft);
  });
});

test('retry reads the durable same-intent receipt while changed-key payloads and stale revisions cannot replace newer input', async () => {
  await fixture(async (tx, actorId, access) => {
    const dependencies = { actorId, transaction: <T>(run: (tx: Prisma.TransactionClient) => Promise<T>) => run(tx),
      authorize: async () => ({ ok: true as const, value: undefined }) };
    const service = createPartnerTechnicalRecoveryService(dependencies);
    const command: PartnerTechnicalCheckpoint = { ...access, expectedRecoveryRevision: 0, idempotencyKey: 'same-key',
      draft: { schemaVersion: 1, inputRevision: 1, rows: [] } };
    const first = await service.checkpoint(command);
    if (!first.ok) throw new Error(first.error.code);
    const reloaded = createPartnerTechnicalRecoveryService(dependencies);
    const replay = await reloaded.checkpoint(command);
    if (!replay.ok) throw new Error(replay.error.code);
    assert.deepEqual(replay.value, { ...first.value, replayed: true });
    const changed = await reloaded.checkpoint({ ...command, draft: { ...command.draft, inputRevision: 2 } });
    if (changed.ok) throw new Error('Changed payload reused a receipt');
    assert.equal(changed.error.code, 'IDEMPOTENCY_CONFLICT');
    const next = await reloaded.checkpoint({ ...command, expectedRecoveryRevision: 1, idempotencyKey: 'next-key',
      draft: { ...command.draft, inputRevision: 3 } });
    if (!next.ok) throw new Error(next.error.code);
    assert.equal(next.value.recoveryRevision, 2);
    const stale = await reloaded.checkpoint({ ...command, idempotencyKey: 'stale-key' });
    if (stale.ok) throw new Error('Stale checkpoint accepted');
    assert.equal(stale.error.code, 'ROW_STALE');
    const lateReplay = await reloaded.checkpoint(command);
    if (!lateReplay.ok) throw new Error(lateReplay.error.code);
    assert.deepEqual(lateReplay.value, { ...first.value, replayed: true });
    const current = await reloaded.read(access);
    if (!current.ok) throw new Error(current.error.code);
    assert.equal(current.value.recoveryRevision, 2);
    assert.equal(current.value.draft?.inputRevision, 3);
  });
});

test('current authority and lease gate every read and receipt replay, and private envelope fields never leave the service', async () => {
  await fixture(async (tx, actorId, access) => {
    let allowed = true;
    const dependencies = { actorId, transaction: <T>(run: (tx: Prisma.TransactionClient) => Promise<T>) => run(tx),
      authorize: async () => allowed ? { ok: true as const, value: undefined } : { ok: false as const, error: partnerError('FORBIDDEN') } };
    const service = createPartnerTechnicalRecoveryService(dependencies);
    const command: PartnerTechnicalCheckpoint = { ...access, expectedRecoveryRevision: 0, idempotencyKey: 'auth-key',
      draft: { schemaVersion: 1, inputRevision: 1, rows: [] } };
    const first = await service.checkpoint(command);
    if (!first.ok) throw new Error(first.error.code);
    const record = await tx.salesContractEditSession.findUniqueOrThrow({ where: { draftId: access.recoveryId } });
    await tx.salesContractEditSession.update({ where: { draftId: access.recoveryId },
      data: { recovery: { ...(record.recovery as Prisma.JsonObject), privateEvidence: { rate: 'private-rate' } } } });
    const safe = await service.read(access);
    if (!safe.ok) throw new Error(safe.error.code);
    assert.equal(JSON.stringify(safe).includes('private-rate'), false);
    allowed = false;
    for (const result of [await service.read(access), await service.checkpoint(command)]) {
      if (result.ok) throw new Error('Revoked authority accepted');
      assert.equal(result.error.code, 'FORBIDDEN');
    }
    allowed = true;
    const foreign = await createPartnerTechnicalRecoveryService({ ...dependencies, actorId: 'foreign-user' }).read(access);
    if (foreign.ok) throw new Error('Foreign creator read accepted');
    assert.equal(foreign.error.code, 'NOT_FOUND');
    await tx.salesContractEditSession.update({ where: { draftId: access.recoveryId }, data: { leaseToken: 'replacement-token' } });
    const revoked = await service.checkpoint(command);
    if (revoked.ok) throw new Error('Revoked lease replay accepted');
    assert.equal(revoked.error.code, 'FORBIDDEN');
    const reacquired = await service.checkpoint({ ...command, leaseToken: 'replacement-token' });
    if (!reacquired.ok) throw new Error(reacquired.error.code);
    assert.equal(reacquired.value.replayed, true, 'transport lease metadata does not change command intent');
  });
});

test('a receipt cannot acknowledge a released and recreated draft that no longer contains its saved revision', async () => {
  await fixture(async (tx, actorId, access) => {
    const service = createPartnerTechnicalRecoveryService({ actorId,
      transaction: <T>(run: (tx: Prisma.TransactionClient) => Promise<T>) => run(tx),
      authorize: async () => ({ ok: true as const, value: undefined }) });
    const command: PartnerTechnicalCheckpoint = { ...access, expectedRecoveryRevision: 0, idempotencyKey: 'old-epoch-key',
      draft: { schemaVersion: 1, inputRevision: 1, rows: [] } };
    assert.equal((await service.checkpoint(command)).ok, true);
    // Simulate the existing release/recreate lifecycle. Immutable receipts stay.
    await tx.salesContractEditSession.delete({ where: { draftId: access.recoveryId } });
    await tx.salesContractEditSession.create({ data: { draftId: access.recoveryId, ownerUserId: actorId,
      browserSessionId: access.browserSessionId, leaseToken: access.leaseToken, schemaVersion: 2, baseRevision: 0 } });
    const replay = await service.checkpoint(command);
    if (replay.ok) throw new Error('Receipt acknowledged missing durable progress');
    assert.equal(replay.error.code, 'INTEGRITY_CONFLICT');
    const fresh = await service.checkpoint({ ...command, idempotencyKey: 'new-epoch-key' });
    if (!fresh.ok) throw new Error(fresh.error.code);
    const wrongEpoch = await service.checkpoint(command);
    if (wrongEpoch.ok) throw new Error('Old receipt matched a new draft with the same revision number');
    assert.equal(wrongEpoch.error.code, 'INTEGRITY_CONFLICT');
  });
});

test('competing checkpoints from one expected revision accept only one draft and retain the winning input', async () => {
  await fixture(async (tx, actorId, access) => {
    const service = createPartnerTechnicalRecoveryService({ actorId,
      transaction: <T>(run: (tx: Prisma.TransactionClient) => Promise<T>) => run(tx),
      authorize: async () => ({ ok: true as const, value: undefined }) });
    const outcomes = await Promise.all([11, 12].map(inputRevision => service.checkpoint({ ...access,
      expectedRecoveryRevision: 0, idempotencyKey: `concurrent-${inputRevision}`,
      draft: { schemaVersion: 1, inputRevision, rows: [] } })));
    assert.equal(outcomes.filter(result => result.ok).length, 1);
    const accepted = outcomes.find(result => result.ok);
    if (!accepted?.ok) throw new Error('No checkpoint accepted');
    const current = await service.read(access);
    if (!current.ok) throw new Error(current.error.code);
    assert.equal(current.value.recoveryRevision, 1);
    assert.equal(current.value.draft?.inputRevision, accepted.value.inputRevision);
  });
});

test('expired lease or seven-day recovery blocks read and checkpoint even when a durable receipt exists', async () => {
  await fixture(async (tx, actorId, access) => {
    const service = createPartnerTechnicalRecoveryService({ actorId,
      transaction: <T>(run: (tx: Prisma.TransactionClient) => Promise<T>) => run(tx),
      authorize: async () => ({ ok: true as const, value: undefined }) });
    const command: PartnerTechnicalCheckpoint = { ...access, expectedRecoveryRevision: 0, idempotencyKey: 'expiry-key',
      draft: { schemaVersion: 1, inputRevision: 1, rows: [] } };
    assert.equal((await service.checkpoint(command)).ok, true);
    await tx.salesContractEditSession.update({ where: { draftId: access.recoveryId }, data: { updatedAt: new Date(Date.now() - 90_000) } });
    const expiredLease = await service.checkpoint(command);
    if (expiredLease.ok) throw new Error('Expired lease replay accepted');
    assert.equal(expiredLease.error.code, 'FORBIDDEN');
    const row = await tx.salesContractEditSession.findUniqueOrThrow({ where: { draftId: access.recoveryId } });
    await tx.salesContractEditSession.update({ where: { draftId: access.recoveryId }, data: { updatedAt: new Date(),
      recovery: { ...(row.recovery as Prisma.JsonObject), updatedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 } } });
    for (const result of [await service.read(access), await service.checkpoint(command)]) {
      if (result.ok) throw new Error('Expired recovery accepted');
      assert.equal(result.error.code, 'STATE_CONFLICT');
    }
  });
});

test('transaction failure rolls back both the checkpoint and its receipt before a retry is acknowledged', async () => {
  await fixture(async (tx, actorId, access) => {
    const dependencies = { actorId, transaction: <T>(run: (tx: Prisma.TransactionClient) => Promise<T>) => run(tx),
      authorize: async () => ({ ok: true as const, value: undefined }) };
    const transactionFailure = new Error('test transaction failure');
    const failing = createPartnerTechnicalRecoveryService({ ...dependencies, transaction: async run => {
      await tx.$executeRaw`SAVEPOINT technical_checkpoint_failure`;
      try { await run(tx); throw transactionFailure; }
      finally { await tx.$executeRaw`ROLLBACK TO SAVEPOINT technical_checkpoint_failure`; }
    } });
    const command: PartnerTechnicalCheckpoint = { ...access, expectedRecoveryRevision: 0, idempotencyKey: 'atomic-key',
      draft: { schemaVersion: 1, inputRevision: 1, rows: [] } };
    await assert.rejects(failing.checkpoint(command), error => error === transactionFailure);
    const service = createPartnerTechnicalRecoveryService(dependencies);
    const current = await service.read(access);
    if (!current.ok) throw new Error(current.error.code);
    assert.equal(current.value.recoveryRevision, 0);
    assert.equal(current.value.draft, null);
    const retried = await service.checkpoint(command);
    if (!retried.ok) throw new Error(retried.error.code);
    assert.equal(retried.value.replayed, false);
    assert.equal(retried.value.recoveryRevision, 1);
  });
});
