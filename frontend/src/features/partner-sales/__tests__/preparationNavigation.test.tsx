import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PartnerPreparationNavigation } from '../../contract-creation/partner/PartnerPreparationNavigation';

test('partner sale preparation exposes ordinary previous and next navigation', () => {
  const first = renderToStaticMarkup(<PartnerPreparationNavigation step={1} pending={false}
    technicalReady={false} onPrevious={() => undefined} onNext={() => undefined} />);
  assert.match(first, />قبلی</);
  assert.match(first, />بعدی</);
  assert.match(first, /مرحله ۱ از ۷/);

  const products = renderToStaticMarkup(<PartnerPreparationNavigation step={4} pending={false}
    technicalReady onPrevious={() => undefined} onNext={() => undefined} />);
  assert.match(products, />قبلی</);
  assert.match(products, />بررسی قیمت‌ها و ادامه</);
  assert.match(products, /مرحله ۴ از ۷/);
});
