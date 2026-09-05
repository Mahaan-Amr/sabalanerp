import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import * as contracts from '@sabalanerp/partner-sales-contracts';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import type { OperationsState } from './contracts';
import type { Incident, OperationsStore, RecordedCommand, RemediationEvidence } from './service';
import type { ReadinessEvidence } from './readiness';
import { PARTNER_OPERATIONS_CONTROL_ID } from '../authorization/technicalRollout';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

export function createPrismaPartnerOperationsStore(input: {
  database: PrismaClient; actorId: string; correlationId: string;
}): OperationsStore {
  return { transaction: work => input.database.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM partner_operations_controls
      WHERE id = ${PARTNER_OPERATIONS_CONTROL_ID} FOR UPDATE`;
    const loadControl = () => tx.partnerOperationsControl.findUniqueOrThrow({
      where: { id: PARTNER_OPERATIONS_CONTROL_ID }, include: { cohort: { include: {
        memberships: { select: { profile: { select: { id: true, userId: true } } } },
      } } },
    });
    let selected = await loadControl();
    const readState = (): OperationsState => ({ revision: selected.revision,
      enrollmentPaused: selected.enrollmentPaused, operationalPaused: selected.operationalPaused,
      ...(selected.lastOperationalPauseAt ? { lastOperationalPauseAt: selected.lastOperationalPauseAt.toISOString() } : {}),
      cohort: selected.cohort ? { id: selected.cohort.id, name: selected.cohort.name,
        sellerIds: selected.cohort.memberships.map(item => item.profile.userId) } : null });
    const now = () => new Date().toISOString();
    return work({
      now,
      authorize: async () => {
        const authorizationRoot = selected.cohort?.memberships[0]?.profile ??
          await tx.partnerProfile.findFirst({ orderBy: { id: 'asc' }, select: { id: true, userId: true } });
        if (!authorizationRoot) return { ok: false, error: contracts.partnerError('NOT_FOUND') };
        return createAuditedPartnerAuthorization(tx, { actorId: input.actorId,
          purpose: 'OPERATIONS', channel: 'API' },
        { correlationId: input.correlationId, reason: 'مدیریت عملیاتی کانال فروشنده همکار' })
          .authorize('OPERATIONS_MANAGE', { kind: 'PROFILE', id: authorizationRoot.id });
      },
      readState: async () => readState(),
      writeState: async state => {
        if (!selected.cohort && state.cohort) {
          await tx.partnerReleaseCohort.create({ data: { id: state.cohort.id, name: state.cohort.name,
            activationEnabled: false, enrollmentPaused: true, operationalPaused: true } });
        }
        if (state.cohort) {
          const currentSellerIds = new Set(selected.cohort?.memberships.map(item => item.profile.userId) ?? []);
          for (const sellerId of state.cohort.sellerIds.filter(id => !currentSellerIds.has(id))) {
            const profile = await tx.partnerProfile.findUniqueOrThrow({ where: { userId: sellerId }, select: { id: true } });
            await tx.partnerCohortMembership.create({ data: { id: randomUUID(), profileId: profile.id,
              cohortId: state.cohort.id, actorId: input.actorId,
              eligibilityEvidence: json({ schemaVersion: 1, source: 'OPERATIONS_CONTROL' }) } });
          }
        }
        const updated = await tx.partnerOperationsControl.updateMany({
          where: { id: PARTNER_OPERATIONS_CONTROL_ID, revision: selected.revision },
          data: { revision: state.revision, enrollmentPaused: state.enrollmentPaused,
            operationalPaused: state.operationalPaused,
            lastOperationalPauseAt: state.lastOperationalPauseAt ? new Date(state.lastOperationalPauseAt) : null,
            cohortId: state.cohort?.id ?? null } });
        if (updated.count !== 1) throw new Error('Partner operations CAS failed');
        selected = await loadControl();
      },
      findCommand: async key => {
        const row = await tx.partnerCommandOutcome.findFirst({ where: { operation: 'OPERATIONS_CONTROL', key }, select: { outcome: true } });
        const value = object(row?.outcome)?.operationsCommand;
        return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordedCommand : null;
      },
      appendCommand: async command => {
        await tx.partnerCommandOutcome.create({ data: { id: randomUUID(), actorId: input.actorId,
          operation: 'OPERATIONS_CONTROL', targetScope: 'partner-operations', key: command.key,
          payloadHash: command.intentHash, outcome: json({ schemaVersion: 1, operationsCommand: command }) } });
      },
      appendAudit: async audit => {
        await tx.partnerOperationsControlEvent.create({ data: { id: randomUUID(), controlId: PARTNER_OPERATIONS_CONTROL_ID,
          revision: audit.revision, actorId: audit.actorId, reason: audit.reason,
          commandId: randomUUID(), evidence: json({ schemaVersion: 1, controlAudit: audit }) } });
      },
      readiness: async () => {
        const evidence = selected.readinessEvidence as unknown as ReadinessEvidence | null;
        return { evidence: evidence ?? null, current: { now: now(), releaseId: selected.cohortId ?? PARTNER_OPERATIONS_CONTROL_ID,
          schemaId: 'partner-schema-v1' } };
      },
      enrollmentCandidate: async sellerId => {
        const profile = await tx.partnerProfile.findUnique({ where: { userId: sellerId }, select: { id: true, state: true } });
        return profile ? { sellerId, profileId: profile.id, eligible: profile.state === 'ACTIVE' } : null;
      },
      listOpenIncidents: async () => {
        const rows = await tx.partnerOperationsIncident.findMany({ where: { resolution: { equals: Prisma.AnyNull } },
          orderBy: { firstSeenAt: 'asc' } });
        return rows.map(row => ({ key: row.key, category: row.category, evidenceReference: row.evidenceReference,
          firstSeenAt: row.firstSeenAt.toISOString(), lastSeenAt: row.lastSeenAt.toISOString(), occurrences: row.occurrences }));
      },
      findIncident: async key => {
        const row = await tx.partnerOperationsIncident.findUnique({ where: { key } });
        return row ? { key: row.key, category: row.category, evidenceReference: row.evidenceReference,
          firstSeenAt: row.firstSeenAt.toISOString(), lastSeenAt: row.lastSeenAt.toISOString(), occurrences: row.occurrences,
          ...(row.resolution ? { resolution: row.resolution as Incident['resolution'] } : {}) } : null;
      },
      saveIncident: async incident => {
        await tx.partnerOperationsIncident.upsert({ where: { key: incident.key }, create: { key: incident.key,
          category: incident.category, evidenceReference: incident.evidenceReference, firstSeenAt: new Date(incident.firstSeenAt),
          lastSeenAt: new Date(incident.lastSeenAt), occurrences: incident.occurrences,
          ...(incident.resolution ? { resolution: json(incident.resolution) } : {}) }, update: {
          category: incident.category, evidenceReference: incident.evidenceReference, lastSeenAt: new Date(incident.lastSeenAt),
          occurrences: incident.occurrences, ...(incident.resolution ? { resolution: json(incident.resolution) } : {}) } });
      },
      enqueueTelemetry: async record => {
        const id = randomUUID();
        await tx.partnerCommandOutcome.create({ data: { id, actorId: input.actorId, operation: 'OPERATIONS_TELEMETRY',
          targetScope: 'partner-operations', key: id, payloadHash: await contracts.canonicalHash(record),
          outcome: json({ schemaVersion: 1, telemetry: record }) } });
      },
      remediationEvidence: async incidentKey => {
        const row = await tx.partnerOperationsIncident.findUnique({ where: { key: incidentKey }, select: { remediation: true } });
        return row?.remediation ? row.remediation as unknown as RemediationEvidence : null;
      },
    });
  }) };
}
