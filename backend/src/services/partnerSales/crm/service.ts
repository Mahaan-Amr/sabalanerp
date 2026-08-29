import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { DuplicateCustomerMatchSchema, PartnerCommandSchema, canonicalHash, partnerError,
  type DuplicateCustomerMatch, type PartnerActionV2, type PermissionContext, type Result } from '@sabalanerp/partner-sales-contracts';
import { PartnerCustomerCreateSchema, PartnerCustomerUpdateSchema, PartnerDuplicateSearchSchema,
  PartnerFollowUpCreateSchema, PartnerNextActionCompleteSchema, PartnerProjectCreateSchema,
  PartnerProjectUpdateSchema, PartnerTransferRequestSchema, type PartnerCustomerDetail, type PartnerCustomerSummary,
  type PartnerFollowUpView, type PartnerNextActionView, type PartnerProjectView } from './contracts';

type Root = PermissionContext['root'];
type Authorization = (tx: Prisma.TransactionClient, input: { action: PartnerActionV2; root: Root;
  correlationId: string; reason?: string; target?: { customerTransferId: string } }) => Promise<Result<PermissionContext>>;
type TransferNotice = (tx: Prisma.TransactionClient, input: { kind: 'REQUESTED' | 'APPROVED' | 'REJECTED';
  transferId: string; recipientIds: string[]; actorId: string; correlationId: string }) => Promise<void>;

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const object = (value: Prisma.JsonValue): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const commandIntent = (input: Record<string, unknown>) => Object.fromEntries(Object.entries(input)
  .filter(([key]) => !['commandId', 'correlationId', 'idempotency', 'idempotencyKey', 'payloadHash'].includes(key)));
const digits = (value: string) => value.trim().replace(/[۰-۹]/g, character => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(character)))
  .replace(/[٠-٩]/g, character => String('٠١٢٣٤٥٦٧٨٩'.indexOf(character))).replace(/\D/g, '');
const displayName = (customer: { firstName: string; lastName: string; companyName: string | null }) =>
  customer.companyName?.trim() || `${customer.firstName} ${customer.lastName}`.trim();
const personType = (customerType: string): 'NATURAL' | 'LEGAL' =>
  ['Company', 'Legal', 'حقوقی'].includes(customerType) ? 'LEGAL' : 'NATURAL';

async function currentProfile(tx: Prisma.TransactionClient, actorId: string, mutation: boolean) {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${actorId} FOR UPDATE`;
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { isActive: true,
    partnerProfile: { select: { id: true, userId: true, state: true, revision: true } } } });
  const profile = actor?.partnerProfile;
  if (!actor?.isActive || !profile || profile.state === 'PENDING' || profile.state === 'TERMINATED' ||
      (mutation && profile.state !== 'ACTIVE')) return null;
  await tx.$queryRaw`SELECT id FROM partner_profiles WHERE id = ${profile.id} FOR UPDATE`;
  return profile;
}

async function useProfile(tx: Prisma.TransactionClient, profileId: string) {
  await tx.$executeRaw`SELECT set_config('sabalan.partner_crm_profile', ${profileId}, true)`;
}

function customerSummary(row: { id: string; partnerRevision: number | null; firstName: string; lastName: string;
  companyName: string | null; customerType: string; city: string | null; phoneNumbers: { number: string; isPrimary: boolean }[] }): PartnerCustomerSummary | undefined {
  if (!row.partnerRevision) return undefined;
  const phone = row.phoneNumbers.find(item => item.isPrimary)?.number ?? row.phoneNumbers[0]?.number;
  if (!phone) return undefined;
  return { schemaVersion: 1, purpose: 'PARTNER_CRM_CUSTOMER', customerId: row.id, revision: row.partnerRevision,
    displayName: displayName(row), personType: personType(row.customerType), ...(row.city ? { city: row.city } : {}), phone };
}

function projectView(row: { id: string; partnerRevision: number | null; title: string; status: string; workType: string;
  address: string | null; probability: number | null; expectedCloseDate: Date | null; description: string | null;
  lostReason: string | null; dormantReason: string | null; revisitDate: Date | null }): PartnerProjectView | undefined {
  if (!row.partnerRevision) return undefined;
  return { projectId: row.id, revision: row.partnerRevision, title: row.title, status: row.status, workType: row.workType,
    ...(row.address ? { address: row.address } : {}), ...(row.probability !== null ? { probability: row.probability } : {}),
    ...(row.expectedCloseDate ? { expectedCloseDate: row.expectedCloseDate.toISOString() } : {}),
    ...(row.description ? { description: row.description } : {}), ...(row.lostReason ? { lostReason: row.lostReason } : {}),
    ...(row.dormantReason ? { dormantReason: row.dormantReason } : {}),
    ...(row.revisitDate ? { revisitDate: row.revisitDate.toISOString() } : {}) };
}

function validProjectLifecycle(command: { status: string; lostReason?: string; dormantReason?: string; revisitDate?: string }) {
  if (command.status === 'برنده شده') return false; // only Sales Contract linkage may win a Project
  if (command.status === 'از دست رفته') return Boolean(command.lostReason) && !command.dormantReason && !command.revisitDate;
  if (command.status === 'راکد') return Boolean(command.dormantReason) && !command.lostReason;
  return !command.lostReason && !command.dormantReason && !command.revisitDate;
}

function followUpView(row: { id: string; potentialProjectId: string | null; communicationType: string; workType: string;
  happenedAt: Date; summary: string; outcome: string; hasNextAction: boolean; noNextActionReason: string | null }): PartnerFollowUpView {
  return { followUpId: row.id, ...(row.potentialProjectId ? { projectId: row.potentialProjectId } : {}),
    communicationType: row.communicationType, workType: row.workType, happenedAt: row.happenedAt.toISOString(),
    summary: row.summary, outcome: row.outcome, hasNextAction: row.hasNextAction,
    ...(row.noNextActionReason ? { noNextActionReason: row.noNextActionReason } : {}) };
}

function nextActionView(row: { id: string; potentialProjectId: string | null; partnerRevision: number | null; title: string;
  communicationType: string; workType: string | null; dueAt: Date; instructions: string; status: string; completedAt: Date | null }): PartnerNextActionView | undefined {
  if (!row.partnerRevision) return undefined;
  return { actionId: row.id, ...(row.potentialProjectId ? { projectId: row.potentialProjectId } : {}),
    revision: row.partnerRevision, title: row.title, communicationType: row.communicationType,
    ...(row.workType ? { workType: row.workType } : {}), dueAt: row.dueAt.toISOString(), instructions: row.instructions,
    status: row.status, ...(row.completedAt ? { completedAt: row.completedAt.toISOString() } : {}) };
}

const customerSelect = { id: true, partnerRevision: true, firstName: true, lastName: true, companyName: true,
  customerType: true, city: true, address: true, ownerUserId: true, partnerOwnerProfileId: true,
  phoneNumbers: { where: { isActive: true }, orderBy: [{ isPrimary: 'desc' as const }, { id: 'asc' as const }],
    select: { number: true, isPrimary: true } } };

async function priorOutcome(tx: Prisma.TransactionClient, actorId: string, operation: string, targetScope: string,
  key: string, payloadHash: string) {
  const prior = await tx.partnerCommandOutcome.findUnique({ where: { actorId_operation_targetScope_key:
    { actorId, operation, targetScope, key } } });
  if (!prior) return null;
  if (prior.payloadHash !== payloadHash) return { ok: false as const, error: partnerError('IDEMPOTENCY_CONFLICT') };
  const decoded = object(prior.outcome);
  if (!decoded || typeof decoded.commandId !== 'string') {
    return { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
  }
  return { ok: true as const, value: decoded };
}

async function validatePayloadHash(input: Record<string, unknown>) {
  return input.payloadHash === await canonicalHash(commandIntent(input));
}

/** A single owner-scoped CRM interface. It owns strict input decoding, current
 * central authorization, positive projections, CAS/idempotency, duplicate
 * disclosure and audited transfer; ordinary CRM routes never call it. */
export function createPartnerCrmService(dependencies: { database: PrismaClient; actorId: string;
  authorize: Authorization; notifyTransfer: TransferNotice }) {
  const database = dependencies.database;
  const authorizeProfile = async (tx: Prisma.TransactionClient, action: PartnerActionV2,
    profileId: string, correlationId: string, reason?: string) => dependencies.authorize(tx,
    { action, root: { kind: 'PROFILE', id: profileId }, correlationId, reason });
  const authorizeCustomer = async (tx: Prisma.TransactionClient, action: PartnerActionV2,
    customerId: string, correlationId: string, reason?: string, target?: { customerTransferId: string }) => dependencies.authorize(tx,
    { action, root: { kind: 'CUSTOMER', id: customerId }, correlationId, reason, target });
  return {
    async listCustomers(input: { correlationId: string; cursor?: string; limit?: number; query?: string }) {
      if (!input.correlationId || (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50))) {
        return { ok: false as const, error: partnerError('INVALID_PAYLOAD') };
      }
      return database.$transaction(async tx => {
        const profile = await currentProfile(tx, dependencies.actorId, false);
        if (!profile) return { ok: false as const, error: partnerError('NOT_FOUND') };
        const access = await authorizeProfile(tx, 'CUSTOMER_LIST', profile.id, input.correlationId);
        if (!access.ok) return access;
        const limit = input.limit ?? 20, query = input.query?.trim();
        const rows = await tx.crmCustomer.findMany({ where: { partnerOwnerProfileId: profile.id, ownerUserId: profile.userId,
          isActive: true, ...(input.cursor ? { id: { gt: input.cursor } } : {}), ...(query ? { OR: [
            { firstName: { contains: query, mode: 'insensitive' } }, { lastName: { contains: query, mode: 'insensitive' } },
            { companyName: { contains: query, mode: 'insensitive' } },
          ] } : {}) }, orderBy: { id: 'asc' }, take: limit + 1, select: customerSelect });
        const refreshed = await authorizeProfile(tx, 'CUSTOMER_LIST', profile.id, input.correlationId);
        if (!refreshed.ok) return refreshed;
        const items = rows.slice(0, limit).map(customerSummary);
        if (items.some(item => !item)) return { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
        return { ok: true as const, value: { schemaVersion: 1 as const, purpose: 'PARTNER_CRM_CUSTOMERS' as const,
          items: items as PartnerCustomerSummary[], total: await tx.crmCustomer.count({ where: {
            partnerOwnerProfileId: profile.id, ownerUserId: profile.userId, isActive: true } }),
          ...(rows.length > limit ? { nextCursor: rows[limit - 1].id } : {}) } };
      });
    },

    async readCustomer(input: { customerId: string; correlationId: string }): Promise<Result<PartnerCustomerDetail>> {
      if (!input.customerId || !input.correlationId) return { ok: false, error: partnerError('INVALID_PAYLOAD') };
      return database.$transaction(async tx => {
        const access = await authorizeCustomer(tx, 'CUSTOMER_READ', input.customerId, input.correlationId);
        if (!access.ok) return access;
        const row = await tx.crmCustomer.findUnique({ where: { id: input.customerId }, select: { ...customerSelect,
          potentialProjects: { where: { isActive: true, responsibleSellerId: access.value.partnerSellerId },
            orderBy: { createdAt: 'desc' }, select: { id: true,
            partnerRevision: true, title: true, status: true, workType: true, address: true, probability: true,
            expectedCloseDate: true, description: true, lostReason: true, dormantReason: true, revisitDate: true,
            responsibleSellerId: true } },
          followUpReports: { where: { sellerId: access.value.partnerSellerId },
            orderBy: { happenedAt: 'desc' }, take: 100, select: { id: true, potentialProjectId: true,
            communicationType: true, workType: true, happenedAt: true, summary: true, outcome: true,
            hasNextAction: true, noNextActionReason: true, sellerId: true } },
          nextActions: { where: { assignedToId: access.value.partnerSellerId },
            orderBy: { dueAt: 'asc' }, take: 100, select: { id: true, potentialProjectId: true,
            partnerRevision: true, title: true, communicationType: true, workType: true, dueAt: true,
            instructions: true, status: true, completedAt: true, assignedToId: true } },
        } });
        if (!row || access.value.persona !== 'PARTNER' || !row.partnerOwnerProfileId ||
            row.ownerUserId !== access.value.partnerSellerId) {
          return { ok: false as const, error: partnerError('NOT_FOUND') };
        }
        if (row.ownerUserId !== access.value.partnerSellerId ||
            row.potentialProjects.some(item => item.responsibleSellerId !== row.ownerUserId) ||
            row.followUpReports.some(item => item.sellerId !== row.ownerUserId) ||
            row.nextActions.some(item => item.assignedToId !== row.ownerUserId)) {
          return { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
        }
        const summary = customerSummary(row), projects = row.potentialProjects.map(projectView), nextActions = row.nextActions.map(nextActionView);
        if (!summary || projects.some(item => !item) || nextActions.some(item => !item)) {
          return { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
        }
        const refreshed = await authorizeCustomer(tx, 'CUSTOMER_READ', input.customerId, input.correlationId);
        return refreshed.ok ? { ok: true as const, value: { ...summary, ...(row.address ? { address: row.address } : {}),
          projects: projects as PartnerProjectView[], followUps: row.followUpReports.map(followUpView),
          nextActions: nextActions as PartnerNextActionView[] } } : refreshed;
      });
    },

    async createCustomer(raw: unknown) {
      const parsed = PartnerCustomerCreateSchema.safeParse(raw);
      if (!parsed.success || !await validatePayloadHash(parsed.data)) return { ok: false as const, error: partnerError('INVALID_PAYLOAD') };
      const command = parsed.data, operation = 'PARTNER_CUSTOMER_CREATE';
      return database.$transaction(async tx => {
        const profile = await currentProfile(tx, dependencies.actorId, true);
        if (!profile) return { ok: false as const, error: partnerError('NOT_FOUND') };
        const replay = await priorOutcome(tx, dependencies.actorId, operation, profile.id, command.idempotencyKey, command.payloadHash);
        if (replay) return replay;
        const access = await authorizeProfile(tx, 'CUSTOMER_CREATE', profile.id, command.correlationId, command.reason);
        if (!access.ok) return access;
        const phone = digits(command.phone), nationalCode = command.nationalCode ? digits(command.nationalCode) : undefined;
        if (phone.length < 7 || (nationalCode && nationalCode.length < 5)) return { ok: false as const, error: partnerError('INVALID_PAYLOAD') };
        const duplicate = await tx.crmCustomer.findFirst({ where: { isActive: true, OR: [
          { phoneNumbers: { some: { number: phone, isActive: true } } }, ...(nationalCode ? [{ nationalCode }] : []),
        ] }, select: { id: true } });
        if (duplicate) return { ok: false as const, error: partnerError('STATE_CONFLICT') };
        await useProfile(tx, profile.id);
        const created = await tx.crmCustomer.create({ data: { id: randomUUID(), firstName: command.firstName,
          lastName: command.lastName, companyName: command.companyName, customerType: command.customerType,
          city: command.city, address: command.address, nationalCode, ownerUserId: profile.userId,
          partnerOwnerProfileId: profile.id, partnerRevision: 1, createdBy: dependencies.actorId,
          phoneNumbers: { create: { id: randomUUID(), number: phone, type: 'mobile', isPrimary: true } } },
          select: customerSelect });
        const summary = customerSummary(created); if (!summary) return { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
        const outcome = { commandId: command.commandId, customer: summary };
        await tx.partnerCommandOutcome.create({ data: { id: randomUUID(), actorId: dependencies.actorId, operation,
          targetScope: profile.id, key: command.idempotencyKey, payloadHash: command.payloadHash, outcome: json(outcome) } });
        return { ok: true as const, value: outcome };
      });
    },

    async updateCustomer(raw: unknown) {
      const parsed = PartnerCustomerUpdateSchema.safeParse(raw);
      if (!parsed.success || !await validatePayloadHash(parsed.data)) return { ok: false as const, error: partnerError('INVALID_PAYLOAD') };
      const command = parsed.data, operation = 'PARTNER_CUSTOMER_UPDATE';
      return database.$transaction(async tx => {
        const replay = await priorOutcome(tx, dependencies.actorId, operation, command.customerId,
          command.idempotencyKey, command.payloadHash); if (replay) return replay;
        const access = await authorizeCustomer(tx, 'CUSTOMER_WRITE', command.customerId, command.correlationId, command.reason);
        if (!access.ok) return access;
        const profile = await currentProfile(tx, dependencies.actorId, true);
        if (!profile || profile.id !== (await tx.crmCustomer.findUnique({ where: { id: command.customerId },
          select: { partnerOwnerProfileId: true } }))?.partnerOwnerProfileId) return { ok: false as const, error: partnerError('NOT_FOUND') };
        const phone = digits(command.phone), nationalCode = command.nationalCode ? digits(command.nationalCode) : undefined;
        const duplicate = await tx.crmCustomer.findFirst({ where: { id: { not: command.customerId }, isActive: true, OR: [
          { phoneNumbers: { some: { number: phone, isActive: true } } }, ...(nationalCode ? [{ nationalCode }] : []),
        ] }, select: { id: true } });
        if (duplicate) return { ok: false as const, error: partnerError('STATE_CONFLICT') };
        await useProfile(tx, profile.id);
        const written = await tx.crmCustomer.updateMany({ where: { id: command.customerId, partnerRevision: command.expectedRevision,
          partnerOwnerProfileId: profile.id, ownerUserId: profile.userId }, data: { firstName: command.firstName,
          lastName: command.lastName, companyName: command.companyName, customerType: command.customerType,
          city: command.city, address: command.address, nationalCode, partnerRevision: { increment: 1 }, updatedBy: dependencies.actorId } });
        if (written.count !== 1) return { ok: false as const, error: partnerError('ROW_STALE') };
        const primary = await tx.phoneNumber.findFirst({ where: { customerId: command.customerId, isPrimary: true, isActive: true },
          orderBy: { id: 'asc' } });
        if (primary) await tx.phoneNumber.update({ where: { id: primary.id }, data: { number: phone } });
        else await tx.phoneNumber.create({ data: { customerId: command.customerId, number: phone, type: 'mobile', isPrimary: true } });
        const row = await tx.crmCustomer.findUniqueOrThrow({ where: { id: command.customerId }, select: customerSelect });
        const summary = customerSummary(row); if (!summary) return { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
        const outcome = { commandId: command.commandId, customer: summary };
        await tx.partnerCommandOutcome.create({ data: { id: randomUUID(), actorId: dependencies.actorId, operation,
          targetScope: command.customerId, key: command.idempotencyKey, payloadHash: command.payloadHash, outcome: json(outcome) } });
        return { ok: true as const, value: outcome };
      });
    },

    async createProject(raw: unknown) {
      const parsed = PartnerProjectCreateSchema.safeParse(raw);
      if (!parsed.success || !validProjectLifecycle(parsed.data) || !await validatePayloadHash(parsed.data)) {
        return { ok: false as const, error: partnerError('INVALID_PAYLOAD') };
      }
      const command = parsed.data, operation = 'PARTNER_PROJECT_CREATE';
      return database.$transaction(async tx => {
        const replay = await priorOutcome(tx, dependencies.actorId, operation, command.customerId,
          command.idempotencyKey, command.payloadHash); if (replay) return replay;
        const access = await authorizeCustomer(tx, 'CUSTOMER_WRITE', command.customerId, command.correlationId, command.reason);
        if (!access.ok) return access;
        const customer = await tx.crmCustomer.findUnique({ where: { id: command.customerId }, select: { partnerOwnerProfileId: true,
          ownerUserId: true } });
        const profile = await currentProfile(tx, dependencies.actorId, true);
        if (!profile || customer?.partnerOwnerProfileId !== profile.id || customer.ownerUserId !== profile.userId) {
          return { ok: false as const, error: partnerError('NOT_FOUND') };
        }
        await useProfile(tx, profile.id);
        const created = await tx.crmPotentialProject.create({ data: { id: randomUUID(), customerId: command.customerId,
          responsibleSellerId: profile.userId, createdBy: dependencies.actorId, partnerRevision: 1,
          title: command.title, status: command.status, workType: command.workType, address: command.address,
          probability: command.probability, expectedCloseDate: command.expectedCloseDate ? new Date(command.expectedCloseDate) : undefined,
          description: command.description, lostReason: command.lostReason, dormantReason: command.dormantReason,
          revisitDate: command.revisitDate ? new Date(command.revisitDate) : undefined }, select: { id: true,
          partnerRevision: true, title: true, status: true, workType: true, address: true, probability: true,
          expectedCloseDate: true, description: true, lostReason: true, dormantReason: true, revisitDate: true } });
        const project = projectView(created); if (!project) return { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
        const outcome = { commandId: command.commandId, project };
        await tx.partnerCommandOutcome.create({ data: { id: randomUUID(), actorId: dependencies.actorId, operation,
          targetScope: command.customerId, key: command.idempotencyKey, payloadHash: command.payloadHash, outcome: json(outcome) } });
        return { ok: true as const, value: outcome };
      });
    },

    async updateProject(raw: unknown) {
      const parsed = PartnerProjectUpdateSchema.safeParse(raw);
      if (!parsed.success || !validProjectLifecycle(parsed.data) || !await validatePayloadHash(parsed.data)) {
        return { ok: false as const, error: partnerError('INVALID_PAYLOAD') };
      }
      const command = parsed.data, operation = 'PARTNER_PROJECT_UPDATE';
      return database.$transaction(async tx => {
        const replay = await priorOutcome(tx, dependencies.actorId, operation, command.projectId,
          command.idempotencyKey, command.payloadHash); if (replay) return replay;
        const access = await authorizeCustomer(tx, 'CUSTOMER_WRITE', command.customerId, command.correlationId, command.reason);
        if (!access.ok) return access;
        const profile = await currentProfile(tx, dependencies.actorId, true); if (!profile) return { ok: false as const, error: partnerError('NOT_FOUND') };
        await useProfile(tx, profile.id);
        const written = await tx.crmPotentialProject.updateMany({ where: { id: command.projectId,
          customerId: command.customerId, responsibleSellerId: profile.userId, partnerRevision: command.expectedRevision,
          isActive: true }, data: { title: command.title, status: command.status, workType: command.workType,
          address: command.address, probability: command.probability,
          expectedCloseDate: command.expectedCloseDate ? new Date(command.expectedCloseDate) : null,
          description: command.description, lostReason: command.lostReason ?? null, dormantReason: command.dormantReason ?? null,
          revisitDate: command.revisitDate ? new Date(command.revisitDate) : null, partnerRevision: { increment: 1 } } });
        if (written.count !== 1) return { ok: false as const, error: partnerError('ROW_STALE') };
        const row = await tx.crmPotentialProject.findUniqueOrThrow({ where: { id: command.projectId }, select: { id: true,
          partnerRevision: true, title: true, status: true, workType: true, address: true, probability: true,
          expectedCloseDate: true, description: true, lostReason: true, dormantReason: true, revisitDate: true } });
        const project = projectView(row); if (!project) return { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
        const outcome = { commandId: command.commandId, project };
        await tx.partnerCommandOutcome.create({ data: { id: randomUUID(), actorId: dependencies.actorId, operation,
          targetScope: command.projectId, key: command.idempotencyKey, payloadHash: command.payloadHash, outcome: json(outcome) } });
        return { ok: true as const, value: outcome };
      });
    },

    async createFollowUp(raw: unknown) {
      const parsed = PartnerFollowUpCreateSchema.safeParse(raw);
      if (!parsed.success || !await validatePayloadHash(parsed.data)) return { ok: false as const, error: partnerError('INVALID_PAYLOAD') };
      const command = parsed.data, operation = 'PARTNER_FOLLOW_UP_CREATE';
      return database.$transaction(async tx => {
        const replay = await priorOutcome(tx, dependencies.actorId, operation, command.customerId,
          command.idempotencyKey, command.payloadHash); if (replay) return replay;
        const access = await authorizeCustomer(tx, 'CUSTOMER_WRITE', command.customerId, command.correlationId, command.reason);
        if (!access.ok) return access;
        const profile = await currentProfile(tx, dependencies.actorId, true); if (!profile) return { ok: false as const, error: partnerError('NOT_FOUND') };
        if (command.projectId) {
          const project = await tx.crmPotentialProject.findUnique({ where: { id: command.projectId }, select: {
            customerId: true, responsibleSellerId: true, isActive: true } });
          if (!project?.isActive || project.customerId !== command.customerId || project.responsibleSellerId !== profile.userId) {
            return { ok: false as const, error: partnerError('NOT_FOUND') };
          }
        }
        await useProfile(tx, profile.id);
        const followUpId = randomUUID();
        const created = await tx.crmFollowUpReport.create({ data: { id: followUpId, customerId: command.customerId,
          potentialProjectId: command.projectId, sellerId: profile.userId, communicationType: command.communicationType,
          workType: command.workType, happenedAt: new Date(command.happenedAt), summary: command.summary, outcome: command.outcome,
          hasNextAction: Boolean(command.nextAction), noNextActionReason: command.nextAction ? null : command.reason,
          ...(command.nextAction ? { nextAction: { create: { id: randomUUID(), customerId: command.customerId,
            potentialProjectId: command.projectId, assignedToId: profile.userId, partnerRevision: 1,
            title: command.nextAction.title, communicationType: command.nextAction.communicationType,
            workType: command.nextAction.workType, dueAt: new Date(command.nextAction.dueAt),
            instructions: command.nextAction.instructions } } } : {}) }, select: { id: true, potentialProjectId: true,
          communicationType: true, workType: true, happenedAt: true, summary: true, outcome: true,
          hasNextAction: true, noNextActionReason: true, nextAction: { select: { id: true, potentialProjectId: true,
            partnerRevision: true, title: true, communicationType: true, workType: true, dueAt: true,
            instructions: true, status: true, completedAt: true } } } });
        const outcome = { commandId: command.commandId, followUp: followUpView(created),
          ...(created.nextAction ? { nextAction: nextActionView(created.nextAction) } : {}) };
        await tx.partnerCommandOutcome.create({ data: { id: randomUUID(), actorId: dependencies.actorId, operation,
          targetScope: command.customerId, key: command.idempotencyKey, payloadHash: command.payloadHash, outcome: json(outcome) } });
        return { ok: true as const, value: outcome };
      });
    },

    async completeNextAction(raw: unknown) {
      const parsed = PartnerNextActionCompleteSchema.safeParse(raw);
      if (!parsed.success || !await validatePayloadHash(parsed.data)) return { ok: false as const, error: partnerError('INVALID_PAYLOAD') };
      const command = parsed.data, operation = 'PARTNER_NEXT_ACTION_COMPLETE';
      return database.$transaction(async tx => {
        const replay = await priorOutcome(tx, dependencies.actorId, operation, command.actionId,
          command.idempotencyKey, command.payloadHash); if (replay) return replay;
        const access = await authorizeCustomer(tx, 'CUSTOMER_WRITE', command.customerId, command.correlationId, command.reason);
        if (!access.ok) return access;
        const profile = await currentProfile(tx, dependencies.actorId, true); if (!profile) return { ok: false as const, error: partnerError('NOT_FOUND') };
        await useProfile(tx, profile.id);
        const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
        const written = await tx.crmNextAction.updateMany({ where: { id: command.actionId, customerId: command.customerId,
          assignedToId: profile.userId, partnerRevision: command.expectedRevision, status: { not: 'انجام شده' } },
          data: { status: 'انجام شده', completedAt: clock.now, completedBy: dependencies.actorId,
            partnerRevision: { increment: 1 } } });
        if (written.count !== 1) return { ok: false as const, error: partnerError('ROW_STALE') };
        const row = await tx.crmNextAction.findUniqueOrThrow({ where: { id: command.actionId }, select: { id: true,
          potentialProjectId: true, partnerRevision: true, title: true, communicationType: true, workType: true,
          dueAt: true, instructions: true, status: true, completedAt: true } });
        const action = nextActionView(row); if (!action) return { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
        const outcome = { commandId: command.commandId, action };
        await tx.partnerCommandOutcome.create({ data: { id: randomUUID(), actorId: dependencies.actorId, operation,
          targetScope: command.actionId, key: command.idempotencyKey, payloadHash: command.payloadHash, outcome: json(outcome) } });
        return { ok: true as const, value: outcome };
      });
    },

    async findDuplicate(raw: unknown): Promise<Result<DuplicateCustomerMatch>> {
      const parsed = PartnerDuplicateSearchSchema.safeParse(raw);
      if (!parsed.success) return { ok: false, error: partnerError('INVALID_PAYLOAD') };
      const input = parsed.data;
      return database.$transaction(async tx => {
        const profile = await currentProfile(tx, dependencies.actorId, true);
        if (!profile) return { ok: false as const, error: partnerError('NOT_FOUND') };
        const access = await authorizeProfile(tx, 'CUSTOMER_DUPLICATE_MATCH', profile.id, input.correlationId,
          'بررسی محدود مشتری تکراری');
        if (!access.ok) return access;
        const phone = input.phone ? digits(input.phone) : undefined, nationalCode = input.nationalCode ? digits(input.nationalCode) : undefined;
        if ((phone && phone.length < 7) || (nationalCode && nationalCode.length < 5)) {
          return { ok: false as const, error: partnerError('INVALID_PAYLOAD') };
        }
        const customer = await tx.crmCustomer.findFirst({ where: { isActive: true,
          NOT: { AND: { partnerOwnerProfileId: profile.id, ownerUserId: profile.userId } },
          OR: [...(phone ? [{ phoneNumbers: { some: { number: phone, isActive: true } } }] : []),
            ...(nationalCode ? [{ nationalCode }] : [])] }, orderBy: { id: 'asc' }, select: customerSelect });
        if (!customer) return { ok: false as const, error: partnerError('NOT_FOUND') };
        const witnessPhone = customer.phoneNumbers[0]?.number;
        if (!witnessPhone || digits(witnessPhone).length < 4) return { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
        const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
        const snapshot = DuplicateCustomerMatchSchema.parse({ schemaVersion: 1, purpose: 'DUPLICATE_MATCH',
          matchReference: randomUUID(), displayName: displayName(customer), personType: personType(customer.customerType),
          city: customer.city?.trim() || 'ثبت‌نشده', maskedWitness: `********${digits(witnessPhone).slice(-4)}` });
        const witnessHash = await canonicalHash({ requesterProfileId: profile.id, customerId: customer.id, snapshot });
        await tx.partnerDuplicateCustomerMatch.create({ data: { id: snapshot.matchReference, requesterProfileId: profile.id,
          customerId: customer.id, snapshot: json(snapshot), witnessHash, issuedAt: clock.now,
          expiresAt: new Date(clock.now.getTime() + 15 * 60_000) } });
        return { ok: true as const, value: snapshot };
      });
    },

    async requestTransfer(raw: unknown) {
      const parsed = PartnerTransferRequestSchema.safeParse(raw);
      if (!parsed.success || !await validatePayloadHash(parsed.data)) return { ok: false as const, error: partnerError('INVALID_PAYLOAD') };
      const command = parsed.data, operation = 'PARTNER_CUSTOMER_TRANSFER_REQUEST';
      return database.$transaction(async tx => {
        const profile = await currentProfile(tx, dependencies.actorId, true);
        if (!profile) return { ok: false as const, error: partnerError('NOT_FOUND') };
        const replay = await priorOutcome(tx, dependencies.actorId, operation, command.matchReference,
          command.idempotencyKey, command.payloadHash); if (replay) return replay;
        const access = await authorizeProfile(tx, 'CUSTOMER_TRANSFER_REQUEST', profile.id, command.correlationId, command.reason);
        if (!access.ok) return access;
        await tx.$queryRaw`SELECT id FROM partner_duplicate_customer_matches WHERE id = ${command.matchReference} FOR UPDATE`;
        const match = await tx.partnerDuplicateCustomerMatch.findUnique({ where: { id: command.matchReference } });
        const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
        if (!match || match.requesterProfileId !== profile.id || match.expiresAt <= clock.now) {
          return { ok: false as const, error: partnerError('NOT_FOUND') };
        }
        await tx.$queryRaw`SELECT id FROM crm_customers WHERE id = ${match.customerId} FOR UPDATE`;
        const customer = await tx.crmCustomer.findUnique({ where: { id: match.customerId }, select: { id: true,
          partnerOwnerProfileId: true, ownerUserId: true, isActive: true } });
        if (!customer?.isActive || !customer.ownerUserId ||
            (customer.partnerOwnerProfileId === profile.id && customer.ownerUserId === profile.userId)) {
          return { ok: false as const, error: partnerError('NOT_FOUND') };
        }
        if (customer.partnerOwnerProfileId) {
          const currentProfileOwner = await tx.partnerProfile.findUnique({ where: { id: customer.partnerOwnerProfileId }, select: { userId: true } });
          if (!currentProfileOwner || currentProfileOwner.userId !== customer.ownerUserId) {
            return { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
          }
        }
        const transferId = randomUUID(), eventId = randomUUID();
        await tx.partnerCustomerTransfer.create({
          data: {
            id: transferId,
            customerId: customer.id,
            matchId: match.id,
            fromOwnerUserId: customer.ownerUserId,
            fromProfileId: customer.partnerOwnerProfileId,
            toProfileId: profile.id,
            requestedBy: dependencies.actorId,
            requestReason: command.reason,
            correlationId: command.correlationId,
            events: {
              create: {
                id: eventId,
                revision: 1,
                type: 'REQUESTED',
                actorId: dependencies.actorId,
                reason: command.reason,
                commandId: command.commandId,
                correlationId: command.correlationId,
                evidence: json({ duplicateMatchId: match.id, witnessHash: match.witnessHash }),
              },
            },
          },
        });
        const outcome = { commandId: command.commandId, transferId, revision: 1, status: 'PENDING' as const };
        await tx.partnerCommandOutcome.create({ data: { id: randomUUID(), actorId: dependencies.actorId, operation,
          targetScope: command.matchReference, key: command.idempotencyKey, payloadHash: command.payloadHash, outcome: json(outcome) } });
        await dependencies.notifyTransfer(tx, { kind: 'REQUESTED', transferId, recipientIds: [customer.ownerUserId],
          actorId: dependencies.actorId, correlationId: command.correlationId });
        return { ok: true as const, value: outcome };
      });
    },

    async decideTransfer(raw: unknown) {
      const parsed = PartnerCommandSchema.safeParse(raw);
      if (!parsed.success || parsed.data.type !== 'CUSTOMER_TRANSFER_DECIDE') {
        return { ok: false as const, error: partnerError('INVALID_PAYLOAD') };
      }
      const command = parsed.data, payloadHash = await canonicalHash(commandIntent(command as unknown as Record<string, unknown>));
      if (command.idempotency.actorId !== dependencies.actorId || command.idempotency.operation !== command.type ||
          command.idempotency.targetId !== command.transferId || command.idempotency.payloadHash !== payloadHash) {
        return { ok: false as const, error: partnerError('INVALID_PAYLOAD') };
      }
      return database.$transaction(async tx => {
        const replay = await priorOutcome(tx, dependencies.actorId, command.type, command.transferId,
          command.idempotency.key, payloadHash); if (replay) return replay;
        const target = await tx.partnerCustomerTransfer.findUnique({ where: { id: command.transferId }, select: { customerId: true } });
        if (!target) return { ok: false as const, error: partnerError('NOT_FOUND') };
        const access = await authorizeCustomer(tx, 'CUSTOMER_TRANSFER_DECIDE', target.customerId,
          command.correlationId, command.reason, { customerTransferId: command.transferId }); if (!access.ok) return access;
        const transfer = await tx.partnerCustomerTransfer.findUnique({ where: { id: command.transferId }, include: {
          fromOwner: { select: { id: true } }, fromProfile: { select: { userId: true } },
          toProfile: { select: { userId: true, state: true } },
          match: { select: { requesterProfileId: true, customerId: true, witnessHash: true } } } });
        if (!transfer) return { ok: false as const, error: partnerError('NOT_FOUND') };
        if (transfer.revision !== command.expectedRevision) return { ok: false as const, error: partnerError('ROW_STALE') };
        if (transfer.status !== 'PENDING') return { ok: false as const, error: partnerError('STATE_CONFLICT') };
        const customer = await tx.crmCustomer.findUnique({ where: { id: transfer.customerId }, select: {
          partnerOwnerProfileId: true, ownerUserId: true, partnerRevision: true } });
        if (customer?.partnerOwnerProfileId !== transfer.fromProfileId ||
            customer?.ownerUserId !== transfer.fromOwnerUserId ||
            (transfer.fromProfile && transfer.fromProfile.userId !== transfer.fromOwnerUserId) ||
            transfer.match.customerId !== transfer.customerId ||
            transfer.match.requesterProfileId !== transfer.toProfileId) {
          return { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
        }
        if (command.outcome === 'APPROVE') {
          if (transfer.toProfile.state !== 'ACTIVE') return { ok: false as const, error: partnerError('DEPENDENCY_BLOCKED') };
          const unresolvedCase = await tx.partnerSaleCase.findFirst({ where: { customerId: transfer.customerId,
            state: { in: ['DRAFT', 'AWAITING_CUSTOMER_CONFIRMATION', 'CUSTOMER_APPROVED'] } }, select: { id: true } });
          // Ownership never rewrites a Case. A previous in-flight Case must use
          // its existing cancellation/remediation command before Customer
          // transfer can commit, so neither owner can continue a stale draft.
          if (unresolvedCase) return { ok: false as const, error: partnerError('DEPENDENCY_BLOCKED') };
          await tx.$executeRaw`SELECT set_config('sabalan.partner_crm_transfer', ${transfer.id}, true)`;
          const changed = await tx.crmCustomer.updateMany({ where: { id: transfer.customerId,
            partnerOwnerProfileId: transfer.fromProfileId, ownerUserId: transfer.fromOwnerUserId,
            partnerRevision: customer.partnerRevision }, data: { partnerOwnerProfileId: transfer.toProfileId,
            ownerUserId: transfer.toProfile.userId,
            partnerRevision: customer.partnerRevision === null ? 1 : { increment: 1 }, updatedBy: dependencies.actorId } });
          if (changed.count !== 1) return { ok: false as const, error: partnerError('ROW_STALE') };
        }
        const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
        await tx.partnerCustomerTransfer.update({ where: { id: transfer.id }, data: { revision: 2,
          status: command.outcome === 'APPROVE' ? 'APPROVED' : 'REJECTED', decidedBy: dependencies.actorId,
          decisionReason: command.reason, decidedAt: clock.now, decisionCommandId: command.commandId } });
        const eventId = randomUUID();
        await tx.partnerCustomerTransferEvent.create({ data: { id: eventId, transferId: transfer.id, revision: 2,
          type: command.outcome === 'APPROVE' ? 'APPROVED' : 'REJECTED', actorId: dependencies.actorId,
          reason: command.reason, commandId: command.commandId, correlationId: command.correlationId,
          evidence: json({ witnessHash: transfer.match.witnessHash,
            ownershipChanged: command.outcome === 'APPROVE', projectResponsibilityChanged: false,
            historicalCaseOwnershipChanged: false, salesCreditChanged: false }) } });
        const outcome = { commandId: command.commandId, transferId: transfer.id, revision: 2,
          status: command.outcome === 'APPROVE' ? 'APPROVED' as const : 'REJECTED' as const, eventIds: [eventId] };
        await tx.partnerCommandOutcome.create({ data: { id: randomUUID(), actorId: dependencies.actorId,
          operation: command.type, targetScope: transfer.id, key: command.idempotency.key, payloadHash, outcome: json(outcome) } });
        await dependencies.notifyTransfer(tx, { kind: outcome.status, transferId: transfer.id,
          recipientIds: [...new Set([transfer.fromOwnerUserId, transfer.toProfile.userId])],
          actorId: dependencies.actorId, correlationId: command.correlationId });
        return { ok: true as const, value: outcome };
      });
    },
  };
}
