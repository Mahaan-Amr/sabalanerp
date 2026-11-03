import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OnboardingGates } from '../management/OnboardingGates';
import { ResponseRow } from '../responder/ResponseRow';
import { ResponseReview } from '../responder/ResponseReview';
import { ManagementView } from '../management/ManagementView';

test('HR onboarding lists unfinished commercial gates without receiving their economics', () => {
  const html = renderToStaticMarkup(<OnboardingGates profile={{ schemaVersion: 1, purpose: 'ONBOARDING',
    profileId: 'fixture-331-profile', partnerSellerId: 'fixture-331-partner', revision: 1, status: 'PENDING',
    identityVerified: true, commercialTermsReady: false, creditTermsReady: false, responderReady: true,
    conversionCleared: false, cohortReady: false }} />);
  assert.match(html, /شرایط تجاری/);
  assert.match(html, /اعتبار و پرداخت/);
  assert.match(html, /تعیین تکلیف کارهای داخلی/);
  assert.match(html, /در انتظار تکمیل/);
  assert.doesNotMatch(html, /قیمت مشتری|حاشیه سود|تومان|ریال/);
});

test('a Manager title never manufactures an action and a projected expired grant is disabled inline', () => {
  const base = { schemaVersion: 2 as const, purpose: 'PARTNER_MANAGEMENT' as const, actorId: 'fixture-actor',
    personaLabel: 'MANAGER', actions: [], profiles: [], transfers: [] };
  const hidden = renderToStaticMarkup(<ManagementView view={base} now={Date.parse('2026-08-27T10:00:00.000Z')} disabled={false} onChoose={() => undefined} />);
  assert.match(hidden, /اقدامی در دسترس نیست/);
  assert.doesNotMatch(hidden, /ایجاد پروفایل|فعال‌سازی|تغییر شرایط/);
  const expired = renderToStaticMarkup(<ManagementView view={{ ...base, actions: [{ action: 'PROFILE_CREATE', enabled: true, expiresAt: '2026-08-27T10:00:00.000Z' }] }}
    now={Date.parse('2026-08-27T10:00:00.000Z')} disabled={false} onChoose={() => undefined} />);
  assert.match(expired, /ایجاد پروفایل/);
  assert.match(expired, /disabled=""/);
  assert.match(expired, /مهلت دسترسی/);
});

test('response review keeps different prices and mixed rejection visible before confirmation', () => {
  const html = renderToStaticMarkup(<ResponseReview rowNumbers={{ a: 1, b: 2, c: 3 }} decisions={[
    { rowId: 'a', expectedRevision: 1, outcome: 'APPROVED', wholesaleUnitPrice: { amount: '120000', currency: 'IRR' } },
    { rowId: 'b', expectedRevision: 1, outcome: 'APPROVED', wholesaleUnitPrice: { amount: '25000', currency: 'IRT' } },
    { rowId: 'c', expectedRevision: 1, outcome: 'REJECTED', reason: 'مشخصات ناقص است' },
  ]} />);
  assert.match(html, /120000/);
  assert.match(html, /25000/);
  assert.match(html, /ریال/);
  assert.match(html, /تومان/);
  assert.match(html, /مشخصات ناقص است/);
});

test('an unavailable responder row shows evidence but no editable price or decision controls', () => {
  const html = renderToStaticMarkup(<ResponseRow number={1} row={{ rowId: 'fixture-row', revision: 2,
    identity: { schemaVersion: 1, partnerSellerId: 'fixture-partner', catalogProductId: 'fixture-stone', family: 'slab',
      unit: 'متر مربع', configuration: [{ key: 'width', value: '۶۰ سانتی‌متر' }], materialRateEvidenceId: 'internal-rate',
      materialRateHash: `sha256-v1:${'0'.repeat(64)}`, components: [], currency: 'IRR', calculationPolicyVersion: 'v1', roundingPolicyVersion: 'v1' },
    approvedPrice: { amount: '120000', currency: 'IRR' }, used: true }} canRespond={false}
    status="پاسخ این استعلام به شما واگذار نشده است." draft={{ selected: false, amount: '', outcome: 'APPROVED', note: '' }}
    pending={false} onChange={() => undefined} />);
  assert.match(html, /۶۰ سانتی‌متر/);
  assert.match(html, /120000/);
  assert.match(html, /واگذار نشده/);
  assert.doesNotMatch(html, /<input|<textarea|<select|internal-rate|sha256|قیمت مشتری|حاشیه سود/);
});
