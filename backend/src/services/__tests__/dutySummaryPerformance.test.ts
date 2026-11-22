import assert from 'node:assert/strict';
import test from 'node:test';
import { getCrossWorkspaceDutySummary } from '../crossWorkspaceDutyInbox';
import { PARTNER_PRICING_DUTY_DEFINITIONS } from '../crossWorkspaceDutyAdapters/partnerPricingDutyAdapter';

test('summary shares recovery evidence across inquiries and rereads it on the next request', async () => {
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
      && where.currentAssigneeUserId !== null ? [duty, { ...duty, id: 'second-duty', sourceId: 'second-inquiry' }] : [] },
    crossWorkspaceDutyHistoryReceipt: { findUnique: async () => null },
    crossWorkspaceDutyAvailableReceipt: { findUnique: async () => null },
    $queryRaw: async () => { evidenceReads++; return [{
      ownerUserId: 'partner', recovery: Buffer.from(JSON.stringify({ validatedSnapshots: [] })) }]; },
    partnerInquiry: { findUnique: async () => { reads++; return { id: 'inquiry', caseId: 'case',
      case: { customer: { firstName: 'مشتری', lastName: '' } },
      profile: { userId: 'partner' }, rows: pending ? rows : [] }; } },
  };
  const input = { actorUserId: 'actor', workspaceCode: 'sales', now };
  const summary = await getCrossWorkspaceDutySummary(database as any, input);
  assert.deepEqual(summary, { open: 2, available: 0, availableUnseen: 0, attention: 2,
    dueSoon: 2, overdue: 0, triage: 2, historyUnseen: 0, canManageTriage: true });
  assert.equal(reads, 2, 'each inquiry is read once across assigned and triage views');
  assert.equal(evidenceReads, 1, 'different inquiries referencing the same recovery share one protected journal read');
  pending = false;
  assert.equal((await getCrossWorkspaceDutySummary(database as any, input)).attention, 0);
  assert.equal(reads, 4, 'the shared Prisma client must not retain a previous request source');
  assert.equal(evidenceReads, 1, 'empty next-request rows do not require historical evidence');
  pending = true;
  assert.equal((await getCrossWorkspaceDutySummary(database as any, input)).attention, 2);
  assert.equal(evidenceReads, 2, 'a new summary rereads the shared journal instead of caching across requests');
});
