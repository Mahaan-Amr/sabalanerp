import React from 'react';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import ErpSearchableSelect, { selectOptions } from './ErpSearchableSelect';

test('platform searchable selection preserves option identities, groups, disabled choices and field accessibility', () => {
  const choices = <><option value="">انتخاب حساب</option><optgroup label="بانک"><option value="qa">بانک آزمایشی</option><option value="closed" disabled>بسته</option></optgroup></>;
  assert.deepEqual(selectOptions(choices).map((item) => [item.value, item.group, item.disabled]), [['', undefined, undefined], ['qa', 'بانک', undefined], ['closed', 'بانک', true]]);
  const html = renderToStaticMarkup(<ErpSearchableSelect id="bank" aria-describedby="bank-help" value="qa">{choices}</ErpSearchableSelect>);
  assert.ok(html.includes('بانک آزمایشی'));
  assert.ok(html.includes('aria-haspopup="listbox"'));
  assert.ok(html.includes('aria-describedby="bank-help"'));
  assert.ok(!html.includes('<select'));
});
