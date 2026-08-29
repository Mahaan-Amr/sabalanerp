import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { canonicalHash, type PartnerActionV2, type PermissionContext } from '@sabalanerp/partner-sales-contracts';
import { createPartnerCrmService } from '../partnerSales/crm/service';
import type { PartnerCustomerSummary, PartnerNextActionView, PartnerProjectView } from '../partnerSales/crm/contracts';
import { createAuditedPartnerAuthorization } from '../partnerSales/authorization/audited';
import { seedAuthorizationCase } from './partnerAuthorizationFixture';
import { ordinaryProjectSearch } from '../../routes/crm';

const databaseUrl = (connectionLimit = 2) => {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  if (!['localhost', '127.0.0.1', 'postgres'].includes(url.hostname) || url.pathname !== '/sabalanerp') {
    throw new Error('Existing sabalanerp-local database required');
  }
  url.searchParams.set('connection_limit', String(connectionLimit));
  url.searchParams.set('pool_timeout', '10');
  return url.toString();
};

const intentHash = async (value: Record<string, unknown>) => canonicalHash(Object.fromEntries(Object.entries(value)
  .filter(([key]) => !['commandId', 'correlationId', 'idempotency', 'idempotencyKey', 'payloadHash'].includes(key))));

const transactionDatabase = (tx: Prisma.TransactionClient): PrismaClient => ({
  $transaction: async (run: (transaction: Prisma.TransactionClient) => unknown) => run(tx),
} as unknown as PrismaClient);

function authorize(actorId: string, partnerSellerId: string, persona: PermissionContext['persona']) {
  return async (_tx: Prisma.TransactionClient, input: { action: PartnerActionV2; root: PermissionContext['root'] }) => ({
    ok: true as const,
    value: {
      actorId,
      persona,
      isAdmin: persona === 'INTERNAL',
      partnerSellerId,
      partnerStatus: 'ACTIVE' as const,
      root: input.root,
      purpose: 'CRM' as const,
      channel: 'API' as const,
      scope: persona === 'PARTNER' ? 'OWN' as const : 'COMPANY' as const,
      resourceVisible: true,
      actionGranted: true,
      authorizationRevision: 1,
      lifecycleRevision: 1,
      evaluatedAt: new Date().toISOString(),
    },
  });
}

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('masked duplicate and approved transfer expose no prior CRM history and preserve Project responsibility', async () => {
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl() } } });
  const rollback = new Error('rollback partner CRM fixture');
  try {
    await assert.rejects(database.$transaction(async tx => {
      const suffix = randomUUID();
      const oldOwnerId = `partner-crm-old-${suffix}`;
      const partnerId = `partner-crm-new-${suffix}`;
      const adminId = `partner-crm-admin-${suffix}`;
      const customerId = `partner-crm-customer-${suffix}`;
      const projectId = `partner-crm-project-${suffix}`;
      for (const [id, role] of [[oldOwnerId, 'SALES'], [partnerId, 'SALES'], [adminId, 'ADMIN']] as const) {
        await tx.user.create({ data: { id, username: id, email: `${id}@example.invalid`, password: 'not-a-login',
          firstName: 'Fixture', lastName: 'Partner CRM', role } });
      }
      await tx.partnerProfile.create({ data: { id: partnerId, userId: partnerId, state: 'ACTIVE' } });
      await tx.crmCustomer.create({ data: { id: customerId, ownerUserId: oldOwnerId, firstName: 'مالک',
        lastName: 'قبلی', city: 'تهران', nationalCode: `9${suffix.replace(/-/g, '').slice(0, 9)}`,
        phoneNumbers: { create: { number: '09121234567', type: 'mobile', isPrimary: true } } } });
      await tx.crmPotentialProject.create({ data: { id: projectId, customerId, responsibleSellerId: oldOwnerId,
        title: 'پروژه تاریخی محرمانه', workType: 'نما' } });

      const notices: Array<{ kind: string; recipients: string[] }> = [];
      const partner = createPartnerCrmService({ database: transactionDatabase(tx), actorId: partnerId,
        authorize: authorize(partnerId, partnerId, 'PARTNER'),
        notifyTransfer: async (_transaction, notice) => { notices.push({ kind: notice.kind, recipients: notice.recipientIds }); } });
      const match = await partner.findDuplicate({ schemaVersion: 1, correlationId: `corr-${suffix}`, phone: '09121234567' });
      assert.equal(match.ok, true);
      if (!match.ok) throw new Error('duplicate match expected');
      assert.equal(match.value.maskedWitness, '********4567');
      assert.equal('customerId' in match.value, false);
      assert.equal(JSON.stringify(match.value).includes(projectId), false);

      const requestBase = { schemaVersion: 1 as const, commandId: `request-${suffix}`, correlationId: `corr-${suffix}`,
        matchReference: match.value.matchReference, reason: 'درخواست انتقال برای پیگیری جاری', idempotencyKey: `key-${suffix}` };
      const request = await partner.requestTransfer({ ...requestBase, payloadHash: await intentHash(requestBase) });
      assert.equal(request.ok, true);
      if (!request.ok) throw new Error('transfer request expected');
      assert.deepEqual(notices, [{ kind: 'REQUESTED', recipients: [oldOwnerId] }]);
      await tx.user.update({ where: { id: oldOwnerId }, data: { isActive: false } });

      const decisionIntent = { schemaVersion: 1 as const, type: 'CUSTOMER_TRANSFER_DECIDE' as const,
        transferId: request.value.transferId, expectedRevision: 1, outcome: 'APPROVE' as const,
        reason: 'تأیید انتقال بدون جابه‌جایی تاریخچه' };
      const decisionHash = await intentHash(decisionIntent);
      const admin = createPartnerCrmService({ database: transactionDatabase(tx), actorId: adminId,
        authorize: (transaction, input) => createAuditedPartnerAuthorization(transaction, {
          actorId: adminId, purpose: 'CRM', channel: 'API',
        }, { correlationId: input.correlationId, reason: input.reason }, input.target).authorize(input.action, input.root),
        notifyTransfer: async (_transaction, notice) => { notices.push({ kind: notice.kind, recipients: notice.recipientIds }); } });
      const decision = await admin.decideTransfer({ ...decisionIntent, commandId: `decision-${suffix}`,
        correlationId: `decision-corr-${suffix}`, idempotency: { actorId: adminId,
          operation: 'CUSTOMER_TRANSFER_DECIDE', targetId: request.value.transferId,
          key: `decision-key-${suffix}`, payloadHash: decisionHash } });
      assert.equal(decision.ok, true);

      const customer = await tx.crmCustomer.findUniqueOrThrow({ where: { id: customerId }, select: {
        ownerUserId: true, partnerOwnerProfileId: true, partnerRevision: true } });
      assert.deepEqual(customer, { ownerUserId: partnerId, partnerOwnerProfileId: partnerId, partnerRevision: 1 });
      const project = await tx.crmPotentialProject.findUniqueOrThrow({ where: { id: projectId }, select: {
        responsibleSellerId: true, partnerRevision: true, title: true, customerTransferSnapshot: true } });
      assert.equal(project.responsibleSellerId, oldOwnerId);
      assert.equal(project.partnerRevision, null);
      assert.equal(project.title, 'پروژه تاریخی محرمانه');
      assert.equal((project.customerTransferSnapshot as { firstName?: string }).firstName, 'مالک');
      await tx.$executeRaw`SELECT set_config('sabalan.partner_crm_profile', ${partnerId}, true)`;
      await tx.crmCustomer.update({ where: { id: customerId }, data: { firstName: 'نام زنده محرمانه', partnerRevision: 2 } });
      assert.equal(((await tx.crmPotentialProject.findUniqueOrThrow({ where: { id: projectId }, select: {
        customerTransferSnapshot: true } })).customerTransferSnapshot as { firstName?: string }).firstName, 'مالک');
      assert.equal(await tx.crmPotentialProject.count({ where: { id: projectId,
        ...ordinaryProjectSearch('نام زنده محرمانه') } }), 0);
      assert.equal(await tx.crmPotentialProject.count({ where: { id: projectId,
        ...ordinaryProjectSearch('مالک') } }), 1);
      await tx.$executeRawUnsafe('SAVEPOINT immutable_customer_witness');
      await assert.rejects(tx.crmPotentialProject.update({ where: { id: projectId }, data: {
        customerTransferSnapshot: { schemaVersion: 1, firstName: 'بازنویسی', lastName: 'ممنوع' },
      } }), /Transferred Customer witness is immutable/);
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT immutable_customer_witness');
      await tx.crmPotentialProject.update({ where: { id: projectId }, data: { status: 'در حال پیگیری' } });
      const retainedFollowUpId = `partner-crm-retained-follow-${suffix}`;
      await tx.crmFollowUpReport.create({ data: { id: retainedFollowUpId, customerId, potentialProjectId: projectId,
        sellerId: oldOwnerId, communicationType: 'تماس تلفنی', workType: 'فروش سنگ پروژه ساختمانی',
        happenedAt: new Date(), summary: 'پیگیری پروژه باقی‌مانده برای مسئول قبلی', outcome: 'ادامه پروژه مستقل',
        hasNextAction: true, nextAction: { create: { id: `partner-crm-retained-action-${suffix}`, customerId,
          potentialProjectId: projectId, assignedToId: oldOwnerId, title: 'پیگیری پروژه باقی‌مانده',
          communicationType: 'تماس تلفنی', dueAt: new Date(Date.now() + 86_400_000), instructions: 'ادامه پیگیری' } } } });
      assert.equal(await tx.crmFollowUpReport.count({ where: { id: retainedFollowUpId, sellerId: oldOwnerId } }), 1);
      assert.deepEqual((await tx.crmPotentialProject.findMany({ where: { partnerRevision: null,
        responsibleSellerId: oldOwnerId }, select: { id: true } })).map(item => item.id), [projectId]);
      assert.deepEqual(await tx.crmPotentialProject.findMany({ where: { partnerRevision: null,
        responsibleSellerId: partnerId }, select: { id: true } }), []);
      await tx.$executeRawUnsafe('SAVEPOINT retained_project_reassign');
      await assert.rejects(tx.crmPotentialProject.update({ where: { id: projectId }, data: {
        responsibleSellerId: adminId } }), /current owner Profile|owner or revision mismatch/);
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT retained_project_reassign');
      await tx.$executeRaw`SELECT set_config('sabalan.partner_crm_legacy_reassignment', ${JSON.stringify({
        projectId, previousSellerId: oldOwnerId, nextSellerId: adminId, actorId: adminId,
        reason: 'تغییر مسئول پروژه قدیمی توسط مدیر CRM',
      })}, true)`;
      await tx.crmPotentialProject.update({ where: { id: projectId }, data: { responsibleSellerId: adminId } });
      assert.equal((await tx.crmPotentialProject.findUniqueOrThrow({ where: { id: projectId }, select: {
        responsibleSellerId: true } })).responsibleSellerId, adminId);

      const detail = await partner.readCustomer({ customerId, correlationId: `read-${suffix}` });
      assert.equal(detail.ok, true);
      if (detail.ok) {
        assert.deepEqual(detail.value.projects, []);
        assert.equal(JSON.stringify(detail.value).includes('پروژه تاریخی محرمانه'), false);
      }
      assert.deepEqual(notices[1], { kind: 'APPROVED', recipients: [oldOwnerId, partnerId] });
      throw rollback;
    }, { timeout: 30_000 }), error => error === rollback);
  } finally {
    await database.$disconnect();
  }
});

test('destination deactivation during transfer lock wait defeats approval', async () => {
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl(3) } } });
  const suffix = randomUUID();
  const oldPartnerId = `partner-crm-race-old-${suffix}`;
  const newPartnerId = `partner-crm-race-new-${suffix}`;
  const adminId = `partner-crm-race-admin-${suffix}`;
  const rollback = new Error('rollback transfer race fixture');
  const locked = signal(); const release = signal(); const ready = signal(); const beginDecision = signal();
  let blocker: Promise<unknown> | undefined; let request: Promise<unknown> | undefined;
  let requestPid = 0; let decisionResult: Awaited<ReturnType<ReturnType<typeof createPartnerCrmService>['decideTransfer']>> | undefined;
  try {
    for (const [id, role] of [[oldPartnerId, 'SALES'], [newPartnerId, 'SALES'], [adminId, 'ADMIN']] as const) {
      await database.user.create({ data: { id, username: id, email: `${id}@example.invalid`, password: 'not-a-login',
        firstName: 'Fixture', lastName: 'Transfer Race', role } });
    }
    await database.partnerProfile.createMany({ data: [
      { id: oldPartnerId, userId: oldPartnerId, state: 'ACTIVE' },
      { id: newPartnerId, userId: newPartnerId, state: 'ACTIVE' },
    ] });
    request = database.$transaction(async tx => {
      const customerId = `partner-crm-race-customer-${suffix}`;
      await tx.crmCustomer.create({ data: { id: customerId, ownerUserId: oldPartnerId, firstName: 'مشتری',
        lastName: 'رقابت انتقال', phoneNumbers: { create: { number: '09127776655', type: 'mobile', isPrimary: true } } } });
      const matchId = `partner-crm-race-match-${suffix}`;
      const transferId = `partner-crm-race-transfer-${suffix}`;
      await tx.partnerDuplicateCustomerMatch.create({ data: { id: matchId, requesterProfileId: newPartnerId,
        customerId, snapshot: { displayName: 'مشتری رقابت انتقال', personType: 'NATURAL', city: null,
          maskedWitness: '********6655' }, witnessHash: `sha256-v1:${'b'.repeat(64)}`,
        expiresAt: new Date(Date.now() + 300_000) } });
      await tx.partnerCustomerTransfer.create({ data: { id: transferId, customerId, matchId,
        fromOwnerUserId: oldPartnerId, fromProfileId: null, toProfileId: newPartnerId,
        requestedBy: newPartnerId, requestReason: 'درخواست انتقال هم‌زمان با غیرفعال‌سازی',
        correlationId: `race-request-corr-${suffix}` } });
      const [connection] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      requestPid = connection.pid; ready.resolve(); await beginDecision.promise;
      const intent = { schemaVersion: 1 as const, type: 'CUSTOMER_TRANSFER_DECIDE' as const,
        transferId, expectedRevision: 1, outcome: 'APPROVE' as const,
        reason: 'بررسی مقصد جاری در همان تراکنش' };
      const admin = createPartnerCrmService({ database: transactionDatabase(tx), actorId: adminId,
        authorize: (transaction, input) => createAuditedPartnerAuthorization(transaction, {
          actorId: adminId, purpose: 'CRM', channel: 'API',
        }, { correlationId: input.correlationId, reason: input.reason }, input.target).authorize(input.action, input.root),
        notifyTransfer: async () => undefined });
      decisionResult = await admin.decideTransfer({ ...intent, commandId: `race-decision-${suffix}`,
        correlationId: `race-decision-corr-${suffix}`, idempotency: { actorId: adminId,
          operation: 'CUSTOMER_TRANSFER_DECIDE', targetId: transferId,
          key: `race-decision-key-${suffix}`, payloadHash: await intentHash(intent) } });
      throw rollback;
    }, { timeout: 15_000 }).catch(error => { if (error !== rollback) throw error; });
    await Promise.race([ready.promise, request.then(() => { throw new Error('Transfer request ended before authorization'); })]);
    blocker = database.$transaction(async tx => {
      // A non-key activation update is compatible with the transfer row's FK
      // key-share lock, but must conflict with authorization's stronger lock.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${newPartnerId} FOR NO KEY UPDATE`;
      locked.resolve(); await release.promise;
      await tx.user.update({ where: { id: newPartnerId }, data: { isActive: false } });
    }, { timeout: 15_000 });
    await Promise.race([locked.promise, blocker.then(() => { throw new Error('Destination lock ended early'); })]);
    beginDecision.resolve();
    for (let attempt = 0; ; attempt++) {
      const [wait] = await database.$queryRaw<Array<{ waiting: boolean }>>`
        SELECT cardinality(pg_blocking_pids(${requestPid}::integer)) > 0 AS waiting`;
      if (wait.waiting) break;
      if (attempt >= 200) throw new Error('Transfer never waited for the destination User lock');
      await new Promise(done => setTimeout(done, 10));
    }
    release.resolve(); await Promise.all([blocker, request]);
    assert.equal(decisionResult?.ok, false);
    if (decisionResult && !decisionResult.ok) assert.equal(decisionResult.error.code, 'DEPENDENCY_BLOCKED');
  } finally {
    beginDecision.resolve(); release.resolve();
    await Promise.allSettled([blocker, request].filter((item): item is Promise<unknown> => Boolean(item)));
    try {
      await database.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
        await tx.partnerProfile.deleteMany({ where: { id: { in: [oldPartnerId, newPartnerId] } } });
        await tx.user.deleteMany({ where: { id: { in: [oldPartnerId, newPartnerId, adminId] },
          email: { in: [`${oldPartnerId}@example.invalid`, `${newPartnerId}@example.invalid`, `${adminId}@example.invalid`] } } });
      });
    } finally { await database.$disconnect(); }
  }
});

test('approved Customer transfer is blocked while the previous owner has an unresolved Partner Case', async () => {
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl() } } });
  const rollback = new Error('rollback unresolved Partner Case transfer fixture');
  try {
    await assert.rejects(database.$transaction(async tx => {
      const suffix = randomUUID();
      const oldPartnerId = `partner-crm-case-old-${suffix}`;
      const newPartnerId = `partner-crm-case-new-${suffix}`;
      const adminId = `partner-crm-case-admin-${suffix}`;
      for (const [id, role] of [[oldPartnerId, 'SALES'], [newPartnerId, 'SALES'], [adminId, 'ADMIN']] as const) {
        await tx.user.create({ data: { id, username: id, email: `${id}@example.invalid`, password: 'not-a-login',
          firstName: 'Fixture', lastName: 'Transfer Case', role } });
      }
      await tx.partnerProfile.createMany({ data: [
        { id: oldPartnerId, userId: oldPartnerId, state: 'ACTIVE' },
        { id: newPartnerId, userId: newPartnerId, state: 'ACTIVE' },
      ] });
      const seeded = await seedAuthorizationCase(tx, oldPartnerId, oldPartnerId);
      await tx.phoneNumber.create({ data: { customerId: seeded.customerId, number: '09129876543', type: 'mobile', isPrimary: true } });

      const requester = createPartnerCrmService({ database: transactionDatabase(tx), actorId: newPartnerId,
        authorize: authorize(newPartnerId, newPartnerId, 'PARTNER'), notifyTransfer: async () => undefined });
      const match = await requester.findDuplicate({ schemaVersion: 1, correlationId: `case-match-${suffix}`,
        phone: '09129876543' });
      assert.equal(match.ok, true);
      if (!match.ok) throw new Error('duplicate expected');
      const requestBase = { schemaVersion: 1 as const, commandId: `case-request-${suffix}`,
        correlationId: `case-request-corr-${suffix}`, matchReference: match.value.matchReference,
        reason: 'درخواست انتقال مشتری دارای پرونده جاری', idempotencyKey: `case-request-key-${suffix}` };
      const request = await requester.requestTransfer({ ...requestBase, payloadHash: await intentHash(requestBase) });
      assert.equal(request.ok, true);
      if (!request.ok) throw new Error('request expected');

      const decisionIntent = { schemaVersion: 1 as const, type: 'CUSTOMER_TRANSFER_DECIDE' as const,
        transferId: request.value.transferId, expectedRevision: 1, outcome: 'APPROVE' as const,
        reason: 'تلاش برای انتقال مشتری دارای پرونده ناتمام' };
      const admin = createPartnerCrmService({ database: transactionDatabase(tx), actorId: adminId,
        authorize: (transaction, input) => createAuditedPartnerAuthorization(transaction, {
          actorId: adminId, purpose: 'CRM', channel: 'API',
        }, { correlationId: input.correlationId, reason: input.reason }, input.target).authorize(input.action, input.root),
        notifyTransfer: async () => undefined });
      const decision = await admin.decideTransfer({ ...decisionIntent, commandId: `case-decision-${suffix}`,
        correlationId: `case-decision-corr-${suffix}`, idempotency: { actorId: adminId,
          operation: 'CUSTOMER_TRANSFER_DECIDE', targetId: request.value.transferId,
          key: `case-decision-key-${suffix}`, payloadHash: await intentHash(decisionIntent) } });
      assert.equal(decision.ok, false);
      if (!decision.ok) assert.equal(decision.error.code, 'DEPENDENCY_BLOCKED');
      const customer = await tx.crmCustomer.findUniqueOrThrow({ where: { id: seeded.customerId }, select: {
        ownerUserId: true, partnerOwnerProfileId: true } });
      assert.deepEqual(customer, { ownerUserId: oldPartnerId, partnerOwnerProfileId: null });
      throw rollback;
    }, { timeout: 30_000 }), error => error === rollback);
  } finally {
    await database.$disconnect();
  }
});

test('database guards reject direct Partner Customer and nested CRM writes outside the owner transaction', async () => {
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl() } } });
  const rollback = new Error('rollback partner CRM guard fixture');
  try {
    await assert.rejects(database.$transaction(async tx => {
      const suffix = randomUUID();
      const partnerId = `partner-crm-guard-${suffix}`;
      const customerId = `partner-crm-guard-customer-${suffix}`;
      await tx.user.create({ data: { id: partnerId, username: partnerId, email: `${partnerId}@example.invalid`,
        password: 'not-a-login', firstName: 'Fixture', lastName: 'Guard' } });
      await tx.partnerProfile.create({ data: { id: partnerId, userId: partnerId, state: 'ACTIVE' } });
      const ordinaryCustomerId = `partner-crm-ordinary-${suffix}`;
      await tx.crmCustomer.create({ data: { id: ordinaryCustomerId, ownerUserId: partnerId,
        firstName: 'مشتری', lastName: 'عادی' } });
      await tx.$executeRaw`SELECT set_config('sabalan.partner_crm_profile', ${partnerId}, true)`;
      await tx.$executeRawUnsafe('SAVEPOINT direct_ordinary_claim');
      await assert.rejects(tx.crmCustomer.update({ where: { id: ordinaryCustomerId }, data: {
        partnerOwnerProfileId: partnerId, partnerRevision: 1 } }), /approved Partner transfer/);
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT direct_ordinary_claim');
      await tx.$executeRaw`SELECT set_config('sabalan.partner_crm_profile', ${partnerId}, true)`;
      await tx.crmCustomer.create({ data: { id: customerId, ownerUserId: partnerId, partnerOwnerProfileId: partnerId,
        partnerRevision: 1, firstName: 'مشتری', lastName: 'همکار' } });
      await tx.$executeRaw`SELECT set_config('sabalan.partner_crm_profile', '', true)`;
      await tx.$executeRawUnsafe('SAVEPOINT direct_customer_write');
      await assert.rejects(tx.crmCustomer.update({ where: { id: customerId }, data: { partnerRevision: 2, city: 'قم' } }),
        /current owner Profile/);
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT direct_customer_write');
      await tx.$executeRawUnsafe('SAVEPOINT nested_phone_write');
      await assert.rejects(tx.phoneNumber.create({ data: { customerId, number: '09120000000', type: 'mobile' } }),
        /current owner Profile/);
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT nested_phone_write');
      throw rollback;
    }, { timeout: 20_000 }), error => error === rollback);
  } finally {
    await database.$disconnect();
  }
});

test('Partner CRM commands use CAS and idempotency while list/count/detail remain owner scoped', async () => {
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl() } } });
  const rollback = new Error('rollback partner CRM command fixture');
  try {
    await assert.rejects(database.$transaction(async tx => {
      const suffix = randomUUID();
      const partnerId = `partner-crm-command-${suffix}`;
      await tx.user.create({ data: { id: partnerId, username: partnerId, email: `${partnerId}@example.invalid`,
        password: 'not-a-login', firstName: 'Fixture', lastName: 'Commands', role: 'SALES' } });
      await tx.partnerProfile.create({ data: { id: partnerId, userId: partnerId, state: 'ACTIVE' } });
      const service = createPartnerCrmService({ database: transactionDatabase(tx), actorId: partnerId,
        authorize: authorize(partnerId, partnerId, 'PARTNER'), notifyTransfer: async () => undefined });

      const createBase = { schemaVersion: 1 as const, commandId: `create-${suffix}`, correlationId: `corr-${suffix}`,
        firstName: 'مشتری', lastName: 'اختصاصی', customerType: 'Individual' as const, city: 'تهران',
        phone: '09123334455', reason: 'ثبت مشتری توسط مالک جاری', idempotencyKey: `create-key-${suffix}` };
      const createCommand = { ...createBase, payloadHash: await intentHash(createBase) };
      const created = await service.createCustomer(createCommand);
      assert.equal(created.ok, true);
      if (!created.ok) throw new Error('customer create expected');
      const replay = await service.createCustomer(createCommand);
      assert.equal(replay.ok, true);
      assert.equal(await tx.crmCustomer.count({ where: { partnerOwnerProfileId: partnerId } }), 1);
      const conflictBase = { ...createBase, firstName: 'نام متفاوت' };
      const conflict = await service.createCustomer({ ...conflictBase, payloadHash: await intentHash(conflictBase) });
      assert.equal(conflict.ok, false);
      if (!conflict.ok) assert.equal(conflict.error.code, 'IDEMPOTENCY_CONFLICT');

      const customerId = (created.value.customer as PartnerCustomerSummary).customerId;
      const updateBase = { ...createBase, commandId: `update-${suffix}`, customerId, expectedRevision: 1,
        firstName: 'مشتری ویرایش‌شده', reason: 'اصلاح اطلاعات مشتری جاری', idempotencyKey: `update-key-${suffix}` };
      const updated = await service.updateCustomer({ ...updateBase, payloadHash: await intentHash(updateBase) });
      assert.equal(updated.ok, true);
      const staleBase = { ...updateBase, commandId: `stale-${suffix}`, idempotencyKey: `stale-key-${suffix}` };
      const stale = await service.updateCustomer({ ...staleBase, payloadHash: await intentHash(staleBase) });
      assert.equal(stale.ok, false);
      if (!stale.ok) assert.equal(stale.error.code, 'ROW_STALE');

      const projectBase = { schemaVersion: 1 as const, commandId: `project-${suffix}`, correlationId: `project-corr-${suffix}`,
        customerId, title: 'پروژه جاری', workType: 'فروش سنگ پروژه ساختمانی', status: 'جدید', probability: 40,
        reason: 'ثبت پروژه برای مشتری جاری', idempotencyKey: `project-key-${suffix}` };
      const projectResult = await service.createProject({ ...projectBase, payloadHash: await intentHash(projectBase) });
      assert.equal(projectResult.ok, true);
      if (!projectResult.ok) throw new Error('project create expected');
      const invalidWon = { ...projectBase, commandId: `project-won-${suffix}`, idempotencyKey: `project-won-key-${suffix}`,
        status: 'برنده شده' as const };
      const won = await service.createProject({ ...invalidWon, payloadHash: await intentHash(invalidWon) });
      assert.equal(won.ok, false);
      if (!won.ok) assert.equal(won.error.code, 'INVALID_PAYLOAD');
      const invalidLost = { ...projectBase, commandId: `project-lost-${suffix}`, idempotencyKey: `project-lost-key-${suffix}`,
        status: 'از دست رفته' as const };
      const lost = await service.createProject({ ...invalidLost, payloadHash: await intentHash(invalidLost) });
      assert.equal(lost.ok, false);
      if (!lost.ok) assert.equal(lost.error.code, 'INVALID_PAYLOAD');

      const followUpBase = { schemaVersion: 1 as const, commandId: `follow-${suffix}`, correlationId: `follow-corr-${suffix}`,
        customerId, projectId: (projectResult.value.project as PartnerProjectView).projectId,
        communicationType: 'تماس تلفنی', workType: 'فروش سنگ پروژه ساختمانی',
        happenedAt: new Date().toISOString(), summary: 'گفت‌وگوی ثبت‌شده', outcome: 'ادامه پیگیری',
        nextAction: { title: 'تماس بعدی', communicationType: 'تماس تلفنی', dueAt: new Date(Date.now() + 86_400_000).toISOString(),
          instructions: 'پیگیری نتیجه' }, reason: 'ثبت تاریخچه پیگیری جاری', idempotencyKey: `follow-key-${suffix}` };
      const followed = await service.createFollowUp({ ...followUpBase, payloadHash: await intentHash(followUpBase) });
      assert.equal(followed.ok, true);
      if (!followed.ok || !followed.value.nextAction) throw new Error('next action expected');

      const completeBase = { schemaVersion: 1 as const, commandId: `complete-${suffix}`,
        correlationId: `complete-corr-${suffix}`, customerId,
        actionId: (followed.value.nextAction as PartnerNextActionView).actionId,
        expectedRevision: 1, reason: 'تکمیل اقدام توسط مسئول جاری', idempotencyKey: `complete-key-${suffix}` };
      const completed = await service.completeNextAction({ ...completeBase, payloadHash: await intentHash(completeBase) });
      assert.equal(completed.ok, true);

      const list = await service.listCustomers({ correlationId: `list-${suffix}`, limit: 10 });
      assert.equal(list.ok, true);
      if (list.ok) {
        assert.equal(list.value.total, 1);
        assert.deepEqual(list.value.items.map(item => item.customerId), [customerId]);
      }
      const detail = await service.readCustomer({ customerId, correlationId: `detail-${suffix}` });
      assert.equal(detail.ok, true);
      if (detail.ok) {
        assert.equal(detail.value.projects.length, 1);
        assert.equal(detail.value.followUps.length, 1);
        assert.equal(detail.value.nextActions[0]?.status, 'انجام شده');
      }
      throw rollback;
    }, { timeout: 30_000 }), error => error === rollback);
  } finally {
    await database.$disconnect();
  }
});
