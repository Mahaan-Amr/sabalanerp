import assert from 'node:assert/strict';
import { normalizeInterviewCriteriaPublication } from '../hrInterviewCriteriaPolicy';

const publication = normalizeInterviewCriteriaPublication([
  { stableId: 'communication', title: 'ارتباط', description: '', answerType: 'SCORE_1_TO_5', isActive: true },
  { stableId: 'commitment', title: 'تعهد', answerType: 'YES_NO', isActive: true },
]);
assert.deepEqual(publication.map(({ stableId, order, answerType }) => ({ stableId, order, answerType })), [
  { stableId: 'communication', order: 1, answerType: 'SCORE_1_TO_5' },
  { stableId: 'commitment', order: 2, answerType: 'YES_NO' },
]);
assert.throws(() => normalizeInterviewCriteriaPublication([{ stableId: 'x', title: '', answerType: 'TEXT', isActive: true }]), /title/i);
assert.throws(() => normalizeInterviewCriteriaPublication([{ stableId: 'x', title: 'x', answerType: 'UNKNOWN', isActive: true }]), /answer type/i);
assert.throws(() => normalizeInterviewCriteriaPublication([
  { stableId: 'x', title: 'x', answerType: 'TEXT', isActive: true },
  { stableId: 'x', title: 'duplicate', answerType: 'TEXT', isActive: true },
]), /unique/i);

console.log('HR interview criteria publication tests passed.');
