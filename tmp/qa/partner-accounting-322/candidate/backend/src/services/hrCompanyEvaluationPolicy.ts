const types = new Set(['MANAGEMENT_INTERVIEW', 'HR_MANAGER_INTERVIEW', 'DEPARTMENT_SUPERVISOR_INTERVIEW', 'THERAPIST_CONSULTATION', 'OTHER']);
const evidencePolicies = new Set(['EXPLANATION_REQUIRED', 'FILE_REQUIRED', 'FILE_OPTIONAL', 'NO_FILE']);
const effects = new Set(['POSITIVE', 'NEUTRAL', 'NEGATIVE']);
const scorePolicies = new Set(['REQUIRED', 'OPTIONAL', 'NONE']);
const internalTypes = new Set(['MANAGEMENT_INTERVIEW', 'HR_MANAGER_INTERVIEW', 'DEPARTMENT_SUPERVISOR_INTERVIEW', 'OTHER']);

const text = (value: unknown) => String(value ?? '').trim() || null;
const dateOnly = (value: unknown, label: string) => {
  const raw = text(value);
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error(`${label} must be a date-only value.`);
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) throw new Error(`${label} is invalid.`);
  return parsed;
};

const dayKey = (value: Date) => value.toISOString().slice(0, 10);
const tehranDayKey = (value: Date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};

const localizedInteger = (value: unknown) => String(value ?? '')
  .trim()
  .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));

const optionalPhone = (value: unknown) => {
  const raw = text(value);
  if (!raw) return null;
  const normalized = localizedInteger(raw).replace(/[\s\-()]/g, '');
  if (!/^\d+$/.test(normalized)) throw new Error('External provider phone must contain digits only.');
  return normalized;
};

export const nextEvaluationOccurrenceNumber = (existingNumbers: number[]) => (
  existingNumbers.length ? Math.max(...existingNumbers) + 1 : 1
);

export const normalizeCompanyEvaluationPlanItem = (input: any, today = new Date()) => {
  const type = String(input.type || '').toUpperCase();
  const evidencePolicy = String(input.evidencePolicy || '').toUpperCase();
  const subject = text(input.subject);
  const instructions = text(input.instructions);
  if (!types.has(type)) throw new Error('Unsupported company evaluation type.');
  if (!evidencePolicies.has(evidencePolicy)) throw new Error('Unsupported evidence policy.');
  if (type === 'OTHER' && (!subject || !instructions)) throw new Error('OTHER evaluation requires subject and instructions.');
  const evaluatorPersonnelId = text(input.evaluatorPersonnelId);
  const externalProviderName = text(input.externalProviderName);
  if (internalTypes.has(type) && !evaluatorPersonnelId) throw new Error('Internal evaluation requires accountable Personnel.');
  if (type === 'THERAPIST_CONSULTATION' && !externalProviderName) throw new Error('External evaluation requires a person or center name.');
  const requestedScorePolicy = String(input.scorePolicy || '').toUpperCase();
  const defaultScorePolicy = ['MANAGEMENT_INTERVIEW', 'HR_MANAGER_INTERVIEW', 'DEPARTMENT_SUPERVISOR_INTERVIEW'].includes(type)
    ? 'REQUIRED'
    : 'OPTIONAL';
  const scorePolicy = requestedScorePolicy || defaultScorePolicy;
  if (!scorePolicies.has(scorePolicy)) throw new Error('Unsupported score policy.');
  const plannedAt = dateOnly(input.plannedAt, 'Planned date');
  const reportDueAt = dateOnly(input.reportDueAt, 'Report deadline');
  if (plannedAt && dayKey(plannedAt) < tehranDayKey(today)) throw new Error('Planned date cannot be in the past.');
  if (plannedAt && reportDueAt && reportDueAt < plannedAt) throw new Error('Report deadline cannot be before the planned date.');
  return {
    type, subject, instructions, evidencePolicy, evaluatorPersonnelId,
    externalProviderName, externalProviderType: text(input.externalProviderType),
    externalProviderPhone: optionalPhone(input.externalProviderPhone), externalProviderNote: text(input.externalProviderNote),
    scorePolicy, plannedAt, reportDueAt,
  };
};

export const validateCompanyEvaluationResult = (input: {
  evidencePolicy: string;
  scorePolicy?: string | null;
  score?: unknown;
  effect: string;
  explanation?: string | null;
  hasFile: boolean;
}) => {
  if (!effects.has(input.effect)) throw new Error('Unsupported evaluation effect.');
  if (input.evidencePolicy === 'EXPLANATION_REQUIRED' && !String(input.explanation || '').trim()) throw new Error('Evaluation explanation is required.');
  if (input.evidencePolicy === 'FILE_REQUIRED' && !input.hasFile) throw new Error('Evaluation evidence file is required.');
  if (input.evidencePolicy === 'NO_FILE' && input.hasFile) throw new Error('This evaluation policy does not allow a file.');
  const scorePolicy = input.scorePolicy || 'NONE';
  if (!scorePolicies.has(scorePolicy)) throw new Error('Unsupported score policy.');
  const rawScore = localizedInteger(input.score);
  if (scorePolicy === 'REQUIRED' && !rawScore) throw new Error('Evaluation score is required.');
  if (scorePolicy === 'NONE' && rawScore) throw new Error('This evaluation policy does not allow a score.');
  if (rawScore && !/^[1-5]$/.test(rawScore)) throw new Error('Evaluation score must be a whole number from 1 through 5.');
  return { score: rawScore ? Number(rawScore) : null };
};
