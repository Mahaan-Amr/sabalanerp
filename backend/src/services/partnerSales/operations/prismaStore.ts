import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import * as contracts from '@sabalanerp/partner-sales-contracts';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import { readAuthorizationDecisionByCorrelation } from '../../effectiveAuthorization/audit';
import type { OperationsState } from './contracts';
import type { Incident, OperationsStore, RecordedCommand, RemediationEvidence } from './service';
import type { ReadinessEvidence } from './readiness';
import { PARTNER_OPERATIONS_CONTROL_ID } from '../authorization/technicalRollout';
import { createPrismaPartnerProfileStore } from '../profiles/prismaStore';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

export function createPrismaPartnerOperationsStore(input: {
  database: PrismaClient; actorId: string; correlationId: string;
  runtimeIdentity: { releaseId: string; schemaId: string };
}): OperationsStore {
  const profileStore = createPrismaPartnerProfileStore(input.database);
  return { transaction: work => input.database.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM partner_operations_controls
      WHERE id = ${PARTNER_OPERATIONS_CONTROL_ID} FOR UPDATE`;
    const loadControl = () => tx.partnerOperationsControl.findUniqueOrThrow({
      where: { id: PARTNER_OPERATIONS_CONTROL_ID }, include: { cohort: { include: {
        memberships: { select: { profile: { select: { id: true, userId: true } } } },
      } } },
    });
    let selected = await loadControl();
    let enrollmentAuthorization: { evidenceId: string; authorizationRevision: number; lifecycleRevision: number } | null = null;
    let enrollmentReadiness: ReadinessEvidence | null = null;
    let enrollmentCandidateEvidence: { sellerId: string; profileId: string; profileRevision: number;
      gateEvidenceIds: string[] } | null = null;
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
        const authorizationTarget = authorizationRoot ? undefined : { prospectiveProfileOwnerId: input.actorId };
        const result = await createAuditedPartnerAuthorization(tx, { actorId: input.actorId,
          purpose: 'OPERATIONS', channel: 'API' },
        { correlationId: input.correlationId, reason: 'مدیریت عملیاتی کانال فروشنده همکار' },
        authorizationTarget)
          .authorize('OPERATIONS_MANAGE', { kind: 'PROFILE',
            id: authorizationRoot?.id ?? `prospective:operations:${input.actorId}` });
        if (result.ok) {
          const rootId = authorizationRoot?.id ?? `prospective:operations:${input.actorId}`;
          const evidence = await readAuthorizationDecisionByCorrelation(tx, { domain: 'PARTNER', actorId: input.actorId,
            action: 'OPERATIONS_MANAGE', rootKind: 'PROFILE', rootId, purpose: 'OPERATIONS', channel: 'API',
            correlationId: input.correlationId, allowed: true });
          if (!evidence) return { ok: false, error: contracts.partnerError('INTEGRITY_CONFLICT') };
          enrollmentAuthorization = { evidenceId: evidence.id, authorizationRevision: result.value.authorizationRevision,
            lifecycleRevision: result.value.lifecycleRevision };
        }
        return result;
      },
      readState: async () => readState(),
      writeState: async state => {
        if (!selected.cohort && state.cohort) {
          await tx.partnerReleaseCohort.create({ data: { id: state.cohort.id, name: state.cohort.name,
            activationEnabled: true, enrollmentPaused: true, operationalPaused: true,
            readinessEvidence: selected.readinessEvidence === null ? Prisma.DbNull
              : selected.readinessEvidence as Prisma.InputJsonValue } });
        }
        if (state.cohort) {
          const currentSellerIds = new Set(selected.cohort?.memberships.map(item => item.profile.userId) ?? []);
          for (const sellerId of state.cohort.sellerIds.filter(id => !currentSellerIds.has(id))) {
            const profile = await tx.partnerProfile.findUniqueOrThrow({ where: { userId: sellerId }, select: { id: true } });
            if (!enrollmentAuthorization || !enrollmentReadiness || !enrollmentCandidateEvidence ||
                enrollmentCandidateEvidence.sellerId !== sellerId || enrollmentCandidateEvidence.profileId !== profile.id) {
              throw new Error('Missing current Partner enrollment provenance');
            }
            await tx.partnerCohortMembership.create({ data: { id: randomUUID(), profileId: profile.id,
              cohortId: state.cohort.id, actorId: input.actorId,
              eligibilityEvidence: json({ schemaVersion: 1, source: 'OPERATIONS_CONTROL',
                readinessEvidenceId: enrollmentReadiness.evidenceId,
                authorizationEvidenceId: enrollmentAuthorization.evidenceId,
                authorizationCorrelationId: input.correlationId,
                authorizationRevision: enrollmentAuthorization.authorizationRevision,
                lifecycleRevision: enrollmentAuthorization.lifecycleRevision,
                profileRevision: enrollmentCandidateEvidence.profileRevision,
                gateEvidenceIds: enrollmentCandidateEvidence.gateEvidenceIds }) } });
          }
          await tx.partnerReleaseCohort.update({ where: { id: state.cohort.id }, data: {
            activationEnabled: selected.cohort ? selected.cohort.activationEnabled : true,
            enrollmentPaused: state.enrollmentPaused, operationalPaused: state.operationalPaused,
            readinessEvidence: selected.readinessEvidence === null ? Prisma.DbNull
              : selected.readinessEvidence as Prisma.InputJsonValue,
          } });
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
        enrollmentReadiness = evidence;
        return { evidence: evidence ?? null, current: { now: now(), ...input.runtimeIdentity } };
      },
      enrollmentCandidate: async sellerId => {
        const profile = await tx.partnerProfile.findUnique({ where: { userId: sellerId }, select: {
          id: true, userId: true, state: true, revision: true, firstActivatedAt: true, irreversibleAt: true } });
        if (!profile || !['PENDING', 'ACTIVE'].includes(profile.state)) return null;
        const gates = await profileStore.readActivationGates(tx, profile);
        const eligible = profile.state === 'ACTIVE' || gates.identityVerified && gates.commercialTermsReady && gates.creditTermsReady &&
          gates.responderReady && gates.conversionCleared && gates.userActive && !gates.conflictingInternalAuthority;
        enrollmentCandidateEvidence = { sellerId, profileId: profile.id, profileRevision: profile.revision,
          gateEvidenceIds: [...gates.evidenceIds].sort() };
        return { sellerId, profileId: profile.id, eligible };
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
