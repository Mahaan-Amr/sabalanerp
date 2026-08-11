const types = new Set(['MANAGEMENT_INTERVIEW', 'HR_MANAGER_INTERVIEW', 'DEPARTMENT_SUPERVISOR_INTERVIEW', 'THERAPIST_CONSULTATION', 'OTHER']);
const evidencePolicies = new Set(['EXPLANATION_REQUIRED', 'FILE_REQUIRED', 'FILE_OPTIONAL', 'NO_FILE']);
const effects = new Set(['POSITIVE', 'NEUTRAL', 'NEGATIVE']);

export const nextEvaluationOccurrenceNumber = (existingNumbers: number[]) => (
  existingNumbers.length ? Math.max(...existingNumbers) + 1 : 1
);

export const normalizeCompanyEvaluationPlanItem = (input: any) => {
  const type = String(input.type || '').toUpperCase();
  const evidencePolicy = String(input.evidencePolicy || '').toUpperCase();
  const subject = String(input.subject || '').trim() || null;
  const instructions = String(input.instructions || '').trim() || null;
  if (!types.has(type)) throw new Error('Unsupported company evaluation type.');
  if (!evidencePolicies.has(evidencePolicy)) throw new Error('Unsupported evidence policy.');
  if (type === 'OTHER' && (!subject || !instructions)) throw new Error('OTHER evaluation requires subject and instructions.');
  return { type, subject, instructions, evidencePolicy };
};

export const validateCompanyEvaluationResult = (input: {
  evidencePolicy: string;
  effect: string;
  explanation?: string | null;
  hasFile: boolean;
}) => {
  if (!effects.has(input.effect)) throw new Error('Unsupported evaluation effect.');
  if (input.evidencePolicy === 'EXPLANATION_REQUIRED' && !String(input.explanation || '').trim()) throw new Error('Evaluation explanation is required.');
  if (input.evidencePolicy === 'FILE_REQUIRED' && !input.hasFile) throw new Error('Evaluation evidence file is required.');
  if (input.evidencePolicy === 'NO_FILE' && input.hasFile) throw new Error('This evaluation policy does not allow a file.');
};
