import assert from 'node:assert/strict';
import { performanceBadgePresentation, performanceLevelTone } from './performanceBadgeModel';

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
assert.equal(performanceBadgePresentation({ state: 'LEVEL', levelCode: 'MEETS', labelFa: 'مطابق انتظار', meaningFa: 'معنا', version: 3 }).tone, 'success');
assert.equal(performanceBadgePresentation({ state: 'LEVEL', levelCode: 'EXCEEDS', labelFa: 'فراتر از انتظار', meaningFa: 'معنا', version: 3 }).lightAsset,
  '/assets/performance-rank-badges-v2/light/ruby.png');
assert.deepEqual([
  'URGENT_IMPROVEMENT', 'IMPROVEMENT', 'MEETS', 'EXCEEDS', 'OUTSTANDING',
].map(performanceLevelTone), ['danger', 'warning', 'success', 'primary', 'purple']);
assert.equal(performanceLevelTone('UNKNOWN_PRIVATE_LEVEL'), 'neutral');
assert.equal(performanceBadgePresentation({
  state: 'TEMPORARILY_UNAVAILABLE', levelCode: 'MEETS', labelFa: 'خلاصه عملکرد موقتاً در دسترس نیست', meaningFa: 'معنا', version: 3,
}).tone, 'neutral', 'neutral states never manufacture a level tone from stale data');

console.log('Performance Badge presentation tests passed.');
