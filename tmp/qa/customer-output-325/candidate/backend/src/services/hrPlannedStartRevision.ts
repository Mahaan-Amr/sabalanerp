const dateOnly = (value: unknown) => {
  const raw = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error('Scheduled start date must be a date-only value.');
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) throw new Error('Scheduled start date is invalid.');
  return parsed;
};

const tehranDayKey = (value: Date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};

export const normalizePlannedStartRevision = (input: any, today = new Date()) => {
  const scheduledStartDate = dateOnly(input.scheduledStartDate);
  const reason = String(input.reason ?? '').trim();
  if (reason.length < 5) throw new Error('A meaningful revision reason is required.');
  if (scheduledStartDate.toISOString().slice(0, 10) < tehranDayKey(today)) throw new Error('A past start date requires the separate historical correction workflow.');
  return { scheduledStartDate, reason };
};

export const projectPlannedStartRevisionEffects = (input: {
  priorScheduledStartDate: Date;
  payrollEffectiveFrom?: Date | null;
  payrollMismatchReason?: string | null;
  hasContractEvidence: boolean;
  hasInsuranceEvidence: boolean;
}) => ({
  syncPayrollDate: Boolean(input.payrollEffectiveFrom
    && input.payrollEffectiveFrom.getTime() === input.priorScheduledStartDate.getTime()
    && !String(input.payrollMismatchReason ?? '').trim()),
  requirePayrollReview: Boolean(input.payrollEffectiveFrom),
  requireContractCorrection: input.hasContractEvidence,
  requireInsuranceReview: input.hasInsuranceEvidence,
});
