import assert from 'node:assert/strict';
import test from 'node:test';
import { partnerStairCanonicalLength, partnerStairDisplayLength } from './PartnerTechnicalDraftEditor';

test('layer width remains stable while typing in centimeters', () => {
  const oneDigit = partnerStairCanonicalLength('2', 'cm');
  assert.equal(partnerStairDisplayLength(oneDigit, 'cm'), '2');
  const twoDigits = partnerStairCanonicalLength('20', 'cm');
  assert.equal(twoDigits, '0.2');
  assert.equal(partnerStairDisplayLength(twoDigits, 'cm'), '20');
});
