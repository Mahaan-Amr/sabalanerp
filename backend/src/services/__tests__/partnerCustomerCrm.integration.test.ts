import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { readPartnerCustomerCrm, mutatePartnerCustomerCrm } from '../partnerCustomerCrm';
import { CustomerManagementError } from '../crmCustomerManagement';
import { seedAuthorizationCase } from './partnerAuthorizationFixture';

const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL || '');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/sabalanerp') throw new Error('Existing local Compose database required');
url.searchParams.set('connection_limit', '2'); url.searchParams.set('pool_timeout', '10');
async function fixture(run: (tx: Prisma.TransactionClient, data: { admin: string; owner: string; customerId: string }) => Promise<void>) {
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } }); const rollback = new Error('rollback CRM fixture');
  try { await assert.rejects(db.$transaction(async tx => {
    const user = async (role: 'ADMIN' | 'MANAGER' | 'USER') => { const id = randomUUID(); await tx.user.create({ data: { id, username: id, email: `${id}@example.invalid`, password: 'not-a-login', role, firstName: 'آزمون', lastName: role } }); return id; };
    const admin = await user('ADMIN'); const owner = await user('USER');
    await tx.partnerProfile.create({ data: { id: owner, userId: owner, state: 'ACTIVE' } });
    await tx.$executeRaw`SELECT set_config('sabalan.partner_crm_profile', ${owner}, true)`;
    const seeded = await seedAuthorizationCase(tx, owner, owner, true);
    await run(tx, { admin, owner, customerId: seeded.customerId }); throw rollback;
  }, { timeout: 60000 }), error => error === rollback); } finally { await db.$disconnect(); }
}
const blocked = (error: unknown) => error instanceof CustomerManagementError && error.status === 403;
const data = { firstName: 'مخاطب', lastName: 'آزمون', mobile: '۰۹۱۲۰۰۰۰۰۰۱', isPrimary: false, isActive: true };
const command = (card: Awaited<ReturnType<typeof readPartnerCustomerCrm>>, resource: 'contacts' | 'leads' | 'project_addresses', operation: 'create' | 'edit' | 'delete', extra = {}) =>
  ({ resource, operation, expectedRevision: card.partnerRevision, expectedCrmVersion: card.crmVersion, ...extra });
const off = (tx: Prisma.TransactionClient, userId: string, feature: string, workspace = 'crm') => tx.featurePermission.upsert({ where: { userId_workspace_feature: { userId, workspace, feature } },
  create: { userId, workspace, feature, permissionLevel: 'none' }, update: { permissionLevel: 'none', expiresAt: null, isActive: true } });

test('Partner detail has safe contract metadata, owner-only read and independent section capabilities', () => fixture(async (tx, { admin, owner, customerId }) => {
  const card = await readPartnerCustomerCrm(tx, admin, customerId);
  assert.equal(card.partnerCrmSections, true); assert.equal(card.salesContracts.length, 1);
  assert.equal('totalAmount' in card.salesContracts[0], false); assert.equal('content' in card.salesContracts[0], false);
  assert.equal('metrics' in card, false); assert.equal('customFields' in card, false);
  assert.equal((await readPartnerCustomerCrm(tx, owner, customerId)).partnerOwnerView, true);
  const foreign = randomUUID(); await tx.user.create({ data: { id: foreign, username: foreign, email: `${foreign}@example.invalid`, password: 'not-a-login', firstName: 'آزمون', lastName: 'همکار' } });
  await tx.partnerProfile.create({ data: { id: foreign, userId: foreign, state: 'ACTIVE' } });
  await assert.rejects(readPartnerCustomerCrm(tx, foreign, customerId), error => error instanceof CustomerManagementError && [403, 404].includes(error.status));
  await off(tx, admin, 'crm_contacts_view'); await off(tx, admin, 'sales_contracts_view', 'sales');
  const restricted = await readPartnerCustomerCrm(tx, admin, customerId);
  assert.deepEqual(restricted.contacts, []); assert.deepEqual(restricted.salesContracts, []); assert.equal(restricted.crmCapabilities.contacts_view, false);
}));

test('Admin CRUD is audited, normalizes digits, preserves ownership, rejects stale and foreign child commands', () => fixture(async (tx, { admin, owner, customerId }) => {
  let card = await readPartnerCustomerCrm(tx, admin, customerId);
  await mutatePartnerCustomerCrm(tx, admin, customerId, command(card, 'contacts', 'create', { data }));
  await assert.rejects(mutatePartnerCustomerCrm(tx, admin, customerId, command(card, 'contacts', 'create', { data })), error => error instanceof CustomerManagementError && error.status === 409);
  card = await readPartnerCustomerCrm(tx, admin, customerId);
  assert.equal(card.contacts[0].mobile, '09120000001'); assert.equal(card.ownerUserId, owner); assert.equal(card.partnerOwnerProfileId, owner);
  await mutatePartnerCustomerCrm(tx, admin, customerId, command(card, 'contacts', 'edit', { id: card.contacts[0].id, data: { ...data, firstName: 'اصلاح' } }));
  card = await readPartnerCustomerCrm(tx, admin, customerId);
  await assert.rejects(mutatePartnerCustomerCrm(tx, admin, customerId, command(card, 'contacts', 'delete', { id: 'foreign-child' })), error => error instanceof CustomerManagementError && error.status === 404);
  await mutatePartnerCustomerCrm(tx, admin, customerId, command(card, 'contacts', 'delete', { id: card.contacts[0].id }));
  assert.equal((await tx.crmContact.findFirstOrThrow({ where: { customerId } })).isActive, false);
  assert.equal(await tx.crmTimelineEvent.count({ where: { customerId } }), 3);
  await off(tx, admin, 'crm_contacts_create'); card = await readPartnerCustomerCrm(tx, admin, customerId);
  assert.equal(card.crmCapabilities.contacts_create, false);
  await assert.rejects(mutatePartnerCustomerCrm(tx, admin, customerId, command(card, 'contacts', 'create', { data })), blocked);
}));

test('manager view-all alone cannot write; exact grants enable scoped operations and revocation blocks them', () => fixture(async (tx, { customerId }) => {
  const manager = randomUUID(); await tx.user.create({ data: { id: manager, username: manager, email: `${manager}@example.invalid`, password: 'not-a-login', role: 'MANAGER', firstName: 'آزمون', lastName: 'مدیر' } });
  await tx.hrWorkspaceAccessGrant.create({ data: { stableKey: randomUUID(), userId: manager, workspaceCode: 'HUMAN_RESOURCES', level: 'ADMIN', effectiveFrom: new Date(0) } });
  await tx.workspacePermission.create({ data: { userId: manager, workspace: 'crm', permissionLevel: 'edit' } });
  await tx.featurePermission.create({ data: { userId: manager, workspace: 'crm', feature: 'crm_customers_view_all', permissionLevel: 'view' } });
  // MANAGER role fixtures can have inherited grants; explicit off is authoritative.
  await off(tx, manager, 'crm_contacts_create');
  let card = await readPartnerCustomerCrm(tx, manager, customerId);
  await assert.rejects(mutatePartnerCustomerCrm(tx, manager, customerId, command(card, 'contacts', 'create', { data })), blocked);
  await tx.featurePermission.update({ where: { userId_workspace_feature: { userId: manager, workspace: 'crm', feature: 'crm_contacts_create' } }, data: { permissionLevel: 'edit' } });
  await mutatePartnerCustomerCrm(tx, manager, customerId, command(card, 'contacts', 'create', { data }));
  await off(tx, manager, 'crm_customers_view_all');
  await assert.rejects(readPartnerCustomerCrm(tx, manager, customerId), blocked);
}));

test('owning Partner can manage Projects and Leads; deleted Lead evidence remains in the timeline', () => fixture(async (tx, { owner, customerId }) => {
  let card = await readPartnerCustomerCrm(tx, owner, customerId);
  await mutatePartnerCustomerCrm(tx, owner, customerId, command(card, 'project_addresses', 'create', { data: { projectName: 'پروژه', address: 'نشانی', isActive: true } }));
  card = await readPartnerCustomerCrm(tx, owner, customerId);
  await mutatePartnerCustomerCrm(tx, owner, customerId, command(card, 'leads', 'create', { data: { companyName: 'شرکت', contactName: 'مخاطب', source: 'تماس', status: 'New', probability: 20 } }));
  card = await readPartnerCustomerCrm(tx, owner, customerId); const id = card.leads[0].id;
  await mutatePartnerCustomerCrm(tx, owner, customerId, command(card, 'leads', 'edit', { id, data: { companyName: 'شرکت', contactName: 'مخاطب', source: 'تماس', status: 'Qualified', probability: 40 } }));
  card = await readPartnerCustomerCrm(tx, owner, customerId);
  await mutatePartnerCustomerCrm(tx, owner, customerId, command(card, 'leads', 'delete', { id }));
  assert.equal(await tx.crmLead.findUnique({ where: { id } }), null);
  const event = await tx.crmTimelineEvent.findFirstOrThrow({ where: { customerId, eventType: 'PARTNER_CRM_LEADS_DELETE' } });
  assert.equal((event.metadata as any).before.id, id);
}));

import { updateAdminPartnerCustomerCard } from '../adminPartnerCustomerCard';
import { readPartnerCustomerContractFinance } from '../partnerCustomerCrm';
const cardDatabase = (tx: Prisma.TransactionClient) => ({ $transaction: async (run: (client: Prisma.TransactionClient) => Promise<unknown>) => run(tx) }) as unknown as PrismaClient;

test('shared full owner edit preserves Contract snapshots and rejects unchecked child operations atomically', () => fixture(async (tx, { admin, owner, customerId }) => {
  let card = await readPartnerCustomerCrm(tx, owner, customerId);
  const before = await tx.salesContract.findFirstOrThrow({ where: { customerId } });
  await updateAdminPartnerCustomerCard(cardDatabase(tx), owner, customerId, 'EDIT', { expectedRevision: card.partnerRevision, expectedCardVersion: card.cardVersion,
    firstName: 'هویت اصلاح‌شده', customerType: 'Government', nationalCode: '۱۲۳۴۵۶۷۸۹۰۱', industry: 'ساختمان', brandName: 'برند', homeAddress: 'نشانی منزل',
    phones: [{ number: '۰۹۱۲۰۰۰۰۰۰۳', type: 'mobile', isActive: true, isPrimary: true }] }, 'owner');
  card = await readPartnerCustomerCrm(tx, owner, customerId);
  assert.equal(card.firstName, 'هویت اصلاح‌شده'); assert.equal(card.customerType, 'Government'); assert.equal(card.nationalCode, '12345678901');
  assert.equal(card.ownerUserId, owner); assert.deepEqual(await tx.salesContract.findUnique({ where: { id: before.id } }), before);
  await off(tx, admin, 'crm_contacts_create');
  await assert.rejects(updateAdminPartnerCustomerCard(cardDatabase(tx), admin, customerId, 'EDIT', { expectedRevision: card.partnerRevision, expectedCardVersion: card.cardVersion,
    contacts: [{ ...data, mobile: '09120000004' }] }), blocked);
  assert.equal(await tx.crmContact.count({ where: { customerId } }), 0);
}));

test('CRM finance rejects report revocation and a Case belonging to another Customer before reporting', () => fixture(async (tx, { admin, customerId }) => {
  await off(tx, admin, 'bi_partner_reports_view', 'bi');
  await assert.rejects(readPartnerCustomerContractFinance(cardDatabase(tx), admin, customerId, customerId), blocked);
  await tx.featurePermission.delete({ where: { userId_workspace_feature: { userId: admin, workspace: 'bi', feature: 'bi_partner_reports_view' } } });
  await assert.rejects(readPartnerCustomerContractFinance(cardDatabase(tx), admin, customerId, 'foreign-case'), error => error instanceof CustomerManagementError && error.status === 404);
}));
