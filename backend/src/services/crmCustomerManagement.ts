import { createHash, randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { activeHrAuthoritiesForUser } from './hrAuthorizationService';
import { appendAuthorizationDecision } from './effectiveAuthorization/audit';

type Database = PrismaClient | Prisma.TransactionClient;
export class CustomerManagementError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/** These two permissions deliberately never inherit broad CRM workspace access. */
export async function customerManagementCapabilities(db: Database, actorId: string, at = new Date()) {
  const actor = await db.user.findUnique({ where: { id: actorId }, select: { role: true, isActive: true } });
  if (!actor?.isActive) return { canViewAllCustomers: false, canDeleteCustomers: false, grantIds: [] as string[] };
  if (await db.partnerProfile.findUnique({ where: { userId: actorId }, select: { id: true } })) {
    return { canViewAllCustomers: false, canDeleteCustomers: false, grantIds: [] as string[] };
  }
  if (actor.role === 'ADMIN') return { canViewAllCustomers: true, canDeleteCustomers: true, grantIds: [] as string[] };
  const manager = (await activeHrAuthoritiesForUser(db, actorId, at)).includes('COMPANY_MANAGER');
  const grants = manager ? await db.featurePermission.findMany({ where: {
    userId: actorId, workspace: 'crm', isActive: true,
    feature: { in: ['crm_customers_view_all', 'crm_customers_delete'] },
    OR: [{ expiresAt: null }, { expiresAt: { gt: at } }],
  } }) : [];
  return {
    canViewAllCustomers: grants.some(g => g.feature === 'crm_customers_view_all' && ['view', 'edit', 'admin'].includes(g.permissionLevel)),
    canDeleteCustomers: grants.some(g => g.feature === 'crm_customers_delete' && ['edit', 'admin'].includes(g.permissionLevel)),
    grantIds: grants.filter(g => g.feature === 'crm_customers_delete').map(g => g.id),
  };
}

const historyLabels = {
  salesContracts: 'قرارداد فروش', partnerSaleCases: 'پرونده فروش همکار', leads: 'سرنخ ثبت‌شده',
  communications: 'ارتباط ثبت‌شده', potentialProjects: 'پروژه کاری CRM', followUpReports: 'گزارش پیگیری',
  nextActions: 'اقدام پیگیری', timelineEvents: 'رویداد سابقه مشتری',
  partnerTransferRequests: 'درخواست انتقال', partnerDuplicateMatches: 'شاهد بررسی مشتری تکراری',
} as const;

async function inspectCustomer(db: Database, customerId: string) {
  const customer = await db.crmCustomer.findUnique({ where: { id: customerId }, include: {
    phoneNumbers: { orderBy: { id: 'asc' } }, contacts: { orderBy: { id: 'asc' } },
    projectAddresses: { orderBy: { id: 'asc' } },
    _count: { select: Object.fromEntries(Object.keys(historyLabels).map(key => [key, true])) },
  } });
  if (!customer || customer.cardDeletedAt) throw new CustomerManagementError(404, 'CUSTOMER_NOT_FOUND', 'مشتری یافت نشد.');
  const projects = customer.projectAddresses.map(p => p.id);
  const contacts = customer.contacts.map(contact => contact.id);
  const [loadings, movements, linkedCommunications, referencedContacts] = await Promise.all([
    db.logisticsLoading.count({ where: { OR: [{ customerId }, { projectId: { in: projects } }] } }),
    db.securityVehicleMovement.count({ where: { OR: [{ customerId }, { projectId: { in: projects } }] } }),
    db.crmCommunication.count({ where: { contactId: { in: contacts }, NOT: { customerId } } }),
    db.crmCustomer.count({ where: { primaryContactId: { in: contacts }, NOT: { id: customerId } } }),
  ]);
  const blockers: Array<{ label: string; count: number }> = Object.entries(historyLabels).flatMap(([key, label]) => {
    const count = (customer._count as Record<string, number>)[key];
    return count > 0 ? [{ label, count }] : [];
  });
  const contactHistory = customer.contacts.filter(contact => contact.communicationHistory != null
    && !['null', '{}', '[]', '""'].includes(JSON.stringify(contact.communicationHistory))).length;
  if (contactHistory || linkedCommunications) blockers.push({ label: 'سابقه ارتباط مخاطبان', count: contactHistory + linkedCommunications });
  if (referencedContacts) blockers.push({ label: 'مخاطب مورد استفاده مشتری دیگر', count: referencedContacts });
  if (loadings) blockers.push({ label: 'بارگیری', count: loadings });
  if (movements) blockers.push({ label: 'تردد ثبت‌شده', count: movements });
  const affected = {
    phones: customer.phoneNumbers.map(p => ({ id: p.id, label: p.number, updatedAt: p.updatedAt })),
    contacts: customer.contacts.map(c => ({ id: c.id, label: `${c.firstName} ${c.lastName}`, updatedAt: c.updatedAt })),
    projects: customer.projectAddresses.map(p => ({ id: p.id, label: `${p.projectName || 'نشانی'}: ${p.address}`, updatedAt: p.updatedAt })),
  };
  const previewToken = createHash('sha256').update(JSON.stringify({ id: customer.id, updatedAt: customer.updatedAt,
    partnerRevision: customer.partnerRevision, affected, blockers })).digest('hex');
  return { customer, preview: { customerId, name: `${customer.firstName} ${customer.lastName}`,
    eligible: true, mode: blockers.length ? 'RETAIN_HISTORY' : 'REMOVE_UNUSED', retained: blockers, blockers: [], affected, previewToken } };
}

export async function previewCustomerDeletion(db: Database, actorId: string, customerId: string) {
  if (!(await customerManagementCapabilities(db, actorId)).canDeleteCustomers) {
    throw new CustomerManagementError(403, 'CUSTOMER_DELETE_FORBIDDEN', 'مجوز مستقل حذف دائمی مشتری لازم است.');
  }
  return (await inspectCustomer(db, customerId)).preview;
}

/** Parent row lock also serializes concurrent FK attachment before cascade. */
export async function deleteCustomerInTransaction(tx: Prisma.TransactionClient, input: {
  actorId: string; customerId: string; reason: string; confirmed: boolean; previewToken: string;
}) {
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (input.confirmed !== true || reason.length < 3 || reason.length > 1000 || !input.previewToken) {
    throw new CustomerManagementError(400, 'CUSTOMER_DELETE_CONFIRMATION_REQUIRED', 'پیش‌نمایش، دلیل حذف و تأیید نهایی لازم است.');
  }
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${input.actorId} FOR UPDATE`;
  // Freeze the authority sources while the command waits on its Customer.
  // Company Manager authority may be canonical HR grants or legacy effective access.
  const actor = await tx.user.findUniqueOrThrow({ where: { id: input.actorId }, select: { role: true } });
  await tx.$queryRaw`SELECT id FROM workspace_permissions WHERE "userId" = ${input.actorId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM feature_permissions WHERE "userId" = ${input.actorId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM role_workspace_permissions WHERE role = ${actor.role} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM role_feature_permissions WHERE role = ${actor.role} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM hr_workspace_access_grants WHERE "userId" = ${input.actorId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM hr_feature_access_grants WHERE "userId" = ${input.actorId} FOR UPDATE`;
  const capabilities = await customerManagementCapabilities(tx, input.actorId);
  if (!capabilities.canDeleteCustomers) throw new CustomerManagementError(403, 'CUSTOMER_DELETE_FORBIDDEN', 'مجوز حذف دائمی مشتری ندارید.');
  const initialOwner = await tx.crmCustomer.findUnique({ where: { id: input.customerId }, select: { partnerOwnerProfileId: true } });
  if (initialOwner?.partnerOwnerProfileId) await tx.$queryRaw`SELECT id FROM partner_profiles WHERE id = ${initialOwner.partnerOwnerProfileId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM crm_customers WHERE id = ${input.customerId} FOR UPDATE`;
  const { customer, preview } = await inspectCustomer(tx, input.customerId);
  if (customer.partnerOwnerProfileId !== initialOwner?.partnerOwnerProfileId) throw new CustomerManagementError(409, 'CUSTOMER_DELETE_PREVIEW_STALE', 'مالک مشتری همزمان تغییر کرده است؛ پیش‌نمایش را دوباره دریافت کنید.');
  if (preview.previewToken !== input.previewToken) throw new CustomerManagementError(409, 'CUSTOMER_DELETE_PREVIEW_STALE', 'اطلاعات مشتری تغییر کرده است؛ پیش‌نمایش را دوباره بررسی کنید.');
  const deletedAt = new Date();
  const receipt = await appendAuthorizationDecision(tx, {
    domain: 'CRM', actorId: input.actorId, action: 'CUSTOMER_PERMANENT_DELETE', rootKind: 'CUSTOMER', rootId: input.customerId,
    purpose: 'CRM', channel: 'API', allowed: true, isAdmin: actor.role === 'ADMIN', code: 'DELETED', scope: 'COMPANY',
    reason, correlationId: randomUUID(), authorizationRevision: null, lifecycleRevision: customer.partnerRevision,
    assignmentId: null, assignmentRevision: null, evaluatedAt: deletedAt, evaluatedGrantIds: capabilities.grantIds,
  });
  // The database accepts Partner identity removal only with this transaction's immutable receipt.
  await tx.$executeRaw`SELECT set_config('sabalan.crm_customer_deletion_receipt', ${receipt.id}, true)`;
  await tx.$executeRaw`SELECT set_config('sabalan.partner_crm_profile', ${customer.partnerOwnerProfileId || ''}, true)`;
  if (preview.mode === 'RETAIN_HISTORY') {
    // The operational card is removed. The original immutable identity and its
    // children continue to resolve every historical FK without rewriting Cases.
    await tx.crmCustomer.update({ where: { id: input.customerId }, data: {
      cardDeletedAt: deletedAt, isActive: false,
      ...(customer.partnerOwnerProfileId ? { partnerRevision: { increment: 1 } } : {}),
    } });
    await tx.crmCustomerRetainedHistory.create({ data: { customerId: input.customerId, receiptId: receipt.id,
      snapshot: JSON.parse(JSON.stringify(customer)), retainedAt: deletedAt } });
    await tx.crmCustomerCard.delete({ where: { customerId: input.customerId } });
  } else {
    await tx.crmCustomer.delete({ where: { id: input.customerId } });
  }
  return { receiptId: receipt.id, customerId: input.customerId, actorId: input.actorId, deletedAt, reason, mode: preview.mode, retained: preview.retained };
}
