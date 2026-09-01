import assert from 'node:assert/strict';
import { performanceBadgePresentation } from './performanceBadgeModel';

assert.deepEqual(performanceBadgePresentation({ state: 'LEVEL', levelCode: 'OUTSTANDING', labelFa: 'عملکرد برجسته', meaningFa: 'معنا', version: 2 }), {
  labelFa: 'عملکرد برجسته',
  meaningFa: 'معنا',
  tone: 'purple',
  lightAsset: '/assets/performance-rank-badges-v2/light/diamond.png',
  darkAsset: '/assets/performance-rank-badges-v2/dark/diamond.png',
  neutral: false,
});
assert.equal(performanceBadgePresentation({ state: 'UNEVALUATED', labelFa: 'ارزیابی‌نشده', meaningFa: 'معنا', version: 0 }).neutral, true);
assert.equal(performanceBadgePresentation({ state: 'TEMPORARILY_UNAVAILABLE', labelFa: 'خلاصه عملکرد موقتاً در دسترس نیست', meaningFa: 'معنا', version: 3 }).tone, 'neutral');

console.log('Performance Badge presentation tests passed.');
