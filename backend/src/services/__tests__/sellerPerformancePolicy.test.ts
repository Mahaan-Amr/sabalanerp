import assert from 'node:assert/strict';
import {
  aggregateBehaviorSurveyScores,
  applySellerPerformanceGates,
  calculateSellerPerformance,
  redistributeSellerFactorWeights,
  SELLER_PERFORMANCE_LEVEL_PRESENTATIONS,
  sellerPerformancePeriodFor,
  sellerPerformancePeriodWindowFor,
} from '../sellerPerformancePolicy';

assert.deepEqual(Object.values(SELLER_PERFORMANCE_LEVEL_PRESENTATIONS).map((level) => [
  level.ordinal, level.labelFa, level.meaningFa, level.stoneFamily, level.romanNumeral,
]), [
  [1, 'همراه', 'با ماست', 'TURQUOISE', 'I'],
  [2, 'هم‌ریشه', 'از ماست', 'TURQUOISE', 'II'],
  [3, 'کارساز', 'به کار ما می‌آید', 'TURQUOISE', 'III'],
  [4, 'مانا', 'با ما می‌ماند', 'RUBY', 'I'],
  [5, 'ستون', 'تکیه‌گاه ماست', 'RUBY', 'II'],
  [6, 'اثرگذار', 'ما را بهتر می‌کند', 'DIAMOND', 'I'],
  [7, 'الگو', 'آن‌گونه که باید باشی', 'DIAMOND', 'II'],
]);
assert.deepEqual(Object.values(SELLER_PERFORMANCE_LEVEL_PRESENTATIONS).map(({ ordinal, romanNumeral }) => [ordinal, romanNumeral]), [
  [1, 'I'], [2, 'II'], [3, 'III'], [4, 'I'], [5, 'II'], [6, 'I'], [7, 'II'],
], 'Roman numerals restart inside each stone family and never define total ordering');

const atTarget = calculateSellerPerformance([{
  factorCode: 'NET_CONTRACT_VALUE',
  direction: 'HIGHER_IS_BETTER',
  target: '100',
  actual: '100',
  weightPercent: '100',
}]);

assert.equal(atTarget.score, '75.000000000000000000');
assert.equal(atTarget.levelCode, 'CAPABLE');

const peerScore = aggregateBehaviorSurveyScores([
  { respondentPersonnelId: 'peer-a', targetPersonnelId: 'seller', factorCode: 'TEAMWORK', score: 100 },
  { respondentPersonnelId: 'peer-a', targetPersonnelId: 'seller', factorCode: 'TEAMWORK', score: 0 },
  { respondentPersonnelId: 'peer-b', targetPersonnelId: 'seller', factorCode: 'TEAMWORK', score: 100 },
  { respondentPersonnelId: 'peer-c', targetPersonnelId: 'seller', factorCode: 'TEAMWORK', score: 100 },
]);
assert.equal(peerScore[0]?.score, 83.33333333333333, 'repeat responses do not multiply one peer influence');

assert.equal(applySellerPerformanceGates({
  score: '98', behavioralScore: '69', collectionScore: '90', qualityScore: '90',
  sufficientEvidence: true, confirmedSeriousViolation: false, primaryFamilyScores: ['90', '90'],
}), 'CAPABLE', 'behavior below 70 prevents superior or higher');

assert.equal(applySellerPerformanceGates({
  score: '92', behavioralScore: '90', collectionScore: '74', qualityScore: '90',
  sufficientEvidence: true, confirmedSeriousViolation: false, primaryFamilyScores: ['90', '90'],
}), 'SUPERIOR', 'collection or quality below 75 prevents excellent or higher');

assert.equal(applySellerPerformanceGates({
  score: '98', behavioralScore: '95', collectionScore: '90', qualityScore: '90',
  sufficientEvidence: true, confirmedSeriousViolation: false, primaryFamilyScores: ['90', '59'],
}), 'EXCELLENT', 'a primary family below 60 prevents role model');

assert.deepEqual(sellerPerformancePeriodFor(new Date('2026-04-21T08:00:00.000Z')), {
  persianYear: 1405, half: 1, key: '1405-H1', labelFa: 'فروردین تا شهریور ۱۴۰۵',
});
assert.deepEqual(sellerPerformancePeriodFor(new Date('2026-09-23T08:00:00.000Z')), {
  persianYear: 1405, half: 2, key: '1405-H2', labelFa: 'مهر تا اسفند ۱۴۰۵',
});
assert.deepEqual(sellerPerformancePeriodWindowFor(new Date('2026-06-01T08:00:00.000Z')), {
  ...sellerPerformancePeriodFor(new Date('2026-06-01T08:00:00.000Z')),
  from: new Date('2026-03-21T00:00:00.000Z'),
  to: new Date('2026-09-22T00:00:00.000Z'),
});

assert.deepEqual(redistributeSellerFactorWeights([
  { factorCode: 'a', familyCode: 'quality', weightPercent: '3', minimumSampleCount: 3, sampleCount: 2, actual: '90' },
  { factorCode: 'b', familyCode: 'quality', weightPercent: '2', minimumSampleCount: 1, sampleCount: 1, actual: '75' },
  { factorCode: 'c', familyCode: 'sales', weightPercent: '95', minimumSampleCount: 1, sampleCount: 1, actual: '80' },
]), [
  { factorCode: 'b', effectiveWeightPercent: '5.000000000000000000' },
  { factorCode: 'c', effectiveWeightPercent: '95.000000000000000000' },
]);
assert.throws(() => redistributeSellerFactorWeights([
  { factorCode: 'a', familyCode: 'quality', weightPercent: '100', minimumSampleCount: 3, sampleCount: 2, actual: '90' },
]), /خانواده اصلی/);

console.log('Seller performance policy tests passed.');
