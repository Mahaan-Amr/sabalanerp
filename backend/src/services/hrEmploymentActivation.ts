type ActivationInput = {
  scheduledStartDate?: Date | null;
  identityClearance: string;
  collateralClearance: string;
  contractClearance: string;
  compensationClearance: string;
  payrollParticipation?: unknown;
  onboardingTasks: Array<{ id?: string; title: string; activationBlocker: boolean; status: string }>;
  insuranceEnrollment?: { registrationPath?: string; status?: string } | null;
  activatedAt?: Date | null;
  activatedBy?: string | null;
};

const canonicalDateKey = (value: Date | string) => {
  const parsed = value instanceof Date ? value : new Date(value);
  return parsed.toISOString().slice(0, 10);
};

const tehranDateKey = (value: Date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

export const plannedStartHasArrived = (
  scheduledStartDate?: Date | string | null,
  now = new Date()
) => Boolean(scheduledStartDate && canonicalDateKey(scheduledStartDate) <= tehranDateKey(now));

export const buildEmploymentActivationReadiness = (
  input: ActivationInput,
  now = new Date()
) => {
  const blockers: Array<{ id: string; message: string }> = [];
  if (!plannedStartHasArrived(input.scheduledStartDate, now)) {
    blockers.push({ id: 'PLANNED_START_NOT_REACHED', message: 'تاریخ شروع برنامه‌ریزی‌شده هنوز نرسیده است.' });
  }
  if (input.identityClearance !== 'APPROVED') blockers.push({ id: 'IDENTITY_NOT_APPROVED', message: 'تأیید هویت کامل نشده است.' });
  if (input.collateralClearance !== 'APPROVED') blockers.push({ id: 'COLLATERAL_NOT_APPROVED', message: 'تأیید وثیقه کامل نشده است.' });
  if (input.contractClearance !== 'APPROVED') blockers.push({ id: 'PAPER_CONTRACT_NOT_APPROVED', message: 'قرارداد کاغذی هنوز توسط مدیر امور مالی تأیید نشده است.' });
  if (input.compensationClearance !== 'APPROVED') blockers.push({ id: 'COMPENSATION_NOT_APPROVED', message: 'حقوق و مزایای نهایی تأیید نشده است.' });
  if (!input.payrollParticipation) blockers.push({ id: 'PAYROLL_NOT_CONFIGURED', message: 'مشارکت حقوق و دستمزد تنظیم نشده است.' });
  for (const task of input.onboardingTasks || []) {
    if (task.activationBlocker && !['COMPLETE', 'WAIVED'].includes(task.status)) {
      blockers.push({ id: `ONBOARDING_TASK:${task.id || task.title}`, message: `وظیفه مسدودکننده «${task.title}» تکمیل نشده است.` });
    }
  }
  return {
    ready: blockers.length === 0,
    blockers,
    plannedStartDate: input.scheduledStartDate || null,
    paperContractClearance: input.contractClearance,
    payrollConfigured: Boolean(input.payrollParticipation),
    insurance: {
      registrationPath: input.insuranceEnrollment?.registrationPath || 'COMPANY',
      status: input.insuranceEnrollment?.status || 'NOT_STARTED',
      blocking: false,
    },
    activatedAt: input.activatedAt || null,
    activatedBy: input.activatedBy || null,
  };
};
