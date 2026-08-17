import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DutyCountBadge } from './DutyCountBadge';

const expanded = renderToStaticMarkup(<DutyCountBadge count={12} collapsed={false} />);
const collapsed = renderToStaticMarkup(<DutyCountBadge count={12} collapsed />);

for (const markup of [expanded, collapsed]) {
  assert.match(markup, /۱۲/);
  assert.match(markup, /aria-label="۱۲ وظیفه بین‌واحدی باز"/);
  assert.match(markup, /var\(--sds-danger\)/);
}

assert.equal(renderToStaticMarkup(<DutyCountBadge count={0} collapsed={false} />), '');
console.log('Cross-workspace duty count badge tests passed.');
