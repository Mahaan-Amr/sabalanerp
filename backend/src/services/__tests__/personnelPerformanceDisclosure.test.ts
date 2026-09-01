import assert from 'node:assert/strict';
import {
  buildPerformanceAnalytics,
  buildPerformanceBadgeSummary,
  buildPerformanceCalibration,
  escapePerformanceSpreadsheetCell,
  escapePerformanceExportHtml,
  validateConsequenceHandoff,
} from '../personnelPerformanceDisclosure';

const projected = buildPerformanceBadgeSummary({
  state: 'LEVEL',
  levelCode: 'EXCEEDS_EXPECTATIONS',
  newestMeasurementTo: new Date('2026-08-22T20:29:59.999Z'),
  nextReviewAt: new Date('2026-11-21T20:30:00.000Z'),
  version: 7,
});
assert.deepEqual(projected, {
  state: 'LEVEL',
  levelCode: 'EXCEEDS_EXPECTATIONS',
  labelFa: 'فراتر از انتظار',
  meaningFa: 'عملکرد مصوب در مجموع فراتر از انتظارهای نقش بوده است.',
  newestMeasurementTo: '2026-08-22T20:29:59.999Z',
  nextReviewAt: '2026-11-21T20:30:00.000Z',
  version: 7,
});
assert.equal('score' in projected, false, 'Badge disclosure must never include a score');
assert.equal('trend' in projected, false, 'Badge disclosure must never include a trend');
assert.equal(buildPerformanceBadgeSummary({ state: 'TEMPORARILY_UNAVAILABLE', version: 8 }).labelFa, 'خلاصه عملکرد موقتاً در دسترس نیست');

const people = Array.from({ length: 20 }, (_, index) => ({
  subjectId: `subject-${index + 1}`,
  personnelId: `personnel-${index + 1}`,
  displayName: `پرسنل ${index + 1}`,
  employmentRelationshipId: `relationship-${index + 1}`,
  levelCode: ['URGENT_IMPROVEMENT', 'IMPROVEMENT_NEEDED', 'MEETS_EXPECTATIONS', 'EXCEEDS_EXPECTATIONS', 'OUTSTANDING'][index % 5],
  comparabilitySignature: index < 10 ? 'signature-a' : 'signature-b',
  peerGroupKey: index < 10 ? 'job-family-a' : 'job-family-b',
  measurementTo: new Date(`2026-08-${String(index + 1).padStart(2, '0')}T20:29:59.999Z`),
}));

const analytics = buildPerformanceAnalytics({ population: people, selected: people.slice(0, 10) });
assert.equal(analytics.suppressed, false);
assert.ok('levelDistribution' in analytics);
if (!('levelDistribution' in analytics)) throw new Error('aggregate analytics missing');
assert.equal(analytics.eligibleCount, 10);
assert.deepEqual(analytics.levelDistribution.map((row) => row.count), [2, 2, 2, 2, 2]);
assert.equal(analytics.exactScoreStatistics, null, 'mixed/absent exact-score signatures must not manufacture an average');

const differencingAttempt = buildPerformanceAnalytics({ population: people, selected: people.slice(0, 12) });
assert.deepEqual(differencingAttempt, {
  suppressed: true,
  reasonCode: 'COMPLEMENTARY_GROUP_TOO_SMALL',
  messageFa: 'این فیلتر به‌دلیل حفاظت از محرمانگی قابل نمایش نیست.',
});

const named = buildPerformanceAnalytics({ population: people, selected: people.slice(0, 5), mode: 'NAMED_RANKING' });
assert.equal(named.suppressed, false);
assert.ok('groups' in named);
if (!('groups' in named)) throw new Error('named ranking missing');
assert.deepEqual(named.groups.map((group) => group.members.length), [1, 1, 1, 1, 1]);
assert.ok(named.groups.every((group) => group.members.every((member) => !('exactScore' in member))));
assert.equal(buildPerformanceAnalytics({ population: people, selected: people.slice(0, 4), mode: 'NAMED_RANKING' }).suppressed, true);

assert.deepEqual(buildPerformanceCalibration(Array.from({ length: 10 }, (_, index) => ({
  evaluatorPersonnelId: 'evaluator-1',
  subjectId: `subject-${index % 5}`,
  periodKey: index < 5 ? '1405-Q1' : '1405-Q2',
  comparabilitySignature: 'signature-a',
  grade: index % 5 + 1,
}))), {
  sufficient: true,
  acceptedSectionCount: 10,
  distinctPersonnelCount: 5,
  distinctPeriodCount: 2,
  gradeDistribution: [2, 2, 2, 2, 2],
});

for (const unsafe of ['=1+1', '+cmd', '-2+3', '@SUM(A1:A2)', '\tformula', '\rformula']) {
  assert.ok(escapePerformanceSpreadsheetCell(unsafe).startsWith("'"));
}
assert.equal(escapePerformanceSpreadsheetCell('متن امن'), 'متن امن');
assert.equal(escapePerformanceExportHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');

assert.deepEqual(validateConsequenceHandoff({
  consequenceType: 'COMPENSATION_REVIEW',
  resultIds: ['result-1'],
  reasonCategory: 'SUSTAINED_CONTRIBUTION',
  reason: 'بازبینی جبران خدمت بر پایه نتیجه مصوب و شاهد مستقل',
  independentEvidenceReferences: ['evidence-1'],
}), []);
assert.ok(validateConsequenceHandoff({
  consequenceType: 'PERFORMANCE_IMPROVEMENT_REVIEW',
  resultIds: ['result-1'],
  reasonCategory: 'ADVERSE_REVIEW',
  reason: 'بررسی',
  independentEvidenceReferences: [],
}).length >= 2);

console.log('Personnel performance disclosure policy tests passed.');
