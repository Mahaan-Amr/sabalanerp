import { Prisma } from '@prisma/client';

/** Read-only conflict discovery, including legacy overlaps which predate the integrity trigger. */
export async function overlappingAttendanceIds(db: Prisma.TransactionClient, personnelId?: string) {
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT a.id FROM attendance_intervals a JOIN attendance_records r ON r.id = a."attendanceRecordId"
    WHERE a.status = 'ACTIVE' AND NOT a."exitUnknown" AND a."enteredAt" IS NOT NULL AND r."personnelId" IS NOT NULL
      ${personnelId ? Prisma.sql`AND r."personnelId" = ${personnelId}` : Prisma.empty}
      AND EXISTS (SELECT 1 FROM attendance_intervals b JOIN attendance_records s ON s.id = b."attendanceRecordId"
        WHERE s."personnelId" = r."personnelId" AND b.id <> a.id AND b.status = 'ACTIVE' AND NOT b."exitUnknown"
          AND b."enteredAt" < COALESCE(a."exitedAt", 'infinity'::timestamp)
          AND a."enteredAt" < COALESCE(b."exitedAt", 'infinity'::timestamp))`);
  return rows.map(r => r.id);
}
export function actionableAttendanceIntervals(overlapIds: string[], today: Date): Prisma.AttendanceIntervalWhereInput {
  return { status: 'ACTIVE', OR: [{ exitUnknown: true }, { enteredAt: null }, { exitedAt: null, attendanceRecord: { date: { lt: today } } }, { id: { in: overlapIds } }] };
}
