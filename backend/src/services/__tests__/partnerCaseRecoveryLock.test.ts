import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalHash, partnerError, type PartnerCommand } from '@sabalanerp/partner-sales-contracts';
import { createPartnerCaseService, type PartnerCaseDependencies } from '../partnerSales/cases/aggregate';

const hash = `sha256-v1:${'a'.repeat(64)}`;

async function command(type: 'CASE_SUBMIT' | 'CASE_DRAFT_REVISE'): Promise<PartnerCommand> {
  const intent = {
    customerId: 'lock-customer', recoveryId: 'lock-recovery', recoveryRevision: 1, graphHash: hash,
    contractDate: '2026-10-06', rows: [{ productRowId: 'lock-product', retailUnitPrice: { amount: '100', currency: 'IRT' as const } }],
    customerPaymentPlan: { planId: 'lock-plan', version: 1, effectiveDate: '2026-10-06', installments: [{
      installmentId: 'lock-payment', dueDate: '2026-10-06', amount: { amount: '100', currency: 'IRT' as const }, method: 'CASH' as const }] },
    retailDiscount: { amount: '0', currency: 'IRT' as const }, belowCostConfirmed: false, deliveries: [],
  };
  return { schemaVersion: 1, type, commandId: 'lock-command', correlationId: 'lock-correlation', intent,
    idempotency: { actorId: 'lock-actor', operation: type, targetId: 'lock-case', key: 'lock-key',
      payloadHash: await canonicalHash({ schemaVersion: 1, type, intent }) },
    ...(type === 'CASE_DRAFT_REVISE' ? { expected: { caseId: 'lock-case', revision: 1, integrityHash: hash },
      expectedState: 'DRAFT' as const, editLease: { recoveryId: 'lock-recovery', browserSessionId: 'lock-browser',
        leaseToken: 'lock-token', baseRevision: 0 } } : {}),
  } as PartnerCommand;
}

for (const type of ['CASE_SUBMIT', 'CASE_DRAFT_REVISE'] as const) {
  test(`${type} reserves recovery before Profile authorization even when permission is denied`, async () => {
    let recoveryLocked = false;
    let authorized = false;
    const tx = {
      $queryRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
        const query = sql.join('?');
        if (query.includes('sales_contract_edit_sessions') && query.includes('FOR UPDATE')) {
          assert.equal(values[0], 'lock-recovery');
          recoveryLocked = true;
        }
        return [];
      },
      partnerCommandOutcome: { findUnique: async () => null },
      partnerSaleCase: { findUnique: async () => type === 'CASE_SUBMIT' ? null : {
        id: 'lock-case', state: 'DRAFT', headRevision: 1, integrityHash: hash, customerContract: null,
      } },
    };
    const dependencies = {
      actorId: 'lock-actor', transaction: async (work: (tx: unknown) => Promise<unknown>) => work(tx),
      authorize: async () => {
        assert.equal(recoveryLocked, true, 'Profile lock must never precede the recovery lock');
        authorized = true;
        return { ok: false, error: partnerError('FORBIDDEN') };
      },
      resolveDraft: async () => ({ ok: true, value: { profileId: 'lock-profile' } }),
      consumeRecovery: async () => { throw new Error('Denied writes cannot consume recovery'); },
    } as unknown as PartnerCaseDependencies;
    const result = await createPartnerCaseService(dependencies).execute(await command(type));
    assert.equal(authorized, true);
    assert.equal(result.ok ? null : result.error.code, 'FORBIDDEN');
  });
}
