import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PartnerQueryV2Schema } from '@sabalanerp/partner-sales-contracts';
import { partnerRequoteInquiryId } from './partnerWizardEntry';

test('repeated repricing produces bounded identities accepted by the exact-duty read contract', () => {
  const ids = new Set<string>();
  for (let round = 0; round < 50; round++) {
    const inquiryId = partnerRequoteInquiryId(randomUUID());
    assert.equal(PartnerQueryV2Schema.safeParse({ schemaVersion: 2, purpose: 'RESPONDER_INQUIRY', inquiryId }).success, true);
    assert.ok(inquiryId.length <= 160);
    ids.add(inquiryId);
  }
  assert.equal(ids.size, 50);
});
