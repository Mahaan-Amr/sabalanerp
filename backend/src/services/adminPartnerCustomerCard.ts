import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { appendAuthorizationDecision } from './effectiveAuthorization/audit';
import { CustomerManagementError } from './crmCustomerManagement';

const digits = (value: string) => value.replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\D/g, '');
const text = z.string().trim().nullable().optional();
const mobile = text.transform(value => value === undefined ? undefined : value ? digits(value) : null).refine(value => !value || /^09\d{9}$/.test(value), 'شماره موبایل نامعتبر است.');
const phone = z.object({ id: z.string().optional(), number: z.string().transform(digits), type: z.enum(['mobile', 'home', 'work', 'other']),
  isPrimary: z.boolean(), isActive: z.boolean() }).strict().refine(value => !value.isActive || /^09\d{9}$/.test(value.number), 'شماره تماس فعال باید موبایل معتبر باشد.');
const project = z.object({ id: z.string().optional(), address: z.string().trim(), city: text, postalCode: text,
  projectName: text, projectType: text, projectManagerName: text, projectManagerNumber: mobile,
  marketerFirstName: text, marketerLastName: text, marketerPhoneNumber: mobile, isActive: z.boolean() }).strict()
  .refine(value => !value.isActive || value.address.length > 0, 'نشانی پروژه الزامی است.');
const contact = z.object({ id: z.string().optional(), firstName: z.string().trim(), lastName: z.string().trim(),
  position: text, email: text, phone: text, mobile, isPrimary: z.boolean(), isActive: z.boolean() }).strict()
  .refine(value => !value.isActive || Boolean(value.firstName && value.lastName), 'نام مخاطب الزامی است.');
const card = z.object({
  expectedRevision: z.number().int().positive().optional(), expectedCardVersion: z.string().optional(),
  firstName: z.string().trim().min(1).optional(), lastName: z.string().trim().min(1).optional(),
  customerType: z.enum(['Individual', 'Company', 'Government']).optional(), status: z.enum(['Active', 'Inactive', 'Prospect', 'Lead']).optional(),
  nationalCode: text, companyName: text, industry: text, brandName: text, brandNameDescription: text,
  homeAddress: text, homeNumber: text, workAddress: text, workNumber: text,
  projectManagerName: text, projectManagerNumber: mobile, referrerFirstName: text, referrerLastName: text, referrerPhoneNumber: mobile,
  isBlacklisted: z.boolean().optional(), isLocked: z.boolean().optional(),
  projects: z.array(project).max(500).optional(), phones: z.array(phone).max(500).optional(), contacts: z.array(contact).max(500).optional(),
}).strict();

export function customerCardVersion(customer: { updatedAt: Date | string; partnerRevision: number | null;
  phoneNumbers: Array<{ id: string; updatedAt?: Date | string }>; contacts: Array<{ id: string; updatedAt?: Date | string }>;
  projectAddresses: Array<{ id: string; updatedAt?: Date | string }> }) {
  const revisions = (rows: Array<{ id: string; updatedAt?: Date | string }>) => rows.map(row => Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)))).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return createHash('sha256').update(JSON.stringify({ updatedAt: customer.updatedAt, revision: customer.partnerRevision,
    phones: revisions(customer.phoneNumbers), contacts: revisions(customer.contacts), projects: revisions(customer.projectAddresses) })).digest('hex');
}

export async function updateAdminPartnerCustomerCard(database: PrismaClient, actorId: string, customerId: string,
  operation: 'EDIT' | 'BLACKLIST' | 'LOCK', raw: unknown = {}) {
  if (operation !== 'EDIT' && (!raw || typeof raw !== 'object' || Object.keys(raw).length)) {
    throw new CustomerManagementError(400, 'INVALID_CUSTOMER_CARD', 'این اقدام فقط وضعیت مشتری را تغییر می‌دهد.');
  }
  const parsed = card.safeParse(raw);
  if (!parsed.success) throw new CustomerManagementError(400, 'INVALID_CUSTOMER_CARD', parsed.error.issues[0]?.message || 'اطلاعات کارت مشتری نامعتبر است.');
  return database.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${actorId} FOR UPDATE`;
    const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, isActive: true } });
    if (!actor?.isActive || actor.role !== 'ADMIN' || await tx.partnerProfile.findUnique({ where: { userId: actorId }, select: { id: true } })) {
      throw new CustomerManagementError(403, 'ADMIN_CUSTOMER_CARD_REQUIRED', 'مدیریت کارت مشتری همکار فقط برای Admin مجاز است.');
    }
    const initial = await tx.crmCustomer.findUnique({ where: { id: customerId }, select: { partnerOwnerProfileId: true } });
    if (!initial?.partnerOwnerProfileId) throw new CustomerManagementError(404, 'PARTNER_CUSTOMER_NOT_FOUND', 'مشتری همکار یافت نشد.');
    // Same Profile-before-Customer order as Partner commands and transfers.
    await tx.$queryRaw`SELECT id FROM partner_profiles WHERE id = ${initial.partnerOwnerProfileId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM crm_customers WHERE id = ${customerId} FOR UPDATE`;
    const customer = await tx.crmCustomer.findUniqueOrThrow({ where: { id: customerId }, include: { phoneNumbers: true, contacts: true, projectAddresses: true } });
    if (customer.cardDeletedAt) throw new CustomerManagementError(404, 'CUSTOMER_NOT_FOUND', 'کارت مشتری حذف شده است.');
    if (customer.partnerOwnerProfileId !== initial.partnerOwnerProfileId) throw new CustomerManagementError(409, 'CUSTOMER_CARD_STALE', 'مالک مشتری تغییر کرده است؛ اطلاعات را دوباره دریافت کنید.');
    const { expectedRevision, expectedCardVersion, projects, phones, contacts, ...patch } = parsed.data;
    if (operation === 'EDIT' && (expectedRevision !== customer.partnerRevision || expectedCardVersion !== customerCardVersion(customer))) {
      throw new CustomerManagementError(409, 'CUSTOMER_CARD_STALE', 'اطلاعات مشتری تغییر کرده است؛ دوباره دریافت کنید.');
    }
    const nationalCode = patch.nationalCode ? digits(patch.nationalCode) : null;
    if ('nationalCode' in patch && nationalCode && nationalCode.length !== ((patch.customerType || customer.customerType) === 'Individual' ? 10 : 11)) {
      throw new CustomerManagementError(400, 'INVALID_CUSTOMER_CARD', 'شناسه مشتری حقیقی باید ۱۰ رقم و شناسه حقوقی باید ۱۱ رقم باشد.');
    }
    if (phones && (!phones.some(p => p.isActive) || phones.filter(p => p.isActive && p.isPrimary).length > 1)) {
      throw new CustomerManagementError(400, 'INVALID_CUSTOMER_CARD', 'حداقل یک شماره فعال و حداکثر یک شماره اصلی لازم است.');
    }
    if (contacts && contacts.filter(c => c.isActive && c.isPrimary).length > 1) throw new CustomerManagementError(400, 'INVALID_CUSTOMER_CARD', 'فقط یک مخاطب اصلی قابل انتخاب است.');
    const checkIds = (rows: Array<{ id?: string }> | undefined, existing: Array<{ id: string }>) => {
      if (!rows) return;
      const ids = rows.flatMap(row => row.id ? [row.id] : []);
      if (new Set(ids).size !== ids.length || ids.some(id => !existing.some(row => row.id === id)) || existing.some(row => !ids.includes(row.id))) {
        throw new CustomerManagementError(409, 'CUSTOMER_CARD_STALE', 'اطلاعات وابسته به این مشتری تغییر کرده یا متعلق به مشتری دیگری است.');
      }
    };
    checkIds(projects, customer.projectAddresses); checkIds(phones, customer.phoneNumbers); checkIds(contacts, customer.contacts);
    const witnesses = [ ...(nationalCode && nationalCode !== customer.nationalCode ? [{ nationalCode }] : []), ...(phones?.filter(p => p.isActive && !customer.phoneNumbers.some(existing => existing.isActive && existing.number === p.number)).map(p => ({ phoneNumbers: { some: { number: p.number, isActive: true } } })) || []) ];
    if (witnesses.length && await tx.crmCustomer.findFirst({ where: { id: { not: customerId }, isActive: true, OR: witnesses }, select: { id: true } })) {
      throw new CustomerManagementError(409, 'DUPLICATE_CUSTOMER', 'شماره تماس یا شناسه برای مشتری دیگری ثبت شده است.');
    }
    await tx.$executeRaw`SELECT set_config('sabalan.partner_crm_profile', ${customer.partnerOwnerProfileId}, true)`;
    for (const row of projects || []) {
      const { id, ...data } = row;
      if (id) await tx.projectAddress.update({ where: { id }, data });
      else if (data.isActive) await tx.projectAddress.create({ data: { ...data, customerId } });
    }
    const primaryPhone = phones?.find(p => p.isActive && p.isPrimary) || phones?.find(p => p.isActive);
    for (const row of phones || []) {
      const { id, ...data } = row; data.isPrimary = row === primaryPhone;
      if (id) await tx.phoneNumber.update({ where: { id }, data });
      else if (data.isActive) await tx.phoneNumber.create({ data: { ...data, customerId } });
    }
    let primaryContactId = customer.primaryContactId;
    if (contacts) primaryContactId = null;
    for (const row of contacts || []) {
      const { id, ...data } = row; data.isPrimary = data.isActive && data.isPrimary;
      const written = id ? await tx.crmContact.update({ where: { id }, data }) : data.isActive ? await tx.crmContact.create({ data: { ...data, customerId } }) : null;
      if (written?.isPrimary) primaryContactId = written.id;
    }
    await tx.crmCustomer.update({ where: { id: customerId }, data: {
      ...(operation === 'EDIT' ? { ...patch, ...('nationalCode' in patch ? { nationalCode } : {}), primaryContactId } : {}),
      ...(operation === 'BLACKLIST' ? { isBlacklisted: !customer.isBlacklisted } : {}),
      ...(operation === 'LOCK' ? { isLocked: !customer.isLocked } : {}),
      partnerRevision: { increment: 1 }, updatedBy: actorId,
    } });
    await appendAuthorizationDecision(tx, { domain: 'CRM', actorId, action: `ADMIN_CUSTOMER_CARD_${operation}`,
      rootKind: 'CUSTOMER', rootId: customerId, purpose: 'CRM', channel: 'API', allowed: true, isAdmin: true,
      code: 'UPDATED', scope: 'CUSTOMER_CARD', reason: 'مدیریت کارت مشتری همکار توسط Admin', correlationId: randomUUID(),
      authorizationRevision: null, lifecycleRevision: customer.partnerRevision, assignmentId: null, assignmentRevision: null,
      evaluatedAt: new Date(), evaluatedGrantIds: [] });
    return tx.crmCustomer.findUniqueOrThrow({ where: { id: customerId }, include: { phoneNumbers: true, contacts: true, projectAddresses: true,
      ownerUser: { select: { id: true, firstName: true, lastName: true, username: true } } } });
  });
}
