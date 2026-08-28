import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { partnerError, type PartnerTechnicalCheckpoint, type PartnerTechnicalRecoveryAccess } from '@sabalanerp/partner-sales-contracts';
import { createPartnerTechnicalRecoveryService } from '../partnerSales/cases/technicalRecovery';
import { createPartnerTechnicalSaveService } from '../partnerSales/cases/technicalSave';
import { createPartnerTechnicalCatalogFixtures } from '@sabalanerp/partner-sales-contracts/testing';
import { createPartnerTechnicalRecoveryAuthority } from '../partnerSales/authorization/technicalRecovery';

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

test('real pre-Case authority binds creator-private recovery to the current Partner lifecycle without an allow-all fixture', async () => {
  await fixture(async (tx, actorId, access) => {
    await tx.user.create({ data: { id: actorId, username: actorId, email: `${actorId}@example.invalid`,
      password: 'not-a-login', firstName: 'Fixture', lastName: 'Technical authority' } });
    await tx.partnerProfile.create({ data: { id: actorId, userId: actorId, state: 'ACTIVE' } });
    const dependencies = { actorId, transaction: <T>(run: (tx: Prisma.TransactionClient) => Promise<T>) => run(tx),
      authorize: createPartnerTechnicalRecoveryAuthority({ actorId, correlationId: 'technical-authority-test' }) };
    const service = createPartnerTechnicalRecoveryService(dependencies);
    const command: PartnerTechnicalCheckpoint = { ...access, expectedRecoveryRevision: 0, idempotencyKey: 'current-profile',
      draft: { schemaVersion: 1, inputRevision: 1, rows: [], editingValues: [{ entityId: 'draft-row', field: 'quantity', text: '۲٫' }] } };
    assert.equal((await service.checkpoint(command)).ok, true);
    await tx.partnerProfile.update({ where: { id: actorId }, data: { state: 'SUSPENDED', revision: { increment: 1 } } });
    const loaded = await createPartnerTechnicalRecoveryService(dependencies).read(access);
    assert.equal(loaded.ok, true, 'suspension keeps creator-private read access');
    if (loaded.ok) assert.deepEqual(loaded.value.draft, command.draft);
    const denied = await service.checkpoint(command);
    assert.equal(denied.ok ? null : denied.error.code, 'PARTNER_NOT_ACTIVE', 'even a receipt replay reauthorizes current mutation rights');
    await tx.partnerProfile.update({ where: { id: actorId }, data: { state: 'TERMINATED', revision: { increment: 1 } } });
    assert.equal((await service.read(access)).ok, false);
  });
});

test('pre-Case technical authority rejects internal ADMIN, pending identity, foreign recovery ids and inactive creators', async () => {
  await fixture(async (tx, actorId, access) => {
    await tx.user.create({ data: { id: actorId, username: actorId, email: `${actorId}@example.invalid`, password: 'not-a-login',
      firstName: 'Fixture', lastName: 'Technical denial', role: 'ADMIN' } });
    const authorize = createPartnerTechnicalRecoveryAuthority({ actorId, correlationId: 'technical-denial-test' });
    const request = { actorId, recoveryId: access.recoveryId, operation: 'SAVE' as const };
    assert.equal((await authorize(tx, request)).ok, false, 'internal ADMIN cannot author Partner technical input');
    await tx.partnerProfile.create({ data: { id: actorId, userId: actorId, state: 'PENDING' } });
    assert.equal((await authorize(tx, request)).ok, false, 'pending identity is onboarding-only');
    await tx.partnerProfile.update({ where: { id: actorId }, data: { state: 'ACTIVE', revision: { increment: 1 } } });
    assert.equal((await authorize(tx, request)).ok, true, 'own active Partner bundle, even with a stray legacy role');
    assert.equal((await authorize(tx, { ...request, actorId: 'forged-actor' })).ok, false);
    await tx.salesContractEditSession.create({ data: { draftId: `foreign-${actorId}`, ownerUserId: 'another-creator',
      browserSessionId: 'other-browser', leaseToken: randomUUID(), schemaVersion: 2, baseRevision: 0 } });
    const foreign = await authorize(tx, { ...request, recoveryId: `foreign-${actorId}` });
    assert.deepEqual(foreign, await authorize(tx, { ...request, recoveryId: `missing-${actorId}` }));
    await tx.user.update({ where: { id: actorId }, data: { isActive: false } });
    assert.equal((await authorize(tx, request)).ok, false);
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

test('no-op or input-revision-only checkpoints renew lease presence but not the seven-day meaningful-change clock', async () => {
  await fixture(async (tx, actorId, access) => {
    const service = createPartnerTechnicalRecoveryService({ actorId,
      transaction: <T>(run: (tx: Prisma.TransactionClient) => Promise<T>) => run(tx),
      authorize: async () => ({ ok: true as const, value: undefined }) });
    const command: PartnerTechnicalCheckpoint = { ...access, expectedRecoveryRevision: 0, idempotencyKey: 'initial',
      draft: { schemaVersion: 1, inputRevision: 1, rows: [] } };
    assert.equal((await service.checkpoint(command)).ok, true);
    const lastMeaningfulChange = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const row = await tx.salesContractEditSession.findUniqueOrThrow({ where: { draftId: access.recoveryId } });
    await tx.salesContractEditSession.update({ where: { draftId: access.recoveryId }, data: {
      recovery: { ...(row.recovery as Prisma.JsonObject), updatedAt: lastMeaningfulChange.getTime() } } });
    const noOp = await service.checkpoint({ ...command, expectedRecoveryRevision: 1, idempotencyKey: 'no-op' });
    if (!noOp.ok) throw new Error(noOp.error.code);
    assert.equal(noOp.value.updatedAt, lastMeaningfulChange.toISOString());
    const revisionOnly = await service.checkpoint({ ...command, expectedRecoveryRevision: 2, idempotencyKey: 'revision-only',
      draft: { ...command.draft, inputRevision: 9 } });
    if (!revisionOnly.ok) throw new Error(revisionOnly.error.code);
    const unchanged = await service.read(access);
    if (!unchanged.ok) throw new Error(unchanged.error.code);
    assert.equal(unchanged.value.updatedAt, lastMeaningfulChange.toISOString());
    assert.equal(unchanged.value.draft?.inputRevision, 9);
    const changed = await service.checkpoint({ ...command, expectedRecoveryRevision: 3, idempotencyKey: 'meaningful',
      draft: { ...command.draft, editingValues: [{ entityId: 'new-row', field: 'quantity', text: '۳' }] } });
    if (!changed.ok) throw new Error(changed.error.code);
    assert.ok(Date.parse(changed.value.updatedAt) > lastMeaningfulChange.getTime());
  });
});

function preparedSaveSetup(tx: Prisma.TransactionClient, actorId: string, access: PartnerTechnicalRecoveryAccess) {
    const catalog = createPartnerTechnicalCatalogFixtures(), product = catalog.products[0];
    const dependencies = { actorId, transaction: <T>(run: (tx: Prisma.TransactionClient) => Promise<T>) => run(tx),
      authorize: async () => ({ ok: true as const, value: undefined }),
      resolveEvidence: async () => ({ ok: true as const, value: {
        context: { catalog, policy: { calculation: 'calc-v1', packing: 'packing-v1', pricing: 'pricing-v1', rounding: 'rounding-v1' },
          products: [{ catalogItemId: product.catalogItemId, catalogSnapshotVersion: product.catalogSnapshotVersion,
            preparedRates: [{ kind: 'cubic' as const, unit: 'ton' as const, rateToman: '12345' }] }] },
        identities: [{ productRowId: 'prepared-row', identity: {
          schemaVersion: 1 as const, partnerSellerId: actorId, catalogProductId: product.catalogItemId,
          family: 'prepared' as const, unit: 'ton', configuration: [{ key: 'kind', value: 'cubic' }],
          materialRateEvidenceId: 'private-material', materialRateHash: 'sha256-v1:' + 'a'.repeat(64), components: [],
          currency: 'IRT' as const, calculationPolicyVersion: 'calc-v1', roundingPolicyVersion: 'rounding-v1',
        } }],
      } }),
    };
    const service = createPartnerTechnicalSaveService(dependencies);
    const command = { ...access, expectedRecoveryRevision: 0, idempotencyKey: 'validated',
      draft: { schemaVersion: 1 as const, inputRevision: 7, rows: [{
        productRowId: 'prepared-row', catalogItemId: product.catalogItemId, catalogSnapshotVersion: product.catalogSnapshotVersion,
        family: 'prepared' as const, configuration: { kind: 'cubic' as const, unit: 'ton' as const, quantity: '2.5' },
      }] } };
    return { dependencies, service, command };
}

test('validated technical save returns exact canonical configuration references and reloads without disclosing its private graph', async () => {
  await fixture(async (tx, actorId, access) => {
    const { service, command, dependencies } = preparedSaveSetup(tx, actorId, access);
    const result = await service.save(command);
    if (!result.ok) throw new Error(result.error.code);
    assert.deepEqual(result.value.rows, [{ configurationRef: {
      recoveryId: access.recoveryId, recoveryRevision: 1, productRowId: 'prepared-row',
    }, quantity: '2.5', unit: 'ton', configurationChange: 'NEW' }]);
    assert.equal(result.value.inputRevision, 7);
    assert.equal(result.value.replayed, false);
    const loaded = await createPartnerTechnicalSaveService(dependencies).readSaved({ ...access, recoveryRevision: 1 });
    if (!loaded.ok) throw new Error(loaded.error.code);
    const { replayed: _replay, ...view } = result.value;
    assert.deepEqual(loaded.value, view);
    assert.equal(JSON.stringify(loaded).includes('12345'), false);
    assert.equal(JSON.stringify(loaded).includes('private-material'), false);
    const draft = await createPartnerTechnicalRecoveryService(dependencies).read(access);
    if (!draft.ok) throw new Error(draft.error.code);
    assert.deepEqual(draft.value.draft, command.draft);
  });
});

test('quantity-only validated successors preserve configuration identity and retry history across incomplete checkpoints', async () => {
  await fixture(async (tx, actorId, access) => {
    const { service, command, dependencies } = preparedSaveSetup(tx, actorId, access);
    const first = await service.save(command);
    if (!first.ok) throw new Error(first.error.code);
    const quantityDraft = { ...command.draft, inputRevision: 8, rows: [{ ...command.draft.rows[0],
      configuration: { ...command.draft.rows[0].configuration, quantity: '3.75' } }] };
    const next = await service.save({ ...command, expectedRecoveryRevision: 1, idempotencyKey: 'quantity-change', draft: quantityDraft });
    if (!next.ok) throw new Error(next.error.code);
    assert.equal(next.value.rows[0].configurationChange, 'UNCHANGED');
    assert.equal(next.value.rows[0].quantity, '3.75');
    assert.equal(next.value.rows[0].configurationRef.recoveryRevision, 2);
    const checkpoint = createPartnerTechnicalRecoveryService(dependencies);
    const incomplete = { ...quantityDraft, inputRevision: 9, editingValues: [{ entityId: 'prepared-row', field: 'quantity' as const, text: '۴٫' }] };
    assert.equal((await checkpoint.checkpoint({ ...command, expectedRecoveryRevision: 2, idempotencyKey: 'editing', draft: incomplete })).ok, true);
    const invalid = await service.save({ ...command, expectedRecoveryRevision: 3, idempotencyKey: 'invalid-save', draft: incomplete });
    if (invalid.ok) throw new Error('Incomplete draft received an inquiry-ready reference');
    assert.equal(invalid.error.code, 'INVALID_PAYLOAD');
    assert.equal((await service.readSaved({ ...access, recoveryRevision: 3 })).ok, false);
    const replay = await createPartnerTechnicalSaveService(dependencies).save(command);
    if (!replay.ok) throw new Error(replay.error.code);
    assert.deepEqual(replay.value, { ...first.value, replayed: true });
    const old = await service.readSaved({ ...access, recoveryRevision: 1 });
    if (!old.ok) throw new Error(old.error.code);
    assert.equal(old.value.rows[0].quantity, '2.5');
    const current = await checkpoint.read(access);
    if (!current.ok) throw new Error(current.error.code);
    assert.equal(current.value.recoveryRevision, 3);
    assert.deepEqual(current.value.draft, incomplete);
    const changedKey = await service.save({ ...command, draft: quantityDraft });
    if (changedKey.ok) throw new Error('Idempotency key accepted changed intent');
    assert.equal(changedKey.error.code, 'IDEMPOTENCY_CONFLICT');
  });
});

test('validated saves cannot reuse a stable row identity for another product family even with matching owner evidence', async () => {
  await fixture(async (tx, actorId, access) => {
    const { service, command, dependencies } = preparedSaveSetup(tx, actorId, access);
    assert.equal((await service.save(command)).ok, true);
    const replacement = createPartnerTechnicalSaveService({ ...dependencies, resolveEvidence: async () => {
      const evidence = await dependencies.resolveEvidence();
      return { ok: true, value: { ...evidence.value,
        identities: evidence.value.identities.map(item => ({ ...item, identity: { ...item.identity, family: 'volumetric' as const } })) } };
    } });
    const rebound = await replacement.save({ ...command, expectedRecoveryRevision: 1, idempotencyKey: 'rebind',
      draft: { ...command.draft, inputRevision: 8, rows: [{ ...command.draft.rows[0], family: 'volumetric' }] } });
    if (rebound.ok) throw new Error('Stable row ID rebound to a different family');
    assert.equal(rebound.error.code, 'INTEGRITY_CONFLICT');
    const current = await createPartnerTechnicalRecoveryService(dependencies).read(access);
    if (!current.ok) throw new Error(current.error.code);
    assert.equal(current.value.recoveryRevision, 1);
    assert.equal(current.value.draft?.rows[0].family, 'prepared');
  });
});

test('validated save reauthorizes after graph evidence resolution and never publishes a reference after authority is revoked', async () => {
  await fixture(async (tx, actorId, access) => {
    const { command, dependencies } = preparedSaveSetup(tx, actorId, access);
    let allowed = true;
    const service = createPartnerTechnicalSaveService({ ...dependencies,
      authorize: async () => allowed ? { ok: true, value: undefined } : { ok: false, error: partnerError('FORBIDDEN') },
      resolveEvidence: async () => { allowed = false; return dependencies.resolveEvidence(); },
    });
    const denied = await service.save(command);
    if (denied.ok) throw new Error('Revoked writer issued a saved reference');
    assert.equal(denied.error.code, 'FORBIDDEN');
    const current = await createPartnerTechnicalRecoveryService(dependencies).read(access);
    if (!current.ok) throw new Error(current.error.code);
    assert.equal(current.value.recoveryRevision, 0);
    const retried = await createPartnerTechnicalSaveService(dependencies).save(command);
    if (!retried.ok) throw new Error(retried.error.code);
    assert.equal(retried.value.replayed, false);
  });
});

test('a lease that expires during owner evidence lookup cannot be renewed by a successful validated save', async () => {
  await fixture(async (tx, actorId, access) => {
    const { command, dependencies } = preparedSaveSetup(tx, actorId, access);
    const service = createPartnerTechnicalSaveService({ ...dependencies, resolveEvidence: async () => {
      await tx.salesContractEditSession.update({ where: { draftId: access.recoveryId }, data: { updatedAt: new Date(Date.now() - 90_000) } });
      return dependencies.resolveEvidence();
    } });
    const expired = await service.save(command);
    if (expired.ok) throw new Error('Expired writer renewed itself while publishing a reference');
    assert.equal(expired.error.code, 'FORBIDDEN');
    await tx.salesContractEditSession.update({ where: { draftId: access.recoveryId }, data: { updatedAt: new Date() } });
    const current = await createPartnerTechnicalRecoveryService(dependencies).read(access);
    if (!current.ok) throw new Error(current.error.code);
    assert.equal(current.value.recoveryRevision, 0);
  });
});

test('validated graph, safe references and idempotency receipt roll back together when the transaction fails', async () => {
  await fixture(async (tx, actorId, access) => {
    const { command, dependencies, service } = preparedSaveSetup(tx, actorId, access);
    const failure = new Error('commit failed');
    const failing = createPartnerTechnicalSaveService({ ...dependencies, transaction: async run => {
      await tx.$executeRaw`SAVEPOINT technical_validated_failure`;
      try { await run(tx); throw failure; }
      finally { await tx.$executeRaw`ROLLBACK TO SAVEPOINT technical_validated_failure`; }
    } });
    await assert.rejects(failing.save(command), error => error === failure);
    const missing = await service.readSaved({ ...access, recoveryRevision: 1 });
    if (missing.ok) throw new Error('Rolled-back reference remained readable');
    assert.equal(missing.error.code, 'NOT_FOUND');
    const draft = await createPartnerTechnicalRecoveryService(dependencies).read(access);
    if (!draft.ok) throw new Error(draft.error.code);
    assert.equal(draft.value.recoveryRevision, 0);
    const retry = await service.save(command);
    if (!retry.ok) throw new Error(retry.error.code);
    assert.equal(retry.value.recoveryRevision, 1);
    assert.equal(retry.value.replayed, false);
  });
});

test('saved references and their retries require current owner authority and reject corrupted private snapshots', async () => {
  await fixture(async (tx, actorId, access) => {
    const { command, dependencies, service } = preparedSaveSetup(tx, actorId, access);
    assert.equal((await service.save(command)).ok, true);
    const denied = createPartnerTechnicalSaveService({ ...dependencies,
      authorize: async () => ({ ok: false, error: partnerError('FORBIDDEN') }) });
    for (const outcome of [await denied.readSaved({ ...access, recoveryRevision: 1 }), await denied.save(command),
      await service.readSaved({ ...access, leaseToken: 'stale-token', recoveryRevision: 1 }),
      await service.save({ ...command, leaseToken: 'stale-token' })]) {
      if (outcome.ok) throw new Error('Stale authority accessed saved evidence');
      assert.equal(outcome.error.code, 'FORBIDDEN');
    }
    const foreign = await createPartnerTechnicalSaveService({ ...dependencies, actorId: 'different-owner' }).readSaved({ ...access, recoveryRevision: 1 });
    if (foreign.ok) throw new Error('Another owner read the saved configuration');
    assert.equal(foreign.error.code, 'NOT_FOUND');
    const row = await tx.salesContractEditSession.findUniqueOrThrow({ where: { draftId: access.recoveryId } });
    const recovery = JSON.parse(JSON.stringify(row.recovery));
    recovery.validatedSnapshots[0].payload.graph.rows[0].commercial.baseRateToman = '99999';
    await tx.salesContractEditSession.update({ where: { draftId: access.recoveryId }, data: { recovery } });
    for (const outcome of [await service.readSaved({ ...access, recoveryRevision: 1 }), await service.save(command)]) {
      if (outcome.ok) throw new Error('Corrupted private graph accepted');
      assert.equal(outcome.error.code, 'INTEGRITY_CONFLICT');
      assert.equal(JSON.stringify(outcome).includes('99999'), false);
    }
  });
});

test('changed owner-issued inquiry evidence reports a configuration change without rewriting the historical reference', async () => {
  await fixture(async (tx, actorId, access) => {
    const { command, dependencies, service } = preparedSaveSetup(tx, actorId, access);
    assert.equal((await service.save(command)).ok, true);
    const changed = createPartnerTechnicalSaveService({ ...dependencies, resolveEvidence: async () => {
      const evidence = await dependencies.resolveEvidence();
      return { ok: true, value: { ...evidence.value, identities: evidence.value.identities.map(item => ({ ...item,
        identity: { ...item.identity, components: [{ componentId: 'new-component', evidenceHash: 'sha256-v1:' + 'b'.repeat(64) }] } })) } };
    } });
    const next = await changed.save({ ...command, expectedRecoveryRevision: 1, idempotencyKey: 'new-evidence' });
    if (!next.ok) throw new Error(next.error.code);
    assert.equal(next.value.rows[0].configurationChange, 'CHANGED');
    const original = await service.readSaved({ ...access, recoveryRevision: 1 });
    if (!original.ok) throw new Error(original.error.code);
    assert.equal(original.value.rows[0].configurationChange, 'NEW');
    assert.equal(original.value.rows[0].configurationRef.recoveryRevision, 1);
  });
});

test('discard erases saved draft content while permanent receipts retain only non-content replay identity', async () => {
  await fixture(async (tx, actorId, access) => {
    const { command, service } = preparedSaveSetup(tx, actorId, access);
    assert.equal((await service.save(command)).ok, true);
    await tx.salesContractEditSession.delete({ where: { draftId: access.recoveryId } });
    const old = await service.readSaved({ ...access, recoveryRevision: 1 });
    if (old.ok) throw new Error('Discarded technical content remained readable');
    assert.equal(old.error.code, 'NOT_FOUND');
    // This is the pre-agreed persistence/erasure boundary: immutable audit
    // evidence must outlive discard, but must not retain discarded draft data.
    const retained = await tx.partnerCommandOutcome.findMany({ where: { actorId, targetScope: access.recoveryId } });
    assert.equal(retained.length, 1);
    const outcome = retained[0].outcome as Prisma.JsonObject;
    assert.deepEqual(Object.keys(outcome).sort(), ['recoveryRevision', 'sessionId', 'version']);
    assert.equal(outcome.recoveryRevision, 1);
    assert.equal(JSON.stringify(outcome).includes('prepared-row'), false);
    assert.equal(JSON.stringify(outcome).includes('2.5'), false);
  });
});

test('discard and recreation of the same recovery ID cannot reissue an old configuration reference for different content', async () => {
  await fixture(async (tx, actorId, access) => {
    const { command, service, dependencies } = preparedSaveSetup(tx, actorId, access);
    const original = await service.save(command);
    if (!original.ok) throw new Error(original.error.code);
    await tx.salesContractEditSession.delete({ where: { draftId: access.recoveryId } });
    await tx.salesContractEditSession.create({ data: { draftId: access.recoveryId, ownerUserId: actorId,
      browserSessionId: access.browserSessionId, leaseToken: access.leaseToken, schemaVersion: 2, baseRevision: 0 } });
    const fresh = await createPartnerTechnicalSaveService(dependencies).save({ ...command, idempotencyKey: 'new-incarnation',
      draft: { ...command.draft, rows: [{ ...command.draft.rows[0], configuration: { ...command.draft.rows[0].configuration, quantity: '8' } }] } });
    if (!fresh.ok) throw new Error(fresh.error.code);
    assert.ok(fresh.value.recoveryRevision > original.value.recoveryRevision);
    assert.notDeepEqual(fresh.value.rows[0].configurationRef, original.value.rows[0].configurationRef);
    const stale = await service.readSaved({ ...access, recoveryRevision: original.value.recoveryRevision });
    if (stale.ok) throw new Error('Old reference resolved to the new incarnation');
    assert.equal(stale.error.code, 'NOT_FOUND');
    const oldRetry = await service.save(command);
    if (oldRetry.ok) throw new Error('Old receipt crossed recovery incarnation');
    assert.equal(oldRetry.error.code, 'INTEGRITY_CONFLICT');
  });
});
