import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import type { Prisma } from '@prisma/client';
import { createAccountingLedgerAdministration } from '../accountingLedgerAdministration';
import { ensureCustomerWorkspaceProfile } from '../accountingCustomerWorkspace';
import { customerFinanceFixture } from './customerFinanceFixture';

const url = process.env.ACCOUNTING_LEDGER_TEST_DATABASE_URL;

test('the protected opening manifest admits only one exact customer command after reopening', { skip: !url, timeout: 240_000 }, async () => {
  const f = await customerFinanceFixture(url!);
  try {
    const profile = await ensureCustomerWorkspaceProfile(f.db, await f.customer(), f.actor, f.common.occurredAt);
    const account = await f.db.accountingLedgerAccount.findUniqueOrThrow({ where: { id: f.counter.id } });
    const clearing = await createAccountingLedgerAdministration(f.db).createAccount({
      bookId: f.book.id, codeSchemeId: account.codeSchemeId, parentId: account.parentId!,
      code: account.code.slice(0, -3) + '002', titlePersian: 'حساب واسط افتتاحیه آزمون', level: 'MOIN',
      normalSide: 'CREDIT', statementRole: 'EQUITY', currencyBehavior: 'BASE_ONLY',
      effectiveFrom: f.common.occurredAt, actorId: f.actor.id,
    });
    const id = randomUUID();
    const release = 'sepidar-opening-test-release';
    const lease = randomUUID();
    const commit = 'a'.repeat(40);
    const source = 'b'.repeat(64);
    const hash = 'c'.repeat(64);
    const key = 'sepidar-test-opening-91';
    const basis = f.common.occurredAt.toISOString();
    await f.db.deploymentOperation.create({ data: {
      id, releaseId: release, targetCommit: commit, owner: f.actor.id, activeKey: 'production',
      phase: 'MIGRATIONS_APPLIED', leaseToken: lease, leaseExpiresAt: new Date(Date.now() + 240_000),
      startedAt: new Date(), heartbeatAt: new Date(), checkpointJson: {
        deploymentId: id, releaseId: release, localVerified: true, remoteVerified: true,
        restoreVerified: true, manifestReadable: true, checksum: 'd'.repeat(64),
      },
    }});
    const manifest = JSON.stringify({
      format: 'sepidar-customer-opening-approval-v1', releaseId: release, deploymentId: id, buildCommit: commit,
      checkpointHash: 'd'.repeat(64),
      bookId: f.book.id, counterAccountId: clearing.id, sourcePackageHash: source,
      accountingApprovalHash: 'e'.repeat(64), basisAt: basis, expiresAt: new Date(Date.now() + 240_000).toISOString(),
      commands: [{ idempotencyKey: key, profileId: profile.id, actorId: f.actor.id,
        sourceCustomerId: '7', sourceVoucherItemId: '91', commandHash: hash, totalRials: '-1' }],
    });
    const manifestHash = createHash('sha256').update(manifest).digest('hex');
    async function admitted(tx: Prisma.TransactionClient, command = hash, item = '91') {
      const [result] = await tx.$queryRaw<Array<{ admitted: boolean }>>`
        SELECT public.sepidar_customer_opening_runtime_admitted(${commit}, ${release}, ${f.book.id},
          ${profile.id}, ${f.actor.id}, ${basis}::timestamptz, ${clearing.id}, ${command}, ${source},
          '7', ${item}, ${key}) AS admitted
      `;
      return result.admitted;
    }

    await f.db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET LOCAL SESSION AUTHORIZATION sabalan_sepidar_opening_controller');
      await tx.$queryRaw`SELECT public.sepidar_customer_opening_register_manifest(${id}, ${release}, ${lease}, ${manifest}, ${manifestHash})::text`;
    });
    await f.db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET LOCAL SESSION AUTHORIZATION sabalan_application_runtime');
      assert.equal(await admitted(tx), false);
    });
    await f.db.deploymentOperation.update({ where: { id }, data: { phase: 'COMPLETED', activeKey: null } });
    await f.db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET LOCAL SESSION AUTHORIZATION sabalan_application_runtime');
      assert.equal(await admitted(tx), true);
      assert.equal(await admitted(tx, 'f'.repeat(64)), false);
      assert.equal(await admitted(tx, hash, '92'), false);
    });
  } finally {
    await f.close();
  }
});
