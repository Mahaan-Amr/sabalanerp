import assert from 'node:assert/strict';
import {
  buildPerformanceAnalytics,
  buildPerformanceBadgeSummary,
  buildPerformanceCalibration,
  escapePerformanceSpreadsheetCell,
  escapePerformanceExportHtml,
  validateConsequenceHandoff,
  performanceReportingQuarter,
  performanceReportingMonths,
  performancePeerFamilyKey,
  latestPerformancePeerFamilies,
} from '../personnelPerformanceDisclosure';
import {
  decryptPerformanceExportArtifact,
  encryptPerformanceExportArtifact,
  validatePerformanceExportKeyEnvironment,
  withinPerformanceExportDeadline,
} from '../personnelPerformanceDisclosureStore';

const exportKey = Buffer.alloc(32, 9);
const confidentialArtifact = Buffer.from('personnel,level\nپرسنل محرمانه,مطابق انتظار');
const encryptedArtifact = encryptPerformanceExportArtifact(confidentialArtifact, exportKey);
assert.equal(encryptedArtifact.includes(confidentialArtifact), false, 'export artifact must not remain plaintext at rest');
assert.deepEqual(decryptPerformanceExportArtifact(encryptedArtifact, exportKey), confidentialArtifact);
const tamperedArtifact = Buffer.from(encryptedArtifact);
tamperedArtifact[tamperedArtifact.length - 1] ^= 1;
assert.throws(() => decryptPerformanceExportArtifact(tamperedArtifact, exportKey));
assert.throws(() => validatePerformanceExportKeyEnvironment({
  PERSONNEL_PERFORMANCE_EXPORT_ENCRYPTION_KEY_ID: 'production-export-v1',
  PERSONNEL_PERFORMANCE_EXPORT_ENCRYPTION_KEY_BASE64: Buffer.alloc(16).toString('base64'),
}), /معتبر/);
assert.equal(validatePerformanceExportKeyEnvironment({
  PERSONNEL_PERFORMANCE_EXPORT_ENCRYPTION_KEY_ID: 'production-export-v1',
  PERSONNEL_PERFORMANCE_EXPORT_ENCRYPTION_KEY_BASE64: exportKey.toString('base64'),
}).key.length, 32);
assert.throws(() => validatePerformanceExportKeyEnvironment({
  PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_BASE64: exportKey.toString('base64'),
  PERSONNEL_PERFORMANCE_EXPORT_ENCRYPTION_KEY_ID: 'production-export-v1',
  PERSONNEL_PERFORMANCE_EXPORT_ENCRYPTION_KEY_BASE64: exportKey.toString('base64'),
}), /مستقل/);
let deadlineAborted = false;
const exportDeadlineCheck = assert.rejects(() => withinPerformanceExportDeadline((signal) => new Promise((_resolve) => {
  signal.addEventListener('abort', () => { deadlineAborted = true; }, { once: true });
}), 5), /سقف مجاز/).then(() => assert.equal(deadlineAborted, true));

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

assert.equal(buildPerformanceAnalytics({ population: people, selected: people.slice(0, 10) }).suppressed, true, 'small level cells must not be disclosed even in a ten-person group');
const safePeople = people.map((person) => ({ ...person, levelCode: 'MEETS_EXPECTATIONS' }));
const analytics = buildPerformanceAnalytics({ population: safePeople, selected: safePeople.slice(0, 10) });
assert.equal(analytics.suppressed, false);
assert.ok('levelDistribution' in analytics);
if (!('levelDistribution' in analytics)) throw new Error('aggregate analytics missing');
assert.equal(analytics.eligibleCount, 10);
assert.deepEqual(analytics.levelDistribution.map((row) => row.count), [0, 0, 10, 0, 0]);
assert.equal(analytics.exactScoreStatistics, null, 'mixed/absent exact-score signatures must not manufacture an average');

const differencingAttempt = buildPerformanceAnalytics({ population: people, selected: people.slice(0, 12) });
assert.deepEqual(differencingAttempt, {
  suppressed: true,
  reasonCode: 'COMPLEMENTARY_GROUP_TOO_SMALL',
  messageFa: 'این فیلتر به‌دلیل حفاظت از محرمانگی قابل نمایش نیست.',
});

const named = buildPerformanceAnalytics({ population: people, selected: people.slice(0, 5), mode: 'NAMED_RANKING' });
assert.equal(named.suppressed, false);
assert.ok('peerGroups' in named);
if (!('peerGroups' in named)) throw new Error('named ranking missing');
assert.deepEqual(named.peerGroups[0].groups.map((group) => group.members.length), [1, 1, 1, 1, 1]);
assert.ok(named.peerGroups[0].groups.every((group) => group.members.every((member) => !('exactScore' in member))));
const unrelated = buildPerformanceAnalytics({ population: people, selected: people, mode: 'NAMED_RANKING' });
assert.ok('peerGroups' in unrelated);
if ('peerGroups' in unrelated) assert.deepEqual(unrelated.peerGroups.map(({ peerGroupKey, groups }) => [peerGroupKey, groups.flatMap(({ members }) => members).length]), [['job-family-a', 10], ['job-family-b', 10]]);
const quarter = performanceReportingQuarter(new Date('2026-01-01Z'), new Date('2026-04-01Z'));
assert.deepEqual(performanceReportingMonths(quarter.from, quarter.to), ['2026-03', '2026-02', '2026-01'], 'empty months must exist without evaluation data');
assert.throws(() => performanceReportingQuarter(new Date('2026-02-01Z'), new Date('2026-04-01Z')));
assert.throws(() => performanceReportingQuarter(new Date('2026-01-01Z'), new Date('2026-07-01Z')));
assert.throws(() => performanceReportingQuarter(new Date('2026-01-01Z'), new Date('2026-01-01Z')));
assert.equal(performancePeerFamilyKey('job', []), 'job:job');
assert.equal(performancePeerFamilyKey('job', [{ familyKey: 'a', version: 1 }, { familyKey: 'a', version: 2 }]), 'a:v2');
assert.equal(performancePeerFamilyKey('job', [{ familyKey: 'a', version: 1 }, { familyKey: 'b', version: 1 }]), null);
const effectiveFamilies = latestPerformancePeerFamilies([{ familyKey: 'a', version: 1, jobs: ['job'] }, { familyKey: 'a', version: 2, jobs: [] }]);
assert.equal(performancePeerFamilyKey('job', effectiveFamilies.filter(({ jobs }) => jobs.includes('job'))), 'job:job', 'membership removed by a new version must not survive');
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

void exportDeadlineCheck.then(() => console.log('Personnel performance disclosure policy tests passed.'));
