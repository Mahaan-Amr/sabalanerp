import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { createAuthoritativeSession, SESSION_COOKIE } from '../../services/identitySessionService';

const url = process.env.LOCAL_QA_DATABASE_URL;
assert.ok(url, 'Use the existing sabalanerp-local database via LOCAL_QA_DATABASE_URL');
const target = new URL(url);
assert.ok(['localhost', '127.0.0.1', 'postgres'].includes(target.hostname) && target.pathname === '/sabalanerp');
const origin = process.env.LOCAL_QA_API_ORIGIN || 'http://127.0.0.1:5000';
assert.ok(['localhost', '127.0.0.1', 'backend'].includes(new URL(origin).hostname), 'Only the local API is supported');

test('HTTP managerial requests never self-approve; independent dated decisions serialize and notify the Accountant', async () => {
  const db = new PrismaClient({ datasources: { db: { url } } });
  const users: string[] = [];
  const contracts: string[] = [];
  try {
    const source = await db.salesContract.findFirstOrThrow({ where: { partnerKind: null, partnerCaseId: null } });
    const user = async (role: 'USER' | 'MANAGER' | 'ADMIN', name: string) => {
      const suffix = randomUUID();
      const actor = await db.user.create({ data: { username: `dispatch-http-${suffix}`, email: `${suffix}@dispatch-http.invalid`,
        password: 'non-login-qa-fixture', firstName: name, lastName: 'آزمون مستقل', role, departmentId: source.departmentId } });
      users.push(actor.id);
      await db.workspacePermission.create({ data: { userId: actor.id, workspace: 'accounting', permissionLevel: role === 'USER' ? 'admin' : 'view' } });
      await db.featurePermission.create({ data: { userId: actor.id, workspace: 'accounting', feature: 'accounting_contracts_view', permissionLevel: 'view' } });
      if (role === 'USER') await db.featurePermission.create({ data: { userId: actor.id, workspace: 'accounting', feature: 'accounting_actions_manage', permissionLevel: 'edit' } });
      const session = await createAuthoritativeSession(db, actor.id, { userAgent: 'manager-dispatch-http-qa', ipAddress: '127.0.0.1' });
      return { id: actor.id, cookie: `${SESSION_COOKIE}=${session.token}` };
    };
    const accountant = await user('USER', 'حسابدار');
    const manager = await user('MANAGER', 'مدیر');
    const admin = await user('ADMIN', 'ادمین');
    const contract = async () => {
      const row = await db.salesContract.create({ data: { contractNumber: `QA-MANAGER-HTTP-${randomUUID()}`, title: 'Manager decision HTTP QA',
        titlePersian: 'آزمون مستقل تصمیم مدیریتی', content: 'QA', customerId: source.customerId, departmentId: source.departmentId,
        createdBy: accountant.id, responsibleSellerId: accountant.id, totalAmount: 1000, currency: 'ریال', status: 'SIGNED',
        commercialFlowVersion: 1, commercialRevision: 1, salesApprovalRevision: 1, customerAcceptanceRevision: 1,
        commercialExpiresAt: new Date('2099-01-01') } });
      contracts.push(row.id); return row;
    };
    const call = async (actor: { cookie: string }, path: string, body?: unknown) => {
      const response = await fetch(`${origin}/api${path}`, { method: body === undefined ? 'GET' : 'POST',
        headers: { cookie: actor.cookie, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, ...(await response.json() as { success: boolean; data: any; error?: string }) };
    };
    const ordinary = await contract();
    const submitted = await call(accountant, `/dispatch-credit/contracts/${ordinary.id}/requests`, { kind: 'MANAGER' });
    assert.equal(submitted.status, 200);
    const id = submitted.data.id;
    const pending = await call(accountant, `/dispatch-credit/contracts/${ordinary.id}`);
    assert.equal(pending.data.authorities[0].status, 'PENDING', 'Accounting workspace admin cannot trigger the old automatic shortcut');
    assert.equal(pending.data.authorities[0].promisedDate, null);
    assert.equal(pending.data.authorities[0].canDecide, false);
    assert.equal(pending.data.eligible, false);
    const notice = await db.notification.findFirstOrThrow({ where: { referenceId: id, userId: manager.id, type: 'CONTRACT_MANAGER_DISPATCH_REQUESTED' } });
    assert.equal(notice.actionUrl, `/dashboard/accounting/contracts/${ordinary.id}`);
    const duty = await db.crossWorkspaceDuty.findUniqueOrThrow({ where: { stableKey: `CONTRACT_DISPATCH:${id}` } });
    const inbox = await call(manager, `/duties/workspaces/accounting/duties/${duty.id}`);
    assert.equal(inbox.status, 200);
    assert.equal(inbox.data.destinationHref, notice.actionUrl);
    assert.equal((await call(accountant, `/dispatch-credit/authorities/${id}/actions`, { action: 'APPROVE', promisedDate: '2099-01-01' })).status, 409);
    assert.equal((await call(manager, `/dispatch-credit/authorities/${id}/actions`, { action: 'APPROVE' })).status, 409);
    const decisions = await Promise.all([
      call(manager, `/dispatch-credit/authorities/${id}/actions`, { action: 'APPROVE', promisedDate: '2099-02-01' }),
      call(admin, `/dispatch-credit/authorities/${id}/actions`, { action: 'APPROVE', promisedDate: '2099-03-01' }),
    ]);
    assert.deepEqual(decisions.map(row => row.status).sort(), [200, 409]);
    const reviewed = await call(accountant, `/dispatch-credit/contracts/${ordinary.id}`);
    assert.equal(reviewed.data.eligible, true);
    const approval = reviewed.data.authorities[0];
    assert.equal(approval.status, 'APPROVED');
    assert.ok([manager.id, admin.id].includes(approval.decidedBy));
    assert.ok(approval.deciderName.includes('آزمون مستقل'));
    assert.ok(approval.decidedAt);
    assert.equal(approval.promisedDate.slice(0, 10), approval.decidedBy === manager.id ? '2099-02-01' : '2099-03-01');
    assert.equal(await db.notification.count({ where: { referenceId: id, userId: accountant.id, type: 'CONTRACT_MANAGER_DISPATCH_DECIDED' } }), 1);

    const second = await contract();
    const own = await call(admin, `/dispatch-credit/contracts/${second.id}/requests`, { kind: 'MANAGER' });
    assert.equal(own.status, 200);
    assert.equal((await call(admin, `/dispatch-credit/contracts/${second.id}`)).data.authorities[0].status, 'PENDING');
    assert.equal((await call(admin, `/dispatch-credit/authorities/${own.data.id}/actions`, { action: 'APPROVE', promisedDate: '2099-01-01' })).status, 409);
    assert.equal((await call(manager, `/dispatch-credit/authorities/${own.data.id}/actions`, { action: 'DECLINE' })).status, 409);
    assert.equal((await call(manager, `/dispatch-credit/authorities/${own.data.id}/actions`, { action: 'DECLINE', reason: 'پرداخت پیش از ارسال لازم است' })).status, 200);
    const rejected = (await call(admin, `/dispatch-credit/contracts/${second.id}`)).data.authorities[0];
    assert.equal(rejected.status, 'REJECTED');
    assert.equal(rejected.promisedDate, null);
    assert.equal(rejected.decidedBy, manager.id);
    assert.equal((await call(admin, `/dispatch-credit/contracts/${second.id}/requests`, { kind: 'MANAGER' })).status, 200);
  } finally {
    try {
    if (contracts.length) {
      const authorities = await db.contractDispatchAuthority.findMany({ where: { contractId: { in: contracts } }, select: { id: true } });
      const sourceIds = authorities.map(row => row.id);
      const events = await db.notificationEvent.findMany({ where: { resourceType: 'CONTRACT_DISPATCH', resourceId: { in: contracts } }, select: { id: true } });
      const eventIds = events.map(row => row.id);
      await db.notificationOutbox.deleteMany({ where: { eventId: { in: eventIds } } });
      await db.notification.deleteMany({ where: { eventId: { in: eventIds } } });
      await db.notificationEvent.deleteMany({ where: { id: { in: eventIds } } });
      const duties = await db.crossWorkspaceDuty.findMany({ where: { sourceType: 'CONTRACT_DISPATCH', sourceId: { in: sourceIds } }, select: { id: true } });
      const dutyIds = duties.map(row => row.id);
      await db.crossWorkspaceDutyNotificationIdentity.deleteMany({ where: { dutyId: { in: dutyIds } } });
      await db.crossWorkspaceDutyAuditVersion.deleteMany({ where: { dutyId: { in: dutyIds } } });
      await db.crossWorkspaceDutyAssignmentHistory.deleteMany({ where: { dutyId: { in: dutyIds } } });
      await db.crossWorkspaceDuty.deleteMany({ where: { id: { in: dutyIds } } });
      await db.accountingAuditLog.deleteMany({ where: { contractId: { in: contracts } } });
      await db.contractDispatchAuthority.deleteMany({ where: { contractId: { in: contracts } } });
      await db.salesContract.deleteMany({ where: { id: { in: contracts } } });
    }
    if (users.length) {
      await db.authSession.deleteMany({ where: { userId: { in: users } } });
      await db.recognizedBrowserProfile.deleteMany({ where: { userId: { in: users } } });
      await db.featurePermission.deleteMany({ where: { userId: { in: users } } });
      await db.workspacePermission.deleteMany({ where: { userId: { in: users } } });
      await db.user.deleteMany({ where: { id: { in: users } } });
    }
    } finally { await db.$disconnect(); }
  }
});
