type PayrollParticipationInput = {
  effectiveFrom?: unknown;
  startMismatchReason?: unknown;
  reviewConfirmed?: unknown;
};

const utcDay = (value: Date) => value.toISOString().slice(0, 10);

export const normalizePayrollParticipationCommand = (
  input: PayrollParticipationInput,
  scheduledStartDate: Date
) => {
  if (input.reviewConfirmed !== true) {
    throw new Error('Payroll review must be explicitly confirmed.');
  }
  const effectiveFrom = new Date(String(input.effectiveFrom || scheduledStartDate.toISOString()));
  if (Number.isNaN(effectiveFrom.getTime())) {
    throw new Error('Payroll effective date is invalid.');
  }
  const differs = utcDay(effectiveFrom) !== utcDay(scheduledStartDate);
  const startMismatchReason = String(input.startMismatchReason || '').trim();
  if (differs && !startMismatchReason) {
    throw new Error('A reason is required when the payroll date differs from the planned start date.');
  }
  return { effectiveFrom, startMismatchReason: differs ? startMismatchReason : null };
};
