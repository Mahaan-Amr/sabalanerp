import { Prisma, type PrismaClient } from '@prisma/client';
import { aggregateBehaviorSurveyScores, sellerPerformancePeriodFor } from './sellerPerformancePolicy';

type Client = PrismaClient | Prisma.TransactionClient;

const runTransaction = <T>(client: Client, work: (tx: Prisma.TransactionClient) => Promise<T>) => (
  '$transaction' in client ? (client as PrismaClient).$transaction(work) : work(client as Prisma.TransactionClient)
);

const surveyError = (message: string, code: string, status = 422) => Object.assign(new Error(message), { code, status });

export const BEHAVIOR_SURVEY_SECTION_CODES = [
  'RESPECT', 'TEAMWORK', 'ACCOUNTABILITY', 'COMMUNICATION', 'LEARNING', 'WORKPLACE_STANDARD',
] as const;
export const BEHAVIOR_SURVEY_OPTIONS = [
  { code: 'STRONGLY_DISAGREE', labelFa: 'کاملاً مخالفم', score: 0 },
  { code: 'DISAGREE', labelFa: 'مخالفم', score: 25 },
  { code: 'NEUTRAL', labelFa: 'نه موافقم نه مخالف', score: 50 },
  { code: 'AGREE', labelFa: 'موافقم', score: 75 },
  { code: 'STRONGLY_AGREE', labelFa: 'کاملاً موافقم', score: 100 },
  { code: 'INSUFFICIENT_INFORMATION', labelFa: 'اطلاعات کافی برای ارزیابی ندارم', score: null },
] as const;

type SurveyQuestionInput = { sectionCode: string; promptFa: string };
type SurveyDraftInput = {
  actorUserId: string;
  titleFa: string;
  periodKey: string;
  questions: SurveyQuestionInput[];
  targetPersonnelIds: string[];
  respondentPersonnelIds: string[];
};

const normalizedDraft = (input: SurveyDraftInput) => {
  const titleFa = input.titleFa?.trim();
  if (!titleFa) throw surveyError('عنوان نظرسنجی را وارد کنید.', 'SURVEY_TITLE_REQUIRED');
  if (!/^\d{4}-H[12]$/.test(input.periodKey)) throw surveyError('دوره نظرسنجی معتبر نیست.', 'SURVEY_PERIOD_INVALID');
  if (!Array.isArray(input.questions) || !input.questions.length) throw surveyError('حداقل یک پرسش لازم است.', 'SURVEY_QUESTION_REQUIRED');
  const questions = input.questions.map((question) => ({
    sectionCode: question.sectionCode,
    promptFa: question.promptFa?.trim(),
  }));
  if (questions.some(({ sectionCode, promptFa }) => (
    !BEHAVIOR_SURVEY_SECTION_CODES.includes(sectionCode as typeof BEHAVIOR_SURVEY_SECTION_CODES[number]) || !promptFa
  ))) throw surveyError('بخش یا متن پرسش معتبر نیست.', 'SURVEY_QUESTION_INVALID');
  const coveredSections = new Set(questions.map(({ sectionCode }) => sectionCode));
  if (BEHAVIOR_SURVEY_SECTION_CODES.some((code) => !coveredSections.has(code))) {
    throw surveyError('هر شش بخش رفتاری باید حداقل یک پرسش داشته باشد.', 'SURVEY_SECTION_REQUIRED');
  }
  const targetPersonnelIds = [...new Set(input.targetPersonnelIds?.map((id) => id.trim()).filter(Boolean) ?? [])];
  const respondentPersonnelIds = [...new Set(input.respondentPersonnelIds?.map((id) => id.trim()).filter(Boolean) ?? [])];
  if (!targetPersonnelIds.length || !respondentPersonnelIds.length) {
    throw surveyError('حداقل یک ارزیابی‌شونده و یک پاسخ‌دهنده انتخاب کنید.', 'SURVEY_AUDIENCE_REQUIRED');
  }
  return { titleFa, periodKey: input.periodKey, questions, targetPersonnelIds, respondentPersonnelIds };
};

const campaignInclude = {
  questions: { orderBy: { sortOrder: 'asc' as const } },
  targets: { orderBy: { personnelId: 'asc' as const } },
  respondents: { orderBy: { personnelId: 'asc' as const } },
} as const;

export const createBehaviorSurveyDraft = (client: Client, input: SurveyDraftInput) => {
  const draft = normalizedDraft(input);
  return runTransaction(client, async (tx) => {
    const activePersonnel = await tx.personnel.count({
      where: { id: { in: [...new Set([...draft.targetPersonnelIds, ...draft.respondentPersonnelIds])] }, isActive: true, archivedAt: null },
    });
    if (activePersonnel !== new Set([...draft.targetPersonnelIds, ...draft.respondentPersonnelIds]).size) {
      throw surveyError('همه افراد انتخاب‌شده باید پرسنل فعال باشند.', 'SURVEY_AUDIENCE_INVALID');
    }
    const campaign = await tx.personnelBehaviorSurveyCampaign.create({ data: {
      titleFa: draft.titleFa, periodKey: draft.periodKey, createdByUserId: input.actorUserId,
      questions: { create: draft.questions.map((question, index) => ({ ...question, sortOrder: index + 1 })) },
      targets: { create: draft.targetPersonnelIds.map((personnelId) => ({ personnelId })) },
      respondents: { create: draft.respondentPersonnelIds.map((personnelId) => ({ personnelId })) },
    }, include: campaignInclude });
    await tx.personnelBehaviorSurveyAudit.create({ data: {
      campaignId: campaign.id, actorUserId: input.actorUserId, eventType: 'DRAFT_CREATED',
      details: { questionCount: draft.questions.length, targetCount: draft.targetPersonnelIds.length, respondentCount: draft.respondentPersonnelIds.length },
    } });
    return campaign;
  });
};

export const updateBehaviorSurveyDraft = (client: Client, input: SurveyDraftInput & { campaignId: string }) => {
  const draft = normalizedDraft(input);
  return runTransaction(client, async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "personnel_behavior_survey_campaigns" WHERE "id" = ${input.campaignId} FOR UPDATE`;
    const campaign = await tx.personnelBehaviorSurveyCampaign.findUnique({ where: { id: input.campaignId } });
    if (!campaign) throw surveyError('نظرسنجی پیدا نشد.', 'SURVEY_NOT_FOUND', 404);
    if (campaign.status !== 'DRAFT') throw surveyError('نسخه فعال نظرسنجی قابل ویرایش نیست.', 'SURVEY_VERSION_LOCKED', 409);
    await tx.personnelBehaviorSurveyQuestion.deleteMany({ where: { campaignId: campaign.id } });
    await tx.personnelBehaviorSurveyTarget.deleteMany({ where: { campaignId: campaign.id } });
    await tx.personnelBehaviorSurveyRespondent.deleteMany({ where: { campaignId: campaign.id } });
    const updated = await tx.personnelBehaviorSurveyCampaign.update({ where: { id: campaign.id }, data: {
      titleFa: draft.titleFa, periodKey: draft.periodKey, version: { increment: 1 },
      questions: { create: draft.questions.map((question, index) => ({ ...question, sortOrder: index + 1 })) },
      targets: { create: draft.targetPersonnelIds.map((personnelId) => ({ personnelId })) },
      respondents: { create: draft.respondentPersonnelIds.map((personnelId) => ({ personnelId })) },
    }, include: campaignInclude });
    await tx.personnelBehaviorSurveyAudit.create({ data: {
      campaignId: campaign.id, actorUserId: input.actorUserId, eventType: 'DRAFT_UPDATED', details: { version: updated.version },
    } });
    return updated;
  });
};

export const activateBehaviorSurvey = (client: Client, input: {
  campaignId: string; actorUserId: string; opensAt: Date; closesAt: Date;
}) => runTransaction(client, async (tx) => {
  if (!(input.opensAt instanceof Date) || Number.isNaN(input.opensAt.getTime())
    || !(input.closesAt instanceof Date) || Number.isNaN(input.closesAt.getTime()) || input.closesAt <= input.opensAt) {
    throw surveyError('زمان شروع و پایان نظرسنجی معتبر نیست.', 'SURVEY_WINDOW_INVALID');
  }
  await tx.$queryRaw`SELECT "id" FROM "personnel_behavior_survey_campaigns" WHERE "id" = ${input.campaignId} FOR UPDATE`;
  const campaign = await tx.personnelBehaviorSurveyCampaign.findUnique({ where: { id: input.campaignId }, include: campaignInclude });
  if (!campaign) throw surveyError('نظرسنجی پیدا نشد.', 'SURVEY_NOT_FOUND', 404);
  if (campaign.status !== 'DRAFT') throw surveyError('نظرسنجی قبلاً فعال شده است.', 'SURVEY_VERSION_LOCKED', 409);
  const opensPeriodKey = sellerPerformancePeriodFor(input.opensAt).key;
  const closesPeriodKey = sellerPerformancePeriodFor(new Date(input.closesAt.getTime() - 1)).key;
  if (opensPeriodKey !== campaign.periodKey || closesPeriodKey !== campaign.periodKey) {
    throw surveyError('بازه نظرسنجی باید به‌طور کامل داخل دوره انتخاب‌شده باشد.', 'SURVEY_PERIOD_WINDOW_MISMATCH');
  }
  const updated = await tx.personnelBehaviorSurveyCampaign.update({ where: { id: campaign.id }, data: {
    status: 'ACTIVE', opensAt: input.opensAt, closesAt: input.closesAt,
    activatedAt: new Date(), activatedByUserId: input.actorUserId,
  }, include: campaignInclude });
  await tx.personnelBehaviorSurveyAudit.create({ data: {
    campaignId: campaign.id, actorUserId: input.actorUserId, eventType: 'ACTIVATED',
    details: { opensAt: input.opensAt.toISOString(), closesAt: input.closesAt.toISOString(), version: campaign.version },
  } });
  return updated;
});

export const listBehaviorSurveyCampaigns = (client: Client) => client.personnelBehaviorSurveyCampaign.findMany({
  include: campaignInclude, orderBy: [{ createdAt: 'desc' }],
});

export const deleteBehaviorSurveyDraft = (client: Client, input: { campaignId: string; actorUserId: string }) => runTransaction(client, async (tx) => {
  await tx.$queryRaw`SELECT "id" FROM "personnel_behavior_survey_campaigns" WHERE "id" = ${input.campaignId} FOR UPDATE`;
  const campaign = await tx.personnelBehaviorSurveyCampaign.findUnique({ where: { id: input.campaignId } });
  if (!campaign) throw surveyError('نظرسنجی پیدا نشد.', 'SURVEY_NOT_FOUND', 404);
  if (campaign.status !== 'DRAFT') throw surveyError('فقط پیش‌نویس نظرسنجی قابل حذف است.', 'SURVEY_VERSION_LOCKED', 409);
  await tx.personnelBehaviorSurveyAudit.create({ data: {
    campaignId: campaign.id, actorUserId: input.actorUserId, eventType: 'DRAFT_DELETED',
    details: { titleFa: campaign.titleFa, periodKey: campaign.periodKey, version: campaign.version },
  } });
  await tx.personnelBehaviorSurveyCampaign.delete({ where: { id: campaign.id } });
  return { id: campaign.id };
});

const actorPersonnelId = async (client: Client, actorUserId: string) => (
  await client.user.findUnique({ where: { id: actorUserId }, select: { personnelId: true } })
)?.personnelId ?? null;

export const listAssignedBehaviorSurveys = async (client: Client, actorUserId: string, now = new Date()) => {
  const personnelId = await actorPersonnelId(client, actorUserId);
  if (!personnelId) return [];
  const campaigns = await client.personnelBehaviorSurveyCampaign.findMany({
    where: {
      status: 'ACTIVE', opensAt: { lte: now }, closesAt: { gt: now },
      respondents: { some: { personnelId } }, targets: { some: { personnelId: { not: personnelId } } },
    },
    include: {
      questions: { orderBy: { sortOrder: 'asc' } },
      targets: { where: { personnelId: { not: personnelId } }, orderBy: { personnelId: 'asc' } },
      responses: { where: { respondentPersonnelId: personnelId }, include: { answers: true } },
    },
    orderBy: [{ closesAt: 'asc' }],
  });
  const targetIds = [...new Set(campaigns.flatMap(({ targets }) => targets.map(({ personnelId: id }) => id)))];
  const personnel = await client.personnel.findMany({
    where: { id: { in: targetIds } }, select: { id: true, firstName: true, lastName: true, employeeNumber: true },
  });
  const names = new Map(personnel.map((person) => [person.id, person]));
  return campaigns.map((campaign) => ({
    ...campaign,
    targets: campaign.targets.map((target) => ({ ...target, personnel: names.get(target.personnelId) ?? null })),
  }));
};

const optionScore = new Map<string, number | null>(BEHAVIOR_SURVEY_OPTIONS.map(({ code, score }) => [code, score]));

export const saveBehaviorSurveyResponse = (client: Client, input: {
  campaignId: string;
  targetPersonnelId: string;
  actorUserId: string;
  submit: boolean;
  commentText?: string;
  answers: Array<{ questionId: string; optionCode: string }>;
  now?: Date;
}) => runTransaction(client, async (tx) => {
  const now = input.now ?? new Date();
  const respondentPersonnelId = await actorPersonnelId(tx, input.actorUserId);
  if (!respondentPersonnelId) throw surveyError('حساب کاربری به پرسنل متصل نیست.', 'SURVEY_PERSONNEL_REQUIRED', 403);
  if (respondentPersonnelId === input.targetPersonnelId) throw surveyError('خودارزیابی مجاز نیست.', 'SURVEY_SELF_RESPONSE_FORBIDDEN', 403);
  const campaign = await tx.personnelBehaviorSurveyCampaign.findUnique({ where: { id: input.campaignId }, include: campaignInclude });
  if (!campaign) throw surveyError('نظرسنجی پیدا نشد.', 'SURVEY_NOT_FOUND', 404);
  if (campaign.status !== 'ACTIVE' || !campaign.opensAt || !campaign.closesAt || campaign.opensAt > now || campaign.closesAt <= now) {
    throw surveyError('نظرسنجی در این زمان باز نیست.', 'SURVEY_NOT_OPEN', 409);
  }
  if (!campaign.respondents.some(({ personnelId }) => personnelId === respondentPersonnelId)
    || !campaign.targets.some(({ personnelId }) => personnelId === input.targetPersonnelId)) {
    throw surveyError('این پاسخ‌دهنده یا ارزیابی‌شونده در نظرسنجی انتخاب نشده است.', 'SURVEY_SCOPE_FORBIDDEN', 403);
  }
  const allowedQuestions = new Set(campaign.questions.map(({ id }) => id));
  const answers = new Map<string, string>();
  for (const answer of input.answers ?? []) {
    if (!allowedQuestions.has(answer.questionId) || answers.has(answer.questionId) || !optionScore.has(answer.optionCode)) {
      throw surveyError('پاسخ نظرسنجی معتبر نیست.', 'SURVEY_ANSWER_INVALID');
    }
    answers.set(answer.questionId, answer.optionCode);
  }
  if (input.submit && answers.size !== campaign.questions.length) {
    throw surveyError('برای ثبت نهایی، همه پرسش‌ها را پاسخ دهید.', 'SURVEY_ANSWER_INCOMPLETE');
  }
  const commentText = input.commentText?.trim() || null;
  if (commentText && commentText.length > 4000) throw surveyError('متن توضیح بیش از حد مجاز است.', 'SURVEY_COMMENT_TOO_LONG');
  const previous = await tx.personnelBehaviorSurveyResponse.findUnique({
    where: { campaignId_targetPersonnelId_respondentPersonnelId: {
      campaignId: campaign.id, targetPersonnelId: input.targetPersonnelId, respondentPersonnelId,
    } }, include: { answers: true },
  });
  if (previous) {
    await tx.personnelBehaviorSurveyResponseRevision.createMany({ data: [{
      responseId: previous.id, version: previous.version, status: previous.status,
      commentText: previous.commentText,
      answers: previous.answers.map(({ questionId, optionCode, numericScore }) => ({ questionId, optionCode, numericScore })),
      actorUserId: input.actorUserId,
    }], skipDuplicates: true });
  }
  const response = previous
    ? await tx.personnelBehaviorSurveyResponse.update({ where: { id: previous.id }, data: {
      status: input.submit ? 'FINAL' : 'DRAFT', version: { increment: 1 }, commentText,
      submittedAt: input.submit ? now : previous.submittedAt,
    } })
    : await tx.personnelBehaviorSurveyResponse.create({ data: {
      campaignId: campaign.id, targetPersonnelId: input.targetPersonnelId, respondentPersonnelId,
      status: input.submit ? 'FINAL' : 'DRAFT', commentText, submittedAt: input.submit ? now : null,
    } });
  await tx.personnelBehaviorSurveyAnswer.deleteMany({ where: { responseId: response.id } });
  if (answers.size) await tx.personnelBehaviorSurveyAnswer.createMany({ data: [...answers].map(([questionId, optionCode]) => ({
    responseId: response.id, questionId, optionCode, numericScore: optionScore.get(optionCode) ?? null,
  })) });
  await tx.personnelBehaviorSurveyResponseRevision.create({ data: {
    responseId: response.id, version: response.version, status: response.status, commentText: response.commentText,
    answers: [...answers].map(([questionId, optionCode]) => ({ questionId, optionCode, numericScore: optionScore.get(optionCode) ?? null })),
    actorUserId: input.actorUserId,
  } });
  await tx.personnelBehaviorSurveyAudit.create({ data: {
    campaignId: campaign.id, responseId: response.id, actorUserId: input.actorUserId,
    eventType: input.submit ? 'RESPONSE_SUBMITTED' : 'RESPONSE_DRAFT_SAVED',
    details: { version: response.version, replacedVersion: previous?.version ?? null, previousStatus: previous?.status ?? null },
  } });
  return tx.personnelBehaviorSurveyResponse.findUniqueOrThrow({ where: { id: response.id }, include: { answers: true } });
});

export const aggregateBehaviorSurveyCampaign = async (client: Client, campaignId: string) => {
  const responses = await client.personnelBehaviorSurveyResponse.findMany({
    where: { campaignId, status: 'FINAL' },
    include: { answers: { include: { question: { select: { sectionCode: true } } } } },
  });
  const factorScores = responses.flatMap((response) => {
    const bySection = new Map<string, number[]>();
    for (const answer of response.answers) {
      if (answer.numericScore === null) continue;
      const scores = bySection.get(answer.question.sectionCode) ?? [];
      scores.push(answer.numericScore);
      bySection.set(answer.question.sectionCode, scores);
    }
    return [...bySection].map(([factorCode, scores]) => ({
      respondentPersonnelId: response.respondentPersonnelId,
      targetPersonnelId: response.targetPersonnelId,
      factorCode,
      score: scores.reduce((sum, score) => sum + score, 0) / scores.length,
    }));
  });
  return aggregateBehaviorSurveyScores(factorScores);
};

export const inspectRawBehaviorSurveyResponses = (client: Client, input: {
  campaignId: string; targetPersonnelId: string; actorUserId: string;
}) => runTransaction(client, async (tx) => {
  const inspectorPersonnelId = await actorPersonnelId(tx, input.actorUserId);
  if (inspectorPersonnelId === input.targetPersonnelId) {
    throw surveyError('مشاهده پاسخ خام درباره خودتان مجاز نیست.', 'SURVEY_SELF_INSPECTION_FORBIDDEN', 403);
  }
  const responses = await tx.personnelBehaviorSurveyResponse.findMany({
    where: { campaignId: input.campaignId, targetPersonnelId: input.targetPersonnelId, status: 'FINAL' },
    include: { answers: { include: { question: true } } }, orderBy: { submittedAt: 'asc' },
  });
  await tx.personnelBehaviorSurveyAudit.create({ data: {
    campaignId: input.campaignId, actorUserId: input.actorUserId, eventType: 'RAW_RESPONSES_INSPECTED',
    details: { targetPersonnelId: input.targetPersonnelId, responseCount: responses.length },
  } });
  return responses;
});
