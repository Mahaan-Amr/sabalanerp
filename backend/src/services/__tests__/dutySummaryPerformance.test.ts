import assert from 'node:assert/strict';
import test from 'node:test';
import { getCrossWorkspaceDutySummary } from '../crossWorkspaceDutyInbox';
import { PARTNER_PRICING_DUTY_DEFINITIONS } from '../crossWorkspaceDutyAdapters/partnerPricingDutyAdapter';

test('summary reads a source once across views and rereads it on the next request', async () => {
  const now = new Date('2026-10-11T10:00:00Z');
  const definition = PARTNER_PRICING_DUTY_DEFINITIONS.PARTNER_PRICE_REVIEW;
  const duty = { id: 'duty', sourceType: 'PARTNER_PRICING', sourceId: 'inquiry', sourceVersion: 1,
    sourceActionCode: definition.sourceActionCode, envelopeCode: definition.envelopeCode, envelopeVersion: 1,
    destinationWorkspaceCode: 'SALES', currentAssigneeUserId: 'actor', status: 'OPEN',
    dueAt: now, createdAt: now, updatedAt: now, respondedAt: null, structuredResultJson: null,
    assignmentHistory: [], envelope: { isActive: true, allowedFieldsJson: [...definition.allowedFields],
      allowedEvidenceJson: [], allowedActionCodesJson: [], responseSchemaJson: definition.responseSchema } };
  let reads = 0;
  let evidenceReads = 0;
  let pending = true;
  const rows = Array.from({ length: 16 }, (_, index) => ({ outcome: 'PENDING', definition: {
    version: 1, configurationRef: { recoveryId: 'recovery', recoveryRevision: 1, productRowId: `row-${index}` },
    identity: { schemaVersion: 1, partnerSellerId: 'partner', catalogProductId: 'stone', family: 'prepared', unit: 'count',
      configuration: [{ key: 'quantity', value: '2' }], materialRateEvidenceId: 'rate',
      materialRateHash: 'sha256-v1:' + 'a'.repeat(64), components: [], currency: 'IRT',
      calculationPolicyVersion: 'calc', roundingPolicyVersion: 'rounding' }, description: 'سنگ', configuration: [],
  } }));
  const database = {
    user: { findUnique: async () => ({ role: 'ADMIN', isActive: true }) },
    crossWorkspaceDuty: { findMany: async ({ where }: any) => where.status === 'OPEN'
      && where.currentAssigneeUserId !== null ? [duty] : [] },
    crossWorkspaceDutyHistoryReceipt: { findUnique: async () => null },
    crossWorkspaceDutyAvailableReceipt: { findUnique: async () => null },
    salesContractEditSession: { findUnique: async () => { evidenceReads++; return {
      ownerUserId: 'partner', recovery: { validatedSnapshots: [] } }; } },
    partnerInquiry: { findUnique: async () => { reads++; return { id: 'inquiry', caseId: 'case',
      case: { customer: { firstName: 'مشتری', lastName: '' } },
      profile: { userId: 'partner' }, rows: pending ? rows : [] }; } },
  };
  const input = { actorUserId: 'actor', workspaceCode: 'sales', now };
  const summary = await getCrossWorkspaceDutySummary(database as any, input);
  assert.deepEqual(summary, { open: 1, available: 0, availableUnseen: 0, attention: 1,
    dueSoon: 1, overdue: 0, triage: 1, historyUnseen: 0, canManageTriage: true });
  assert.equal(reads, 1, 'one summary must not reload the same source for triage');
  assert.equal(evidenceReads, 1, 'sixteen rows must share one protected journal read');
  pending = false;
  assert.equal((await getCrossWorkspaceDutySummary(database as any, input)).attention, 0);
  assert.equal(reads, 2, 'the shared Prisma client must not retain a previous request source');
});
