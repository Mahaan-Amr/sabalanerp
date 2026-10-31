import { Prisma, AttendanceRestAssignment } from '@prisma/client';
import { parseSecurityBusinessDate, securityDateKey, securityDateKeyFromInstant } from '../utils/securityBusinessDate';

export const restEffectiveDate = (value: unknown, now = new Date()) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('تاریخ اجرای معتبر الزامی است.');
  const date = parseSecurityBusinessDate(value);
  if (securityDateKey(date) !== value || value < securityDateKeyFromInstant(now)) throw new Error('تاریخ اجرا نمی‌تواند نامعتبر یا در گذشته باشد.');
  return date;
};
export const restReason = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 2000) throw new Error('دلیل معتبر الزامی است.');
  return value.trim();
};
export async function saveRestPolicy(db: Prisma.TransactionClient, input: { effectiveDate?: unknown; startTime?: unknown; endTime?: unknown; reason?: unknown }, actorId: string) {
  const effectiveFrom = restEffectiveDate(input.effectiveDate), reason = input.reason === undefined ? 'ثبت نسخه بازه استراحت پرسنل' : restReason(input.reason);
  const validTime = (v: unknown): v is string => typeof v === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
  if (!validTime(input.startTime) || !validTime(input.endTime) || input.startTime === input.endTime) throw new Error('شروع و پایان استراحت باید معتبر و متفاوت باشند.');
  if (await db.attendanceRestPolicy.findUnique({ where: { effectiveFrom } })) throw new Error('برای این تاریخ نسخه ثبت شده است؛ تاریخ تازه‌ای انتخاب کنید. سابقه بازنویسی نمی‌شود.');
  return db.attendanceRestPolicy.create({ data: { effectiveFrom, startTime: input.startTime, endTime: input.endTime, reason, createdBy: actorId } });
}
export async function assignRestPolicy(db: Prisma.TransactionClient, input: { effectiveDate?: unknown; personnelIds?: unknown; hasRest?: unknown; reason?: unknown }, actorId: string) {
  const effectiveFrom = restEffectiveDate(input.effectiveDate), reason = input.reason === undefined ? 'ثبت تخصیص استراحت پرسنل' : restReason(input.reason);
  if (!Array.isArray(input.personnelIds) || !input.personnelIds.length || input.personnelIds.length > 100 || input.personnelIds.some(id => typeof id !== 'string' || !id)) throw new Error('بین یک تا صد پرونده پرسنلی را انتخاب کنید.');
  if (typeof input.hasRest !== 'boolean') throw new Error('داشتن یا نداشتن استراحت را صریحاً انتخاب کنید.');
  const personnelIds = [...new Set(input.personnelIds as string[])];
  const people = await db.personnel.findMany({ where: { id: { in: personnelIds }, isActive: true }, select: { id: true } });
  if (people.length !== personnelIds.length) throw new Error('یک یا چند پرونده پرسنلی فعال در دسترس نیست.');
  if (await db.attendanceRestAssignment.count({ where: { personnelId: { in: personnelIds }, effectiveFrom } })) throw new Error('برای یک یا چند نفر در این تاریخ تخصیص ثبت شده است؛ تاریخ تازه‌ای انتخاب کنید.');
  const rows: AttendanceRestAssignment[] = [];
  for (const personnelId of personnelIds) {
    const row = await db.attendanceRestAssignment.create({ data: { personnelId, effectiveFrom, hasRest: input.hasRest, reason, createdBy: actorId } });
    await db.hrPersonnelAudit.create({ data: { personnelId, actorUserId: actorId, eventType: 'ATTENDANCE_REST_ASSIGNED', sourceCategory: 'WORK_SCHEDULE', reason, payloadJson: { assignmentId: row.id, effectiveDate: securityDateKey(effectiveFrom), hasRest: row.hasRest } } });
    rows.push(row);
  }
  return rows;
}
