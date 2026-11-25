import { Prisma, type PrismaClient } from '@prisma/client';
import {
  findProjectReturnProjects, parseProjectReturnItems, projectLabel, projectReturnId, projectReturnProductKey,
  ProjectReturnReceiptError, readProjectReturnProducts, readProjectReturnReceipt,
} from './projectReturnReceipts';
import { readLegacyProjectReturnBase, readCurrentProjectReturnLegacyBase, requireCurrentLegacyProjectReturnBase } from './projectReturnLegacyBase';
import { lockProjectReturnCase, readLatestProjectReturnAllocationDraft } from './projectReturnDraftState';
import { lockStoneReturnCase } from './stoneReturnAllocationDraft';

type Tx = Prisma.TransactionClient;
const writeOptions = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30_000 };

const proposalChanged = () => new ProjectReturnReceiptError(409, 'نسخهٔ اصلاحی تغییر کرده است. پرونده را دوباره باز کنید.');

export async function openProjectReturnCorrection(db: PrismaClient, receiptId: string, actorId: string) {
  return db.$transaction(async tx => {
    await lockStoneReturnCase(tx, receiptId);
    const base = await readLegacyProjectReturnBase(tx, receiptId);
    requireCurrentLegacyProjectReturnBase(base);
    const existing = await tx.projectReturnCase.findUnique({ where: { legacyFinalizationId: base.finalizationId }, select: { id: true } });
    if (existing) return existing;
    const { receipt } = base;
    const projects = new Map(base.rows.flatMap(row => row.projectId && row.projectName
      ? [[row.projectId, { projectId: row.projectId, projectName: row.projectName }] as const] : []));
    return tx.projectReturnCase.create({
      data: {
        customerId: receipt.customerId, customerName: receipt.customerName,
        legacyFinalizationId: base.finalizationId,
        versions: { create: {
          number: 1, assignedAt: new Date(), assignedBy: actorId,
          customerId: receipt.customerId, customerName: receipt.customerName,
          projects: { create: [...projects.values()] },
          items: { create: {
            productId: receipt.productId, productName: receipt.productName, productCode: receipt.productCode, unit: receipt.unit,
            healthyQuantity: receipt.acceptedQuantity, damagedQuantity: receipt.rejectedQuantity,
          } },
        } },
      },
      select: { id: true },
    });
  }, writeOptions);
}

async function lockedCorrection(tx: Tx, caseId: string, expectedVersionId: string) {
  await lockProjectReturnCase(tx, caseId);
  const correction = await readProjectReturnReceipt(tx, caseId, 'latest');
  if (!correction.legacyFinalizationId) throw new ProjectReturnReceiptError(409, 'این پرونده نسخهٔ اصلاحی پس از ثبت قطعی ندارد.');
  if (correction.version.id !== expectedVersionId) throw proposalChanged();
  const base = await readCurrentProjectReturnLegacyBase(tx, correction.legacyFinalizationId, true);
  requireCurrentLegacyProjectReturnBase(base);
  return { correction, base };
}

export async function returnProjectReturnCorrection(
  db: PrismaClient, caseId: string, actorId: string, expectedVersionId: unknown, expectedDraftNumber: unknown,
) {
  const versionId = projectReturnId(expectedVersionId, 'نسخه');
  return db.$transaction(async tx => {
    const { correction } = await lockedCorrection(tx, caseId, versionId);
    const { version } = correction;
    if (!version.submittedAt) throw proposalChanged();
    const draft = await readLatestProjectReturnAllocationDraft(tx, versionId);
    if ((draft?.number ?? 0) !== expectedDraftNumber) throw proposalChanged();
    const previous = await tx.projectReturnVersion.findUniqueOrThrow({ where: { id: versionId }, include: { projects: true, items: true } });
    await tx.projectReturnVersion.create({
      data: {
        caseId, baseVersionId: version.id, number: version.number + 1, assignedAt: new Date(), assignedBy: actorId,
        customerId: previous.customerId, customerName: previous.customerName,
        projects: { create: previous.projects.map(({ projectId, projectName }) => ({ projectId, projectName })) },
        items: { create: previous.items.map(({ id: _id, versionId: _versionId, inventoryIdentityId: _inventory, ...item }) => ({
          ...item,
          healthyCalculation: item.healthyCalculation ?? Prisma.DbNull,
          damagedCalculation: item.damagedCalculation ?? Prisma.DbNull,
          contractSources: item.contractSources ?? Prisma.DbNull,
        })) },
      },
    });
    return { id: caseId };
  }, writeOptions);
}

export async function submitProjectReturnCorrection(db: PrismaClient, caseId: string, actorId: string, body: Record<string, unknown>) {
  const command = parseProjectReturnItems(body);
  const versionId = projectReturnId(body.expectedVersionId, 'نسخه');
  return db.$transaction(async tx => {
    const { correction, base } = await lockedCorrection(tx, caseId, versionId);
    const { version, customerId } = correction;
    if (!version.assignedAt || version.submittedAt) throw proposalChanged();
    if (body.customerId !== undefined && body.customerId !== customerId) {
      throw new ProjectReturnReceiptError(409, 'مشتری مرجوعی قطعی قابل تغییر نیست.');
    }
    const projects = await findProjectReturnProjects(tx, customerId, command.projectIds);
    const products = await readProjectReturnProducts(tx, customerId, command.projectIds, command.items.map(item => item.productId), base.deliveredBefore);
    const items = command.items.map(item => {
      const product = products.get(projectReturnProductKey(item));
      if (!product || item.productId !== base.receipt.productId || item.unit !== base.receipt.unit) {
        throw new ProjectReturnReceiptError(400, 'محصول و واحد مرجوعی اصلی باید در پروژه‌های انتخابی این مشتری وجود داشته باشد.');
      }
      return { ...product, ...item };
    });
    await tx.projectReturnVersion.create({
      data: {
        caseId, baseVersionId: version.id, number: version.number + 1, submittedAt: new Date(), submittedBy: actorId,
        customerId, customerName: correction.customerName,
        projects: { create: projects.map(project => ({ projectId: project.id, projectName: projectLabel(project) })) },
        items: { create: items },
      },
    });
    return readProjectReturnReceipt(tx, caseId, 'latest');
  }, writeOptions);
}
