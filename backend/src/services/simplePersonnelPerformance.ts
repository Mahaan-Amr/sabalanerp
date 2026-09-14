import {
  calculateSellerPerformance,
  SELLER_PERFORMANCE_LEVEL_LABELS,
  type SellerPerformanceLevelCode,
} from './sellerPerformancePolicy';

export type SimplePerformanceDirection = 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER' | 'CAPPED_RATE';
export type SimplePerformanceLevel = SellerPerformanceLevelCode;
export type SimpleEvaluatorAuthority = 'SUPERVISOR' | 'HR_PROCESSOR' | 'HR_MANAGER';

export type SimplePerformanceInput = {
  indicatorId: string;
  direction: SimplePerformanceDirection;
  target: string;
  actual: string | null;
  weightPercent: string;
};

export const calculateSimplePerformance = (inputs: SimplePerformanceInput[]) => {
  if (inputs.some(({ actual }) => actual === null || actual.trim() === '')) throw new Error('همه مقدارها را وارد کنید.');
  const result = calculateSellerPerformance(inputs.map((input) => ({
    factorCode: input.indicatorId,
    direction: input.direction,
    target: input.target,
    actual: input.actual!,
    weightPercent: input.weightPercent,
  })));
  return {
    score: result.score,
    level: result.levelCode,
    indicators: result.factors.map(({ factorCode, score }) => ({ indicatorId: factorCode, score })),
  };
};

export const canEvaluatePersonnel = (input: {
  hasEvaluateAll: boolean;
  hasEvaluateDirectReports: boolean;
  hasEnterEvidence?: boolean;
  isResponsibleSupervisor: boolean;
  isSelf?: boolean;
}): SimpleEvaluatorAuthority | null => {
  if (input.isSelf) return null;
  if (input.hasEvaluateAll) return 'HR_MANAGER';
  if (input.hasEnterEvidence) return 'HR_PROCESSOR';
  if (input.hasEvaluateDirectReports && input.isResponsibleSupervisor) return 'SUPERVISOR';
  return null;
};

const dateInTehran = (date: Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);
export const validateSimpleEvaluationDate = (value: string, now = new Date()): { valid: boolean; message?: string } => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(value)) {
    return { valid: false, message: 'تاریخ ارزیابی معتبر نیست.' };
  }
  const today = dateInTehran(now);
  if (value > today) return { valid: false, message: 'تاریخ آینده مجاز نیست.' };
  return { valid: true };
};

export const SIMPLE_PERFORMANCE_LEVEL_LABELS = SELLER_PERFORMANCE_LEVEL_LABELS;
