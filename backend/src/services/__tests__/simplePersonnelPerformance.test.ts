import assert from 'node:assert/strict';
import {
  calculateSimplePerformance,
  canEvaluatePersonnel,
  validateSimpleEvaluationDate,
} from '../simplePersonnelPerformance';

const result = calculateSimplePerformance([
  { indicatorId: 'sales', direction: 'HIGHER_IS_BETTER', target: '100', actual: '90', weightPercent: '60' },
  { indicatorId: 'errors', direction: 'LOWER_IS_BETTER', target: '10', actual: '5', weightPercent: '40' },
]);
assert.equal(result.score, '94.00');
assert.equal(result.level, 'EXCEEDS_EXPECTATIONS');
assert.deepEqual(result.indicators.map(({ score }) => score), ['90.00', '100.00']);

assert.equal(calculateSimplePerformance([
  { indicatorId: 'incidents', direction: 'LOWER_IS_BETTER', target: '0', actual: '0', weightPercent: '100' },
]).score, '100.00');
assert.equal(calculateSimplePerformance([
  { indicatorId: 'incidents', direction: 'LOWER_IS_BETTER', target: '0', actual: '1', weightPercent: '100' },
]).score, '0.00');

assert.throws(() => calculateSimplePerformance([
  { indicatorId: 'missing', direction: 'HIGHER_IS_BETTER', target: '10', actual: null, weightPercent: '100' },
]), /همه مقدارها را وارد کنید/);
assert.throws(() => calculateSimplePerformance([
  { indicatorId: 'bad-weights', direction: 'HIGHER_IS_BETTER', target: '10', actual: '10', weightPercent: '90' },
]), /جمع وزن‌ها باید ۱۰۰ درصد باشد/);

for (const [actual, level] of [
  ['59.99', 'URGENT_IMPROVEMENT'],
  ['60', 'NEEDS_IMPROVEMENT'],
  ['75', 'MEETS_EXPECTATIONS'],
  ['90', 'EXCEEDS_EXPECTATIONS'],
  ['100', 'OUTSTANDING'],
] as const) {
  assert.equal(calculateSimplePerformance([
    { indicatorId: level, direction: 'HIGHER_IS_BETTER', target: '100', actual, weightPercent: '100' },
  ]).level, level);
}

assert.equal(canEvaluatePersonnel({ hasEvaluateAll: true, hasEvaluateDirectReports: false, isResponsibleSupervisor: false }), 'HR_MANAGER');
assert.equal(canEvaluatePersonnel({ hasEvaluateAll: false, hasEvaluateDirectReports: true, isResponsibleSupervisor: true }), 'SUPERVISOR');
assert.equal(canEvaluatePersonnel({ hasEvaluateAll: false, hasEvaluateDirectReports: true, isResponsibleSupervisor: false }), null);

assert.deepEqual(validateSimpleEvaluationDate('2026-09-12', new Date('2026-09-12T12:00:00.000Z')), { valid: true });
assert.equal(validateSimpleEvaluationDate('2026-09-13', new Date('2026-09-12T12:00:00.000Z')).valid, false);
assert.equal(validateSimpleEvaluationDate('2026-08-31', new Date('2026-09-12T12:00:00.000Z')).valid, false);

console.log('Simple personnel performance tests passed.');
