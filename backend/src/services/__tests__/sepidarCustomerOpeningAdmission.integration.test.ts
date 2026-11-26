import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import type { Prisma } from '@prisma/client';
import { createAccountingLedgerAdministration } from '../accountingLedgerAdministration';
import { ensureCustomerWorkspaceProfile } from '../accountingCustomerWorkspace';
import { readSepidarCustomerOpeningPreparation } from '../prepareSepidarCustomerOpening';
import { customerFinanceFixture } from './customerFinanceFixture';
import { protectedSepidarOpeningProof } from '../protectedBridgeMigrations';

const url = process.env.ACCOUNTING_LEDGER_TEST_DATABASE_URL;

test('the protected opening manifest admits only one exact customer command after reopening', { skip: !url, timeout: 240_000 }, async () => {
  const f = await customerFinanceFixture(url!);
  try {
    const oldRelease = new Set<string>();
    const openingRelease = new Set(['20261125110000_accounting_neutral_normal_side', '20261125112000_sepidar_customer_opening_admission']);
    assert.deepEqual(await protectedSepidarOpeningProof(f.db, oldRelease), {});
    assert.deepEqual((await protectedSepidarOpeningProof(f.db, openingRelease)).normalSides, ['DEBIT', 'CREDIT', 'NEUTRAL']);
    await f.db.$transaction(async tx => {
      await tx.$executeRawUnsafe('GRANT SELECT ON public.sepidar_customer_opening_admissions TO sabalan_application_runtime');
      await assert.rejects(protectedSepidarOpeningProof(tx, openingRelease), { code: 'PROTECTED_SEPIDAR_OPENING_ACL_DRIFT' });
      await tx.$executeRawUnsafe('REVOKE SELECT ON public.sepidar_customer_opening_admissions FROM sabalan_application_runtime');
      await tx.$executeRawUnsafe('GRANT SELECT (source_customer_id) ON public.sepidar_customer_opening_admissions TO sabalan_application_runtime');
      await assert.rejects(protectedSepidarOpeningProof(tx, openingRelease), { code: 'PROTECTED_SEPIDAR_OPENING_ACL_DRIFT' });
      await tx.$executeRawUnsafe('REVOKE SELECT (source_customer_id) ON public.sepidar_customer_opening_admissions FROM sabalan_application_runtime');
    });
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
    const crmOnly = await f.customer();
    const prepared = await f.db.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return readSepidarCustomerOpeningPreparation(tx, {
        targetWorkspaceKey: crmOnly, sourcePackageHash: source, sourceCustomerId: '8', sourceVoucherItemId: '92',
        signedRials: '11', debitRials: '11', creditRials: '0',
      }, { actor: f.actor, basisAt: f.common.occurredAt, bookId: f.book.id, periodId: f.common.periodId,
        postingRuleId: f.rule.id, counterAccountId: clearing.id });
    });
    assert.equal(prepared.manifestLine.destinationKey, crmOnly);
    assert.equal(await f.db.accountingCustomerProfile.count({ where: { partySourceId: crmOnly.slice(9) } }), 0);
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
      commands: [{ idempotencyKey: key, destinationKey: profile.id, actorId: f.actor.id,
        sourceCustomerId: '7', sourceVoucherItemId: '91', commandHash: hash, totalRials: '-1' }, prepared.manifestLine],
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
      const [locked] = await tx.$queryRaw<Array<{ checkpoint_hash: string; phase: string }>>`
        SELECT * FROM public.sepidar_customer_opening_lock(${id}, ${release}, ${lease})
      `;
      assert.equal(locked.checkpoint_hash, 'd'.repeat(64));
      assert.equal(locked.phase, 'MIGRATIONS_APPLIED');
      await tx.$queryRaw`SELECT public.sepidar_customer_opening_register_manifest(${id}, ${release}, ${lease}, ${manifest}, ${manifestHash})::text`;
      await tx.$queryRaw`SELECT public.sepidar_customer_opening_register_manifest(${id}, ${release}, ${lease}, ${manifest}, ${manifestHash})::text`;
    });
    await f.db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET LOCAL SESSION AUTHORIZATION sabalan_application_runtime');
      assert.equal(await admitted(tx), false);
    });
    await f.db.deploymentOperation.update({ where: { id }, data: { phase: 'COMPLETED', activeKey: null } });
    const onboarded = await ensureCustomerWorkspaceProfile(f.db, crmOnly, f.actor, f.common.occurredAt);
    const reopened = await f.db.$transaction(tx => readSepidarCustomerOpeningPreparation(tx, {
      targetWorkspaceKey: crmOnly, sourcePackageHash: source, sourceCustomerId: '8', sourceVoucherItemId: '92',
      signedRials: '11', debitRials: '11', creditRials: '0',
    }, { actor: f.actor, basisAt: f.common.occurredAt, bookId: f.book.id, periodId: f.common.periodId,
      postingRuleId: f.rule.id, counterAccountId: clearing.id }));
    assert.deepEqual(reopened.manifestLine, prepared.manifestLine);
    await f.db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET LOCAL SESSION AUTHORIZATION sabalan_application_runtime');
      assert.equal(await admitted(tx), true);
      assert.equal(await admitted(tx, 'f'.repeat(64)), false);
      assert.equal(await admitted(tx, hash, '92'), false);
      const [crm] = await tx.$queryRaw<Array<{ admitted: boolean }>>`
        SELECT public.sepidar_customer_opening_runtime_admitted(${commit}, ${release}, ${f.book.id},
          ${onboarded.id}, ${f.actor.id}, ${basis}::timestamptz, ${clearing.id}, ${prepared.manifestLine.commandHash},
          ${source}, '8', '92', ${prepared.command.idempotencyKey}) AS admitted
      `;
      assert.equal(crm.admitted, true);
    });
    // The runtime can insert an opening review only with the same signed amount and source.
    await f.db.$executeRawUnsafe('GRANT INSERT ON public.accounting_customer_opening_reviews TO sabalan_application_runtime');
    const reviewEvidence = JSON.stringify({
      review: { sepidarEvidence: { sourcePackageHash: source, sourceCustomerId: '7', sourceVoucherItemId: '91' } },
      sepidarAdmission: { sourcePackageHash: source, sourceCustomerId: '7', sourceVoucherItemId: '91',
        bookId: f.book.id, counterAccountId: clearing.id },
    });
    const insertReview = (total: number) => f.db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET LOCAL SESSION AUTHORIZATION sabalan_application_runtime');
      await tx.$executeRaw`
        INSERT INTO public.accounting_customer_opening_reviews
          (id, "profileId", "basisAt", "totalRials", "transferRials", "snapshotHash", evidence, "idempotencyKey", "commandHash", "createdBy")
        VALUES (${randomUUID()}, ${profile.id}, ${basis}::timestamptz AT TIME ZONE 'UTC',
          ${total}::numeric, ${total}::numeric, ${'f'.repeat(64)}, ${reviewEvidence}::jsonb, ${key}, ${hash}, ${f.actor.id})
      `;
    });
    await assert.rejects(insertReview(-2), /SEPIDAR_CUSTOMER_OPENING_CLOSED/);
    await insertReview(-1);
    assert.equal((await f.db.accountingCustomerOpeningReview.findUniqueOrThrow({ where: { idempotencyKey: key } })).totalRials.toString(), '-1');

    const successor = randomUUID();
    await f.db.deploymentOperation.create({ data: {
      id: successor, releaseId: 'sepidar-opening-successor', targetCommit: commit, owner: f.actor.id,
      phase: 'COMPLETED', startedAt: new Date(Date.now() + 1000), heartbeatAt: new Date(),
      leaseToken: randomUUID(), leaseExpiresAt: new Date(),
    }});
    await f.db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET LOCAL SESSION AUTHORIZATION sabalan_application_runtime');
      assert.equal(await admitted(tx), false);
    });
  } finally {
    await f.close();
  }
});
