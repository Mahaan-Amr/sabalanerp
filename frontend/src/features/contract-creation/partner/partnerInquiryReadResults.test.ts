import assert from 'node:assert/strict';
import test from 'node:test';
import { partnerError } from '@sabalanerp/partner-sales-contracts';
import { partnerInquiryReadRows } from './partnerInquiryReadResults';

test('saved-case pricing preserves transient and permission failures instead of claiming corrupt evidence', () => {
  for (const code of ['TEMPORARY_FAILURE', 'FORBIDDEN', 'INTEGRITY_CONFLICT'] as const) {
    const error = partnerError(code);
    assert.throws(() => partnerInquiryReadRows([{ ok: false, error }]), failure => failure === error);
  }
  assert.deepEqual(partnerInquiryReadRows([{ ok: false, error: partnerError('NOT_FOUND') }, { ok: true, value: { rows: [] } }]), []);
});
