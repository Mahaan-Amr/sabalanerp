import { AttendanceStatus } from '@prisma/client';

export type SecurityAttendanceSummaryRow = {
  status: AttendanceStatus | string;
  approvedMissions: unknown[];
  approvedLeaves: unknown[];
};

export type SecurityAttendanceSignatureRow = {
  digitalSignature?: string | null;
};

export const summarizeSecurityAttendance = (
  rows: SecurityAttendanceSummaryRow[],
  recordedRows: SecurityAttendanceSignatureRow[],
) => {
  const expectedRows = rows.filter((row) => row.status !== AttendanceStatus.NON_WORKING_DAY);
  return {
    totalEmployees: expectedRows.length,
    present: rows.filter((row) => row.status === AttendanceStatus.PRESENT).length,
    absent: rows.filter((row) => row.status === AttendanceStatus.ABSENT).length,
    late: rows.filter((row) => row.status === AttendanceStatus.LATE).length,
    mission: rows.filter((row) => row.approvedMissions.length > 0).length,
    leave: rows.filter((row) => row.approvedLeaves.length > 0).length,
    exception: rows.filter((row) => row.status === AttendanceStatus.ABSENT || row.status === AttendanceStatus.LATE).length,
    signed: recordedRows.filter((row) => Boolean(row.digitalSignature)).length,
  };
};
