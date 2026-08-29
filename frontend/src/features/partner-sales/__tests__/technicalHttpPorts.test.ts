import assert from 'node:assert/strict';
import test from 'node:test';
import { createPartnerTechnicalHttpPorts, createPartnerTechnicalPolicyHttpPort } from '../../contract-creation/partner/partnerTechnicalHttpPorts';

const access = { schemaVersion: 1 as const, recoveryId: 'draft-1', browserSessionId: 'browser-1',
  leaseToken: 'lease-1', baseRevision: 0 };

test('technical HTTP ports validate requests and successful public responses at the transport boundary', async () => {
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  const client = {
    post: async (path: string, body: unknown) => {
      requests.push({ method: 'POST', path, body });
      if (path.endsWith('/catalog/query')) return { data: { success: true, data: {
        schemaVersion: 1, purpose: 'PARTNER_TECHNICAL_CATALOG', kind: 'PRODUCT', items: [],
      } } };
      if (path.endsWith('/recoveries/read')) return { data: { success: true, data: {
        schemaVersion: 1, recoveryId: 'draft-1', recoveryRevision: 0,
        updatedAt: '2026-08-29T00:00:00.000Z', draft: null,
      } } };
      throw new Error(`Unexpected path ${path}`);
    },
    put: async (path: string, body: unknown) => {
      requests.push({ method: 'PUT', path, body });
      return { data: { success: true, data: { schemaVersion: 1, recoveryId: 'draft-1',
        recoveryRevision: 1, inputRevision: 1, updatedAt: '2026-08-29T00:00:01.000Z', replayed: false } } };
    },
  };
  const ports = createPartnerTechnicalHttpPorts(client);
  const invalid = await ports.catalog.read({ schemaVersion: 1, purpose: 'PARTNER_TECHNICAL_CATALOG',
    kind: 'PRODUCT', limit: 101 } as never);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.ok ? '' : invalid.error.code, 'INVALID_PAYLOAD');
  assert.equal(requests.length, 0);

  const catalog = await ports.catalog.read({ schemaVersion: 1, purpose: 'PARTNER_TECHNICAL_CATALOG', kind: 'PRODUCT' });
  const recovered = await ports.recovery.read(access);
  const checkpoint = await ports.recovery.checkpoint({ ...access, expectedRecoveryRevision: 0,
    idempotencyKey: 'checkpoint-1', draft: { schemaVersion: 1, inputRevision: 1, rows: [] } });
  assert.equal(catalog.ok && catalog.value.items.length, 0);
  assert.equal(recovered.ok && recovered.value.recoveryId, 'draft-1');
  assert.equal(checkpoint.ok && checkpoint.value.recoveryRevision, 1);
  assert.deepEqual(requests.map(request => `${request.method} ${request.path}`), [
    'POST /partner/technical/catalog/query',
    'POST /partner/technical/recoveries/read',
    'PUT /partner/technical/recoveries/checkpoint',
  ]);
});

test('technical HTTP ports collapse hidden 404 errors, reject malformed success and preserve network uncertainty', async () => {
  const hidden = createPartnerTechnicalHttpPorts({
    post: async () => { throw { response: { status: 404, data: { success: false,
      code: 'CUSTOMER_OUT_OF_SCOPE', error: 'private detail' } } }; },
    put: async () => { throw new Error('offline'); },
  });
  const denied = await hidden.recovery.read(access);
  assert.deepEqual(denied, { ok: false, error: { code: 'NOT_FOUND', status: 404, message: 'مورد در دسترس نیست.' } });
  await assert.rejects(() => hidden.recovery.checkpoint({ ...access, expectedRecoveryRevision: 0,
    idempotencyKey: 'checkpoint-1', draft: { schemaVersion: 1, inputRevision: 1, rows: [] } }), /offline/);

  const malformed = createPartnerTechnicalHttpPorts({
    post: async () => ({ data: { success: true, data: { schemaVersion: 1, recoveryId: 'draft-1', rates: ['private'] } } }),
    put: async () => { throw new Error('unused'); },
  });
  const result = await malformed.recovery.read(access);
  assert.equal(result.ok, false);
  assert.equal(result.ok ? '' : result.error.code, 'INTEGRITY_CONFLICT');
});

test('Sales policy HTTP port reads and publishes only the versioned management contract', async () => {
  const calls: string[] = [];
  const policy = { schemaVersion: 1 as const, purpose: 'PARTNER_TECHNICAL_PRICING' as const,
    calculationPolicy: { calculation: 'calc-v1', packing: 'pack-v1', pricing: 'price-v1', rounding: 'round-v1' },
    mandatoryPercentage: '20', mandatoryEnabled: true, slabCuttingPricingMethod: 'lineBased' as const,
    sawKerfMeters: '0.005', materialRateScale: '0.1', currency: 'IRT' as const,
    rates: { longitudinalCutRateToman: '1200', crossCutRateToman: '1400', calibrationCutRateToman: '900',
      verticalCutRateToman: '1600', squareMeterCutRateToman: '4500' } };
  const value = { schemaVersion: 1 as const, purpose: 'PARTNER_TECHNICAL_POLICY' as const,
    profileId: 'profile-1', accountVersion: 1, policy: { ...policy, policyId: 'policy-1', version: 1,
      effectiveDate: '2026-08-29', integrityHash: `sha256-v1:${'a'.repeat(64)}` } };
  const port = createPartnerTechnicalPolicyHttpPort({
    get: async path => { calls.push(`GET ${path}`); return { data: { success: true, data: value } }; },
    post: async (path, body) => { calls.push(`POST ${path}:${(body as any).expectedVersion}`);
      return { data: { success: true, data: value } }; },
  });
  const read = await port.read('profile-1');
  const published = await port.publish({ schemaVersion: 1, purpose: 'PARTNER_TECHNICAL_POLICY_PUBLISH',
    profileId: 'profile-1', expectedVersion: 0, effectiveDate: '2026-08-29',
    reason: 'سیاست فنی مصوب مدیریت فروش', policy });
  assert.equal(read.ok && read.value.policy.policyId, 'policy-1');
  assert.equal(published.ok && published.value.accountVersion, 1);
  assert.deepEqual(calls, ['GET /partner/management/technical-policy/profile-1',
    'POST /partner/management/technical-policy:0']);
});
