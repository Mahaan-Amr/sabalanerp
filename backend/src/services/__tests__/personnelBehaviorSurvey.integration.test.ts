import assert from 'node:assert/strict';
import { prisma } from '../../lib/prisma';
import {
  activateBehaviorSurvey,
  aggregateBehaviorSurveyCampaign,
  createBehaviorSurveyDraft,
  deleteBehaviorSurveyDraft,
  inspectRawBehaviorSurveyResponses,
  saveBehaviorSurveyResponse,
  updateBehaviorSurveyDraft,
} from '../personnelBehaviorSurveyStore';

const rollback = Symbol('rollback');
const questions = [
  ['RESPECT', 'رفتار محترمانه دارد.'], ['TEAMWORK', 'همکاری می‌کند.'],
  ['ACCOUNTABILITY', 'تعهد را پیگیری می‌کند.'], ['COMMUNICATION', 'شفاف ارتباط برقرار می‌کند.'],
  ['LEARNING', 'بازخورد را می‌پذیرد.'], ['WORKPLACE_STANDARD', 'استاندارد محیط کار را رعایت می‌کند.'],
].map(([sectionCode, promptFa]) => ({ sectionCode, promptFa }));

const main = async () => {
  try {
    await prisma.$transaction(async (tx) => {
      const target = await tx.personnel.create({ data: { firstName: 'هدف', lastName: 'نظرسنجی' } });
      const people = await Promise.all(['یک', 'دو', 'سه'].map(async (suffix) => {
        const personnel = await tx.personnel.create({ data: { firstName: 'همکار', lastName: suffix } });
        const user = await tx.user.create({ data: {
          username: `survey-peer-${suffix}`, email: `survey-${suffix}@example.invalid`, password: 'not-used',
          firstName: 'همکار', lastName: suffix, personnelId: personnel.id,
        } });
        return { personnel, user };
      }));
      const targetUser = await tx.user.create({ data: {
        username: 'survey-target', email: 'survey-target@example.invalid', password: 'not-used',
        firstName: 'هدف', lastName: 'نظرسنجی', personnelId: target.id,
      } });
      const campaign = await createBehaviorSurveyDraft(tx, {
        actorUserId: people[0].user.id, titleFa: 'نظرسنجی نیم‌سال', periodKey: '1405-H2', questions,
        targetPersonnelIds: [target.id], respondentPersonnelIds: people.map(({ personnel }) => personnel.id),
      });
      const disposableDraft = await createBehaviorSurveyDraft(tx, {
        actorUserId: people[0].user.id, titleFa: 'پیش‌نویس قابل حذف', periodKey: '1405-H2', questions,
        targetPersonnelIds: [target.id], respondentPersonnelIds: people.map(({ personnel }) => personnel.id),
      });
      await deleteBehaviorSurveyDraft(tx, { campaignId: disposableDraft.id, actorUserId: people[0].user.id });
      assert.equal(await tx.personnelBehaviorSurveyCampaign.count({ where: { id: disposableDraft.id } }), 0);
      assert.equal(await tx.personnelBehaviorSurveyAudit.count({ where: { campaignId: disposableDraft.id, eventType: 'DRAFT_DELETED' } }), 1);
      const now = new Date();
      const active = await activateBehaviorSurvey(tx, {
        campaignId: campaign.id, actorUserId: people[0].user.id,
        opensAt: new Date(now.getTime() - 60_000), closesAt: new Date(now.getTime() + 60_000),
      });
      await assert.rejects(updateBehaviorSurveyDraft(tx, {
        campaignId: active.id, actorUserId: people[0].user.id, titleFa: active.titleFa,
        periodKey: active.periodKey, questions, targetPersonnelIds: [target.id],
        respondentPersonnelIds: people.map(({ personnel }) => personnel.id),
      }), (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'SURVEY_VERSION_LOCKED'));

      for (const peer of people) await saveBehaviorSurveyResponse(tx, {
        campaignId: active.id, targetPersonnelId: target.id, actorUserId: peer.user.id, submit: true,
        commentText: 'توضیح محرمانه', now,
        answers: active.questions.map(({ id }) => ({ questionId: id, optionCode: 'AGREE' })),
      });
      await saveBehaviorSurveyResponse(tx, {
        campaignId: active.id, targetPersonnelId: target.id, actorUserId: people[0].user.id, submit: true,
        commentText: 'توضیح محرمانه اصلاح‌شده', now,
        answers: active.questions.map(({ id }) => ({ questionId: id, optionCode: 'STRONGLY_AGREE' })),
      });
      const revisedResponse = await tx.personnelBehaviorSurveyResponse.findUniqueOrThrow({
        where: { campaignId_targetPersonnelId_respondentPersonnelId: {
          campaignId: active.id, targetPersonnelId: target.id, respondentPersonnelId: people[0].personnel.id,
        } }, include: { revisions: { orderBy: { version: 'asc' } } },
      });
      assert.equal(revisedResponse.revisions.length, 2, 'prior answers and comments remain available as immutable versions');
      assert.equal(revisedResponse.revisions[0].commentText, 'توضیح محرمانه');
      const aggregate = await aggregateBehaviorSurveyCampaign(tx, active.id);
      assert.equal(aggregate.length, 6);
      assert.ok(aggregate.every(({ score, respondentCount, sufficient }) => Math.abs(score - (250 / 3)) < 0.001 && respondentCount === 3 && sufficient));

      await assert.rejects(inspectRawBehaviorSurveyResponses(tx, {
        campaignId: active.id, targetPersonnelId: target.id, actorUserId: targetUser.id,
      }), (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'SURVEY_SELF_INSPECTION_FORBIDDEN'));
      const raw = await inspectRawBehaviorSurveyResponses(tx, {
        campaignId: active.id, targetPersonnelId: target.id, actorUserId: people[0].user.id,
      });
      assert.equal(raw.length, 3);
      assert.equal(await tx.personnelBehaviorSurveyAudit.count({ where: {
        campaignId: active.id, eventType: 'RAW_RESPONSES_INSPECTED', actorUserId: people[0].user.id,
      } }), 1);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally { await prisma.$disconnect(); }
  console.log('Personnel behavior survey integration tests passed.');
};

main().catch((error) => { console.error(error); process.exitCode = 1; });
