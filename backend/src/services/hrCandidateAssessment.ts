const SCORE_MIN = 0;
const SCORE_MAX = 100;

type AssessmentType = 'DISC' | 'BIG_FIVE' | 'EQ' | 'OTHER';
type ResultRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is ResultRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const requiredScore = (result: ResultRecord, key: string, label: string) => {
  const value = result[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < SCORE_MIN || value > SCORE_MAX) {
    throw new Error(`امتیاز «${label}» باید عددی بین ۰ تا ۱۰۰ باشد.`);
  }
  return value;
};

const requiredText = (result: ResultRecord, key: string, label: string) => {
  const value = typeof result[key] === 'string' ? result[key].trim() : '';
  if (!value) throw new Error(`${label} الزامی است.`);
  return value;
};

const optionalNotes = (result: ResultRecord) => {
  const notes = typeof result.notes === 'string' ? result.notes.trim() : '';
  return notes ? { notes } : {};
};

export const normalizeCandidateAssessmentResult = (assessmentType: string, value: unknown) => {
  if (!['DISC', 'BIG_FIVE', 'EQ', 'OTHER'].includes(assessmentType)) {
    throw new Error('نوع ارزیابی معتبر نیست.');
  }
  if (!isRecord(value)) throw new Error('نتیجه ارزیابی الزامی است.');

  switch (assessmentType as AssessmentType) {
    case 'DISC':
      return {
        dominance: requiredScore(value, 'dominance', 'تسلط‌گرایی (D)'),
        influence: requiredScore(value, 'influence', 'تأثیرگذاری (I)'),
        steadiness: requiredScore(value, 'steadiness', 'ثبات (S)'),
        conscientiousness: requiredScore(value, 'conscientiousness', 'وظیفه‌شناسی (C)'),
        ...optionalNotes(value),
      };
    case 'BIG_FIVE':
      return {
        openness: requiredScore(value, 'openness', 'پذیرش تجربه‌های جدید'),
        conscientiousness: requiredScore(value, 'conscientiousness', 'وظیفه‌شناسی'),
        extraversion: requiredScore(value, 'extraversion', 'برون‌گرایی'),
        agreeableness: requiredScore(value, 'agreeableness', 'توافق‌پذیری'),
        neuroticism: requiredScore(value, 'neuroticism', 'روان‌رنجوری'),
        ...optionalNotes(value),
      };
    case 'EQ':
      return {
        score: requiredScore(value, 'score', 'هوش هیجانی'),
        ...optionalNotes(value),
      };
    case 'OTHER':
      return {
        title: requiredText(value, 'title', 'عنوان ارزیابی'),
        result: requiredText(value, 'result', 'نتیجه ارزیابی'),
        ...optionalNotes(value),
      };
  }
};
