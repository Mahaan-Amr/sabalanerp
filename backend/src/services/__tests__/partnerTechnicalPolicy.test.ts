import assert from 'node:assert/strict';
import test from 'node:test';
import { createPartnerTechnicalPolicyService } from '../partnerSales/management/technicalPolicy';

const policy = { schemaVersion: 1 as const, purpose: 'PARTNER_TECHNICAL_PRICING' as const,
  calculationPolicy: { calculation: 'calculation-v1', packing: 'packing-v1', pricing: 'pricing-v1', rounding: 'rounding-v2' },
  mandatoryPercentage: '20', mandatoryEnabled: true, slabCuttingPricingMethod: 'lineBased' as const,
  sawKerfMeters: '0.005', materialRateScale: '0.1', currency: 'IRT' as const,
  rates: { longitudinalCutRateToman: '1200', crossCutRateToman: '1400', calibrationCutRateToman: '900',
    verticalCutRateToman: '1600', squareMeterCutRateToman: '4500' } };

test('Sales management appends a versioned technical policy with CAS and current authorization', async () => {
  const created: any[] = []; let allowed = true;
  const tx = { $queryRaw: async () => [{ now: new Date('2026-08-29T12:00:00.000Z') }],
    partnerProfile: { findUnique: async () => ({ commercialAccount: { id: 'account-1' } }) },
    partnerCommercialTerms: {
      findFirst: async () => created.at(-1) ?? null,
      create: async ({ data }: any) => { created.push(data); return data; },
    } } as any;
  const service = createPartnerTechnicalPolicyService({ actorId: 'manager-1', transaction: async run => run(tx),
    authorize: async () => allowed ? { ok: true as const, value: undefined } : { ok: false as const,
      error: { code: 'FORBIDDEN' as const, status: 403, message: 'مجاز نیست.' } } });
  const result = await service.publish({ schemaVersion: 1, purpose: 'PARTNER_TECHNICAL_POLICY_PUBLISH',
    profileId: 'partner-profile', expectedVersion: 0,
    effectiveDate: '2026-08-29', reason: 'سیاست فنی مصوب مدیریت فروش', policy });
  assert.ok(result.ok);
  assert.equal(result.value.accountVersion, 1);
  assert.equal(result.value.policy.version, 1);
  assert.match(created[0].integrityHash, /^sha256-v1:[a-f0-9]{64}$/);
  const stale = await service.publish({ schemaVersion: 1, purpose: 'PARTNER_TECHNICAL_POLICY_PUBLISH',
    profileId: 'partner-profile', expectedVersion: 0,
    effectiveDate: '2026-08-29', reason: 'نسخه بعدی سیاست مدیریت فروش', policy });
  assert.equal(stale.ok ? null : stale.error.code, 'ROW_STALE');
  allowed = false;
  const denied = await service.publish({ schemaVersion: 1, purpose: 'PARTNER_TECHNICAL_POLICY_PUBLISH',
    profileId: 'partner-profile', expectedVersion: 1,
    effectiveDate: '2026-08-29', reason: 'نسخه بعدی سیاست مدیریت فروش', policy });
  assert.equal(denied.ok ? null : denied.error.code, 'FORBIDDEN');
  assert.equal(created.length, 1);
});
