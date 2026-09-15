import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canSubmitPartnerTechnicalAction,
  showPartnerContractConfigurationWarning,
} from '../../contract-creation/partner/partnerCreationFlow';

test('independent inquiry can submit with optional dimensions and no contract quantity', () => {
  assert.equal(canSubmitPartnerTechnicalAction({
    mode: 'inquiry',
    pending: false,
    technicalReady: true,
    contractConfigurationReady: false,
    quickDimensionsValid: true,
    hasDraftAccess: true,
  }), true);
  assert.equal(showPartnerContractConfigurationWarning('inquiry', false), false);
});

test('partner sale product step still requires a complete canonical contract configuration', () => {
  assert.equal(canSubmitPartnerTechnicalAction({
    mode: 'sale',
    pending: false,
    technicalReady: true,
    contractConfigurationReady: false,
    quickDimensionsValid: true,
    hasDraftAccess: true,
  }), false);
  assert.equal(showPartnerContractConfigurationWarning('sale', false), true);
});
