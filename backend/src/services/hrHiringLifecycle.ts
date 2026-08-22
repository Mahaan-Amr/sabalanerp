import { paperContractReviewState } from "./hrEmploymentContract";
import { buildEmploymentActivationReadiness } from "./hrEmploymentActivation";
import { latestDecisionsByKind } from "./hrApplicationDecisionVersions";
import { projectFormalAssessmentEvidenceGate } from "./hrFormalAssessmentPolicy";

export const HIRING_LIFECYCLE_PHASES = [
  { id: "APPLICATION", number: 1, title: "تشکیل پرونده و فرم متقاضی" },
  { id: "INITIAL_HR_REVIEW", number: 2, title: "بررسی اولیه منابع انسانی" },
  { id: "FORMAL_ASSESSMENTS", number: 3, title: "ارزیابی‌های رسمی اختیاری" },
  { id: "COMPANY_EVALUATION_PLAN", number: 4, title: "برنامه ارزیابی مدیریت شرکت" },
  { id: "IDENTITY", number: 5, title: "بررسی و احراز هویت" },
  { id: "OFFER", number: 6, title: "پیشنهاد همکاری و پذیرش" },
  { id: "CONVERSION", number: 7, title: "وثیقه و تبدیل به پرسنل" },
  { id: "ONBOARDING", number: 8, title: "آماده‌سازی شروع همکاری" },
  { id: "ACTIVATION", number: 9, title: "فعال‌سازی همکاری" },
] as const;

export type HiringLifecyclePhaseId =
  (typeof HIRING_LIFECYCLE_PHASES)[number]["id"];
export type HiringLifecycleStatus =
  | "COMPLETED"
  | "ACTION_REQUIRED"
  | "WAITING"
  | "BLOCKED"
  | "PAUSED"
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
  totalPhases: number;
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
  disposition?: string | null;
  dispositionReason?: string | null;
  position: { id: string; title: string; job?: { id: string; title: string } | null };
  hiringDecisions?: HiringDecisionLike[];
  decisionDetailsVisible?: boolean;
}

interface FormRevisionLike {
  status: string;
}
interface CompensationLike {
  obsoleteAt?: Date | string | null;
  proposedBy?: string | null;
  payrollReviewStatus?: string | null;
  payrollVerifiedAt?: Date | string | null;
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
  uploadedBy?: string;
  submittedAt?: Date | string | null;
  returnedAt?: Date | string | null;
  approvedAt?: Date | string | null;
}
interface OnboardingTaskLike {
  id?: string;
  activationBlocker?: boolean;
  status: string;
  ownerAuthority?: string | null;
  title?: string;
}
interface PreIdentityChecklistLike {
  status: string;
  managementResolution?: string | null;
}
interface CompanyEvaluationOccurrenceLike {
  status: string;
}
interface HiringDecisionLike {
  kind: string;
  outcome: string;
  version: number;
}

interface FormalAssessmentSelectionLike {
  assessmentKind: "DISC" | "EQ" | "BIG_FIVE";
  selected: boolean;
  executionMethod?: "APPLICANT" | "COMPANY" | null;
}

interface FormalAssessmentResultLike {
  assessmentKind: "DISC" | "EQ" | "BIG_FIVE";
  resultVersion: number;
  status: "PENDING" | "COMPLETED" | "INVALIDATED";
}

interface FormalAssessmentPlanLike {
  version: number;
  status: "ACTIVE" | "SUPERSEDED";
  explicitlyNoAssessment: boolean;
  executionMethod?: "APPLICANT" | "COMPANY" | null;
  selections?: FormalAssessmentSelectionLike[];
  results?: FormalAssessmentResultLike[];
}

export interface HiringLifecycleSource {
  stage: string;
  outcome?: string | null;
  formRevisions?: FormRevisionLike[];
  identityClearance?: string | null;
  assessments?: unknown[];
  assessmentCompletedAt?: Date | string | null;
  assessmentReviewRequired?: boolean;
  assessmentDecision?: string | null;
  disposition?: string | null;
  preIdentityRequirementsFinalizedAt?: Date | string | null;
  preIdentityManagementApprovedAt?: Date | string | null;
  preIdentityReleasedAt?: Date | string | null;
  preIdentityGrandfatheredAt?: Date | string | null;
  preIdentityChecklistItems?: PreIdentityChecklistLike[];
  companyEvaluationOccurrences?: CompanyEvaluationOccurrenceLike[];
  formalAssessmentPlans?: FormalAssessmentPlanLike[];
  hiringDecisions?: HiringDecisionLike[];
  compensationClearance?: string | null;
  compensationSnapshots?: CompensationLike[];
  collateralClearance?: string | null;
  collateralItems?: CollateralLike[];
  convertedAt?: Date | string | null;
  scheduledStartDate?: Date | string | null;
  employmentRelationship?: { status: string } | null;
  contractClearance?: string | null;
  contracts?: ContractLike[];
  insuranceEnrollment?: { status: string; registrationPath?: string; dueDate?: Date | string | null } | null;
  payrollParticipation?: unknown | null;
  onboardingTasks?: OnboardingTaskLike[];
}

export interface HiringTaskCapability {
  id:
    | "SIGNED_CONTRACT"
    | "INSURANCE"
    | "PAYROLL_PARTICIPATION"
    | "EMPLOYMENT_ACTIVATION"
    | "ONBOARDING_TASK";
  title: string;
  status: string;
  ownerAuthorities: string[];
  detailVisible: boolean;
  actionIds: string[];
  overdue?: boolean;
}

export const projectHiringTaskCapabilities = (
  source: HiringLifecycleSource,
  viewerAuthorities: Iterable<string> = [],
  viewerUserId?: string,
): HiringTaskCapability[] => {
  const authorities = new Set(viewerAuthorities);
  const visibleTo = (...required: string[]) =>
    required.some((authority) => authorities.has(authority));
  const activationBlocked = !buildEmploymentActivationReadiness({
    scheduledStartDate: source.scheduledStartDate ? new Date(source.scheduledStartDate) : null,
    identityClearance: source.identityClearance || "NOT_STARTED",
    collateralClearance: source.collateralClearance || "NOT_STARTED",
    contractClearance: source.contractClearance || "NOT_STARTED",
    compensationClearance: source.compensationClearance || "NOT_STARTED",
    payrollParticipation: source.payrollParticipation,
    onboardingTasks: (source.onboardingTasks || []).map((task) => ({
      ...task,
      title: task.title || "وظیفه آماده‌سازی",
      activationBlocker: Boolean(task.activationBlocker),
    })),
    insuranceEnrollment: source.insuranceEnrollment,
  }).ready;
  const employmentActive = source.employmentRelationship?.status === "ACTIVE";
  const contractVisible = visibleTo("FINANCE_RECORDER", "FINANCE_MANAGER");
  const latestContract = source.contracts?.[0];
  const contractReviewState = latestContract
    ? paperContractReviewState({
        uploadedBy: latestContract.uploadedBy || "unknown",
        submittedAt: latestContract.submittedAt,
        returnedAt: latestContract.returnedAt,
        approvedAt: latestContract.approvedAt,
      })
    : "DRAFT";
  const insuranceVisible = visibleTo("HR_PROCESSOR");
  const insuranceOverdue =
    source.insuranceEnrollment?.registrationPath !== "INDEPENDENT_REQUEST" &&
    Boolean(source.insuranceEnrollment?.dueDate) &&
    new Date(source.insuranceEnrollment!.dueDate!) < new Date() &&
    !["ACTIVE", "EXEMPT"].includes(source.insuranceEnrollment?.status || "");
  const payrollVisible = visibleTo("HR_PAYROLL_MANAGER");
  const activationVisible = visibleTo("HR_MANAGER");

  const tasks: HiringTaskCapability[] = [
    {
      id: "SIGNED_CONTRACT",
      title: "قرارداد کاغذی",
      status: source.contractClearance || "NOT_STARTED",
      ownerAuthorities: ["FINANCE_RECORDER", "FINANCE_MANAGER"],
      detailVisible: contractVisible,
      actionIds: contractVisible
        ? [
            ...(authorities.has("FINANCE_RECORDER")
              ? contractReviewState === "DRAFT" && latestContract
                ? ["SUBMIT_CONTRACT"]
                : contractReviewState === "RETURNED" || !latestContract
                  ? ["RECORD_CONTRACT"]
                  : []
              : []),
            ...(authorities.has("FINANCE_MANAGER") &&
            contractReviewState === "SUBMITTED" &&
            Boolean(viewerUserId) &&
            latestContract?.uploadedBy !== viewerUserId
              ? ["REVIEW_CONTRACT"]
              : []),
          ]
        : [],
    },
    {
      id: "INSURANCE",
      title: "پیگیری ثبت بیمه",
      status: source.insuranceEnrollment?.status || "NOT_STARTED",
      overdue: insuranceOverdue,
      ownerAuthorities: ["HR_PROCESSOR"],
      detailVisible: insuranceVisible,
      actionIds: insuranceVisible ? ["UPDATE_INSURANCE"] : [],
    },
    {
      id: "PAYROLL_PARTICIPATION",
      title: "تنظیم مشارکت حقوق و دستمزد",
      status: source.payrollParticipation ? "COMPLETE" : "PENDING",
      ownerAuthorities: ["HR_PAYROLL_MANAGER"],
      detailVisible: payrollVisible,
      actionIds: payrollVisible ? ["CONFIGURE_PAYROLL"] : [],
    },
    {
      id: "EMPLOYMENT_ACTIVATION",
      title: "فعال‌سازی همکاری",
      status: employmentActive
        ? "COMPLETE"
        : activationBlocked
          ? "BLOCKED"
          : "READY",
      ownerAuthorities: ["HR_MANAGER"],
      detailVisible: activationVisible,
      actionIds:
        activationVisible && !employmentActive && !activationBlocked
          ? ["ACTIVATE_EMPLOYMENT"]
          : [],
    },
  ];

  for (const task of source.onboardingTasks || []) {
    const ownerAuthorities = task.ownerAuthority
      ? [task.ownerAuthority]
      : [];
    const detailVisible = visibleTo(...ownerAuthorities);
    tasks.push({
      id: "ONBOARDING_TASK",
      title: task.title || "وظیفه آماده‌سازی شروع همکاری",
      status: task.status,
      ownerAuthorities,
      detailVisible,
      actionIds: detailVisible ? ["UPDATE_ONBOARDING_TASK"] : [],
    });
  }

  return tasks;
};

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
export const actionPermissionForHiringLifecycleAction = (actionId: string) => {
  if (actionId.startsWith("RECORD_COMPANY_ASSESSMENT_RESULT:")) {
    return "RECORD_COMPANY_EVALUATION_RESULT";
  }
  return ({
    RECORD_HR_INTERVIEW: "RECORD_INITIAL_INTERVIEW",
    RECORD_HR_PRELIMINARY_APPROVAL: "RECORD_PRELIMINARY_DECISION",
    FINALIZE_FORMAL_ASSESSMENT_PLAN: "MANAGE_COMPANY_EVALUATION_PLAN",
    REVISE_FORMAL_ASSESSMENT_PLAN: "MANAGE_COMPANY_EVALUATION_PLAN",
    RECORD_COMPANY_EVALUATION_RESULT: "RECORD_COMPANY_EVALUATION_RESULT",
    ADD_COMPANY_EVALUATION: "MANAGE_COMPANY_EVALUATION_PLAN",
    FINALIZE_PRE_IDENTITY_REQUIREMENTS: "MANAGE_PRE_EMPLOYMENT_REQUIREMENTS",
    ADD_PRE_IDENTITY_ITEM: "MANAGE_PRE_EMPLOYMENT_REQUIREMENTS",
    RESOLVE_NEGATIVE_PRE_IDENTITY_ITEM: "MANAGE_PRE_EMPLOYMENT_REQUIREMENTS",
    APPROVE_PRE_IDENTITY: "RECORD_FINAL_MANAGEMENT_DECISION",
    COMPLETE_PRE_IDENTITY_ITEM: "MANAGE_RECRUITMENT_CASE",
    RELEASE_PRE_IDENTITY: "MANAGE_RECRUITMENT_CASE",
    CREATE_OFFER: "MANAGE_COMPENSATION",
    VERIFY_OFFER_PAYROLL: "MANAGE_PAYROLL",
    RECORD_CONTRACT: "MANAGE_FINANCE_EVIDENCE",
    UPLOAD_CONTRACT: "MANAGE_FINANCE_EVIDENCE",
    SUBMIT_CONTRACT: "MANAGE_FINANCE_EVIDENCE",
    REVIEW_CONTRACT: "MANAGE_FINANCE_EVIDENCE",
    APPROVE_CONTRACT: "MANAGE_FINANCE_EVIDENCE",
    CONFIGURE_PAYROLL: "MANAGE_PAYROLL",
    REVIEW_IDENTITY: "MANAGE_RECRUITMENT_CASE",
    APPROVE_IDENTITY: "MANAGE_RECRUITMENT_CASE",
    RECORD_ASSESSMENT: "MANAGE_RECRUITMENT_CASE",
    COMPLETE_ASSESSMENT: "MANAGE_RECRUITMENT_CASE",
    DECIDE_ASSESSMENT: "MANAGE_PRE_EMPLOYMENT_REQUIREMENTS",
    CONVERT_TO_PERSONNEL: "MANAGE_RECRUITMENT_CASE",
    COMPLETE_COLLATERAL: "MANAGE_FINANCE_EVIDENCE",
    UPDATE_INSURANCE: "MANAGE_RECRUITMENT_CASE",
    UPDATE_ONBOARDING_TASK: "MANAGE_RECRUITMENT_CASE",
    COMPLETE_ONBOARDING_TASK: "MANAGE_RECRUITMENT_CASE",
    ACTIVATE_EMPLOYMENT: "MANAGE_RECRUITMENT_CASE",
    RESEND_INVITATION: "MANAGE_RECRUITMENT_CASE",
  } as Record<string, string>)[actionId] ?? null;
};

const canPerform = (
  viewerAuthorities: ReadonlySet<string>,
  viewerActionPermissions: ReadonlySet<string>,
  candidate: HiringLifecycleAction | null,
) =>
  Boolean(
    candidate && (
      candidate.authorities.some((required) => viewerAuthorities.has(required))
      || Boolean(
        actionPermissionForHiringLifecycleAction(candidate.id)
        && viewerActionPermissions.has(actionPermissionForHiringLifecycleAction(candidate.id)!),
      )
    ),
  );
const isCompleteTask = (status: string) =>
  status === "COMPLETE" || status === "WAIVED";
const authorityLabels: Record<string, string> = {
  HR_PROCESSOR: "کارشناس منابع انسانی",
  HR_MANAGER: "مدیریت منابع انسانی",
  HR_PAYROLL_PROCESSOR: "کارشناس حقوق و دستمزد",
  HR_PAYROLL_MANAGER: "مدیریت حقوق و دستمزد",
  FINANCE_RECORDER: "کارشناس امور مالی",
  FINANCE_MANAGER: "مدیریت امور مالی",
  COMPANY_MANAGER: "مدیریت شرکت",
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

const latestDecision = (source: HiringLifecycleSource, kind: string) =>
  latestDecisionsByKind(source.hiringDecisions || []).get(kind);

const completedGate = (requiredTotal = 1): Gate => ({
  complete: true,
  requiredComplete: requiredTotal,
  requiredTotal,
  blockers: [],
  action: null,
  secondaryActions: [],
});

const initialHrReviewGate = (source: HiringLifecycleSource): Gate => {
  if (source.preIdentityGrandfatheredAt) {
    return completedGate(2);
  }
  const interviewRecorded = Boolean(latestDecision(source, "HR_INTERVIEW"));
  const hrApproved = latestDecision(source, "HR_PRELIMINARY_APPROVAL")?.outcome === "POSITIVE";
  const completed = Number(interviewRecorded) + Number(hrApproved);
  return {
    complete: completed === 2,
    requiredComplete: completed,
    requiredTotal: 2,
    blockers: [],
    action: !interviewRecorded
      ? action("RECORD_HR_INTERVIEW", "ثبت نتیجه مصاحبه اولیه HR", "HR_PROCESSOR")
      : action("RECORD_HR_PRELIMINARY_APPROVAL", "ثبت تأیید اولیه HR", "HR_MANAGER"),
    secondaryActions: [],
  };
};

const formalAssessmentGate = (source: HiringLifecycleSource): Gate => {
  if (source.preIdentityGrandfatheredAt) return completedGate();
  const plans = source.formalAssessmentPlans || [];
  const evidence = projectFormalAssessmentEvidenceGate(plans);
  if (evidence.planVersion === null) {
    return {
      complete: false,
      requiredComplete: 0,
      requiredTotal: 1,
      blockers: [blocker(
        "FORMAL_ASSESSMENT_PLAN_UNRESOLVED",
        "تصمیم صریح درباره ارزیابی‌های رسمی هنوز ثبت نشده است.",
        "COMPANY_MANAGER",
      )],
      action: action("FINALIZE_FORMAL_ASSESSMENT_PLAN", "ثبت برنامه ارزیابی‌های رسمی", "COMPANY_MANAGER"),
      secondaryActions: [],
    };
  }
  if (evidence.explicitlyNoAssessment) return completedGate();
  const nextCompanyResult = evidence.missingKinds.find((kind) => evidence.executionMethodByKind.get(kind) === "COMPANY");
  return {
    complete: evidence.complete,
    requiredComplete: evidence.selectedKinds.length - evidence.missingKinds.length,
    requiredTotal: evidence.selectedKinds.length || 1,
    blockers: [
      ...(!evidence.selectedKinds.length ? [blocker(
        "FORMAL_ASSESSMENT_SELECTION_MISSING",
        "برنامه باید ارزیابی انتخاب‌شده داشته باشد یا صریحاً بدون ارزیابی ثبت شود.",
        "COMPANY_MANAGER",
      )] : []),
      ...evidence.missingKinds.map((kind) => blocker(
        `FORMAL_ASSESSMENT_RESULT_MISSING:${kind}`,
        `نتیجه ${kind} برای نسخه جاری برنامه تکمیل نشده است.`,
        evidence.executionMethodByKind.get(kind) === "APPLICANT" ? "APPLICANT" : "HR_PROCESSOR",
      )),
    ],
    action: nextCompanyResult
      ? action(
          `RECORD_COMPANY_ASSESSMENT_RESULT:${nextCompanyResult}`,
          `ثبت نتیجه ${nextCompanyResult}`,
          "HR_PROCESSOR",
        )
      : null,
    secondaryActions: [action("REVISE_FORMAL_ASSESSMENT_PLAN", "بازنگری برنامه ارزیابی‌های رسمی", "COMPANY_MANAGER")],
  };
};

const companyEvaluationPlanGate = (source: HiringLifecycleSource): Gate => {
  if (source.preIdentityGrandfatheredAt) return completedGate(2);
  const evaluations = source.companyEvaluationOccurrences || [];
  const pendingEvaluations = evaluations.filter((item) => item.status === "PLANNED");
  const resolvedEvaluations = evaluations.length - pendingEvaluations.length;
  const companyApproved = latestDecision(source, "COMPANY_APPROVAL")?.outcome === "POSITIVE";
  return {
    complete: companyApproved && pendingEvaluations.length === 0,
    requiredComplete: resolvedEvaluations + Number(companyApproved),
    requiredTotal: evaluations.length + 1,
    blockers: [],
    action: pendingEvaluations.length
      ? action(
          "RECORD_COMPANY_EVALUATION_RESULT",
          "پیگیری و ثبت نتیجه ارزیابی‌های شرکت",
          "HR_PROCESSOR",
        )
      : action(
          "RECORD_FINAL_MANAGEMENT_DECISION",
          "ثبت تصمیم نهایی مدیریت شرکت",
          "COMPANY_MANAGER",
        ),
    secondaryActions: [
      action("ADD_COMPANY_EVALUATION", "افزودن ارزیابی شرکت", "COMPANY_MANAGER"),
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
  const approved = source.assessmentDecision === "APPROVED";
  return {
    complete: complete && approved && !reviewRequired,
    requiredComplete: Number(complete) + Number(approved && !reviewRequired),
    requiredTotal: 2,
    blockers: reviewRequired
      ? [
          blocker(
            "ASSESSMENT_REVIEW_REQUIRED",
            "ارزیابی پس از تغییر نیازمند تأیید دوباره مدیریت شرکت است.",
            "COMPANY_MANAGER",
          ),
        ]
      : [],
    action: !complete || source.assessmentDecision === "REPEAT_REQUIRED"
      ? action(
          "COMPLETE_ASSESSMENT",
          "تکمیل مرحله ارزیابی",
          "HR_PROCESSOR",
        )
      : action(
          "DECIDE_ASSESSMENT",
          "ثبت تصمیم مدیریت شرکت درباره ارزیابی",
          "COMPANY_MANAGER",
        ),
    secondaryActions: [
      action("RECORD_ASSESSMENT", "ثبت نتیجه ارزیابی تکمیلی", "HR_PROCESSOR"),
    ],
  };
};

const offerGate = (source: HiringLifecycleSource): Gate => {
  const latest = source.compensationSnapshots?.find((snapshot) => !snapshot.obsoleteAt);
  const proposed = Boolean(latest?.proposedBy);
  const payrollVerified = Boolean(
    latest?.payrollReviewStatus === "VERIFIED" ||
    latest?.payrollVerifiedAt ||
    (latest?.hrApprovedAt && latest?.financeApprovedAt),
  );
  const candidateAccepted = Boolean(latest?.candidateAcceptedAt);
  const completed = [
    proposed,
    payrollVerified,
    candidateAccepted,
  ].filter(Boolean).length;
  let nextAction = action(
    "CREATE_OFFER",
    "ایجاد پیشنهاد همکاری",
    "COMPANY_MANAGER",
  );
  if (latest?.payrollReviewStatus === "RETURNED")
    nextAction = action(
      "CREATE_OFFER",
      "ثبت نسخه اصلاح‌شده پیشنهاد همکاری",
      "COMPANY_MANAGER",
    );
  else if (latest && !payrollVerified)
    nextAction = action(
      "VERIFY_OFFER_PAYROLL",
      "بررسی ردیف‌های پیشنهاد حقوق",
      "HR_PAYROLL_MANAGER",
    );
  else if (latest && !candidateAccepted)
    nextAction = action(
      "WAIT_FOR_CANDIDATE_ACCEPTANCE",
      "در انتظار پذیرش پیشنهاد توسط متقاضی",
    );
  return {
    complete: completed === 3,
    requiredComplete: completed,
    requiredTotal: 3,
    blockers:
      source.compensationClearance === "REJECTED"
        ? [
            blocker(
              "OFFER_REJECTED",
              "پیشنهاد همکاری رد شده و نیازمند رسیدگی است.",
              "COMPANY_MANAGER",
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

const onboardingGate = (source: HiringLifecycleSource, viewerUserId?: string): Gate => {
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
  let nextAction: HiringLifecycleAction | null = action(
    "UPLOAD_CONTRACT",
    "بارگذاری قرارداد امضاشده",
    "FINANCE_RECORDER",
  );
  const latestContract = source.contracts?.[0];
  const contractState = latestContract
    ? paperContractReviewState({
        uploadedBy: latestContract.uploadedBy || "unknown",
        submittedAt: latestContract.submittedAt,
        returnedAt: latestContract.returnedAt,
        approvedAt: latestContract.approvedAt,
      })
    : null;
  if (contractState === "DRAFT")
    nextAction = action(
      "SUBMIT_CONTRACT",
      "ارسال قرارداد امضاشده برای بررسی",
      "FINANCE_RECORDER",
    );
  else if (contractState === "RETURNED")
    nextAction = action(
      "UPLOAD_CONTRACT",
      "ثبت نسخه اصلاح‌شده قرارداد امضاشده",
      "FINANCE_RECORDER",
    );
  else if (contractState === "SUBMITTED")
    nextAction = latestContract?.uploadedBy === viewerUserId
      ? null
      : action(
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
  const readiness = buildEmploymentActivationReadiness({
    scheduledStartDate: source.scheduledStartDate ? new Date(source.scheduledStartDate) : null,
    identityClearance: source.identityClearance || "NOT_STARTED",
    collateralClearance: source.collateralClearance || "NOT_STARTED",
    contractClearance: source.contractClearance || "NOT_STARTED",
    compensationClearance: source.compensationClearance || "NOT_STARTED",
    payrollParticipation: source.payrollParticipation,
    onboardingTasks: (source.onboardingTasks || []).map((task) => ({
      ...task,
      title: task.title || "وظیفه آماده‌سازی",
      activationBlocker: Boolean(task.activationBlocker),
    })),
    insuranceEnrollment: source.insuranceEnrollment,
  });
  const blockers = readiness.blockers.map((item) => {
    const task = source.onboardingTasks?.find(
      (candidate) => `ONBOARDING_TASK:${candidate.id || candidate.title}` === item.id,
    );
    return blocker(item.id, item.message, task?.ownerAuthority || "HR_MANAGER");
  });
  if (source.employmentRelationship?.status === "ENDED") blockers.push(blocker("EMPLOYMENT_ENDED", "رابطه استخدامی پایان یافته است.", "HR_MANAGER"));
  return {
    complete,
    requiredComplete: complete ? 1 : 0,
    requiredTotal: 1,
    blockers,
    action: blockers.length === 0
      ? action("ACTIVATE_EMPLOYMENT", "فعال‌سازی رابطه استخدامی", "HR_MANAGER")
      : null,
    secondaryActions: [],
  };
};

export const projectHiringLifecycle = (
  source: HiringLifecycleSource,
  viewerAuthorities: Iterable<string> = [],
  viewerUserId?: string,
  viewerActionPermissions: Iterable<string> = [],
): HiringLifecycleProjection => {
  const authorities = new Set(viewerAuthorities);
  const actionPermissions = new Set(viewerActionPermissions);
  const gates = [
    applicationGate(source),
    initialHrReviewGate(source),
    formalAssessmentGate(source),
    companyEvaluationPlanGate(source),
    identityGate(source),
    offerGate(source),
    conversionGate(source),
    onboardingGate(source, viewerUserId),
    activationGate(source),
  ];
  const terminal = Boolean(source.outcome && source.outcome !== "HIRED");
  const firstIncomplete = gates.findIndex((gate) => !gate.complete);
  const effectiveIndex =
    firstIncomplete === -1 ? gates.length - 1 : firstIncomplete;

  const projectedPhases = HIRING_LIFECYCLE_PHASES.map(
    (phase, index): HiringLifecyclePhase => {
      const gate = gates[index];
      let status: HiringLifecycleStatus;
      if (gate.complete) status = "COMPLETED";
      else if (source.disposition && index === effectiveIndex) status = "PAUSED";
      else if (terminal && index >= effectiveIndex) status = "ENDED";
      else if (index > effectiveIndex) status = "UPCOMING";
      else if (gate.blockers.length) status = "BLOCKED";
      else if (
        [gate.action, ...gate.secondaryActions].some((candidate) =>
          canPerform(authorities, actionPermissions, candidate),
        )
      )
        status = "ACTION_REQUIRED";
      else status = "WAITING";

      const isFocused = index === effectiveIndex && !terminal;
      const actionableEvidenceGap = gate.blockers.every((item) =>
        item.code.startsWith("FORMAL_ASSESSMENT_RESULT_MISSING:"),
      );
      const actionable = isFocused && (gate.blockers.length === 0 || actionableEvidenceGap) && !source.disposition;
      const permittedActions = actionable
        ? [gate.action, ...gate.secondaryActions].filter(
            (candidate): candidate is HiringLifecycleAction =>
              canPerform(authorities, actionPermissions, candidate),
          )
        : [];
      const primaryAction = permittedActions[0] || null;
      const secondaryActions = permittedActions.slice(1);
      const guidance: Record<HiringLifecycleStatus, string> = {
        COMPLETED: "الزامات این مرحله تکمیل شده است.",
        ACTION_REQUIRED: "این مرحله به اقدام شما نیاز دارد.",
        WAITING: "ادامه این مرحله در انتظار اقدام متقاضی یا واحد مسئول است.",
        BLOCKED: "برای ادامه، مانع ثبت‌شده باید برطرف شود.",
        PAUSED: "پرونده با حفظ مرحله و شواهد متوقف شده است.",
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

  const activeAssessmentPlan = [...(source.formalAssessmentPlans || [])]
    .sort((left, right) => right.version - left.version)
    .find((plan) => plan.status === "ACTIVE");
  const assessmentExecutionMethod = activeAssessmentPlan?.executionMethod
    || activeAssessmentPlan?.selections?.find((selection) => selection.selected)?.executionMethod
    || null;
  const hidesFormalAssessmentPhase = Boolean(
    activeAssessmentPlan
    && (activeAssessmentPlan.explicitlyNoAssessment || assessmentExecutionMethod === "APPLICANT")
    && gates[2].complete,
  );
  const phases = projectedPhases
    .filter((phase) => !hidesFormalAssessmentPhase || phase.id !== "FORMAL_ASSESSMENTS")
    .map((phase, index) => ({ ...phase, number: index + 1 }));
  const currentPhaseId = HIRING_LIFECYCLE_PHASES[effectiveIndex].id;
  const currentPhase = phases.find((phase) => phase.id === currentPhaseId) || phases[0];

  return {
    currentPhaseId: currentPhase.id,
    currentPhaseNumber: currentPhase.number,
    totalPhases: phases.length,
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
) => {
  const latestDecisionMap = latestDecisionsByKind(source.hiringDecisions || []);
  return ({
  id: source.id,
  stage: source.stage,
  outcome: source.outcome || null,
  disposition: source.disposition || null,
  dispositionReason: source.dispositionReason || null,
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
    job: source.position.job || null,
  },
  decisions: ["HR_INTERVIEW", "HR_PRELIMINARY_APPROVAL", "COMPANY_APPROVAL"].reduce(
    (result, kind) => {
      const latest = latestDecisionMap.get(kind);
      result[kind] = latest || null;
      return result;
    },
    {} as Record<string, HiringDecisionLike | null>,
  ),
  decisionHistory: ["HR_INTERVIEW", "HR_PRELIMINARY_APPROVAL", "COMPANY_APPROVAL"].reduce(
    (result, kind) => {
      result[kind] = (source.hiringDecisions || [])
        .filter((decision) => decision.kind === kind)
        .sort((left, right) => (right.version || 0) - (left.version || 0));
      return result;
    },
    {} as Record<string, HiringDecisionLike[]>,
  ),
  decisionDetailsVisible: Boolean(source.decisionDetailsVisible),
  lifecycleSummary,
  });
};
