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

export interface HiringLifecyclePhase {
  id: string;
  number: number;
  title: string;
  status: HiringLifecycleStatus;
  requiredComplete: number;
  requiredTotal: number;
  blockers: Array<{ code: string; label: string }>;
  primaryAction: HiringLifecycleAction | null;
  secondaryActions: HiringLifecycleAction[];
  guidance: string;
  responsibleFunction: string | null;
}

export interface HiringLifecycleProjection {
  currentPhaseId: string;
  currentPhaseNumber: number;
  totalPhases: number;
  terminal: boolean;
  phases: HiringLifecyclePhase[];
}

export interface HiringTaskCapability {
  id: string;
  title: string;
  status: string;
  ownerAuthorities: string[];
  detailVisible: boolean;
  actionIds: string[];
}

export const hiringTaskCapability = (
  tasks: HiringTaskCapability[] | null | undefined,
  id: string,
) => tasks?.find((task) => task.id === id) || null;

export const hiringTaskDetailVisible = (
  tasks: HiringTaskCapability[] | null | undefined,
  id: string,
) => Boolean(hiringTaskCapability(tasks, id)?.detailVisible);

export const hiringLifecycleStatusLabel: Record<HiringLifecycleStatus, string> =
  {
    COMPLETED: "تکمیل‌شده",
    ACTION_REQUIRED: "اقدام شما",
    WAITING: "در انتظار",
    BLOCKED: "مسدود",
    PAUSED: "متوقف‌شده",
    UPCOMING: "پیش رو",
    ENDED: "پایان‌یافته",
  };

export const hiringLifecyclePhaseOptions = [
  ["APPLICATION", "تشکیل پرونده و فرم متقاضی"],
  ["INITIAL_HR_REVIEW", "بررسی اولیه منابع انسانی"],
  ["FORMAL_ASSESSMENTS", "ارزیابی‌های رسمی اختیاری"],
  ["COMPANY_EVALUATION_PLAN", "برنامه ارزیابی مدیریت شرکت"],
  ["IDENTITY", "بررسی و احراز هویت"],
  ["OFFER", "پیشنهاد همکاری و پذیرش"],
  ["CONVERSION", "وثیقه و تبدیل به پرسنل"],
  ["ONBOARDING", "آماده‌سازی شروع همکاری"],
  ["ACTIVATION", "فعال‌سازی همکاری"],
] as const;

export const resolveSelectedHiringPhase = (
  projection: HiringLifecycleProjection,
  requestedPhase: string | null | undefined,
) =>
  projection.phases.some((phase) => phase.id === requestedPhase)
    ? (requestedPhase as string)
    : projection.currentPhaseId;

export const selectedHiringPhase = (
  projection: HiringLifecycleProjection,
  requestedPhase: string | null | undefined,
) => {
  const selectedId = resolveSelectedHiringPhase(projection, requestedPhase);
  return (
    projection.phases.find((phase) => phase.id === selectedId) ||
    projection.phases[0]
  );
};

export const shouldLoadCompanyEvaluationPlan = (
  phaseId: string | null | undefined,
  actionPermissions: readonly string[],
) =>
  phaseId === "COMPANY_EVALUATION_PLAN" &&
  actionPermissions.includes("VIEW_COMPANY_EVALUATION_RESULTS");
