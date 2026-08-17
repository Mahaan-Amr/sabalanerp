import type { Prisma, PrismaClient } from '@prisma/client';
import { collectHrDutyBaselineReport, type HrDutyBaselineReport } from './hrDutyBaselineReport';

type DutyBaselineDatabase = PrismaClient | Prisma.TransactionClient;

export type HrDutyBaselineCommandResult = {
  exitCode: 0 | 1;
  report: HrDutyBaselineReport;
};

export const runHrDutyBaselineCommand = async (
  database: DutyBaselineDatabase,
  input: { now?: Date; writeLine: (line: string) => void },
): Promise<HrDutyBaselineCommandResult> => {
  const report = await collectHrDutyBaselineReport(database, { now: input.now });
  input.writeLine(JSON.stringify(report));
  return { exitCode: report.ok ? 0 : 1, report };
};
