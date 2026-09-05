import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PartnerInquiryViewSchema, PartnerInquiryViewV2Schema } from '@sabalanerp/partner-sales-contracts';
import { createPartnerFixtures } from '@sabalanerp/partner-sales-contracts/testing';

test('v2 inquiry survives reload with exact safe configuration and successor links without changing v1', () => {
  const fixture = createPartnerFixtures();
  const input = { ...fixture.inquiry, schemaVersion: 2, rows: [{ ...fixture.inquiry.rows[0],
    configurationRef: fixture.configurationDraft,
    successor: { inquiryId: 'next-inquiry', rowId: 'next-row', revision: 1, state: 'PENDING' },
  }] };
  const view = PartnerInquiryViewV2Schema.parse(JSON.parse(JSON.stringify(input)));
  assert.equal(view.rows[0].configurationRef.productRowId, 'fixture-313-row');
  assert.equal(view.rows[0].successor?.rowId, 'next-row');
  // An open successor does not retroactively invalidate its approved predecessor.
  assert.equal(view.rows[0].state, 'APPROVED');
  assert.equal(PartnerInquiryViewSchema.safeParse(fixture.inquiry).success, true);
  assert.equal(PartnerInquiryViewSchema.safeParse(input).success, false);
  assert.equal(PartnerInquiryViewV2Schema.safeParse({ ...input, internalRate: '800' }).success, false);
  assert.equal(PartnerInquiryViewV2Schema.safeParse({ ...input, rows: [{ ...input.rows[0],
    predecessor: { inquiryId: 'old-inquiry', rowId: 'old-row', revision: 1 },
  }] }).success, false);
});
