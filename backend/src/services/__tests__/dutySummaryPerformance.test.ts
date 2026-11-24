import assert from 'node:assert/strict';
import test from 'node:test';
import { getCrossWorkspaceDutySummary, listCrossWorkspaceDutyHistoryPage } from '../crossWorkspaceDutyInbox';
import { PARTNER_PRICING_DUTY_DEFINITIONS } from '../crossWorkspaceDutyAdapters/partnerPricingDutyAdapter';
import { SALES_CONTRACT_CORRECTION_DUTY_DEFINITIONS } from '../crossWorkspaceDutyAdapters/salesContractCorrectionDutyAdapter';

test('summary shares recovery evidence across inquiries and rereads it on the next request', async () => {
  const now = new Date('2026-10-11T10:00:00Z');
  const definition = PARTNER_PRICING_DUTY_DEFINITIONS.PARTNER_PRICE_REVIEW;
  const duty = { id: 'duty', sourceType: 'PARTNER_PRICING', sourceId: 'inquiry', sourceVersion: 1,
    sourceActionCode: definition.sourceActionCode, envelopeCode: definition.envelopeCode, envelopeVersion: 1,
    destinationWorkspaceCode: 'SALES', currentAssigneeUserId: 'actor', status: 'OPEN',
    dueAt: now, createdAt: now, updatedAt: now, respondedAt: null, structuredResultJson: null,
    assignmentHistory: [], envelope: { isActive: true, allowedFieldsJson: [...definition.allowedFields],
      allowedEvidenceJson: [], allowedActionCodesJson: [], responseSchemaJson: definition.responseSchema } };
  let activePasses = 0;
  let managerReads = 0;
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
    user: { findUnique: async () => { managerReads++; return { role: 'ADMIN', isActive: true }; } },
    crossWorkspaceDuty: { findMany: async ({ where }: any) => {
      if (where.status !== 'OPEN') return [];
      activePasses++;
      return where.currentAssigneeUserId !== null
        ? [duty, { ...duty, id: 'second-duty', sourceId: 'second-inquiry' }] : [];
    } },
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
  assert.equal(activePasses, 1, 'one active candidate pass supplies all three active views');
  assert.equal(managerReads, 1, 'all active views and unseen history use the same manager decision');
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

test('correction history counts exact visible duties with batched evidence and a fresh grant decision per request', async () => {
  const now = new Date('2026-11-25T10:00:00Z');
  const lastSeenAt = new Date('2026-11-24T10:00:00Z');
  const definition = SALES_CONTRACT_CORRECTION_DUTY_DEFINITIONS.ACCOUNTING_VERIFY_CONTRACT_CORRECTION;
  const processingDefinition = SALES_CONTRACT_CORRECTION_DUTY_DEFINITIONS.ACCOUNTING_PROCESS_CONTRACT_CORRECTION;
  function envelope(definition: typeof SALES_CONTRACT_CORRECTION_DUTY_DEFINITIONS[keyof typeof SALES_CONTRACT_CORRECTION_DUTY_DEFINITIONS]) {
    return { isActive: true, allowedFieldsJson: [...definition.allowedFields], allowedEvidenceJson: [],
      allowedActionCodesJson: [...definition.allowedActionCodes], responseSchemaJson: definition.responseSchema };
  }
  const duty = {
    id: 'parent', sourceType: 'SALES_CONTRACT_CORRECTION', sourceId: 'correction', sourceVersion: 1,
    sourceActionCode: definition.sourceActionCode, envelopeCode: definition.envelopeCode, envelopeVersion: 1,
    destinationWorkspaceCode: 'ACCOUNTING', currentAssigneeUserId: null, sourceActorUserId: 'seller',
    status: 'COMPLETED', dueAt: now, createdAt: now, updatedAt: now, assignmentHistory: [],
    respondedAt: null, structuredResultJson: { actionCode: 'VERIFY' },
    envelope: envelope(definition),
  };
  const rows = [
    ...Array.from({ length: 212 }, (_, index) => ({
      ...duty, id: `duty-${index}`, sourceId: `correction-${index}`,
    })),
    { ...duty, id: 'self-decision', sourceId: 'correction-0', sourceActorUserId: 'actor' },
    { ...duty, id: 'missing-source', sourceId: 'missing' },
    { ...duty, id: 'missing-contract', sourceId: 'orphan' },
    { ...duty, id: 'stale-envelope', sourceId: 'correction-0', envelope: { ...duty.envelope, isActive: false } },
    { ...duty, id: 'former-assignee', sourceId: 'missing',
      sourceActionCode: processingDefinition.sourceActionCode, envelopeCode: processingDefinition.envelopeCode,
      envelope: envelope(processingDefinition), assignmentHistory: [{ assignedUserId: 'actor' }] },
    { ...duty, id: 'current-assignee', sourceId: 'correction-0', currentAssigneeUserId: 'actor',
      sourceActionCode: processingDefinition.sourceActionCode, envelopeCode: processingDefinition.envelopeCode,
      envelope: envelope(processingDefinition) },
    { ...duty, id: 'already-seen', sourceId: 'correction-0', updatedAt: lastSeenAt },
    { ...duty, id: 'sales-workspace', sourceId: 'correction-0', destinationWorkspaceCode: 'SALES' },
    { ...duty, id: 'active', sourceId: 'correction-0', status: 'OPEN', sourceVersion: 4 },
    { ...duty, id: 'stale-active', sourceId: 'correction-0', status: 'OPEN', sourceVersion: 3 },
  ];
  const correction = (id: string) => id === 'missing' ? null : {
    id, contractId: id === 'orphan' ? 'deleted-contract' : `contract-${id}`,
    dutySourceVersion: 4, accountantNote: 'Review the source',
  };
  const contract = (id: string) => id === 'deleted-contract' ? null : {
    id, contractNumber: id, status: 'SIGNED', partnerCaseId: 'partner-case',
    customer: { firstName: 'Sample', lastName: 'Customer' },
  };
  const reads = { corrections: 0, contracts: 0, grant: 0, duty: 0 };
  const readCorrectionIds: string[] = [];
  let directGrantRevoked = false;
  const empty = { findMany: async () => [], findUnique: async () => null, findFirst: async () => null };
  const database = {
    user: { findUnique: async () => ({ isActive: true, role: 'USER' }) },
    workspacePermission: empty,
    roleWorkspacePermission: empty,
    featurePermission: { ...empty, findUnique: async ({ where }: any) => {
      if (where.userId_workspace_feature.feature !== 'accounting_corrections_verify') return null;
      reads.grant++;
      return directGrantRevoked ? { id: 'direct-grant', isActive: false, permissionLevel: 'edit' } : null;
    } },
    roleFeaturePermission: { ...empty, findUnique: async ({ where }: any) => (
      where.role_workspace_feature.feature === 'accounting_corrections_verify'
        ? { id: 'role-grant', isActive: true, permissionLevel: 'edit' } : null
    ) },
    hrWorkspaceAccessGrant: empty,
    hrFeatureAccessGrant: empty,
    crossWorkspaceDuty: {
      findMany: async ({ where, cursor, take }: any) => {
        const eligible = rows.filter(row => (typeof where.status === 'string' ? row.status === where.status : where.status.in.includes(row.status))
          && row.destinationWorkspaceCode === where.destinationWorkspaceCode
          && (!where.updatedAt?.gt || row.updatedAt > where.updatedAt.gt));
        const start = cursor ? eligible.findIndex(row => row.id === cursor.id) + 1 : 0;
        return eligible.slice(start, take === undefined ? undefined : start + take);
      },
      findUnique: async ({ where }: any) => { reads.duty++; return rows.find(row => row.id === where.id); },
      findFirst: async () => null,
    },
    crossWorkspaceDutyHistoryReceipt: { findUnique: async () => ({ lastSeenAt }) },
    crossWorkspaceDutyAvailableReceipt: { findUnique: async () => null },
    accountingCorrectionRequest: {
      findUnique: async ({ where }: any) => { reads.corrections++; return correction(where.id); },
      findMany: async ({ where }: any) => {
        reads.corrections++;
        readCorrectionIds.push(...where.id.in);
        return where.id.in.map(correction).filter(Boolean);
      },
    },
    salesContract: {
      findUnique: async ({ where }: any) => { reads.contracts++; return contract(where.id); },
      findMany: async ({ where }: any) => { reads.contracts++; return where.id.in.map(contract).filter(Boolean); },
    },
  };
  const input = { actorUserId: 'actor', workspaceCode: 'accounting', now };
  const summary = await getCrossWorkspaceDutySummary(database as any, input);
  assert.equal(summary.historyUnseen, 214);
  assert.equal(summary.open, 1, 'only the current verification stage is actionable');
  assert.deepEqual(reads, { corrections: 2, contracts: 2, grant: 1, duty: 0 });
  assert.equal(readCorrectionIds.filter(id => id === 'correction-0').length, 1,
    'active and history reuse the common source evidence');

  directGrantRevoked = true;
  assert.equal((await getCrossWorkspaceDutySummary(database as any, input)).historyUnseen, 2);
  assert.equal(reads.grant, 2, 'a new request checks the now-revoked direct grant');

  const redactedHistory = await listCrossWorkspaceDutyHistoryPage(database as any, input);
  assert.deepEqual(redactedHistory.duties.map(({ id, detailAvailable }) => ({ id, detailAvailable })), [
    { id: 'former-assignee', detailAvailable: false },
    { id: 'current-assignee', detailAvailable: true },
  ]);
  assert.deepEqual(redactedHistory.duties[0].fields, {});
  assert.equal(redactedHistory.duties[0].result, null);
  assert.equal(redactedHistory.nextCursor, null);

  directGrantRevoked = false;
  const history = await listCrossWorkspaceDutyHistoryPage(database as any, input);
  assert.equal(history.duties.length, 50);
  assert.equal(history.nextCursor, 'duty-49');
  assert.equal(history.duties[0].destinationHref, '/dashboard/accounting/contracts/partner/partner-case?section=financial');
  assert.deepEqual(history.duties[0].allowedActionCodes, []);
  assert.deepEqual(history.duties[0].accessProvenance, ['مجوز قابلیت از نقش']);
});
