import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PartnerTechnicalPricingPolicySchema, PartnerTechnicalPolicyPublishSchema,
  PartnerTechnicalPolicyReceiptSchema, PartnerTechnicalPolicyViewSchema,
} from '@sabalanerp/partner-sales-contracts';

const policy = { schemaVersion: 1 as const, purpose: 'PARTNER_TECHNICAL_PRICING' as const,
  calculationPolicy: { calculation: 'calculation-v1', packing: 'packing-v1', pricing: 'pricing-v1', rounding: 'rounding-v1' },
  mandatoryPercentage: '20', mandatoryEnabled: true, slabCuttingPricingMethod: 'lineBased' as const,
  sawKerfMeters: '0.005', materialRateScale: '0.1', currency: 'IRT' as const,
  rates: { longitudinalCutRateToman: '1200', crossCutRateToman: '1400', calibrationCutRateToman: '900',
    verticalCutRateToman: '1600', squareMeterCutRateToman: '4500' } };

test('technical pricing policy is purpose-bound, exact-decimal and versioned for Sales management only', () => {
  assert.deepEqual(PartnerTechnicalPricingPolicySchema.parse(policy), policy);
  const command = { schemaVersion: 1 as const, purpose: 'PARTNER_TECHNICAL_POLICY_PUBLISH' as const,
    profileId: 'profile-1', expectedVersion: 0, effectiveDate: '2026-08-29',
    reason: 'سیاست فنی مصوب مدیریت فروش', policy };
  assert.deepEqual(PartnerTechnicalPolicyPublishSchema.parse(command), command);
  const value = { schemaVersion: 1 as const, purpose: 'PARTNER_TECHNICAL_POLICY' as const,
    profileId: 'profile-1', accountVersion: 1, policy: { ...policy,
      policyId: 'policy-1', version: 1, effectiveDate: '2026-08-29',
      integrityHash: `sha256-v1:${'a'.repeat(64)}` } };
  assert.deepEqual(PartnerTechnicalPolicyViewSchema.parse(value), value);
  assert.deepEqual(PartnerTechnicalPolicyReceiptSchema.parse(value), value);
  for (const invalid of [
    { ...policy, mandatoryPercentage: '101' },
    { ...policy, materialRateScale: '0' },
    { ...policy, rates: { ...policy.rates, longitudinalCutRateToman: 1200 } },
    { ...policy, privateCatalogRates: [] },
  ]) assert.equal(PartnerTechnicalPricingPolicySchema.safeParse(invalid).success, false);
});
