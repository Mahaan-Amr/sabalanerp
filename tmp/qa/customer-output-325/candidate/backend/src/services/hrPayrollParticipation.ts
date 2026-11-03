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
    throw new Error('بررسی حقوق و مزایا باید به‌صورت صریح تأیید شود.');
  }
  const effectiveFrom = new Date(String(input.effectiveFrom || scheduledStartDate.toISOString()));
  if (Number.isNaN(effectiveFrom.getTime())) {
    throw new Error('تاریخ شروع مشارکت حقوق و دستمزد معتبر نیست.');
  }
  const differs = utcDay(effectiveFrom) !== utcDay(scheduledStartDate);
  const startMismatchReason = String(input.startMismatchReason || '').trim();
  if (differs && !startMismatchReason) {
    throw new Error('در صورت تفاوت تاریخ حقوق با تاریخ شروع برنامه‌ریزی‌شده، ثبت دلیل الزامی است.');
  }
  return { effectiveFrom, startMismatchReason: differs ? startMismatchReason : null };
};
