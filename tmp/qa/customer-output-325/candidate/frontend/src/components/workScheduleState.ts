export interface WorkScheduleDayValue {
  weekday: number;
  startTime: string;
  endTime: string;
}

export interface WorkScheduleValue {
  effectiveDate: string;
  days: WorkScheduleDayValue[];
}

export const shouldConfirmBulkTimeReplacement = (
  days: readonly WorkScheduleDayValue[],
  startTime: string,
  endTime: string,
) => days.some((day) => day.startTime !== startTime || day.endTime !== endTime);

export const applyBulkTimes = (
  days: readonly WorkScheduleDayValue[],
  startTime: string,
  endTime: string,
): WorkScheduleDayValue[] => days.map((day) => ({ ...day, startTime, endTime }));
