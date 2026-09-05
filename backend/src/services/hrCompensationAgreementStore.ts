import { Prisma, type PrismaClient } from '@prisma/client';
import { activeHrActionPermissionsForUser } from './hrAuthorizationService';
import { canonicalPerformanceHash } from './personnelPerformancePolicy';
import { runPerformanceSerializableTransaction } from './personnelPerformancePolicyStore';

export type CompensationAgreementInput = {
  employmentRelationshipId: string;
  actorUserId: string;
  components: Array<{ title: string; amountRials: string }>;
  payRangeMinimumRials: string;
  payRangeMaximumRials: string;
  budgetCode: string;
  budgetAvailableRials: string;
  approvalReason: string;
};

// Publication is a separate, explicitly authorized operation. Performance handoffs
// only read the resulting agreement and never invoke this writer.
export const publishCompensationAgreement = async (client: PrismaClient | Prisma.TransactionClient, input: CompensationAgreementInput) => {
  const fail = (message: string, status = 422) => Object.assign(new Error(message), { status, code: 'COMPENSATION_AGREEMENT_INVALID' });
  const amount = (value: unknown) => {
    if (typeof value !== 'string' || !/^\d{1,18}$/.test(value)) throw fail('مبلغ ریالی باید عدد صحیح نامنفی باشد.');
    return new Prisma.Decimal(value);
  };
  if (!Array.isArray(input.components) || !input.components.length || typeof input.budgetCode !== 'string' || !input.budgetCode.trim()
    || typeof input.approvalReason !== 'string' || input.approvalReason.trim().length < 20) {
    throw fail('اجزای توافق، مرجع بودجه و دلیل تأیید الزامی است.');
  }
  const components = input.components.map((component) => {
    if (!component || typeof component.title !== 'string' || !component.title.trim()) throw fail('عنوان جزء جبران خدمت الزامی است.');
    return { title: component.title.trim(), amountRials: amount(component.amountRials).toFixed(0) };
  });
  const total = components.reduce((sum, component) => sum.add(component.amountRials), new Prisma.Decimal(0));
  const minimum = amount(input.payRangeMinimumRials);
  const maximum = amount(input.payRangeMaximumRials);
  const budget = amount(input.budgetAvailableRials);
  if (total.lt(minimum) || total.gt(maximum) || total.gt(budget)) throw fail('توافق با محدوده پرداخت یا بودجه سازگار نیست.');
  const publish = async (tx: Prisma.TransactionClient) => {
    const permissions = await activeHrActionPermissionsForUser(tx, input.actorUserId);
    if (!permissions.includes('MANAGE_COMPENSATION_AGREEMENTS')) throw fail('مجوز مستقل انتشار توافق جبران خدمت لازم است.', 403);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`compensation:${input.employmentRelationshipId}`}, 0))`;
    const relationship = await tx.hrEmploymentRelationship.findUnique({ where: { id: input.employmentRelationshipId } });
    if (!relationship || !['ACTIVE', 'SUSPENDED'].includes(relationship.status)) throw fail('رابطه استخدامی جاری پیدا نشد.', 409);
    const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT CURRENT_TIMESTAMP AS now`;
    const latest = await tx.hrCompensationAgreement.findFirst({ where: { employmentRelationshipId: relationship.id }, orderBy: { version: 'desc' } });
    const current = await tx.hrCompensationAgreement.findFirst({ where: {
      employmentRelationshipId: relationship.id, status: 'ACTIVE', effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
    } });
    if (current) await tx.hrCompensationAgreement.update({ where: { id: current.id }, data: { status: 'RETIRED', effectiveTo: now } });
    const evidence = { components, payRangeMinimumRials: minimum.toFixed(0), payRangeMaximumRials: maximum.toFixed(0),
      budgetCode: input.budgetCode.trim(), budgetAvailableRials: budget.toFixed(0), approvalReason: input.approvalReason.trim() };
    const draft = await tx.hrCompensationAgreement.create({ data: {
      employmentRelationshipId: relationship.id, version: (latest?.version ?? 0) + 1,
      effectiveFrom: now, componentsJson: evidence, totalRials: total,
      payRangeMinimumRials: minimum, payRangeMaximumRials: maximum,
      budgetCode: evidence.budgetCode, budgetAvailableRials: budget, legalControlStatus: 'APPROVED',
      contentHash: canonicalPerformanceHash(evidence), createdByUserId: input.actorUserId,
      approvedByUserId: input.actorUserId, approvedAt: now,
    } });
    await tx.hrCompensationAgreement.update({ where: { id: draft.id }, data: { status: 'SCHEDULED' } });
    return tx.hrCompensationAgreement.update({ where: { id: draft.id }, data: { status: 'ACTIVE' } });
  };
  return '$transaction' in client ? runPerformanceSerializableTransaction(client, publish) : publish(client);
};
