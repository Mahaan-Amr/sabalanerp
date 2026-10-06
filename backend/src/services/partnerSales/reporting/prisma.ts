import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import * as contracts from '@sabalanerp/partner-sales-contracts';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import { projectPartnerAccount } from '../accounting/account';
import { readPersistedPartnerEvents } from '../events/persisted';
import { readPartnerSnapshot } from '../authorization/readSnapshot';
import { comparableCommercialRevision } from './comparable';
import { caseHistory } from './history';
import { effectiveThrough, visibleEvents } from './revenue';
import { readPartnerShipmentQuantityProjection } from '../fulfillment/quantityStore';
import { latestPartnerFinancialApproval, readPartnerOfficialPurchase } from '../accounting/officialPurchase';
import type {
  CaseEvidence, FrozenExport, Period, Query, ReportExportStore, ReportPurpose, ReportingSource, Root,
} from './contracts';

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const ownsRevision = (owner: { caseId: string; revision: number; integrityHash: string },
  expected: { caseId: string; revision: number; integrityHash: string }) =>
  owner.caseId === expected.caseId && owner.revision === expected.revision && owner.integrityHash === expected.integrityHash;

const integrityConflict = (): never => { throw new Error('Partner reporting integrity conflict'); };

export function verifyPartnerReportingHead(projection: unknown, head: contracts.RevisionRef,
  linked: { internalRecordId: string; customerContractNumber: string }) {
  const source = object(projection);
  const partner = contracts.PartnerCaseViewSchema.parse(source?.partner);
  if (!ownsRevision(partner.owner, head) || (partner.customerContractNumber &&
    partner.customerContractNumber !== linked.customerContractNumber)) integrityConflict();
  // An approved commercial edit can await fresh wholesale prices. Its head
  // then has no accounting/fulfillment projection; financial history is read
  // below from the effective committed revision, never from an invented price.
  if (!partner.sabalanTotals) {
    if (source?.accounting !== undefined || source?.fulfillment !== undefined) integrityConflict();
    return;
  }
  const internal = contracts.SabalanInternalRecordViewSchema.parse(source?.accounting);
  const fulfillment = contracts.FulfillmentViewSchema.parse(source?.fulfillment);
  if (!ownsRevision(internal.owner, head) || !ownsRevision(fulfillment.owner, head) ||
    internal.recordId !== linked.internalRecordId || fulfillment.recordId !== linked.internalRecordId) integrityConflict();
}

export function createPrismaPartnerReportExportStore(database: PrismaClient): ReportExportStore {
  return {
    async get(id) {
      const row = await database.partnerReportExport.findUnique({ where: { id } });
      if (!row) return null;
      return { id: row.id, actorId: row.actorId, expiresAt: row.expiresAt.toISOString(),
        query: row.query as unknown as FrozenExport['query'], report: row.report as unknown as FrozenExport['report'],
        roots: row.roots as unknown as Root[], contentHash: row.contentHash };
    },
  };
}

export function createPrismaPartnerReportingSource(input: {
  database: PrismaClient; actorId: string; correlationId: string;
}): ReportingSource {
  return { async read(query, work) {
    return readPartnerSnapshot(input.database, async tx => {
      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
      const period = { from: query.from, to: query.to, asOf: clock.now.toISOString() };
      const through = effectiveThrough(period);
      const roots = await tx.partnerSaleCase.findMany({ where: { customerContractId: { not: null }, events: { some: {
        type: 'CASE_COMMITTED', effectiveDate: { lte: new Date(`${through}T00:00:00.000Z`) }, recordedAt: { lte: clock.now } } } }, select: { id: true,
        trackingCode: { select: { number: true } }, profile: { select: { userId: true } },
        customerContract: { select: { departmentId: true } } }, orderBy: { id: 'asc' } });
      const mapped: Root[] = roots.flatMap(row => row.customerContract ? [{ caseId: row.id,
        partnerSellerId: row.profile.userId, departmentId: row.customerContract.departmentId,
        ...(row.trackingCode ? { trackingNumber: row.trackingCode.number } : {}) }] : []);
      const channel = query.search ? 'SEARCH' as const : 'LIST' as const;
      const baseAuthorization = createAuditedPartnerAuthorization(tx, { actorId: input.actorId,
        purpose: query.purpose, channel }, { correlationId: input.correlationId });
      let access: Awaited<ReturnType<typeof baseAuthorization.authorize>> = {
        ok: false, error: contracts.partnerError('NOT_FOUND') };
      if (query.purpose === 'PARTNER') {
        const profile = await tx.partnerProfile.findUnique({ where: { userId: input.actorId }, select: { id: true } });
        if (profile) access = await baseAuthorization.authorize('REPORT_READ', { kind: 'PROFILE', id: profile.id });
      } else {
        const candidates = query.caseId ? mapped.filter(candidate => candidate.caseId === query.caseId) : mapped;
        for (const candidate of candidates) {
          const decision = await baseAuthorization.authorize('REPORT_READ', { kind: 'CASE', id: candidate.caseId });
          if (decision.ok) { access = decision; break; }
          if (!['NOT_FOUND', 'FORBIDDEN', 'PARTNER_NOT_ACTIVE'].includes(decision.error.code)) {
            access = decision; break;
          }
          access = decision;
        }
      }
      return work({ snapshotId: randomUUID(), capturedAt: clock.now.toISOString(), access, roots: mapped,
        authorization: (purpose, requestedChannel) => createAuditedPartnerAuthorization(tx, { actorId: input.actorId,
          purpose, channel: requestedChannel }, { correlationId: input.correlationId }),
        caseEvidence: (candidate, purpose) => caseEvidence(tx, candidate, purpose, period),
        putExport: artifact => tx.partnerReportExport.create({ data: { id: artifact.id,
          actorId: artifact.actorId, expiresAt: new Date(artifact.expiresAt),
          query: artifact.query as Prisma.InputJsonObject,
          report: artifact.report as unknown as Prisma.InputJsonObject,
          roots: artifact.roots as unknown as Prisma.InputJsonArray, contentHash: artifact.contentHash } }).then(() => undefined),
      });
    });
  } };
}

async function caseEvidence(tx: Prisma.TransactionClient, root: Root, purpose: ReportPurpose, period: Period): Promise<CaseEvidence> {
  const through = effectiveThrough(period);
  const cutoff = new Date(Math.min(Date.parse(`${through}T23:59:59.999+03:30`), Date.parse(period.asOf)));
  const row = await tx.partnerSaleCase.findUnique({ where: { id: root.caseId }, select: {
    id: true, headRevision: true, integrityHash: true, internalRecordId: true, customerContractId: true,
    head: { select: { internalProjection: true } },
    revisions: { orderBy: { revision: 'asc' }, select: { revision: true, integrityHash: true, internalProjection: true,
      wholesaleEnvelope: true, retailEnvelope: true } },
    events: { orderBy: { sequence: 'asc' }, select: {
      id: true, type: true, caseRevision: true, integrityHash: true, evidence: true,
      toState: true, effectiveDate: true, recordedAt: true,
    } },
    customerContract: { select: { departmentId: true, contractNumber: true, commercialFlowVersion: true, reportingEvents: true } },
    profile: { select: { userId: true } },
  } });
  if (!row?.internalRecordId || !row.customerContract || row.profile.userId !== root.partnerSellerId ||
      row.customerContract.departmentId !== root.departmentId) {
    throw new Error('Partner report root changed during snapshot');
  }
  const customerContractNumber = row.customerContract.contractNumber;
  const head = { caseId: row.id, revision: row.headRevision, integrityHash: row.integrityHash };
  verifyPartnerReportingHead(row.head.internalProjection, head, { internalRecordId: row.internalRecordId, customerContractNumber });
  const events = readPersistedPartnerEvents({ ...row, internalRecordId: row.internalRecordId }, row.events);
  const history = caseHistory(contracts, visibleEvents(contracts, events, period));
  const stateEvent = row.events.filter(event => event.toState && event.recordedAt.toISOString() <= period.asOf &&
    event.effectiveDate.toISOString().slice(0, 10) <= through).at(-1);
  const effective = history.effective ?? (stateEvent ? { caseId: row.id,
    revision: stateEvent.caseRevision, integrityHash: stateEvent.integrityHash } : undefined);
  if (!effective) return integrityConflict();
  const revision = row.revisions.find(candidate => candidate.revision === effective.revision && candidate.integrityHash === effective.integrityHash);
  if (!revision) return integrityConflict();
  const selected = contracts.SabalanInternalRecordViewSchema.parse(object(revision.internalProjection)?.accounting);
  const fulfillment = contracts.FulfillmentViewSchema.parse(object(revision.internalProjection)?.fulfillment);
  if (!ownsRevision(selected.owner, effective) || !ownsRevision(fulfillment.owner, effective) ||
      selected.recordId !== row.internalRecordId || fulfillment.recordId !== row.internalRecordId ||
      selected.customerContractNumber !== customerContractNumber) return integrityConflict();
  const internal = { ...selected, state: history.voided ? 'VOIDED' as const : history.commitment ? 'COMMITTED' as const
    : contracts.CaseStateSchema.parse(stateEvent?.toState) };
  const commercial = ['PARTNER', 'MANAGEMENT'].includes(purpose) ? row.revisions.flatMap(revision => {
    const view = contracts.PartnerCaseViewSchema.parse(object(revision.internalProjection)?.partner);
    if (!ownsRevision(view.owner, { caseId: row.id, revision: revision.revision,
      integrityHash: revision.integrityHash })) integrityConflict();
    if (!view.sabalanTotals && !view.customerContractNumber) return [];
    // Early linked-pair allocation stored the pre-numbered Partner projection.
    // Derive its public number from the verified linked customer Contract for
    // reporting; the immutable revision and its commercial amounts stay intact.
    if (view.customerContractNumber && view.customerContractNumber !== customerContractNumber) integrityConflict();
    const numbered = view.customerContractNumber ? view
      : contracts.PartnerCaseViewSchema.parse({ ...view, customerContractNumber });
    const comparable = comparableCommercialRevision(numbered, revision);
    return comparable ? [comparable] : [];
  }) : undefined;
  const progress = await readPartnerShipmentQuantityProjection(tx, row.id,
    { cutoff: cutoff.toISOString(), mode: 'OPERATIONAL_AS_OF' });
  const { official, covered } = await readPartnerOfficialPurchase(tx, { internalRecordId: internal.recordId,
    approval: latestPartnerFinancialApproval(visibleEvents(contracts, events, period)),
    cutoff, asOf: new Date(period.asOf), voided: Boolean(history.voided) });
  let account: CaseEvidence['account'] = null;
  if (covered && ['COMMITTED', 'VOIDED'].includes(internal.state)) {
    const accountView = await projectPartnerAccount({ partnerSellerId: root.partnerSellerId,
      purchases: [{ source: { view: internal, partnerSellerId: root.partnerSellerId }, official }] }, root.partnerSellerId);
    if (!accountView.ok) throw new Error(`Partner accounting projection failed: ${accountView.error.code}`);
    account = accountView.value.purchases[0] ?? null;
  }
  const financialRevenue = row.customerContract.commercialFlowVersion === 2
    ? row.customerContract.reportingEvents.filter(item => item.effectiveAt <= cutoff && item.createdAt <= new Date(period.asOf)).map(item => ({ amount: item.amount.toString(), effectiveDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(item.effectiveAt), recordedAt: item.createdAt.toISOString() })) : undefined;
  return { root, events, internal, fulfillment, ...(financialRevenue ? { financialRevenue } : {}), ...(commercial ? { commercial } : {}), account,
    deliveryProgress: progress.rows.length && progress.rows.every(item => item.health === 'CURRENT' && item.quantities)
      ? progress.rows.map(item => ({ productRowId: item.productRowId, unit: item.unit,
        contracted: item.quantities!.contracted, reserved: item.quantities!.finalizedReserved,
        dispatched: item.quantities!.physicallyDispatched })) : null };
}
