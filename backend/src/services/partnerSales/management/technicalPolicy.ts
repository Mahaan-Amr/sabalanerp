import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { PartnerTechnicalPolicyPublishSchema, PartnerTechnicalPolicyReceiptSchema, PartnerTechnicalPolicyViewSchema,
  canonicalHash, partnerError, type PartnerTechnicalPolicyPublish, type PartnerTechnicalPolicyReceipt,
  type PartnerTechnicalPolicyView, type Result } from '@sabalanerp/partner-sales-contracts';
import { readPartnerTechnicalSalesPolicyForProfile,
} from '../cases/technicalEvidence';

export type PartnerTechnicalPolicyCommand = PartnerTechnicalPolicyPublish;
interface Dependencies {
  actorId: string;
  transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
  authorize(tx: Prisma.TransactionClient, input: { actorId: string; profileId: string; reason: string }): Promise<Result<void>>;
}

export function createPrismaPartnerTechnicalPolicyService(input: {
  database: PrismaClient; actorId: string; authorize: Dependencies['authorize'];
}) {
  return createPartnerTechnicalPolicyService({ actorId: input.actorId, authorize: input.authorize,
    transaction: work => input.database.$transaction(work) });
}

/** One append-only policy stream per commercial account. expectedVersion is
 * the account's complete terms revision, so concurrent credit/commercial term
 * writes cannot be silently overwritten. */
export function createPartnerTechnicalPolicyService(dependencies: Dependencies) {
  return { async read(profileId: string): Promise<Result<PartnerTechnicalPolicyView>> {
    if (typeof profileId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/.test(profileId)) {
      return { ok: false, error: partnerError('INVALID_PAYLOAD') };
    }
    return dependencies.transaction(async tx => {
      const reason = 'مشاهده سیاست فنی فروش همکار';
      const allowed = await dependencies.authorize(tx, { actorId: dependencies.actorId, profileId, reason });
      if (!allowed.ok) return allowed;
      const current = await readPartnerTechnicalSalesPolicyForProfile(tx, profileId);
      return current.ok ? { ok: true, value: PartnerTechnicalPolicyViewSchema.parse({ schemaVersion: 1,
        purpose: 'PARTNER_TECHNICAL_POLICY', profileId, ...current.value }) } : current;
    });
  }, async publish(command: PartnerTechnicalPolicyCommand): Promise<Result<PartnerTechnicalPolicyReceipt>> {
    const input = PartnerTechnicalPolicyPublishSchema.safeParse(command);
    if (!input.success) return { ok: false, error: partnerError('INVALID_PAYLOAD') };
    command = input.data;
    const policyId = randomUUID();
    return dependencies.transaction(async tx => {
      const allowed = await dependencies.authorize(tx, { actorId: dependencies.actorId, profileId: command.profileId, reason: command.reason });
      if (!allowed.ok) return allowed;
      await tx.$queryRaw`SELECT id FROM partner_profiles WHERE id = ${command.profileId} FOR UPDATE`;
      const profile = await tx.partnerProfile.findUnique({ where: { id: command.profileId },
        select: { commercialAccount: { select: { id: true } } } });
      const accountId = profile?.commercialAccount?.id;
      if (!accountId) return { ok: false, error: partnerError('NOT_FOUND') };
      await tx.$queryRaw`SELECT id FROM partner_commercial_accounts WHERE id = ${accountId} FOR UPDATE`;
      const latest = await tx.partnerCommercialTerms.findFirst({ where: { accountId }, orderBy: { version: 'desc' }, select: { version: true } });
      const currentVersion = latest?.version ?? 0;
      if (currentVersion !== command.expectedVersion) return { ok: false, error: partnerError('ROW_STALE') };
      const version = currentVersion + 1;
      const terms = JSON.parse(JSON.stringify(command.policy)) as Prisma.InputJsonValue;
      const integrityHash = await canonicalHash({ accountId, version, effectiveDate: command.effectiveDate,
        terms, actorId: dependencies.actorId, reason: command.reason.trim() });
      await tx.partnerCommercialTerms.create({ data: { id: policyId, accountId, version,
        effectiveDate: new Date(`${command.effectiveDate}T00:00:00.000Z`), terms, integrityHash,
        actorId: dependencies.actorId, reason: command.reason.trim() } });
      const refreshed = await dependencies.authorize(tx, { actorId: dependencies.actorId, profileId: command.profileId, reason: command.reason });
      if (!refreshed.ok) return refreshed;
      return { ok: true, value: PartnerTechnicalPolicyReceiptSchema.parse({ schemaVersion: 1,
        purpose: 'PARTNER_TECHNICAL_POLICY', profileId: command.profileId, accountVersion: version,
        policy: { ...command.policy, policyId, version, effectiveDate: command.effectiveDate, integrityHash } }) };
    });
  } };
}
