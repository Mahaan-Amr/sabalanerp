import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import * as runtime from '@sabalanerp/partner-sales-contracts';
import { partnerCardContactSchema, partnerCardProjectSchema, customerCardVersion } from './adminPartnerCustomerCard';
import { readManagedCrmOperations } from './crmOperationAuthority';
import { CustomerManagementError } from './crmCustomerManagement';
import { createAuditedPartnerAuthorization } from './partnerSales/authorization/audited';
import { PartnerReportingService } from './partnerSales/reporting/service';
import { createPrismaPartnerReportingSource, createPrismaPartnerReportExportStore } from './partnerSales/reporting/prisma';

const include = { phoneNumbers: true, contacts: true, projectAddresses: true, leads: true,
  ownerUser: { select: { id: true, firstName: true, lastName: true, username: true } } } as const;
type Customer = Prisma.CrmCustomerGetPayload<{ include: typeof include }>;
const version = (customer: Customer) => createHash('sha256').update(JSON.stringify({ card: customerCardVersion(customer), leads: customer.leads.map(row => [row.id, row.updatedAt]).sort() })).digest('hex');
const leadSchema = z.object({ companyName: z.string().trim().min(1).max(500), contactName: z.string().trim().min(1).max(500),
  source: z.string().trim().min(1).max(200), status: z.enum(['New', 'Contacted', 'Qualified', 'Converted', 'Lost']),
  notes: z.string().trim().max(5000).nullable().optional(), email: z.string().trim().email().nullable().optional(),
  phone: z.string().trim().nullable().optional(), score: z.number().int().min(0).max(100).optional(),
  expectedValue: z.number().finite().nonnegative().nullable().optional(), probability: z.number().int().min(0).max(100) }).strict();
const commandSchema = z.object({ resource: z.enum(['project_addresses', 'contacts', 'leads']), operation: z.enum(['create', 'edit', 'delete']),
  id: z.string().min(1).optional(), expectedRevision: z.number().int().positive(), expectedCrmVersion: z.string().min(1), data: z.unknown().optional() }).strict();

async function authorize(tx: Prisma.TransactionClient, actorId: string, customerId: string, action: 'CUSTOMER_READ' | 'CUSTOMER_WRITE') {
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { partnerProfile: { select: { id: true } } } });
  if (!actor?.partnerProfile && !(await readManagedCrmOperations(tx, actorId)).visible) throw new CustomerManagementError(403, 'CRM_CUSTOMER_FORBIDDEN', 'دسترسی به این مشتری مجاز نیست.');
  if (actor?.partnerProfile && action === 'CUSTOMER_READ') {
    const off = await tx.featurePermission.findUnique({ where: { userId_workspace_feature: { userId: actorId, workspace: 'crm', feature: 'crm_customers_view' } } });
    if (off?.isActive && off.permissionLevel === 'none' && (!off.expiresAt || off.expiresAt > new Date())) throw new CustomerManagementError(403, 'CRM_CUSTOMER_FORBIDDEN', 'مجوز مشاهده مشتری فعال نیست.');
  }
  const decision = await createAuditedPartnerAuthorization(tx, { actorId, purpose: 'CRM', channel: 'API' }, { correlationId: randomUUID(), ...(action === 'CUSTOMER_WRITE' ? { reason: 'مدیریت عملیاتی اطلاعات مشتری همکار در CRM' } : {}) })
    .authorize(action, { kind: 'CUSTOMER', id: customerId });
  if (!decision.ok) throw new CustomerManagementError(decision.error.status, decision.error.code, decision.error.message);
}

async function customerOperations(tx: Prisma.TransactionClient, actorId: string, customerId: string) {
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { partnerProfile: { select: { id: true, state: true } } } });
  if (!actor?.partnerProfile) return { ...await readManagedCrmOperations(tx, actorId), owner: false };
  const customer = await tx.crmCustomer.findUnique({ where: { id: customerId }, select: { partnerOwnerProfileId: true } });
  const owns = customer?.partnerOwnerProfileId === actor.partnerProfile.id;
  const write = owns ? await createAuditedPartnerAuthorization(tx, { actorId, purpose: 'CRM', channel: 'API' }, { correlationId: randomUUID() }).authorize('CUSTOMER_WRITE', { kind: 'CUSTOMER', id: customerId }) : null;
  const decisions = await tx.featurePermission.findMany({ where: { userId: actorId } });
  return { visible: owns, isAdmin: false, owner: owns,
    has: async (feature: string, workspace = 'crm', required: 'view' | 'edit' = 'edit') => {
      const off = decisions.find(row => row.workspace === workspace && row.feature === feature);
      if (off?.isActive && off.permissionLevel === 'none' && (!off.expiresAt || off.expiresAt > new Date())) return false;
      return owns && (required === 'view' || Boolean(write?.ok));
    } };
}

export async function readPartnerCustomerCrm(tx: Prisma.TransactionClient, actorId: string, customerId: string) {
  await authorize(tx, actorId, customerId, 'CUSTOMER_READ');
  const customer = await tx.crmCustomer.findUnique({ where: { id: customerId }, include });
  if (!customer?.partnerOwnerProfileId || customer.cardDeletedAt) throw new CustomerManagementError(404, 'CUSTOMER_NOT_FOUND', 'مشتری یافت نشد.');
  const authority = await customerOperations(tx, actorId, customerId);
  const permissions = Object.fromEntries(await Promise.all(['project_addresses', 'contacts', 'leads'].flatMap(resource =>
    ['view', 'create', 'edit', 'delete'].map(async operation => [`${resource}_${operation}`,
      resource === 'project_addresses' && operation === 'view' || await authority.has(`crm_${resource}_${operation}`, 'crm', operation === 'view' ? 'view' : 'edit')]))));
  const contractsView = await authority.has('sales_contracts_view', 'sales', 'view');
  const financialView = await authority.has('bi_partner_reports_view', 'bi', 'view');
  const cases = contractsView ? await tx.partnerSaleCase.findMany({ where: { customerId, customerContractId: { not: null } },
    orderBy: { createdAt: 'desc' }, select: { id: true, state: true, customerContract: { select: { id: true, contractNumber: true, createdAt: true,
      status: true, commercialFlowVersion: true } } } }) : [];
  // Never spread Customer/Contract records into this projection. Full contracts,
  // snapshots, custom fields, lead values and histories contain private evidence.
  const response = { id: customer.id, firstName: customer.firstName, lastName: customer.lastName, companyName: customer.companyName,
    activityCategory: customer.activityCategory, customerType: customer.customerType, industry: customer.industry, brandName: customer.brandName, brandNameDescription: customer.brandNameDescription,
    homeNumber: customer.homeNumber, workNumber: customer.workNumber, projectManagerName: customer.projectManagerName, projectManagerNumber: customer.projectManagerNumber,
    referrerFirstName: customer.referrerFirstName, referrerLastName: customer.referrerLastName, referrerPhoneNumber: customer.referrerPhoneNumber, status: customer.status, nationalCode: customer.nationalCode,
    homeAddress: customer.homeAddress, workAddress: customer.workAddress, isBlacklisted: customer.isBlacklisted, isLocked: customer.isLocked,
    partnerOwnerProfileId: customer.partnerOwnerProfileId, ownerUserId: customer.ownerUserId, ownerUser: customer.ownerUser,
    managementReadOnly: true, partnerCrmSections: true, partnerOwnerView: authority.owner, canManageCustomerCard: (authority.owner || authority.isAdmin) && await authority.has('crm_customers_edit'),
    partnerRevision: customer.partnerRevision, cardVersion: customerCardVersion(customer), crmVersion: version(customer),
    createdAt: customer.createdAt, updatedAt: customer.updatedAt,
    phoneNumbers: customer.phoneNumbers.map(({ id, number, type, isPrimary, isActive }) => ({ id, number, type, isPrimary, isActive })),
    projectAddresses: customer.projectAddresses.map(({ id, address, city, postalCode, projectName, projectType, projectManagerName, projectManagerNumber, marketerFirstName, marketerLastName, marketerPhoneNumber, isActive }) =>
      ({ id, address, city, postalCode, projectName, projectType, projectManagerName, projectManagerNumber, marketerFirstName, marketerLastName, marketerPhoneNumber, isActive })),
    contacts: permissions.contacts_view ? customer.contacts.map(({ id, firstName, lastName, position, email, phone, mobile, isPrimary, isActive }) => ({ id, firstName, lastName, position, email, phone, mobile, isPrimary, isActive })) : [],
    leads: permissions.leads_view ? customer.leads.map(({ id, companyName, contactName, source, status, probability, score, phone, email, notes, createdAt }) =>
      ({ id, companyName, contactName, source, status, probability, score, phone, email, notes, createdAt })) : [],
    salesContracts: cases.flatMap(row => row.customerContract ? [{ ...row.customerContract, caseId: row.id, partnerCommercialStatus: row.state }] : []),
    crmCapabilities: { ...permissions, contracts_view: contractsView, financial_view: financialView,
      customers_blacklist: (authority.owner || authority.isAdmin) && await authority.has('crm_customers_blacklist'),
      customers_lock: (authority.owner || authority.isAdmin) && await authority.has('crm_customers_lock'),
      ...Object.fromEntries(await Promise.all(['create', 'edit', 'delete'].map(async operation => [`phone_numbers_${operation}`, (authority.owner || authority.isAdmin) && await authority.has(`crm_phone_numbers_${operation}`)]))) } };
  // A transfer or revocation during projection cannot disclose the old owner's card.
  await authorize(tx, actorId, customerId, 'CUSTOMER_READ');
  return response;
}

export async function mutatePartnerCustomerCrm(tx: Prisma.TransactionClient, actorId: string, customerId: string, raw: unknown) {
  const parsed = commandSchema.safeParse(raw);
  if (!parsed.success) throw new CustomerManagementError(400, 'INVALID_CRM_COMMAND', 'اطلاعات عملیات نامعتبر است.');
  const input = parsed.data;
  if ((input.operation !== 'create' && !input.id) || (input.operation === 'create' && input.id)) throw new CustomerManagementError(400, 'INVALID_CRM_COMMAND', 'شناسه عملیات نامعتبر است.');
  const initial = await tx.crmCustomer.findUnique({ where: { id: customerId }, select: { partnerOwnerProfileId: true } });
  if (!initial?.partnerOwnerProfileId) throw new CustomerManagementError(404, 'CUSTOMER_NOT_FOUND', 'مشتری یافت نشد.');
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${actorId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM partner_profiles WHERE id = ${initial.partnerOwnerProfileId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM crm_customers WHERE id = ${customerId} FOR UPDATE`;
  await authorize(tx, actorId, customerId, 'CUSTOMER_WRITE');
  if (!await (await customerOperations(tx, actorId, customerId)).has(`crm_${input.resource}_${input.operation}`)) throw new CustomerManagementError(403, 'CRM_OPERATION_FORBIDDEN', 'مجوز این عملیات فعال نیست.');
  const customer = await tx.crmCustomer.findUniqueOrThrow({ where: { id: customerId }, include });
  if (customer.cardDeletedAt || customer.partnerOwnerProfileId !== initial.partnerOwnerProfileId) throw new CustomerManagementError(409, 'CUSTOMER_CARD_STALE', 'مالکیت یا وضعیت مشتری تغییر کرده است.');
  if (input.expectedRevision !== customer.partnerRevision || input.expectedCrmVersion !== version(customer)) throw new CustomerManagementError(409, 'CUSTOMER_CARD_STALE', 'اطلاعات همزمان تغییر کرده است؛ اطلاعات را دوباره دریافت کنید.');
  const existing = (input.resource === 'project_addresses' ? customer.projectAddresses : input.resource === 'contacts' ? customer.contacts : customer.leads).find(row => row.id === input.id);
  if (input.operation !== 'create' && (!existing || ('isActive' in existing && !existing.isActive))) throw new CustomerManagementError(404, 'CRM_CHILD_NOT_FOUND', 'رکورد متعلق به این مشتری نیست یا حذف شده است.');
  await tx.$executeRaw`SELECT set_config('sabalan.partner_crm_profile', ${customer.partnerOwnerProfileId}, true)`;
  let result: unknown;
  if (input.resource === 'leads') {
    if (input.operation === 'delete') result = await tx.crmLead.delete({ where: { id: input.id } });
    else {
      const parsedLead = leadSchema.safeParse(input.data);
      if (!parsedLead.success) throw new CustomerManagementError(400, 'INVALID_CRM_LEAD', 'نام شرکت، نام مخاطب، منبع و اطلاعات معتبر سرنخ لازم است.');
      result = input.operation === 'create' ? await tx.crmLead.create({ data: { ...parsedLead.data, customerId } }) : await tx.crmLead.update({ where: { id: input.id }, data: parsedLead.data });
    }
  } else {
    const schema = input.resource === 'contacts' ? partnerCardContactSchema : partnerCardProjectSchema;
    const values = input.operation === 'delete' ? { isActive: false } : schema.safeParse(input.data);
    if ('success' in values && !values.success) throw new CustomerManagementError(400, 'INVALID_CRM_CHILD', values.error.issues[0]?.message || 'اطلاعات نامعتبر است.');
    const data = 'success' in values ? values.data! : values;
    if ('id' in data) throw new CustomerManagementError(400, 'INVALID_CRM_CHILD', 'شناسه فقط در فرمان عملیات مجاز است.');
    if (input.operation !== 'delete' && !data.isActive) throw new CustomerManagementError(400, 'INVALID_CRM_CHILD', 'برای حذف از عملیات حذف استفاده کنید.');
    if (input.resource === 'contacts') {
      const contactData = data as z.infer<typeof partnerCardContactSchema>;
      if (contactData.isPrimary && customer.contacts.some(row => row.id !== input.id && row.isActive && row.isPrimary)) throw new CustomerManagementError(409, 'PRIMARY_CONTACT_EXISTS', 'ابتدا مخاطب اصلی فعلی را تغییر دهید.');
      result = input.operation === 'create' ? await tx.crmContact.create({ data: { ...contactData, customerId } }) : await tx.crmContact.update({ where: { id: input.id }, data: contactData });
      if (input.operation === 'delete' && customer.primaryContactId === input.id) await tx.crmCustomer.update({ where: { id: customerId }, data: { primaryContactId: null } });
      else if (input.operation !== 'delete' && (contactData.isPrimary || customer.primaryContactId === input.id)) await tx.crmCustomer.update({ where: { id: customerId }, data: { primaryContactId: contactData.isPrimary ? (result as { id: string }).id : null } });
    } else {
      const projectData = data as z.infer<typeof partnerCardProjectSchema>;
      result = input.operation === 'create' ? await tx.projectAddress.create({ data: { ...projectData, customerId } }) : await tx.projectAddress.update({ where: { id: input.id }, data: projectData });
    }
  }
  await tx.crmTimelineEvent.create({ data: { customerId, actorId, eventType: `PARTNER_CRM_${input.resource.toUpperCase()}_${input.operation.toUpperCase()}`,
    title: 'مدیریت اطلاعات مشتری همکار', metadata: JSON.parse(JSON.stringify({ before: existing ?? null, after: result })) } });
  await tx.crmCustomer.update({ where: { id: customerId }, data: { partnerRevision: { increment: 1 }, updatedBy: actorId } });
  return { updated: true };
}

export async function readPartnerCustomerContractFinance(database: PrismaClient, actorId: string, customerId: string, caseId: string) {
  const binding = await database.$transaction(async tx => {
    await authorize(tx, actorId, customerId, 'CUSTOMER_READ');
    const access = await customerOperations(tx, actorId, customerId);
    if (!await access.has('sales_contracts_view', 'sales', 'view') || !await access.has('bi_partner_reports_view', 'bi', 'view')) throw new CustomerManagementError(403, 'CRM_FINANCE_FORBIDDEN', 'مجوز مشاهده اطلاعات مالی فعال نیست.');
    const linked = await tx.partnerSaleCase.findFirst({ where: { id: caseId, customerId, customerContractId: { not: null } }, select: { id: true, createdAt: true } });
    if (!linked) throw new CustomerManagementError(404, 'CONTRACT_NOT_FOUND', 'قرارداد یافت نشد.');
    return { purpose: access.owner ? 'PARTNER' as const : 'MANAGEMENT' as const, from: linked.createdAt.toISOString().slice(0, 10) };
  });
  const service = new PartnerReportingService(runtime, createPrismaPartnerReportingSource({ database, actorId, correlationId: randomUUID() }), createPrismaPartnerReportExportStore(database));
  const report = await service.detail({ purpose: binding.purpose, from: binding.from, to: new Date().toISOString().slice(0, 10), caseId });
  const row = report.rows.find(row => row.caseId === caseId);
  if (!row) throw new CustomerManagementError(403, 'CRM_FINANCE_FORBIDDEN', 'اطلاعات مالی در محدوده دسترسی شما نیست.');
  await database.$transaction(async tx => {
    await authorize(tx, actorId, customerId, 'CUSTOMER_READ');
    const access = await customerOperations(tx, actorId, customerId);
    if (!await access.has('sales_contracts_view', 'sales', 'view') || !await access.has('bi_partner_reports_view', 'bi', 'view')) throw new CustomerManagementError(403, 'CRM_FINANCE_FORBIDDEN', 'مجوز مشاهده اطلاعات مالی تغییر کرده است.');
  }, { timeout: 30000 });
  return { currency: row.currency, metrics: row.metrics, collectionStatus: row.collectionStatus };
}
