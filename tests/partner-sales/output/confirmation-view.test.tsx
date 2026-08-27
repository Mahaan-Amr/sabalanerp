import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import ConfirmationContractView from '../../../frontend/src/app/contracts/confirm/ConfirmationContractView';

const frontendRequire = createRequire(path.resolve(__dirname, '../../../frontend/package.json'));
const React = frontendRequire('react');
Object.assign(globalThis, { React }); // Next supplies the JSX runtime in production.
const { renderToStaticMarkup } = frontendRequire('react-dom/server');
const foundationRequire = createRequire(path.resolve(__dirname, '../../../packages/partner-sales-contracts/package.json'));
const { createPartnerFixtures } = foundationRequire('@sabalanerp/partner-sales-contracts/testing');

test('the existing confirmation card/table accepts retail output and locks historical sessions', () => {
  const fixture = createPartnerFixtures();
  const data = { contract: fixture.customer, verifiedAt: '2026-08-27T12:00:00.000Z',
    linkExpiresAt: '2026-10-26T12:00:00.000Z', readOnly: true, banner: 'SUPERSEDED' as const };
  const html = renderToStaticMarkup(<ConfirmationContractView data={data} code="" error="" success=""
    submitting={false} onCodeChange={() => {}} onVerify={() => {}} onResend={() => {}} />);
  assert.ok(html.includes('همکار آزمایشی'));
  assert.ok(html.includes('تأمین و تحویل توسط سبلان'));
  assert.ok(html.includes('نسخه جدید جایگزین شده'));
  assert.ok(html.includes('سنگ طولی آزمایشی'));
  assert.ok(!html.includes('ارسال مجدد کد'));
  for (const secret of ['FIXTURE-CASE', 'FIXTURE-INTERNAL', 'fixture-313-row', '1600']) assert.ok(!html.includes(secret));
});

test('retail output preserves exact large monetary amounts and exposes the ordinary OTP controls while pending', () => {
  const fixture = createPartnerFixtures();
  fixture.customer.totals.payable = '9007199254740993';
  const html = renderToStaticMarkup(<ConfirmationContractView data={{ contract: fixture.customer, verifiedAt: null,
    linkExpiresAt: '2026-10-26T12:00:00.000Z', readOnly: false, banner: null }}
    code="" error="" success="" submitting={false} onCodeChange={() => {}} onVerify={() => {}} onResend={() => {}} />);
  assert.ok(html.includes('۹٬۰۰۷٬۱۹۹٬۲۵۴٬۷۴۰٬۹۹۳'));
  assert.ok(html.includes('ارسال مجدد کد'));
  assert.ok(html.includes('تایید قرارداد'));
});
