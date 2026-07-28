import assert from 'node:assert/strict';
import {
  convertCompactLengthUnit,
  createProductModalDraftState,
  currentProductModalView,
  reduceProductModalDraft
} from '../productModalState';

assert.equal(convertCompactLengthUnit('1.5', 'm', 'cm'), '150');
assert.equal(convertCompactLengthUnit('150', 'cm', 'm'), '1.5');
assert.equal(convertCompactLengthUnit('0.3', 'cm', 'm'), '0.003');
assert.equal(convertCompactLengthUnit('12,500.75', 'm', 'cm'), '1250075');
assert.equal(convertCompactLengthUnit('۱۲٬۵۰۰٫۷۵', 'm', 'cm'), '1250075');
assert.equal(convertCompactLengthUnit('', 'm', 'cm'), '');

{
  const initial = createProductModalDraftState({ title: 'Original' });
  const changed = reduceProductModalDraft(initial, {
    type: 'change',
    update: draft => ({ ...draft, title: 'Contract title' })
  });
  assert.equal(changed.dirty, true);
  assert.equal(initial.draft.title, 'Original');

  const remainderList = reduceProductModalDraft(changed, {
    type: 'enter-view',
    view: 'contract-remainders'
  });
  const remainderBuild = reduceProductModalDraft(remainderList, {
    type: 'enter-view',
    view: 'build-from-remainder'
  });
  assert.equal(currentProductModalView(remainderBuild), 'build-from-remainder');
  assert.equal(currentProductModalView(reduceProductModalDraft(remainderBuild, { type: 'back' })), 'contract-remainders');

  const pending = reduceProductModalDraft(remainderBuild, { type: 'save-started' });
  assert.equal(reduceProductModalDraft(pending, { type: 'save-started' }), pending);
  assert.equal(reduceProductModalDraft(pending, { type: 'back' }), pending);
}

console.log('product modal design-system state tests passed');
