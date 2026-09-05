import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { prisma } from '../../lib/prisma';
import accountingRouter from '../../routes/accounting';
import { createAuthoritativeSession, SESSION_COOKIE } from '../identitySessionService';

// An actual authenticated HTTP approval against the parent's isolated database.
async function main() {
  const url = new URL(process.env.DATABASE_URL || '');
  if (url.hostname !== '127.0.0.1' || url.port !== '55432' ||
      !/^\/sabalanerp_concurrency_[a-f0-9]{16}$/.test(url.pathname)) throw new Error('Isolated local test DB required');
    const actorId = process.env.PARTNER_TEST_ACTOR_ID!, invoiceId = process.env.PARTNER_TEST_INVOICE_ID!;
  try {
    await prisma.workspacePermission.create({ data: { userId: actorId, workspace: 'accounting',
      permissionLevel: 'admin', grantedBy: actorId } });
    await prisma.featurePermission.create({ data: { userId: actorId, workspace: 'accounting',
      feature: 'accounting_records_approve_void', permissionLevel: 'edit', grantedBy: actorId } });
    const session = await createAuthoritativeSession(prisma, actorId, { ipAddress: '127.0.0.1', userAgent: 'isolated-334-approval' });
    const app = express(); app.use(express.json()); app.use('/api/accounting', accountingRouter);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    try {
      const grant = await prisma.effectiveActionGrant.findFirstOrThrow({ where: { principalId: actorId, domain: 'PARTNER',
        action: 'ACCOUNTING_WRITE', revokedAt: null } });
      await prisma.effectiveActionGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date(), revokedBy: actorId,
        revocationReason: 'آزمون لغو مجوز پس از آماده‌سازی صورتحساب', revocationCorrelationId: `${invoiceId}-revoke-before-approval` } });
      const payload = { kind: 'APPROVE_FINANCIAL_INVOICE', invoiceId,
        systemInvoiceNumber: `${invoiceId}-official`, systemInvoiceDate: new Date().toISOString(),
        sepidarAmount: '1600', note: 'تأیید صورتحساب آزمایشی پرونده همکار' };
      const approve = async () => {
        const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/accounting/actions`, {
          method: 'POST', headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${session.token}`,
            'x-idempotency-key': `${invoiceId}-initial-approval`, 'x-correlation-id': `${invoiceId}-initial-approval` },
          body: JSON.stringify(payload) });
        return { status: response.status, body: await response.json() as any };
      };
      const denied = await approve();
      assert.equal(denied.status, 403, 'ordinary Accounting manager authority cannot approve a private Partner invoice');
      await prisma.effectiveActionGrant.create({ data: { ...grant, id: `${grant.id}-initial-approval`,
        reason: 'مجوز تأیید صورتحساب در آزمون محلی', correlationId: `${invoiceId}-approval-grant` } });
      let waiting: ReturnType<typeof approve> | undefined;
      const featureKey = { userId_workspace_feature: { userId: actorId, workspace: 'accounting', feature: 'accounting_records_approve_void' } };
      try {
        await prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM partner_operations_controls WHERE id = 'partner-operations' FOR UPDATE`;
          waiting = approve();
          let blocked = false;
          const deadline = Date.now() + 5_000;
          while (Date.now() < deadline) {
            await tx.$queryRaw`SELECT pg_stat_clear_snapshot()::text`;
            const waits = await tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM pg_stat_activity
              WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'
                AND query LIKE '%partner_operations_controls%'`;
            if (Number(waits[0].count)) { blocked = true; break; }
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          assert.equal(blocked, true, 'approval passed HTTP preflight and reached the shared lock');
          await tx.featurePermission.update({ where: featureKey, data: { permissionLevel: 'view' } });
          await tx.workspacePermission.update({ where: { userId_workspace: { userId: actorId, workspace: 'accounting' } },
            data: { permissionLevel: 'edit' } });
        });
        assert.equal((await waiting!).status, 403, 'approval rechecks narrow authority after waiting, not from the earlier route snapshot');
      } finally {
        await waiting;
        await prisma.featurePermission.update({ where: featureKey, data: { permissionLevel: 'edit' } });
        await prisma.workspacePermission.update({ where: { userId_workspace: { userId: actorId, workspace: 'accounting' } },
          data: { permissionLevel: 'admin' } });
      }
      // The absence of a direct override is authority too. No existing direct
      // row changes in this race, so locking only visible rows is insufficient.
      const workspaceKey = { userId_workspace: { userId: actorId, workspace: 'accounting' } };
      const actor = await prisma.user.findUniqueOrThrow({ where: { id: actorId } });
      await prisma.roleWorkspacePermission.create({ data: { role: actor.role, workspace: 'accounting',
        permissionLevel: 'admin' } });
      await prisma.workspacePermission.delete({ where: workspaceKey });
      waiting = undefined;
      try {
        await prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM partner_operations_controls WHERE id = 'partner-operations' FOR UPDATE`;
          waiting = approve();
          let blocked = false;
          const deadline = Date.now() + 5_000;
          while (Date.now() < deadline) {
            await tx.$queryRaw`SELECT pg_stat_clear_snapshot()::text`;
            const waits = await tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM pg_stat_activity
              WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'
                AND query LIKE '%partner_operations_controls%'`;
            if (Number(waits[0].count)) { blocked = true; break; }
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          assert.equal(blocked, true, 'inherited approval authority passed HTTP preflight');
          await tx.workspacePermission.create({ data: { userId: actorId, workspace: 'accounting',
            permissionLevel: 'view', grantedBy: actorId } });
        });
        assert.equal((await waiting!).status, 403, 'a direct override inserted during the wait invalidates inherited approval authority');
      } finally {
        await waiting;
        await prisma.workspacePermission.upsert({ where: workspaceKey,
          create: { userId: actorId, workspace: 'accounting', permissionLevel: 'admin', grantedBy: actorId },
          update: { permissionLevel: 'admin' } });
        await prisma.roleWorkspacePermission.delete({ where: { role_workspace: { role: actor.role, workspace: 'accounting' } } });
      }
      const invoice = await prisma.accountingFinancialRecord.findUniqueOrThrow({ where: { id: invoiceId } });
      const caseId = (invoice.metadata as { partnerCaseId: string }).partnerCaseId;
      const sale = await prisma.partnerSaleCase.findUniqueOrThrow({ where: { id: caseId }, include: { head: true } });
      const graphHash = async (value: string) => prisma.$transaction(async tx => {
        // Deliberate damaged persisted fixture, exclusively in the isolated DB.
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
        await tx.partnerCaseRevision.update({ where: { caseId_revision: { caseId, revision: sale.headRevision } }, data: { graphHash: value } });
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = origin');
      });
      try {
        await graphHash(`sha256-v1:${'e'.repeat(64)}`);
        assert.equal((await approve()).status, 409, 'cached financial projection cannot authorize approval over a damaged canonical graph');
      } finally { await graphHash(sale.head.graphHash); }
      const authorizationAuditCount = () => prisma.effectiveAuthorizationAudit.count({ where: {
        domain: 'PARTNER', rootKind: 'CASE', rootId: caseId,
        correlationId: `${invoiceId}-initial-approval`, action: 'ACCOUNTING_WRITE',
      } });
      const auditsBeforeApproval = await authorizationAuditCount();
      const approved = await approve();
      assert.equal(approved.status, 200, JSON.stringify(approved.body));
      assert.deepEqual(approved.body.data.affected.financialRecordIds, [invoiceId]);
      assert.equal(await authorizationAuditCount(), auditsBeforeApproval + 1,
        'one approval invocation persists exactly one central authorization decision');
      const auditsBeforeReplay = await authorizationAuditCount();
      const replay = await approve();
      assert.equal(replay.status, 200, 'an exact successful Partner approval retry returns its existing result');
      assert.deepEqual(replay.body.data.affected, approved.body.data.affected);
      assert.equal(await authorizationAuditCount(), auditsBeforeReplay + 1,
        'an authorized replay rechecks authority once without duplicate effect-level audit');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
