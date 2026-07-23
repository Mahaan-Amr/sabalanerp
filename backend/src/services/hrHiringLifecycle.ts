export const HIRING_LIFECYCLE_PHASES = [
  { id: "APPLICATION", number: 1, title: "تشکیل پرونده و فرم متقاضی" },
  { id: "IDENTITY", number: 2, title: "بررسی و احراز هویت" },
  { id: "ASSESSMENT", number: 3, title: "ارزیابی و تصمیم اولیه" },
  { id: "OFFER", number: 4, title: "پیشنهاد همکاری و پذیرش" },
  { id: "CONVERSION", number: 5, title: "وثیقه و تبدیل به پرسنل" },
  { id: "ONBOARDING", number: 6, title: "آماده‌سازی شروع همکاری" },
  { id: "ACTIVATION", number: 7, title: "فعال‌سازی همکاری" },
] as const;

export type HiringLifecyclePhaseId =
  (typeof HIRING_LIFECYCLE_PHASES)[number]["id"];
export type HiringLifecycleStatus =
  | "COMPLETED"
  | "ACTION_REQUIRED"
  | "WAITING"
  | "BLOCKED"
  | "UPCOMING"
  | "ENDED";

export interface HiringLifecycleAction {
  id: string;
  label: string;
  authorities: string[];
}

export interface HiringLifecycleBlocker {
  code: string;
  label: string;
  responsibleAuthorities: string[];
}

export interface HiringLifecyclePhase {
  id: HiringLifecyclePhaseId;
  number: number;
  title: string;
  status: HiringLifecycleStatus;
  requiredComplete: number;
  requiredTotal: number;
  blockers: HiringLifecycleBlocker[];
  primaryAction: HiringLifecycleAction | null;
  secondaryActions: HiringLifecycleAction[];
  guidance: string;
  responsibleFunction: string | null;
}

export interface HiringLifecycleProjection {
  currentPhaseId: HiringLifecyclePhaseId;
  currentPhaseNumber: number;
  totalPhases: 7;
  terminal: boolean;
  phases: HiringLifecyclePhase[];
}

export interface HiringLifecycleSummary {
  phaseId: HiringLifecyclePhaseId;
  phaseNumber: number;
  phaseTitle: string;
  status: HiringLifecycleStatus;
  stepLabel: string;
  actionLabel: string | null;
  requiredComplete: number;
  requiredTotal: number;
  terminal: boolean;
}

export interface HiringQueueSource {
  id: string;
  stage: string;
  outcome?: string | null;
  updatedAt: Date | string;
  candidate: {
    id: string;
    firstName: string;
    lastName: string;
    mobile: string;
  };
  position: { id: string; title: string };
}

interface FormRevisionLike {
  status: string;
}
interface CompensationLike {
  proposedBy?: string | null;
  preparedAt?: Date | string | null;
  hrApprovedAt?: Date | string | null;
  financeApprovedAt?: Date | string | null;
  candidateAcceptedAt?: Date | string | null;
}
interface CollateralLike {
  required?: boolean;
  status: string;
}
interface ContractLike {
  approvedAt?: Date | string | null;
}
interface OnboardingTaskLike {
  activationBlocker?: boolean;
  status: string;
  ownerAuthority?: string | null;
  title?: string;
}

export interface HiringLifecycleSource {
  stage: string;
  outcome?: string | null;
  formRevisions?: FormRevisionLike[];
  identityClearance?: string | null;
  assessments?: unknown[];
  assessmentCompletedAt?: Date | string | null;
  assessmentReviewRequired?: boolean;
  compensationClearance?: string | null;
  compensationSnapshots?: CompensationLike[];
  collateralClearance?: string | null;
  collateralItems?: CollateralLike[];
  convertedAt?: Date | string | null;
  employmentRelationship?: { status: string } | null;
  contractClearance?: string | null;
  contracts?: ContractLike[];
  payrollParticipation?: unknown | null;
  onboardingTasks?: OnboardingTaskLike[];
}

interface Gate {
  complete: boolean;
  requiredComplete: number;
  requiredTotal: number;
  blockers: HiringLifecycleBlocker[];
  action: HiringLifecycleAction | null;
  secondaryActions: HiringLifecycleAction[];
}

const action = (
  id: string,
  label: string,
  ...authorities: string[]
): HiringLifecycleAction => ({ id, label, authorities });
const blocker = (
  code: string,
  label: string,
  ...responsibleAuthorities: string[]
): HiringLifecycleBlocker => ({
  code,
  label,
  responsibleAuthorities,
});
const canPerform = (
  viewerAuthorities: ReadonlySet<string>,
  candidate: HiringLifecycleAction | null,
) =>
  Boolean(
    candidate?.authorities.some((required) => viewerAuthorities.has(required)),
  );
const isCompleteTask = (status: string) =>
  status === "COMPLETE" || status === "WAIVED";
const authorityLabels: Record<string, string> = {
  HR_PROCESSOR: "کارشناس منابع انسانی",
  HR_MANAGER: "مدیریت منابع انسانی",
  HIRING_MANAGER: "مدیر استخدام‌کننده",
  HR_PAYROLL_PROCESSOR: "کارشناس حقوق و دستمزد",
  HR_PAYROLL_MANAGER: "مدیریت حقوق و دستمزد",
  FINANCE_RECORDER: "کارشناس امور مالی",
  FINANCE_MANAGER: "مدیریت امور مالی",
};
const responsibleFunctionForAuthorities = (authorities: string[]) => {
  if (!authorities.length) return "متقاضی";
  return authorities
    .map((authority) => authorityLabels[authority] || authority)
    .join(" یا ");
};
const responsibleFunction = (candidate: HiringLifecycleAction | null) =>
  candidate ? responsibleFunctionForAuthorities(candidate.authorities) : null;

const applicationGate = (source: HiringLifecycleSource): Gate => {
  const complete = source.formRevisions?.[0]?.status === "SUBMITTED";
  return {
    complete,
    requiredComplete: complete ? 1 : 0,
    requiredTotal: 1,
    blockers: [],
    action: action(
      "WAIT_FOR_APPLICATION_FORM",
      "در انتظار تکمیل و ارسال فرم توسط متقاضی",
    ),
    secondaryActions: [
      action(
        "RESEND_INVITATION",
        "ارسال مجدد دعوت‌نامه",
        "HR_PROCESSOR",
        "HR_MANAGER",
      ),
    ],
  };
};

const identityGate = (source: HiringLifecycleSource): Gate => {
  const complete = source.identityClearance === "APPROVED";
  const rejected = source.identityClearance === "REJECTED";
  return {
    complete,
    requiredComplete: complete ? 1 : 0,
    requiredTotal: 1,
    blockers: rejected
      ? [
          blocker(
            "IDENTITY_REJECTED",
            "احراز هویت رد شده و نیازمند رسیدگی است.",
            "HR_PROCESSOR",
            "HR_MANAGER",
          ),
        ]
      : [],
    action:
      source.identityClearance === "IN_PROGRESS"
        ? action("APPROVE_IDENTITY", "تأیید نهایی احراز هویت", "HR_MANAGER")
        : action(
            "REVIEW_IDENTITY",
            "بررسی و تطبیق مدارک هویتی",
            "HR_PROCESSOR",
          ),
    secondaryActions:
      source.identityClearance === "IN_PROGRESS"
        ? [
            action(
              "REVIEW_IDENTITY",
              "ادامه بررسی و تطبیق مدارک هویتی",
              "HR_PROCESSOR",
            ),
          ]
        : [],
  };
};

const assessmentGate = (source: HiringLifecycleSource): Gate => {
  const complete = Boolean(source.assessmentCompletedAt);
  const reviewRequired = Boolean(source.assessmentReviewRequired);
  return {
    complete: complete && !reviewRequired,
    requiredComplete: complete && !reviewRequired ? 1 : 0,
    requiredTotal: 1,
    blockers: reviewRequired
      ? [
          blocker(
            "ASSESSMENT_REVIEW_REQUIRED",
            "ارزیابی پس از تغییر نیازمند تأیید دوباره مدیر استخدام‌کننده است.",
            "HIRING_MANAGER",
          ),
        ]
      : [],
    action: !complete
      ? action(
          "COMPLETE_ASSESSMENT",
          "تکمیل مرحله ارزیابی",
          "HR_PROCESSOR",
        )
      : action(
          "PROCEED_TO_OFFER",
          "ثبت تصمیم اولیه و ورود به پیشنهاد همکاری",
          "HIRING_MANAGER",
        ),
    secondaryActions: [
      action("RECORD_ASSESSMENT", "ثبت نتیجه ارزیابی تکمیلی", "HR_PROCESSOR"),
    ],
  };
};

const offerGate = (source: HiringLifecycleSource): Gate => {
  const latest = source.compensationSnapshots?.[0];
  const proposed = Boolean(latest?.proposedBy);
  const prepared = Boolean(latest?.preparedAt);
  const hrApproved = Boolean(latest?.hrApprovedAt);
  const financeApproved = Boolean(latest?.financeApprovedAt);
  const candidateAccepted = Boolean(latest?.candidateAcceptedAt);
  const completed = [
    proposed,
    prepared,
    hrApproved,
    financeApproved,
    candidateAccepted,
  ].filter(Boolean).length;
  let nextAction = action(
    "CREATE_OFFER",
    "ایجاد پیشنهاد همکاری",
    "HIRING_MANAGER",
  );
  if (latest && !prepared)
    nextAction = action(
      "PREPARE_OFFER_PAYROLL",
      "آماده‌سازی پیشنهاد توسط کارشناس حقوق‌ودستمزد",
      "HR_PAYROLL_PROCESSOR",
    );
  else if (latest && !hrApproved)
    nextAction = action(
      "APPROVE_OFFER_HR",
      "تأیید پیشنهاد توسط منابع انسانی و حقوق‌ودستمزد",
      "HR_PAYROLL_MANAGER",
    );
  else if (latest && !financeApproved)
    nextAction = action(
      "APPROVE_OFFER_FINANCE",
      "تأیید مالی پیشنهاد همکاری",
      "FINANCE_MANAGER",
    );
  else if (latest && !candidateAccepted)
    nextAction = action(
      "WAIT_FOR_CANDIDATE_ACCEPTANCE",
      "در انتظار پذیرش پیشنهاد توسط متقاضی",
    );
  return {
    complete: completed === 5,
    requiredComplete: completed,
    requiredTotal: 5,
    blockers:
      source.compensationClearance === "REJECTED"
        ? [
            blocker(
              "OFFER_REJECTED",
              "پیشنهاد همکاری رد شده و نیازمند رسیدگی است.",
              "HIRING_MANAGER",
              "HR_PAYROLL_MANAGER",
            ),
          ]
        : [],
    action: nextAction,
    secondaryActions: [],
  };
};

const conversionGate = (source: HiringLifecycleSource): Gate => {
  const requiredCollateral =
    source.collateralItems?.filter((item) => item.required !== false) || [];
  const collateralApproved =
    source.collateralClearance === "APPROVED" &&
    requiredCollateral.every(
      (item) => item.status === "VERIFIED" || item.status === "NOT_APPLICABLE",
    );
  const missingEmployment =
    Boolean(source.convertedAt) && !source.employmentRelationship;
  const converted =
    Boolean(source.convertedAt) && Boolean(source.employmentRelationship);
  const completed = [collateralApproved, converted].filter(Boolean).length;
  return {
    complete: completed === 2,
    requiredComplete: completed,
    requiredTotal: 2,
    blockers: [
      ...(source.collateralClearance === "REJECTED"
        ? [
            blocker(
              "COLLATERAL_REJECTED",
              "وثیقه رد شده و باید اصلاح یا جایگزین شود.",
              "FINANCE_RECORDER",
              "FINANCE_MANAGER",
            ),
          ]
        : []),
      ...(missingEmployment
        ? [
            blocker(
              "EMPLOYMENT_LINK_MISSING",
              "تبدیل ثبت شده اما رابطه استخدامی مرتبط پیدا نشد.",
              "HR_MANAGER",
            ),
          ]
        : []),
    ],
    action: collateralApproved
      ? action(
          "CONVERT_TO_PERSONNEL",
          "تبدیل پرونده پذیرفته‌شده به پرسنل",
          "HR_MANAGER",
        )
      : action(
          "COMPLETE_COLLATERAL",
          "تکمیل و تأیید وثیقه‌های الزامی",
          "FINANCE_RECORDER",
          "FINANCE_MANAGER",
        ),
    secondaryActions: [],
  };
};

const onboardingGate = (source: HiringLifecycleSource): Gate => {
  const contractApproved =
    Boolean(source.contracts?.[0]?.approvedAt) &&
    source.contractClearance === "APPROVED";
  const payrollReady = Boolean(source.payrollParticipation);
  const blockingTasks =
    source.onboardingTasks?.filter((task) => task.activationBlocker) || [];
  const completedTasks = blockingTasks.filter((task) =>
    isCompleteTask(task.status),
  ).length;
  const completed =
    Number(contractApproved) + Number(payrollReady) + completedTasks;
  const total = 2 + blockingTasks.length;
  const missingEmployment =
    Boolean(source.convertedAt || source.outcome === "HIRED") &&
    !source.employmentRelationship;
  let nextAction = action(
    "UPLOAD_CONTRACT",
    "بارگذاری قرارداد امضاشده",
    "FINANCE_RECORDER",
  );
  if (source.contracts?.[0] && !contractApproved)
    nextAction = action(
      "APPROVE_CONTRACT",
      "تأیید قرارداد امضاشده",
      "FINANCE_MANAGER",
    );
  else if (contractApproved && !payrollReady)
    nextAction = action(
      "CONFIGURE_PAYROLL",
      "تنظیم مشارکت حقوق و دستمزد",
      "HR_PAYROLL_MANAGER",
    );
  else if (
    contractApproved &&
    payrollReady &&
    completedTasks < blockingTasks.length
  ) {
    const pending = blockingTasks.find((task) => !isCompleteTask(task.status));
    nextAction = action(
      "COMPLETE_ONBOARDING_TASK",
      pending?.title || "تکمیل وظیفه مسدودکننده شروع همکاری",
      pending?.ownerAuthority || "HR_MANAGER",
    );
  }
  return {
    complete: !missingEmployment && completed === total,
    requiredComplete: completed,
    requiredTotal: total,
    blockers: [
      ...(missingEmployment
        ? [
            blocker(
              "EMPLOYMENT_LINK_MISSING",
              "پرونده تبدیل شده اما رابطه استخدامی مرتبط پیدا نشد.",
              "HR_MANAGER",
            ),
          ]
        : []),
      ...(source.contractClearance === "REJECTED"
        ? [
            blocker(
              "CONTRACT_REJECTED",
              "قرارداد رد شده و نیازمند نسخه اصلاحی است.",
              "FINANCE_RECORDER",
              "FINANCE_MANAGER",
            ),
          ]
        : []),
    ],
    action: nextAction,
    secondaryActions: [],
  };
};

const activationGate = (source: HiringLifecycleSource): Gate => {
  const complete = source.employmentRelationship?.status === "ACTIVE";
  return {
    complete,
    requiredComplete: complete ? 1 : 0,
    requiredTotal: 1,
    blockers:
      source.employmentRelationship?.status === "ENDED"
        ? [
            blocker(
              "EMPLOYMENT_ENDED",
              "رابطه استخدامی پایان یافته است.",
              "HR_MANAGER",
            ),
          ]
        : [],
    action: action(
      "ACTIVATE_EMPLOYMENT",
      "فعال‌سازی رابطه استخدامی",
      "HR_MANAGER",
    ),
    secondaryActions: [],
  };
};

export const projectHiringLifecycle = (
  source: HiringLifecycleSource,
  viewerAuthorities: Iterable<string> = [],
): HiringLifecycleProjection => {
  const authorities = new Set(viewerAuthorities);
  const gates = [
    applicationGate(source),
    identityGate(source),
    assessmentGate(source),
    offerGate(source),
    conversionGate(source),
    onboardingGate(source),
    activationGate(source),
  ];
  const terminal = Boolean(source.outcome && source.outcome !== "HIRED");
  const firstIncomplete = gates.findIndex((gate) => !gate.complete);
  const effectiveIndex =
    firstIncomplete === -1 ? gates.length - 1 : firstIncomplete;

  const phases = HIRING_LIFECYCLE_PHASES.map(
    (phase, index): HiringLifecyclePhase => {
      const gate = gates[index];
      let status: HiringLifecycleStatus;
      if (gate.complete) status = "COMPLETED";
      else if (terminal && index >= effectiveIndex) status = "ENDED";
      else if (index > effectiveIndex) status = "UPCOMING";
      else if (gate.blockers.length) status = "BLOCKED";
      else if (
        [gate.action, ...gate.secondaryActions].some((candidate) =>
          canPerform(authorities, candidate),
        )
      )
        status = "ACTION_REQUIRED";
      else status = "WAITING";

      const isFocused = index === effectiveIndex && !terminal;
      const actionable = isFocused && gate.blockers.length === 0;
      const permittedActions = actionable
        ? [gate.action, ...gate.secondaryActions].filter(
            (candidate): candidate is HiringLifecycleAction =>
              canPerform(authorities, candidate),
          )
        : [];
      const primaryAction = permittedActions[0] || null;
      const secondaryActions = permittedActions.slice(1);
      const guidance: Record<HiringLifecycleStatus, string> = {
        COMPLETED: "الزامات این مرحله تکمیل شده است.",
        ACTION_REQUIRED: "این مرحله به اقدام شما نیاز دارد.",
        WAITING: "ادامه این مرحله در انتظار اقدام متقاضی یا واحد مسئول است.",
        BLOCKED: "برای ادامه، مانع ثبت‌شده باید برطرف شود.",
        UPCOMING: "این مرحله پس از تکمیل مراحل پیشین آغاز می‌شود.",
        ENDED: "این مرحله به دلیل نتیجه نهایی پرونده ادامه پیدا نمی‌کند.",
      };

      return {
        ...phase,
        status,
        requiredComplete: gate.requiredComplete,
        requiredTotal: gate.requiredTotal,
        blockers: gate.blockers,
        primaryAction,
        secondaryActions,
        guidance: guidance[status],
        responsibleFunction: isFocused
          ? status === "BLOCKED"
            ? responsibleFunctionForAuthorities(
                gate.blockers[0]?.responsibleAuthorities || [],
              )
            : responsibleFunction(primaryAction || gate.action)
          : null,
      };
    },
  );

  return {
    currentPhaseId: HIRING_LIFECYCLE_PHASES[effectiveIndex].id,
    currentPhaseNumber: HIRING_LIFECYCLE_PHASES[effectiveIndex].number,
    totalPhases: 7,
    terminal,
    phases,
  };
};

export const summarizeHiringLifecycle = (
  projection: HiringLifecycleProjection,
): HiringLifecycleSummary => {
  const phase =
    projection.phases.find((item) => item.id === projection.currentPhaseId) ||
    projection.phases[0];
  return {
    phaseId: phase.id,
    phaseNumber: phase.number,
    phaseTitle: phase.title,
    status: phase.status,
    stepLabel: `مرحله ${phase.number} از ${projection.totalPhases}`,
    actionLabel: phase.primaryAction?.label || null,
    requiredComplete: phase.requiredComplete,
    requiredTotal: phase.requiredTotal,
    terminal: projection.terminal,
  };
};

export const buildHiringQueueItem = (
  source: HiringQueueSource,
  lifecycleSummary: HiringLifecycleSummary,
) => ({
  id: source.id,
  stage: source.stage,
  outcome: source.outcome || null,
  updatedAt: source.updatedAt,
  candidate: {
    id: source.candidate.id,
    firstName: source.candidate.firstName,
    lastName: source.candidate.lastName,
    mobile: source.candidate.mobile,
  },
  position: {
    id: source.position.id,
    title: source.position.title,
  },
  lifecycleSummary,
});
