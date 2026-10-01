import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { customerManagementCapabilities, previewCustomerDeletion, deleteCustomerInTransaction, CustomerManagementError } from '../crmCustomerManagement';
import { seedAuthorizationCase } from './partnerAuthorizationFixture';
import { customerScopeForActor, managedCustomerResponse } from '../../routes/crm';
const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL || '');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/sabalanerp') throw new Error('Existing local database required');
url.searchParams.set('connection_limit', '2'); url.searchParams.set('pool_timeout', '10');
async function fixture(run: (tx: Prisma.TransactionClient, admin: string) => Promise<void>) {
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } }); const rollback = new Error('rollback fixture');
  try { await assert.rejects(db.$transaction(async tx => { const admin = await user(tx, 'ADMIN'); await run(tx, admin); throw rollback; }, { timeout: 30000 }), e => e === rollback); }
  finally { await db.$disconnect(); }
}
async function user(tx: Prisma.TransactionClient, role: 'ADMIN' | 'MANAGER' | 'USER' = 'USER') {
  const id = randomUUID(); await tx.user.create({ data: { id, username: id, email: `${id}@example.invalid`, password: 'not-a-login', firstName: 'Fixture', lastName: role, role } }); return id;
}
async function partner(tx: Prisma.TransactionClient) { const id = await user(tx); await tx.partnerProfile.create({ data: { id, userId: id, state: 'ACTIVE' } }); await tx.$executeRaw`SELECT set_config('sabalan.partner_crm_profile', ${id}, true)`; return id; }
const blocked = (code: string) => (error: unknown) => error instanceof CustomerManagementError && error.code === code;
const command = (actorId: string, customerId: string, previewToken: string) => ({ actorId, customerId, previewToken, reason: 'ثبت آزمایشی بدون سابقه', confirmed: true });

test('unified Admin scope includes both identities, management response excludes private work', () => fixture(async (tx, admin) => {
  const owner = await partner(tx);
  const internal = await tx.crmCustomer.create({ data: { firstName: 'مشتری', lastName: 'داخلی', ownerUserId: admin } });
  const external = await tx.crmCustomer.create({ data: { firstName: 'مشتری', lastName: 'همکار', ownerUserId: owner, partnerOwnerProfileId: owner, partnerRevision: 1 } });
  const capabilities = await customerManagementCapabilities(tx, admin);
  const scope = customerScopeForActor({ userId: admin, role: 'ADMIN', canAssignOwner: false, canViewAll: capabilities.canViewAllCustomers });
  assert.equal(await tx.crmCustomer.count({ where: { AND: [scope, { id: { in: [internal.id, external.id] } }] } }), 2);
  const safe = managedCustomerResponse({ ...external, customFields: { privateMargin: 50 }, salesContracts: [{ price: 100 }], communications: [{ message: 'private' }], contacts: [{ id: 'contact', firstName: 'نام', communicationHistory: { private: true } }] });
  assert.equal(safe.managementReadOnly, true); assert.equal('communicationHistory' in safe.contacts[0], false); for (const key of ['salesContracts', 'customFields', 'communications']) assert.equal(key in safe, false);
}));

test('unused Partner card deletes its card children with durable immutable receipt', () => fixture(async (tx, admin) => {
  const owner = await partner(tx);
  const customer = await tx.crmCustomer.create({ data: { firstName: 'قاسم', lastName: 'آزمون', ownerUserId: owner, partnerOwnerProfileId: owner, partnerRevision: 1,
    phoneNumbers: { create: { number: '09120000001', type: 'mobile' } }, projectAddresses: { create: { address: 'نشانی بدون سابقه' } }, contacts: { create: { firstName: 'مخاطب', lastName: 'آزمون' } } } });
  const preview = await previewCustomerDeletion(tx, admin, customer.id); assert.equal(preview.eligible, true);
  for (const key of ['phones', 'contacts', 'projects'] as const) assert.equal(preview.affected[key].length, 1);
  await tx.$executeRawUnsafe('SAVEPOINT direct_delete'); await assert.rejects(tx.crmCustomer.delete({ where: { id: customer.id } }), /identity is retained/); await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT direct_delete'); await tx.$executeRawUnsafe('RELEASE SAVEPOINT direct_delete');
  const receipt = await deleteCustomerInTransaction(tx, command(admin, customer.id, preview.previewToken));
  assert.equal(await tx.crmCustomer.findUnique({ where: { id: customer.id } }), null); assert.equal(await tx.projectAddress.count({ where: { customerId: customer.id } }), 0);
  const evidence = await tx.effectiveAuthorizationAudit.findUniqueOrThrow({ where: { id: receipt.receiptId } }); assert.equal(evidence.rootId, customer.id); assert.equal(evidence.actorId, admin); assert.equal(evidence.reason, receipt.reason);
  await tx.$executeRawUnsafe('SAVEPOINT receipt_mutation'); await assert.rejects(tx.effectiveAuthorizationAudit.delete({ where: { id: receipt.receiptId } }), /immutable|evidence/i); await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT receipt_mutation');
}));

test('fresh history, stale preview and missing reason block deletion', () => fixture(async (tx, admin) => {
  const customer = await tx.crmCustomer.create({ data: { firstName: 'مشتری', lastName: 'آزمون', ownerUserId: admin } }); const preview = await previewCustomerDeletion(tx, admin, customer.id); const input = command(admin, customer.id, preview.previewToken);
  await assert.rejects(deleteCustomerInTransaction(tx, { ...input, reason: '' }), blocked('CUSTOMER_DELETE_CONFIRMATION_REQUIRED'));
  await tx.phoneNumber.create({ data: { customerId: customer.id, number: '09120000002', type: 'mobile' } }); await assert.rejects(deleteCustomerInTransaction(tx, input), blocked('CUSTOMER_DELETE_PREVIEW_STALE'));
  const updated = await previewCustomerDeletion(tx, admin, customer.id); await tx.crmTimelineEvent.create({ data: { customerId: customer.id, eventType: 'FOLLOW_UP', title: 'سابقه پیگیری' } });
  await assert.rejects(deleteCustomerInTransaction(tx, { ...input, previewToken: updated.previewToken }), blocked('CUSTOMER_DELETE_PREVIEW_STALE')); assert.ok(await tx.crmCustomer.findUnique({ where: { id: customer.id } }));
}));

test('numbered draft Partner Case and contract survive permanent operational card deletion', () => fixture(async (tx, admin) => {
  const owner = await partner(tx); const seeded = await seedAuthorizationCase(tx, owner); const preview = await previewCustomerDeletion(tx, admin, seeded.customerId);
  assert.equal(preview.eligible, true); for (const label of ['پرونده فروش همکار', 'قرارداد فروش']) assert.ok(preview.retained.some(b => b.label === label));
  const contractBefore = await tx.salesContract.findUniqueOrThrow({ where: { id: seeded.contractId } });
  const casesBefore = await tx.partnerSaleCase.findMany({ where: { customerId: seeded.customerId } });
  const receipt = await deleteCustomerInTransaction(tx, command(admin, seeded.customerId, preview.previewToken));
  assert.equal(receipt.mode, 'RETAIN_HISTORY'); assert.equal(await tx.crmCustomerCard.findUnique({ where: { customerId: seeded.customerId } }), null);
  assert.deepEqual(await tx.salesContract.findUnique({ where: { id: seeded.contractId } }), contractBefore);
  assert.deepEqual(await tx.partnerSaleCase.findMany({ where: { customerId: seeded.customerId } }), casesBefore);
  const history = await tx.crmCustomerRetainedHistory.findUniqueOrThrow({ where: { customerId: seeded.customerId } });
  assert.equal(history.receiptId, receipt.receiptId);
  assert.ok((await tx.crmCustomer.findUniqueOrThrow({ where: { id: seeded.customerId } })).cardDeletedAt);
  await assert.rejects(previewCustomerDeletion(tx, admin, seeded.customerId), blocked('CUSTOMER_NOT_FOUND'));
}));

test('manager needs current Company Manager authority plus separate active direct grant', () => fixture(async (tx, admin) => {
  const manager = await user(tx, 'MANAGER'); await tx.workspacePermission.create({ data: { userId: manager, workspace: 'crm', permissionLevel: 'admin' } });
  const customer = await tx.crmCustomer.create({ data: { firstName: 'مشتری', lastName: 'آزمون', ownerUserId: admin } }); assert.equal((await customerManagementCapabilities(tx, manager)).canDeleteCustomers, false);
  await tx.featurePermission.create({ data: { userId: manager, workspace: 'crm', feature: 'crm_customers_delete', permissionLevel: 'edit' } }); assert.equal((await customerManagementCapabilities(tx, manager)).canDeleteCustomers, false);
  await tx.hrWorkspaceAccessGrant.create({ data: { stableKey: randomUUID(), userId: manager, workspaceCode: 'HUMAN_RESOURCES', level: 'ADMIN', effectiveFrom: new Date(0) } });
  assert.equal((await customerManagementCapabilities(tx, manager)).canDeleteCustomers, true); assert.equal((await customerManagementCapabilities(tx, manager)).canViewAllCustomers, false);
  await tx.featurePermission.create({ data: { userId: manager, workspace: 'crm', feature: 'crm_customers_view_all', permissionLevel: 'view' } }); assert.equal((await customerManagementCapabilities(tx, manager)).canViewAllCustomers, true);
  const preview = await previewCustomerDeletion(tx, manager, customer.id); await tx.featurePermission.update({ where: { userId_workspace_feature: { userId: manager, workspace: 'crm', feature: 'crm_customers_delete' } }, data: { expiresAt: new Date(0) } });
  await assert.rejects(deleteCustomerInTransaction(tx, command(manager, customer.id, preview.previewToken)), blocked('CUSTOMER_DELETE_FORBIDDEN'));
}));

test('movement linked only through a project survives card deletion', () => fixture(async (tx, admin) => {
  const customer = await tx.crmCustomer.create({ data: { firstName: 'مشتری', lastName: 'تردد', ownerUserId: admin, projectAddresses: { create: { address: 'نشانی پروژه' } } }, include: { projectAddresses: true } });
  const movement = await tx.securityVehicleMovement.create({ data: { movementNumber: randomUUID(), direction: 'INBOUND', purpose: 'MISC', projectId: customer.projectAddresses[0].id, createdBy: admin } });
  const preview = await previewCustomerDeletion(tx, admin, customer.id);
  assert.equal(preview.eligible, true); assert.ok(preview.retained.some(b => b.label === 'تردد ثبت‌شده'));
  await deleteCustomerInTransaction(tx, command(admin, customer.id, preview.previewToken));
  assert.equal((await tx.securityVehicleMovement.findUniqueOrThrow({ where: { id: movement.id } })).projectId, customer.projectAddresses[0].id);
}));

test('ordinary primary contact and card children delete together without losing audit', () => fixture(async (tx, admin) => {
  const customer = await tx.crmCustomer.create({ data: { firstName: 'مشتری', lastName: 'مخاطب اصلی', ownerUserId: admin, contacts: { create: { firstName: 'مخاطب', lastName: 'اصلی' } } }, include: { contacts: true } });
  await tx.crmCustomer.update({ where: { id: customer.id }, data: { primaryContactId: customer.contacts[0].id } });
  const preview = await previewCustomerDeletion(tx, admin, customer.id);
  const receipt = await deleteCustomerInTransaction(tx, command(admin, customer.id, preview.previewToken));
  assert.equal(await tx.crmContact.findUnique({ where: { id: customer.contacts[0].id } }), null);
  assert.ok(await tx.effectiveAuthorizationAudit.findUnique({ where: { id: receipt.receiptId } }));
}));

test('a history attachment committed while deletion waits cannot be lost to cascade or SetNull', async () => {
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  let admin = '', customerId = '', movementId = '';
  let releaseWriter!: () => void;
  const release = new Promise<void>(resolve => { releaseWriter = resolve; });
  let writerLocked!: () => void;
  const locked = new Promise<void>(resolve => { writerLocked = resolve; });
  let writer: Promise<unknown> | undefined;
  try {
    admin = await user(db as unknown as Prisma.TransactionClient, 'ADMIN');
    const customer = await db.crmCustomer.create({ data: { firstName: 'آزمون همزمانی', lastName: randomUUID(), ownerUserId: admin,
      projectAddresses: { create: { address: 'نشانی آزمون همزمانی' } } }, include: { projectAddresses: true } });
    customerId = customer.id;
    const preview = await previewCustomerDeletion(db, admin, customerId);
    movementId = randomUUID();
    writer = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM crm_customers WHERE id = ${customerId} FOR UPDATE`;
      await tx.securityVehicleMovement.create({ data: { id: movementId, movementNumber: movementId, direction: 'INBOUND', purpose: 'MISC', projectId: customer.projectAddresses[0].id, createdBy: admin } });
      writerLocked(); await release;
    }, { timeout: 15000 });
    await locked;
    let deletingPid!: number;
    let deletingStarted!: () => void;
    const started = new Promise<void>(resolve => { deletingStarted = resolve; });
    const deleting = db.$transaction(async tx => {
      const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      deletingPid = rows[0].pid; deletingStarted();
      return deleteCustomerInTransaction(tx, command(admin, customerId, preview.previewToken));
    }, { timeout: 15000, isolationLevel: 'Serializable' });
    // Attach the rejection listener before releasing the competing writer.
    const rejected = assert.rejects(deleting, error => blocked('CUSTOMER_DELETE_PREVIEW_STALE')(error)
      || (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034'));
    await started;
    // The two application connections are occupied; a separate test-harness
    // connection observes the wait without creating another database or stack.
    const observer = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt += 1) {
        const rows = await observer.$queryRaw<Array<{ waiting: boolean }>>`SELECT (wait_event_type = 'Lock') AS waiting FROM pg_stat_activity WHERE pid = ${deletingPid}`;
        waiting = rows[0]?.waiting === true;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(waiting, true, 'deletion must actually wait for the customer attachment lock');
    } finally { await observer.$disconnect(); releaseWriter(); }
    await writer; await rejected;
    assert.ok(await db.crmCustomer.findUnique({ where: { id: customerId } }));
    assert.equal((await db.securityVehicleMovement.findUniqueOrThrow({ where: { id: movementId } })).projectId, customer.projectAddresses[0].id);
    assert.equal(await db.effectiveAuthorizationAudit.count({ where: { rootId: customerId, action: 'CUSTOMER_PERMANENT_DELETE' } }), 0);
  } finally {
    releaseWriter(); await writer?.catch(() => undefined);
    if (movementId) await db.securityVehicleMovement.deleteMany({ where: { id: movementId } });
    if (customerId) { await db.projectAddress.deleteMany({ where: { customerId } }); await db.crmCustomer.deleteMany({ where: { id: customerId } }); }
    if (admin) await db.user.deleteMany({ where: { id: admin } });
    await db.$disconnect();
  }
});


test('legacy contact communication history is retained after permanent card deletion', () => fixture(async (tx, admin) => {
  const customer = await tx.crmCustomer.create({ data: { firstName: 'مشتری', lastName: 'سابقه مخاطب', ownerUserId: admin,
    contacts: { create: { firstName: 'مخاطب', lastName: 'پیگیری', communicationHistory: [{ note: 'پیگیری ثبت‌شده' }] } } } });
  const preview = await previewCustomerDeletion(tx, admin, customer.id);
  assert.equal(preview.eligible, true); assert.ok(preview.retained.some(blocker => blocker.label === 'سابقه ارتباط مخاطبان'));
  await deleteCustomerInTransaction(tx, command(admin, customer.id, preview.previewToken));
  assert.equal(await tx.crmCustomerCard.findUnique({ where: { customerId: customer.id } }), null);
  assert.equal(await tx.crmContact.count({ where: { customerId: customer.id } }), 1);
}));

import { customerCardVersion, updateAdminPartnerCustomerCard } from '../adminPartnerCustomerCard';
const cardDatabase = (tx: Prisma.TransactionClient) => ({ $transaction: async (run: (client: Prisma.TransactionClient) => Promise<unknown>) => run(tx) }) as unknown as PrismaClient;
async function cardFixture(tx: Prisma.TransactionClient) {
  const owner = await partner(tx);
  return tx.crmCustomer.create({ data: { firstName: 'مشتری', lastName: 'همکار', ownerUserId: owner,
    partnerOwnerProfileId: owner, partnerRevision: 1, projectManagerNumber: '09120009990', customFields: { privateEvidence: 'preserved' },
    phoneNumbers: { create: { number: '09120009991', type: 'mobile', isPrimary: true } },
    projectAddresses: { create: { address: 'نشانی پیشین' } } }, include: { phoneNumbers: true, contacts: true, projectAddresses: true } });
}
test('Admin edits complete Partner card and flags preserving owner and private evidence', () => fixture(async (tx, admin) => {
  const initial = await cardFixture(tx);
  const edited = await updateAdminPartnerCustomerCard(cardDatabase(tx), admin, initial.id, 'EDIT', {
    expectedRevision: initial.partnerRevision, expectedCardVersion: customerCardVersion(initial), firstName: 'اصلاح‌شده',
    phones: initial.phoneNumbers.map(p => ({ id: p.id, number: p.number, type: p.type, isPrimary: true, isActive: true })),
    projects: initial.projectAddresses.map(p => ({ id: p.id, address: 'نشانی جدید', isActive: true })),
    contacts: [{ firstName: 'مخاطب', lastName: 'جدید', isPrimary: true, isActive: true }] });
  assert.equal(edited.firstName, 'اصلاح‌شده'); assert.equal(edited.projectAddresses[0].address, 'نشانی جدید');
  assert.equal(edited.primaryContactId, edited.contacts[0].id); assert.equal(edited.projectManagerNumber, initial.projectManagerNumber);
  assert.equal(edited.partnerOwnerProfileId, initial.partnerOwnerProfileId); assert.equal(edited.ownerUserId, initial.ownerUserId); assert.deepEqual(edited.customFields, initial.customFields);
  await updateAdminPartnerCustomerCard(cardDatabase(tx), admin, initial.id, 'BLACKLIST');
  const locked = await updateAdminPartnerCustomerCard(cardDatabase(tx), admin, initial.id, 'LOCK');
  assert.equal(locked.isBlacklisted, true); assert.equal(locked.isLocked, true); assert.equal(locked.partnerRevision, 4);
  assert.equal(await tx.effectiveAuthorizationAudit.count({ where: { actorId: admin, rootId: initial.id, action: { startsWith: 'ADMIN_CUSTOMER_CARD_' } } }), 3);
}));
test('Partner owner, manager and revoked Admin cannot use Admin card authority', () => fixture(async (tx, admin) => {
  const initial = await cardFixture(tx); const manager = await user(tx, 'MANAGER');
  for (const actor of [initial.ownerUserId!, manager]) await assert.rejects(updateAdminPartnerCustomerCard(cardDatabase(tx), actor, initial.id, 'LOCK'), blocked('ADMIN_CUSTOMER_CARD_REQUIRED'));
  await tx.user.update({ where: { id: admin }, data: { isActive: false } });
  await assert.rejects(updateAdminPartnerCustomerCard(cardDatabase(tx), admin, initial.id, 'BLACKLIST'), blocked('ADMIN_CUSTOMER_CARD_REQUIRED'));
  assert.equal((await tx.crmCustomer.findUniqueOrThrow({ where: { id: initial.id } })).partnerRevision, 1);
}));
test('stale revision, changed child and foreign child reject edits before writes', () => fixture(async (tx, admin) => {
  const initial = await cardFixture(tx); const payload = { expectedRevision: 1, expectedCardVersion: customerCardVersion(initial), firstName: 'نباید ذخیره شود' };
  await assert.rejects(updateAdminPartnerCustomerCard(cardDatabase(tx), admin, initial.id, 'EDIT', { ...payload, expectedRevision: 2 }), blocked('CUSTOMER_CARD_STALE'));
  await assert.rejects(updateAdminPartnerCustomerCard(cardDatabase(tx), admin, initial.id, 'EDIT', { ...payload, projects: [{ id: randomUUID(), address: 'دیگر', isActive: true }] }), blocked('CUSTOMER_CARD_STALE'));
  await tx.projectAddress.update({ where: { id: initial.projectAddresses[0].id }, data: { address: 'ویرایش همکار' } });
  await assert.rejects(updateAdminPartnerCustomerCard(cardDatabase(tx), admin, initial.id, 'EDIT', payload), blocked('CUSTOMER_CARD_STALE'));
  assert.equal((await tx.crmCustomer.findUniqueOrThrow({ where: { id: initial.id } })).firstName, initial.firstName);
}));

test('foreign ownership payload and duplicate phone reject without card or audit changes', () => fixture(async (tx, admin) => {
  const initial = await cardFixture(tx);
  await tx.crmCustomer.create({ data: { firstName: 'دیگر', lastName: 'مشتری', phoneNumbers: { create: { number: '09120009992', type: 'mobile' } } } });
  const base = { expectedRevision: 1, expectedCardVersion: customerCardVersion(initial), firstName: 'نباید ذخیره شود' };
  await assert.rejects(updateAdminPartnerCustomerCard(cardDatabase(tx), admin, initial.id, 'EDIT', { ...base, ownerUserId: admin }), blocked('INVALID_CUSTOMER_CARD'));
  await assert.rejects(updateAdminPartnerCustomerCard(cardDatabase(tx), admin, initial.id, 'EDIT', { ...base,
    phones: initial.phoneNumbers.map(p => ({ id: p.id, number: '09120009992', type: 'mobile', isPrimary: true, isActive: true })) }), blocked('DUPLICATE_CUSTOMER'));
  const current = await tx.crmCustomer.findUniqueOrThrow({ where: { id: initial.id }, include: { phoneNumbers: true } });
  assert.equal(current.firstName, initial.firstName); assert.equal(current.phoneNumbers[0].number, initial.phoneNumbers[0].number);
  assert.equal(await tx.effectiveAuthorizationAudit.count({ where: { rootId: initial.id } }), 0);
}));


test('retained Partner identity cannot be edited, restored or selected for new independent work', () => fixture(async (tx, admin) => {
  const owner = await partner(tx); const seeded = await seedAuthorizationCase(tx, owner, owner, true);
  const phone = await tx.phoneNumber.create({ data: { customerId: seeded.customerId, number: '09121110001', type: 'mobile' } });
  const preview = await previewCustomerDeletion(tx, admin, seeded.customerId);
  await deleteCustomerInTransaction(tx, command(admin, seeded.customerId, preview.previewToken));
  assert.equal(await tx.crmCustomer.count({ where: { id: seeded.customerId, activeCard: { isNot: null } } }), 0);
  const rejectWrite = async (run: () => Promise<unknown>) => {
    await tx.$executeRawUnsafe('SAVEPOINT retained_write');
    await assert.rejects(run(), /immutable|cannot be restored|cannot be selected/i);
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT retained_write'); await tx.$executeRawUnsafe('RELEASE SAVEPOINT retained_write');
  };
  await rejectWrite(() => tx.crmCustomer.update({ where: { id: seeded.customerId }, data: { firstName: 'overwrite', partnerRevision: { increment: 1 } } }));
  await rejectWrite(() => tx.crmCustomerCard.create({ data: { customerId: seeded.customerId } }));
  const other = await tx.crmCustomer.create({ data: { firstName: 'Other', lastName: 'Fixture' } });
  await rejectWrite(() => tx.phoneNumber.update({ where: { id: phone.id }, data: { customerId: other.id } }));
  await rejectWrite(() => tx.crmCustomerRetainedHistory.update({ where: { customerId: seeded.customerId }, data: { snapshot: {} } }));
  await rejectWrite(() => tx.$executeRaw`INSERT INTO sales_contracts
    (id,"contractNumber",title,"titlePersian",content,"customerId","departmentId","createdBy","responsibleSellerId","updatedAt")
    VALUES (${randomUUID()},${randomUUID()},'Fixture','آزمون','Fixture',${seeded.customerId},${seeded.id},${admin},${admin},now())`);
  await assert.rejects(updateAdminPartnerCustomerCard(cardDatabase(tx), admin, seeded.customerId, 'LOCK'), blocked('CUSTOMER_NOT_FOUND'));
  assert.equal((await tx.crmCustomerRetainedHistory.findUniqueOrThrow({ where: { customerId: seeded.customerId } })).snapshot instanceof Object, true);
}));
