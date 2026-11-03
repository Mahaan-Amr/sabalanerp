import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PartnerCommandSchema, ApprovedInquirySchema } from '@sabalanerp/partner-sales-contracts';
import { createPartnerFixtures, FixturePartnerQueryAdapter } from '@sabalanerp/partner-sales-contracts/testing';

test('Partner constructs inquiry and Case submissions solely from safe query/draft references', async () => {
  const fixture = createPartnerFixtures();
  const adapter = new FixturePartnerQueryAdapter(['PARTNER_INQUIRY']);
  const result = await adapter.query({ schemaVersion: 1, purpose: 'PARTNER_INQUIRY', inquiryId: 'fixture-313-inquiry' });
  if (!result.ok) assert.fail('Inquiry must be available');
  const binding = result.value.rows[0].approvedRowBinding;
  assert.ok(binding);
  const envelope = (type: string) => ({ schemaVersion: 1, commandId: 'fixture-command', correlationId: 'fixture-correlation',
    idempotency: { actorId: fixture.profile.partnerSellerId, operation: type, targetId: fixture.configurationDraft.recoveryId,
      key: 'fixture-key', payloadHash: 'sha256-v1:' + 'b'.repeat(64) } });
  const inquiry = { ...envelope('INQUIRY_SUBMIT'), type: 'INQUIRY_SUBMIT', partnerSellerId: fixture.profile.partnerSellerId,
    rows: [{ rowId: 'new-inquiry-row', configuration: fixture.configurationDraft }] };
  assert.equal(PartnerCommandSchema.safeParse(inquiry).success, true);
  const successor = { ...inquiry, rows: [{ ...inquiry.rows[0], predecessor: { rowId: binding.rowId, revision: binding.revision, reason: 'درخواست قیمت جدید' } }] };
  assert.equal(PartnerCommandSchema.safeParse(successor).success, true);
  assert.equal(PartnerCommandSchema.safeParse({ ...successor, rows: [{ ...successor.rows[0], predecessor: { rowId: binding.rowId, revision: binding.revision } }] }).success, false);
  const submit = { ...envelope('CASE_SUBMIT'), type: 'CASE_SUBMIT', intent: {
    ...fixture.draftSubmissionReference, contractDate: fixture.customer.contractDate,
    rows: [{ productRowId: fixture.partner.products[0].productRowId,
      approvedRowBinding: binding, retailUnitPrice: { amount: '1000', currency: 'IRR' } }],
    customerPaymentPlan: fixture.partner.customerPaymentPlan,
    retailDiscount: { amount: '0', currency: 'IRR' }, belowCostConfirmed: false, deliveries: fixture.partner.deliveries,
  } };
  assert.equal(PartnerCommandSchema.safeParse(submit).success, true);
  assert.equal(ApprovedInquirySchema.safeParse({ ...fixture.approval, predecessorApprovalId: 'previous' }).success, false);
  assert.equal(ApprovedInquirySchema.safeParse({ ...fixture.approval, predecessorApprovalId: 'previous', supersessionReason: 'قیمت تازه تأیید شد' }).success, true);
});
