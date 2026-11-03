import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createManagementFixture, type ManagementPersona } from '../management/fixturePorts';
import { createResponderFixture } from '../responder/fixturePorts';
import { PartnerCommandSession } from '../management/commandSession';
import { ManagementView } from '../management/ManagementView';

test('purpose-projected fixtures keep HR, Sales, Accounting, CRM and ordinary Manager separate', async () => {
  const expected: Record<ManagementPersona, string[]> = {
    HR: ['تأیید هویت'], SALES: ['تغییر شرایط تجاری', 'تعیین پاسخ‌دهنده'], ACCOUNTING: ['تغییر شرایط اعتبار'],
    CRM: ['تأیید انتقال'], ADMIN: ['تأیید هویت', 'تغییر شرایط تجاری', 'تغییر شرایط اعتبار', 'تأیید انتقال'],
    MANAGER: [], PARTNER: [], EXPIRED: [],
  };
  for (const persona of Object.keys(expected) as ManagementPersona[]) {
    const fixture = createManagementFixture(persona);
    const response = await fixture.queryPort.query({ schemaVersion: 2, purpose: 'PARTNER_MANAGEMENT' });
    assert.equal(response.ok, true); if (!response.ok) continue;
    const html = renderToStaticMarkup(<ManagementView view={response.value} now={Date.now()} disabled={false} onChoose={() => undefined} />);
    const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) || [];
    for (const label of ['تأیید هویت', 'تغییر شرایط تجاری', 'تغییر شرایط اعتبار', 'تأیید انتقال']) {
      assert.equal(buttons.some(button => button.includes(`>${label}</span>`)), expected[persona].includes(label), `${persona}: ${label}`);
    }
    assert.doesNotMatch(html, /قیمت مشتری|حاشیه سود|retail/);
  }
});

test('HR verifies an owner-issued identity reference but cannot write Accounting terms', async () => {
  const fixture = createManagementFixture('HR');
  const response = await fixture.queryPort.query({ schemaVersion: 2, purpose: 'PARTNER_MANAGEMENT' });
  assert.ok(response.ok); if (!response.ok) return;
  const item = response.value.profiles[0];
  const session = new PartnerCommandSession(fixture.commandPort, response.value.actorId, fixture.managementPort);
  assert.equal((await session.submitManagement({ type: 'IDENTITY_VERIFY', profileId: item.profile.profileId,
    expectedRevision: item.profile.revision, evidenceId: item.identity!.evidenceId, reason: 'مدرک هویت بررسی شد' }, item.profile.profileId)).kind, 'success');
  const updated = await fixture.queryPort.query({ schemaVersion: 2, purpose: 'PARTNER_MANAGEMENT' });
  assert.ok(updated.ok); if (!updated.ok) return;
  assert.equal(updated.value.profiles[0].profile.identityVerified, true);
  const stale = await session.submitManagement({ type: 'IDENTITY_VERIFY', profileId: item.profile.profileId,
    expectedRevision: item.profile.revision, evidenceId: item.identity!.evidenceId, reason: 'تصمیم بر پایه نمای قبلی' }, item.profile.profileId);
  assert.equal(stale.kind, 'error');
  if (stale.kind === 'error') assert.equal(stale.error.code, 'ROW_STALE');
  assert.equal((await session.submitManagement({ type: 'CREDIT_TERMS_SET', profileId: item.profile.profileId,
    expectedRevision: updated.value.profiles[0].profile.revision, termsVersionId: 'fixture-331-credit', reason: 'تغییر شرایط پرداخت' }, item.profile.profileId)).kind, 'error');
});

test('responder partial result preserves distinct price truth and exact retry after lost acknowledgement', async () => {
  for (const scenario of ['PARTIAL', 'UNCERTAIN'] as const) {
    const fixture = createResponderFixture(scenario);
    const response = await fixture.queryPort.query({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE' });
    assert.ok(response.ok); if (!response.ok) continue;
    const inquiry = response.value.inquiries[0];
    const session = new PartnerCommandSession(fixture.commandPort, response.value.actorId);
    let outcome = await session.submit({ type: 'INQUIRY_DECIDE', inquiryId: inquiry.inquiryId, expectedAssignmentRevision: inquiry.assignmentRevision,
      decisions: inquiry.rows.map((row, index) => ({ rowId: row.rowId, expectedRevision: row.revision, outcome: 'APPROVED',
        wholesaleUnitPrice: { amount: index === 0 ? '120000' : '250000', currency: row.identity.currency } })) }, inquiry.inquiryId);
    if (scenario === 'UNCERTAIN') { assert.equal(outcome.kind, 'uncertain'); outcome = await session.retry(); }
    assert.equal(outcome.kind, 'success');
    const updated = await fixture.queryPort.query({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE' });
    assert.ok(updated.ok); if (!updated.ok) continue;
    assert.equal(updated.value.inquiries[0].rows[0].approvedPrice?.amount, '120000');
    assert.equal(updated.value.inquiries[0].rows[0].revision, 2);
    assert.equal(updated.value.inquiries[0].rows[1].state, scenario === 'PARTIAL' ? 'PENDING' : 'APPROVED');
    if (scenario === 'UNCERTAIN') assert.equal(updated.value.inquiries[0].rows[1].approvedPrice?.amount, '250000');
  }
});
