import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { isValidIranianNationalCode } from './hrHiringRules';

export class PersonnelIdentityError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export const identityUserSelect = { id: true, firstName: true, lastName: true, updatedAt: true, erasedAt: true } as const;

// Includes both sides: a User edit must invalidate an open Personnel editor too.
export const personnelIdentityVersion = (person: { id: string; updatedAt: Date } | null, user: { id: string; updatedAt: Date } | null) =>
  crypto.createHash('sha256').update(JSON.stringify([person?.id, person?.updatedAt.toISOString(), user?.id, user?.updatedAt.toISOString()])).digest('hex');

export const assertPersonnelIdentityVersion = (expected: unknown, person: { id: string; updatedAt: Date } | null, user: { id: string; updatedAt: Date } | null) => {
  if (typeof expected !== 'string' || expected !== personnelIdentityVersion(person, user)) {
    throw new PersonnelIdentityError(409, 'PERSONNEL_IDENTITY_CONFLICT', 'اطلاعات از زمان بازشدن فرم تغییر کرده است؛ آخرین اطلاعات را دریافت و دوباره بررسی کنید.');
  }
};

const requiredName = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100) throw new PersonnelIdentityError(400, 'INVALID_PERSONNEL_NAME', 'نام و نام خانوادگی الزامی است و هر کدام باید حداکثر ۱۰۰ نویسه باشد.');
  return value.trim();
};

const identifier = (value: unknown) => {
  if (value !== null && typeof value !== 'string') throw new PersonnelIdentityError(400, 'INVALID_PERSONNEL_IDENTIFIER', 'شناسه باید به‌صورت متن وارد شود.');
  return String(value ?? '').replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).trim() || null;
};

export async function correctPersonnelIdentity(tx: Prisma.TransactionClient, input: {
  personnelId: string; actorUserId: string; source: 'PERSONNEL' | 'USER';
  expectedVersion: unknown;
  fields: { firstName?: unknown; lastName?: unknown; nationalCode?: unknown; employeeNumber?: unknown };
}) {
  const person = await tx.personnel.findUnique({ where: { id: input.personnelId }, include: { user: { select: identityUserSelect } } });
  if (!person) throw new PersonnelIdentityError(404, 'PERSONNEL_NOT_FOUND', 'پرسنل پیدا نشد.');
  if (person.archivedAt || person.user?.erasedAt) throw new PersonnelIdentityError(409, 'PERSONNEL_ARCHIVED', 'مشخصات پروندهٔ بایگانی‌شده یا حساب حذف‌شده قابل تغییر نیست.');
  assertPersonnelIdentityVersion(input.expectedVersion, person, person.user);
  const before = { firstName: person.firstName, lastName: person.lastName, nationalCode: person.nationalCode, employeeNumber: person.employeeNumber };
  const after = {
    firstName: input.fields.firstName === undefined ? before.firstName : requiredName(input.fields.firstName),
    lastName: input.fields.lastName === undefined ? before.lastName : requiredName(input.fields.lastName),
    nationalCode: input.fields.nationalCode === undefined ? before.nationalCode : identifier(input.fields.nationalCode),
    employeeNumber: input.fields.employeeNumber === undefined ? before.employeeNumber : identifier(input.fields.employeeNumber),
  };
  if ((before.nationalCode && !after.nationalCode) || (before.employeeNumber && !after.employeeNumber)) throw new PersonnelIdentityError(400, 'PERSONNEL_IDENTIFIER_REQUIRED', 'کد ملی و شمارهٔ پرسنلی ثبت‌شده را نمی‌توان خالی کرد.');
  if (input.fields.nationalCode !== undefined && after.nationalCode && !isValidIranianNationalCode(after.nationalCode)) throw new PersonnelIdentityError(400, 'INVALID_NATIONAL_CODE', 'کد ملی معتبر نیست.');
  if (input.fields.employeeNumber !== undefined && after.employeeNumber && after.employeeNumber.length > 100) throw new PersonnelIdentityError(400, 'INVALID_EMPLOYEE_NUMBER', 'شمارهٔ پرسنلی باید حداکثر ۱۰۰ نویسه باشد.');
  const nameChanged = after.firstName !== before.firstName || after.lastName !== before.lastName;
  const syncUser = person.user && (nameChanged || input.source === 'USER')
    && (person.user.firstName !== after.firstName || person.user.lastName !== after.lastName);
  if (JSON.stringify(before) === JSON.stringify(after) && !syncUser) return person;
  const updated = await tx.personnel.updateMany({ where: { id: person.id, updatedAt: person.updatedAt, archivedAt: null }, data: { ...after, updatedAt: new Date(Math.max(Date.now(), person.updatedAt.getTime() + 1)) } });
  if (updated.count !== 1) throw new PersonnelIdentityError(409, 'PERSONNEL_IDENTITY_CONFLICT', 'اطلاعات هم‌زمان تغییر کرده است؛ آخرین اطلاعات را دریافت کنید.');
  if (syncUser && person.user) {
    const userUpdate = await tx.user.updateMany({ where: { id: person.user.id, updatedAt: person.user.updatedAt, personnelId: person.id, erasedAt: null }, data: { firstName: after.firstName, lastName: after.lastName } });
    if (userUpdate.count !== 1) throw new PersonnelIdentityError(409, 'PERSONNEL_IDENTITY_CONFLICT', 'حساب متصل هم‌زمان تغییر کرده است؛ آخرین اطلاعات را دریافت کنید.');
  }
  await tx.hrPersonnelAudit.create({ data: {
    personnelId: person.id, actorUserId: input.actorUserId, eventType: 'IDENTITY_CORRECTED', sourceCategory: input.source, reason: '',
    payloadJson: { before, after, linkedUserId: person.user?.id || null,
      ...(syncUser && person.user ? { userBefore: { firstName: person.user.firstName, lastName: person.user.lastName }, userAfter: { firstName: after.firstName, lastName: after.lastName } } : {}) },
  } });
  return tx.personnel.findUniqueOrThrow({ where: { id: person.id }, include: { user: { select: identityUserSelect } } });
}
