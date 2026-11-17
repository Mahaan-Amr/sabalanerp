import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { requireCustomerSourceSharesWithin } from '../customerSemanticCompatibility';
import { verifyCustomerAllocationDeploymentState } from '../accountingCustomerAllocationDeployment';
import path from 'node:path';
import { createTemporaryConcurrencyDatabase } from './shipmentStatementConcurrency/database';

test('migration-owned allocation control is closed and cannot be opened by the application', async () => {
  const url = process.env.ACCOUNTING_LEDGER_TEST_DATABASE_URL;
  if (!url) return;
  const temporary = await createTemporaryConcurrencyDatabase({ repositoryRoot: path.resolve(process.cwd(), '..'), sourceDatabaseUrl: url, migrateEmptySchema: true });
  const db: PrismaClient = temporary.client();
  try {
    const rows = await db.$queryRaw<Array<{ state: string }>>`SELECT state FROM customer_allocation_release_control WHERE id = 'grouped-allocation'`;
    assert.deepEqual(rows.map(row => row.state), ['CLOSED']);
    assert.deepEqual(await verifyCustomerAllocationDeploymentState(db), { customerAllocationDatabaseProtections: 'verified' });
    await assert.rejects(db.$transaction(async tx => {
      await tx.$executeRaw`ALTER TABLE public.accounting_settlement_allocations
        DISABLE TRIGGER require_active_grouped_allocation_child`;
      await verifyCustomerAllocationDeploymentState(tx);
    }), /protections are incomplete/);
    await assert.rejects(db.$transaction(tx => requireCustomerSourceSharesWithin(tx, 'grouped-allocation')),
      { code: 'CUSTOMER_SOURCE_SHARES_CLOSED' });
    await assert.rejects(db.$executeRaw`UPDATE customer_allocation_release_control SET state = 'ACTIVE' WHERE id = 'grouped-allocation'`);
    await assert.rejects(db.$executeRaw`DELETE FROM customer_allocation_release_control WHERE id = 'grouped-allocation'`);
    assert.deepEqual((await db.$queryRaw<Array<{ state: string }>>`SELECT state FROM customer_allocation_release_control WHERE id = 'grouped-allocation'`).map(row => row.state), ['CLOSED']);
  } finally { await db.$disconnect(); await temporary.cleanup(); }
});

test('controller session authorization can activate once under a live locked deployment', async () => {
  const url = process.env.ACCOUNTING_LEDGER_TEST_DATABASE_URL;
  if (!url) return;
  const temporary = await createTemporaryConcurrencyDatabase({ repositoryRoot: path.resolve(process.cwd(), '..'), sourceDatabaseUrl: url, migrateEmptySchema: true });
  const db = temporary.client();
  try {
    const deploymentId = `allocation-${temporary.runId}`;
    const leaseToken = `lease-${temporary.runId}`;
    await db.deploymentOperation.create({ data: {
      id: deploymentId, activeKey: 'production', releaseId: 'release-456', targetCommit: 'a'.repeat(40),
      owner: 'controller-test', phase: 'MIGRATIONS_APPLIED', leaseToken,
      leaseExpiresAt: new Date(Date.now() + 120_000), heartbeatAt: new Date(), startedAt: new Date(),
    } });
    await assert.rejects(db.$queryRawUnsafe(
      'SELECT * FROM public.customer_allocation_controller_lock($1, $2)', deploymentId, leaseToken),
      /CUSTOMER_ALLOCATION_CONTROLLER_ROLE_REQUIRED/);
    await assert.rejects(db.$executeRawUnsafe(
      `UPDATE public.customer_allocation_release_control SET state = 'ACTIVE', deployment_id = '${deploymentId}', release_id = 'release-456', manifest_sha256 = '${'b'.repeat(64)}', activated_at = clock_timestamp()`),
      /CUSTOMER_ALLOCATION_CONTROL_IMMUTABLE/);
    await assert.rejects(db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET SESSION AUTHORIZATION sabalan_allocation_controller');
      const locked = await tx.$queryRawUnsafe<Array<{ phase: string; controlState: string }>>(
        'SELECT * FROM public.customer_allocation_controller_lock($1, $2)', deploymentId, leaseToken);
      assert.equal(locked[0]?.phase, 'MIGRATIONS_APPLIED');
      assert.equal(locked[0]?.controlState, 'CLOSED');
      await tx.$executeRawUnsafe(`UPDATE public.customer_allocation_release_control SET state = 'ACTIVE'`);
    }), /permission denied/);
    for (const change of [
      { phase: 'RELEASE_STARTED' }, { leaseExpiresAt: new Date(Date.now() - 1_000) },
    ]) {
      await db.deploymentOperation.update({ where: { id: deploymentId }, data: change });
      await assert.rejects(db.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET SESSION AUTHORIZATION sabalan_allocation_controller');
        await tx.$queryRawUnsafe('SELECT * FROM public.customer_allocation_controller_activate($1, $2, $3, $4, $5)',
          deploymentId, leaseToken, 'release-456', 'b'.repeat(64), new Date(Date.now() + 60_000));
      }), /CUSTOMER_ALLOCATION_CONTROLLER_BOUNDARY_REJECTED/);
    }
    await db.deploymentOperation.update({ where: { id: deploymentId }, data: {
      phase: 'MIGRATIONS_APPLIED', leaseExpiresAt: new Date(Date.now() + 120_000),
    } });
    await assert.rejects(db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET SESSION AUTHORIZATION sabalan_allocation_controller');
      await tx.$queryRawUnsafe('SELECT * FROM public.customer_allocation_controller_activate($1, $2, $3, $4, $5)',
        deploymentId, 'wrong-lease', 'release-456', 'b'.repeat(64), new Date(Date.now() + 60_000));
    }), /CUSTOMER_ALLOCATION_CONTROLLER_BOUNDARY_REJECTED/);
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET SESSION AUTHORIZATION sabalan_allocation_controller');
      const rows = await tx.$queryRawUnsafe<Array<{ state: string; manifest_sha256: string }>>(
        'SELECT * FROM public.customer_allocation_controller_activate($1, $2, $3, $4, $5)',
        deploymentId, leaseToken, 'release-456', 'b'.repeat(64), new Date(Date.now() + 60_000));
      assert.equal(rows[0]?.state, 'ACTIVE');
      await tx.$executeRawUnsafe('RESET SESSION AUTHORIZATION');
    });
    const audit = await db.$queryRaw<Array<{ event: string }>>`SELECT event FROM public.customer_allocation_release_audit`;
    assert.deepEqual(audit.map(row => row.event), ['ACTIVATED']);
    const runtimeAdmission = (commit: string, release: string) => db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET SESSION AUTHORIZATION sabalan_application_runtime');
      const [row] = await tx.$queryRaw<Array<{ admitted: boolean }>>`
        SELECT public.customer_allocation_runtime_admitted(${commit}, ${release}) AS admitted
      `;
      await tx.$executeRawUnsafe('RESET SESSION AUTHORIZATION');
      return row.admitted;
    });
    assert.equal(await runtimeAdmission('a'.repeat(40), 'release-456'), false, 'activation is not serving authority before traffic opens');
    await assert.rejects(db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET SESSION AUTHORIZATION sabalan_allocation_controller');
      await tx.$queryRawUnsafe('SELECT * FROM public.customer_allocation_controller_activate($1, $2, $3, $4, $5)',
        deploymentId, leaseToken, 'release-456', 'b'.repeat(64), new Date(Date.now() + 60_000));
    }), /CUSTOMER_ALLOCATION_CONTROL_REPLAY/);

    const closureId = `${deploymentId}-close`;
    const closureLease = `${leaseToken}-close`;
    await db.deploymentOperation.update({ where: { id: deploymentId }, data: { activeKey: null, phase: 'COMPLETED' } });
    assert.equal(await runtimeAdmission('a'.repeat(40), 'release-456'), true);
    assert.equal(await runtimeAdmission('f'.repeat(40), 'release-456'), false);
    assert.equal(await runtimeAdmission('a'.repeat(40), 'other-release'), false);
    await db.deploymentOperation.create({ data: {
      id: closureId, activeKey: 'production', releaseId: 'rollback-release', targetCommit: 'c'.repeat(40),
      owner: 'controller-test', phase: 'MUTATION_STARTED', leaseToken: closureLease,
      leaseExpiresAt: new Date(Date.now() + 120_000), heartbeatAt: new Date(), startedAt: new Date(),
    } });
    const close = (manifest: string) => db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET SESSION AUTHORIZATION sabalan_allocation_controller');
      const receipt = await tx.$queryRaw<Array<{ state: string; manifest_sha256: string }>>`
        SELECT * FROM public.customer_allocation_controller_close(${closureId}, ${closureLease}, 'rollback-release', ${manifest})
      `;
      await tx.$executeRawUnsafe('RESET SESSION AUTHORIZATION');
      return receipt;
    });
    await assert.rejects(close('b'.repeat(64)), /CUSTOMER_ALLOCATION_CLOSURE_BOUNDARY_REJECTED/);
    await db.deploymentOperation.update({ where: { id: closureId }, data: { checkpointJson: {
      deploymentId: closureId, releaseId: 'rollback-release', localVerified: true, remoteVerified: true,
      restoreVerified: true, manifestReadable: true, checksum: 'c'.repeat(64),
    } } });
    await assert.rejects(close('f'.repeat(64)), /CUSTOMER_ALLOCATION_CLOSURE_RECEIPT_MISMATCH/);
    assert.deepEqual(await close('b'.repeat(64)), [{ state: 'CLOSED', manifest_sha256: 'b'.repeat(64) }]);
    assert.deepEqual(await close('b'.repeat(64)), [{ state: 'CLOSED', manifest_sha256: 'b'.repeat(64) }]);
    const history = await db.$queryRaw<Array<{ event: string; manifest_sha256: string }>>`
      SELECT event, manifest_sha256 FROM public.customer_allocation_release_audit ORDER BY id
    `;
    assert.deepEqual(history.map(row => row.event), ['ACTIVATED', 'CLOSED']);
    assert.ok(history.every(row => row.manifest_sha256 === 'b'.repeat(64)));
    assert.equal(await runtimeAdmission('a'.repeat(40), 'release-456'), false, 'closure removes posting authority');
    assert.deepEqual(await verifyCustomerAllocationDeploymentState(db), { customerAllocationDatabaseProtections: 'verified' });
  } finally { await db.$disconnect(); await temporary.cleanup(); }
});
