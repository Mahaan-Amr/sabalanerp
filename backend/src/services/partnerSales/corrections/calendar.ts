import type { Prisma } from '@prisma/client';
import type { TehranWorkingCalendar } from '@sabalanerp/partner-sales-contracts';
import { addTehranWorkingDays, tehranCivilDateKey } from '../../tehranBusinessCalendar';

/** Freeze the authoritative active holiday set in the approval transaction. */
export async function readPartnerWorkingCalendar(tx: Prisma.TransactionClient): Promise<TehranWorkingCalendar> {
  const rows = await tx.sabalanCalendarEntry.findMany({ where: { isActive: true, isHoliday: true }, select: { date: true } });
  const holidays = new Set(rows.map(row => tehranCivilDateKey(row.date)));
  return { version: 'TEHRAN_WORKING_DAYS_V1', async addWorkingDays(instant, days) {
    return addTehranWorkingDays(new Date(instant), days, holidays).toISOString();
  } };
}
