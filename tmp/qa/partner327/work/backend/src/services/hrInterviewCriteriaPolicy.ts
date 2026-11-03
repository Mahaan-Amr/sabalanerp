const answerTypes = new Set(['TEXT', 'SCORE_1_TO_5', 'YES_NO', 'ADDRESS', 'STRENGTHS_WEAKNESSES', 'COMPANION']);

const DEFAULT_INTERVIEW_CRITERIA_SOURCE = [
  ['appearance', 'نوع پوشش'], ['grooming', 'آراستگی'], ['resume', 'رزومه'],
  ['address', 'نشانی و تناسب رفت‌وآمد'], ['responsibility', 'مسئولیت‌پذیری'], ['honesty', 'صداقت'],
  ['teamwork', 'روحیه کار تیمی'], ['resilience', 'تاب‌آوری و تحمل فشار'], ['communication', 'مهارت ارتباطی'],
  ['motivation', 'انگیزه شغلی'], ['previousJob', 'علت ترک شغل قبلی'], ['stability', 'ثبات شغلی'],
  ['selfView', 'نقاط قوت و ضعف'], ['workplaceValues', 'ارزش‌های محیط کار مطلوب'],
  ['createdValues', 'ارزش قابل ایجاد برای سازمان'], ['achievement', 'دستاورد شغلی مورد انتظار'],
  ['companion', 'حضور با همراه برای مصاحبه'],
];

const SPECIALIZED_ANSWER_TYPES: Record<string, string> = {
  address: 'ADDRESS',
  motivation: 'TEXT',
  previousJob: 'TEXT',
  selfView: 'STRENGTHS_WEAKNESSES',
  workplaceValues: 'TEXT',
  createdValues: 'TEXT',
  achievement: 'TEXT',
  companion: 'COMPANION',
};

export const DEFAULT_INTERVIEW_CRITERIA = DEFAULT_INTERVIEW_CRITERIA_SOURCE.map(([stableId, title]) => ({
  stableId,
  title,
  description: null,
  answerType: SPECIALIZED_ANSWER_TYPES[stableId] ?? 'SCORE_1_TO_5',
  isActive: true,
  allowUnassessed: true,
}));

export type InterviewCriterionPublicationInput = {
  stableId: string;
  title: string;
  description?: string | null;
  answerType: string;
  isActive?: boolean;
  allowUnassessed?: boolean;
};

export const normalizeInterviewCriteriaPublication = (items: InterviewCriterionPublicationInput[]) => {
  if (!Array.isArray(items) || items.length === 0) throw new Error('At least one interview criterion is required.');
  const stableIds = new Set<string>();
  return items.map((item, index) => {
    const stableId = String(item.stableId || '').trim();
    const title = String(item.title || '').trim();
    const description = String(item.description || '').trim() || null;
    const answerType = String(item.answerType || '').trim().toUpperCase();
    if (!stableId || !title) throw new Error('Criterion stable ID and title are required.');
    if (stableIds.has(stableId)) throw new Error('Criterion stable IDs must be unique.');
    if (!answerTypes.has(answerType)) throw new Error('Unsupported criterion answer type.');
    stableIds.add(stableId);
    return { stableId, title, description, answerType, isActive: item.isActive !== false, allowUnassessed: item.allowUnassessed === true, order: index + 1 };
  });
};
