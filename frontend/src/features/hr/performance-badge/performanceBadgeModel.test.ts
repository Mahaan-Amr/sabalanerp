import assert from 'node:assert/strict';
import {
  performanceBadgePresentation,
  performanceLevelTone,
  type PerformanceLevelCode,
} from './performanceBadgeModel';

const codes: PerformanceLevelCode[] = [
  'COMPANION', 'DILIGENT', 'WORTHY', 'CAPABLE', 'SUPERIOR', 'EXCELLENT', 'ROLE_MODEL',
];
const expected = [
  [1, 'همراه', 'با ماست', 'TURQUOISE', 'I'],
  [2, 'هم‌ریشه', 'از ماست', 'TURQUOISE', 'II'],
  [3, 'کارساز', 'به کار ما می‌آید', 'TURQUOISE', 'III'],
  [4, 'مانا', 'با ما می‌ماند', 'RUBY', 'I'],
  [5, 'ستون', 'تکیه‌گاه ماست', 'RUBY', 'II'],
  [6, 'اثرگذار', 'ما را بهتر می‌کند', 'DIAMOND', 'I'],
  [7, 'الگو', 'آن‌گونه که باید باشی', 'DIAMOND', 'II'],
];

for (const [index, code] of codes.entries()) {
  const [ordinal, labelFa, meaningFa, stoneFamily, romanNumeral] = expected[index] as [
    number, string, string, 'TURQUOISE' | 'RUBY' | 'DIAMOND', 'I' | 'II' | 'III',
  ];
  const presentation = performanceBadgePresentation({
    state: 'LEVEL', levelCode: code, labelFa, meaningFa,
    version: 2, officialResult: true, ordinal, stoneFamily, romanNumeral,
    lightAsset: `/assets/performance-rank-badges-roman-v1/light/rank-${String(index + 1).padStart(2, '0')}.png`,
    darkAsset: `/assets/performance-rank-badges-roman-v1/dark/rank-${String(index + 1).padStart(2, '0')}.png`,
    presentationVersion: 'roman-v1',
  });
  assert.equal(presentation.romanNumeral, romanNumeral);
  assert.equal(presentation.imageFilter, undefined, 'Roman assets never recolor the frame with a CSS filter');
  assert.match(presentation.lightAsset, new RegExp(`/light/rank-0${index + 1}\\.png$`));
  assert.match(presentation.darkAsset, new RegExp(`/dark/rank-0${index + 1}\\.png$`));
}

assert.equal(performanceBadgePresentation({
  state: 'LEVEL', levelCode: 'COMPANION', labelFa: 'همراه', meaningFa: 'با ماست',
  version: 2, officialResult: false, ordinal: 1, stoneFamily: 'TURQUOISE', romanNumeral: 'I',
  lightAsset: '/assets/performance-rank-badges-roman-v1/light/rank-01.png',
  darkAsset: '/assets/performance-rank-badges-roman-v1/dark/rank-01.png', presentationVersion: 'roman-v1',
}).romanNumeral, undefined, 'no official result uses rank 01 artwork without a Roman numeral');

assert.equal(performanceBadgePresentation({ state: 'TEMPORARILY_UNAVAILABLE', labelFa: 'خلاصه عملکرد موقتاً در دسترس نیست', meaningFa: 'معنا', version: 3 }).tone, 'neutral');
assert.equal(performanceBadgePresentation({ state: 'LEVEL', levelCode: 'MEETS', labelFa: 'مطابق انتظار', meaningFa: 'معنا', version: 3 }).lightAsset,
  '/assets/performance-rank-badges-v2/light/emerald-v2.png', 'historical five-level display remains available');
assert.deepEqual(codes.map(performanceLevelTone), ['neutral', 'warning', 'success', 'success', 'primary', 'purple', 'purple']);
assert.equal(performanceLevelTone('UNKNOWN_PRIVATE_LEVEL'), 'neutral');

console.log('Performance Badge presentation tests passed.');
