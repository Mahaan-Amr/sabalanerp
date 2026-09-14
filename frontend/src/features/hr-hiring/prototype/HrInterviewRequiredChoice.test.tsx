import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  PersonalityTestSummaryEditor,
  ProductionInterviewReport,
  RequiredInterviewChoice,
  ScoreControl,
} from './HrInterviewPrototype';
import { createInitialInterviewState } from './interviewPrototypeData';

test('required interview choice presents an unanswered state without a selectable unset option', () => {
  const html = renderToStaticMarkup(
    <RequiredInterviewChoice
      ariaLabel="اثر در تصمیم"
      value={null}
      onChange={() => undefined}
      options={[
        { value: 'POSITIVE', label: 'مثبت' },
        { value: 'NEUTRAL', label: 'خنثی' },
        { value: 'NEGATIVE', label: 'منفی' },
      ]}
    />,
  );

  assert.match(html, /هنوز انتخاب نشده/);
  assert.doesNotMatch(html, />ثبت نشده</);
  assert.doesNotMatch(html, /پاک‌کردن انتخاب/);
  assert.equal((html.match(/aria-pressed="false"/g) || []).length, 3);
});

test('required interview choice offers a secondary clear action after selection', () => {
  const html = renderToStaticMarkup(
    <RequiredInterviewChoice
      ariaLabel="نتیجه مستقل مصاحبه‌گر"
      value="POSITIVE"
      onChange={() => undefined}
      options={[
        { value: 'POSITIVE', label: 'مثبت' },
        { value: 'NEGATIVE', label: 'منفی' },
      ]}
    />,
  );

  assert.match(html, /پاک‌کردن انتخاب/);
  assert.match(html, /aria-pressed="true"/);
  assert.doesNotMatch(html, /هنوز انتخاب نشده/);
});

test('required score distinguishes no answer and supports clearing a real answer', () => {
  const unanswered = renderToStaticMarkup(
    <ScoreControl value={null} onChange={() => undefined} />,
  );
  assert.match(unanswered, /هنوز انتخاب نشده/);
  assert.doesNotMatch(unanswered, /پاک‌کردن انتخاب/);

  const answered = renderToStaticMarkup(
    <ScoreControl value={3} onChange={() => undefined} />,
  );
  assert.match(answered, /پاک‌کردن انتخاب/);
  assert.doesNotMatch(answered, /هنوز انتخاب نشده/);
});

test('personality-test criterion presents one required DISC result and optional BIG FIVE and EQ summaries', () => {
  const answer = createInitialInterviewState().answers.personalityTestSummary;
  const html = renderToStaticMarkup(
    <PersonalityTestSummaryEditor answer={answer} onChange={() => undefined} />,
  );

  assert.match(html, /تیپ شخصیتی DISC/);
  assert.match(html, /متقاضی نتیجه DISC را ارائه نکرد/);
  assert.match(html, /خلاصه نتیجه BIG FIVE \(اختیاری\)/);
  assert.match(html, /خلاصه نتیجه EQ \(اختیاری\)/);
  assert.match(html, /maxLength="100"/);
  assert.equal((html.match(/maxLength="1000"/g) || []).length, 2);
});

test('completed interview report labels personality-test statements as applicant-reported evidence', () => {
  const html = renderToStaticMarkup(
    <ProductionInterviewReport
      version={1}
      payload={{
        schemaVersion: 2,
        criteriaTemplateVersion: 1,
        criteriaSnapshot: [{
          stableId: 'personalityTestSummary',
          title: 'نتایج آزمون‌های DISC، BIG FIVE و EQ',
          answerType: 'PERSONALITY_TEST_SUMMARY',
          isActive: true,
          order: 1,
          allowUnassessed: false,
        }],
        state: {
          answers: {
            personalityTestSummary: {
              ...createInitialInterviewState().answers.personalityTestSummary,
              personalityTestSummary: {
                discResult: 'SC',
                discNotProvided: false,
                bigFiveResult: 'برون‌گرایی بالا',
                eqResult: '',
              },
            },
          },
          decision: 'POSITIVE',
          decisionReason: 'مناسب',
        },
        customCriteria: [],
      }}
    />,
  );

  assert.match(html, /اظهارشده توسط متقاضی/);
  assert.match(html, /SC/);
  assert.match(html, /برون‌گرایی بالا/);
  assert.match(html, /ثبت نشده/);
});
