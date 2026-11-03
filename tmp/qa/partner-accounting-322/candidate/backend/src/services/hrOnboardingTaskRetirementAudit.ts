export const SYSTEM_ONBOARDING_TASK_DEFINITIONS = {
  SIGNED_CONTRACT: {
    title: 'تأیید قرارداد امضاشده',
    ownerAuthority: 'FINANCE_MANAGER',
    activationBlocker: true,
  },
  PAYROLL_PARTICIPATION: {
    title: 'تنظیم مشارکت حقوق و دستمزد',
    ownerAuthority: 'HR_PAYROLL_MANAGER',
    activationBlocker: true,
  },
  INSURANCE: {
    title: 'پیگیری ثبت بیمه',
    ownerAuthority: 'HR_PROCESSOR',
    activationBlocker: false,
  },
} as const;

export const SYSTEM_ONBOARDING_TASK_TITLES = Object.fromEntries(
  Object.entries(SYSTEM_ONBOARDING_TASK_DEFINITIONS).map(([kind, definition]) => [
    kind,
    definition.title,
  ]),
) as { [Kind in keyof typeof SYSTEM_ONBOARDING_TASK_DEFINITIONS]:
  (typeof SYSTEM_ONBOARDING_TASK_DEFINITIONS)[Kind]['title'] };

type SystemTaskKind = keyof typeof SYSTEM_ONBOARDING_TASK_DEFINITIONS;

export interface OnboardingTaskAuditRow {
  title: string;
  status: string;
  ownerAuthority: string;
  activationBlocker: boolean;
}

export interface OnboardingApplicationAuditRow {
  converted: boolean;
  contractClearance: string | null;
  payrollConfigured: boolean;
  insuranceStatus: string | null;
  tasks: OnboardingTaskAuditRow[];
}

const openTaskStatuses = new Set(['PENDING', 'IN_PROGRESS']);
const systemKindByTitle = new Map<string, SystemTaskKind>(
  Object.entries(SYSTEM_ONBOARDING_TASK_DEFINITIONS).map(([kind, definition]) => [
    definition.title,
    kind as SystemTaskKind,
  ]),
);

export const isSystemOnboardingTaskTitle = (title: string) =>
  systemKindByTitle.has(title);

const systemTaskKind = (task: Pick<OnboardingTaskAuditRow,
  'title' | 'ownerAuthority' | 'activationBlocker'>) => {
  const kind = systemKindByTitle.get(task.title);
  if (!kind) return null;
  const definition = SYSTEM_ONBOARDING_TASK_DEFINITIONS[kind];
  return task.ownerAuthority === definition.ownerAuthority &&
    task.activationBlocker === definition.activationBlocker
    ? kind
    : null;
};

export const isSystemOnboardingTask = (
  task: Pick<OnboardingTaskAuditRow,
    'title' | 'ownerAuthority' | 'activationBlocker'>,
) => Boolean(systemTaskKind(task));

export const legacyOnboardingTaskCompletionDecision = (
  task: Pick<OnboardingTaskAuditRow,
    'title' | 'ownerAuthority' | 'activationBlocker'>,
  requestedStatus: unknown,
) => {
  if (isSystemOnboardingTask(task)) return 'SYSTEM_MANAGED' as const;
  if (requestedStatus !== 'COMPLETE') return 'INVALID_STATUS' as const;
  return 'COMPLETE' as const;
};

const expectedSystemTaskStatus = (
  application: OnboardingApplicationAuditRow,
  kind: SystemTaskKind,
) => {
  if (kind === 'SIGNED_CONTRACT') {
    return application.contractClearance === 'APPROVED' ? 'COMPLETE' : 'PENDING';
  }
  if (kind === 'PAYROLL_PARTICIPATION') {
    return application.payrollConfigured ? 'COMPLETE' : 'PENDING';
  }
  return ['ACTIVE', 'EXEMPT'].includes(application.insuranceStatus || '')
    ? 'COMPLETE'
    : 'PENDING';
};

export const auditHrOnboardingTaskRetirement = (
  applications: OnboardingApplicationAuditRow[],
) => {
  const blockers = {
    openManualTasks: 0,
    missingSystemTasks: 0,
    duplicateSystemTasks: 0,
    canonicalStatusDrift: 0,
  };
  let totalTasks = 0;
  let systemTasks = 0;
  let manualTasks = 0;

  for (const application of applications) {
    totalTasks += application.tasks.length;
    const systemTasksByKind = new Map<SystemTaskKind, OnboardingTaskAuditRow[]>();

    for (const task of application.tasks) {
      const kind = systemTaskKind(task);
      if (!kind) {
        manualTasks += 1;
        if (openTaskStatuses.has(task.status)) blockers.openManualTasks += 1;
        continue;
      }
      systemTasks += 1;
      systemTasksByKind.set(kind, [
        ...(systemTasksByKind.get(kind) || []),
        task,
      ]);
      if (task.status !== expectedSystemTaskStatus(application, kind)) {
        blockers.canonicalStatusDrift += 1;
      }
    }

    if (!application.converted) continue;
    for (const kind of Object.keys(SYSTEM_ONBOARDING_TASK_DEFINITIONS) as SystemTaskKind[]) {
      const count = systemTasksByKind.get(kind)?.length || 0;
      if (count === 0) blockers.missingSystemTasks += 1;
      if (count > 1) blockers.duplicateSystemTasks += count - 1;
    }
  }

  return {
    mode: 'READ_ONLY' as const,
    ok: Object.values(blockers).every((count) => count === 0),
    population: {
      applications: applications.length,
      convertedApplications: applications.filter((application) => application.converted).length,
      totalTasks,
      systemTasks,
      manualTasks,
    },
    blockers,
  };
};
