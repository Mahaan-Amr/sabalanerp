import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { publishPurchaseReservationRelease } from './accountingOperationalEvidence';
import { releaseInventoryReservationWithin } from './accountingSupplyChain';
import { createAccountingSupplyChainPrismaRepository } from './accountingSupplyChainPrismaRepository';
import { lockInventoryIdentities } from './inventoryIdentityLock';
import {
  lockProjectReturnCase, projectReturnDraftHasAllocations, readLatestProjectReturnAllocationDraft, withProjectReturnCaseTransaction,
} from './projectReturnDraftState';
import {
  prepareProjectReturnVersion, ProjectReturnReceiptError, projectReturnId, readProjectReturnReceipt,
} from './projectReturnReceipts';
import { loadProjectReturnStocks, reverseProjectReturnStock } from './projectReturnStock';

type Tx = Prisma.TransactionClient;
type Receipt = Awaited<ReturnType<typeof readProjectReturnReceipt>>;
type Action = 'edit' | 'cancel' | 'request-rework' | 'return-to-logistics';

const stockMovementBlock = 'برای موجودی این پرونده گردش دیگری ثبت شده است. موجودی باید پیش از اصلاح یا لغو تعیین تکلیف شود.';
const stockEvidenceBlock = 'شاهد دریافت موجودی این پرونده قابل تأیید نیست.';
const conflict = (message: string) => new ProjectReturnReceiptError(409, message);

async function dependencies(tx: Tx, receipt: Receipt) {
  const ids = receipt.version.items.flatMap(item => item.inventoryIdentityId ? [item.inventoryIdentityId] : []);
  const [draft, reservations, events, layers, lots] = await Promise.all([
    readLatestProjectReturnAllocationDraft(tx, receipt.version.id),
    tx.accountingInventoryReservation.findMany({
      where: { identityId: { in: ids }, status: 'ACTIVE' }, orderBy: { id: 'asc' },
      select: { id: true, identityId: true, purposeId: true, quantity: true, unit: true },
    }),
    tx.accountingInventoryEvent.findMany({ where: { identityId: { in: ids } }, select: { id: true } }),
    tx.accountingInventoryValuationLayer.count({ where: { identityId: { in: ids } } }),
    loadProjectReturnStocks(tx, ids),
  ]);
  const stock = [...lots.values()].filter(lot => lot !== null);
  const originalEvents = new Set(stock.map(lot => lot.event.id));
  const stockBlock = stock.length !== ids.length || receipt.version.items.some(item => item.healthyQuantity !== '0' && !item.inventoryIdentityId)
    ? stockEvidenceBlock : layers > 0 || events.some(event => !originalEvents.has(event.id)) ? stockMovementBlock : null;
  return { draft, reservations, stock, stockBlock, hasAllocations: projectReturnDraftHasAllocations(draft) };
}

export async function readProjectReturnOperationalState(tx: Tx, receipt: Receipt) {
  if (!receipt.visit || receipt.operationStatus === 'CANCELLED') return null;
  const current = await dependencies(tx, receipt);
  const { hasAllocations, reservations, stockBlock } = current;
  const hasDependencies = hasAllocations || reservations.length > 0;
  const logisticsOwnsCase = receipt.operationStatus === 'ACTIVE' || receipt.operationStatus === 'RETURNED_TO_LOGISTICS';
  return {
    hasAllocations,
    reservations: reservations.map(({ quantity, ...row }) => ({ ...row, quantity: quantity.toFixed() })),
    stockBlock,
    canEdit: logisticsOwnsCase && !stockBlock && !hasDependencies,
    canRequestRework: receipt.operationStatus === 'ACTIVE' && !stockBlock && hasDependencies,
    canReturnToLogistics: receipt.operationStatus === 'REWORK_REQUESTED' && !stockBlock,
  };
}

export async function readProjectReturnOperationalDetails(tx: Tx, caseId: string) {
  const receipt = await readProjectReturnReceipt(tx, caseId, 'latest');
  if (!receipt.visit) return { ...receipt, operations: [], versions: [], operational: null };
  const [operations, versions, operational] = await Promise.all([
    tx.projectReturnOperation.findMany({
      where: { caseId }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      select: { id: true, kind: true, versionId: true, occurredAt: true, actorId: true },
    }),
    tx.projectReturnVersion.findMany({
      where: { caseId }, orderBy: { number: 'desc' }, select: { id: true, number: true, submittedAt: true },
    }),
    readProjectReturnOperationalState(tx, receipt),
  ]);
  return { ...receipt, visit: receipt.visit, operations, versions, operational };
}

export async function changeProjectReturnOperation(db: PrismaClient, caseId: string, actorId: string, action: Action, body: Record<string, unknown>) {
  const expectedVersionId = projectReturnId(body.expectedVersionId, 'نسخه');
  const result = await withProjectReturnCaseTransaction(db, async tx => {
    await lockProjectReturnCase(tx, caseId);
    const receipt = await readProjectReturnReceipt(tx, caseId, 'latest');
    if (!receipt.visit) throw conflict('این پرونده از مسیر اصلاح پیش از ثبت قطعی قابل تغییر نیست.');
    if (receipt.version.id !== expectedVersionId) throw conflict('نسخهٔ پرونده تغییر کرده است. پرونده را دوباره باز کنید.');
    const { operationStatus: status } = receipt;
    if (status === 'CANCELLED') throw conflict('پرونده لغو شده است.');
    const accountingOwnsCase = status === 'REWORK_REQUESTED';
    if ((action === 'return-to-logistics') !== accountingOwnsCase) {
      throw conflict('وضعیت پرونده اجازهٔ این اقدام را نمی‌دهد.');
    }

    const identityIds = receipt.version.items.flatMap(item => item.inventoryIdentityId ? [item.inventoryIdentityId] : []);
    await lockInventoryIdentities(tx, identityIds);
    const { draft, reservations, stock, stockBlock, hasAllocations } = await dependencies(tx, receipt);
    if (stockBlock) throw conflict(stockBlock);

    const operationId = randomUUID();
    const now = new Date();
    let versionId = receipt.version.id;
    let clearedDraftNumber: number | undefined;
    const releasedReservationIds: string[] = [];
    let kind: Prisma.ProjectReturnOperationUncheckedCreateInput['kind'];
    let operationStatus: Prisma.ProjectReturnCaseUpdateInput['operationStatus'];

    if (action === 'request-rework') {
      if (status !== 'ACTIVE' || (!hasAllocations && !reservations.length)) {
        throw conflict('تخصیص یا رزرو فعالی برای بررسی حسابداری وجود ندارد.');
      }
      kind = operationStatus = 'REWORK_REQUESTED';
    } else if (action === 'return-to-logistics') {
      const repository = createAccountingSupplyChainPrismaRepository(tx);
      for (const reservation of reservations) {
        const evidence = await publishPurchaseReservationRelease(tx, {
          sourceId: `${operationId}:${reservation.id}`, sourceVersion: 1, occurredAt: now,
          sourcePayload: {
            reservationId: reservation.id, purposeId: reservation.purposeId,
            identityId: reservation.identityId, quantity: reservation.quantity.toFixed(), unit: reservation.unit,
            caseId, versionId, operationId, actorId,
          },
        });
        await releaseInventoryReservationWithin(repository, { reservationId: reservation.id, evidence, actorId, releasedAt: now });
        releasedReservationIds.push(reservation.id);
      }
      if (hasAllocations && draft) {
        clearedDraftNumber = draft.number + 1;
        await tx.projectReturnAllocationDraft.create({
          data: { versionId, number: clearedDraftNumber, items: draft.items.map(item => ({ ...item, rows: [] })), createdBy: actorId },
        });
      }
      kind = operationStatus = 'RETURNED_TO_LOGISTICS';
    } else {
      if (hasAllocations || reservations.length) throw conflict('پرونده تخصیص یا رزرو فعال دارد. ابتدا آن را به حسابداری ارجاع دهید.');
      kind = action === 'edit' ? 'EDITED' : 'CANCELLED';
      operationStatus = action === 'edit' ? 'ACTIVE' : 'CANCELLED';
      if (action === 'edit') {
        if (body.visitId !== undefined && body.visitId !== receipt.visit.id) {
          throw new ProjectReturnReceiptError(400, 'مراجعهٔ گارد در اصلاح پرونده ثابت می‌ماند.');
        }
        const { version } = await prepareProjectReturnVersion(tx, {
          caseId, actorId, deliveredBefore: receipt.visit.admittedAt, previousReceipt: receipt, body: { ...body, customerId: body.customerId === undefined ? receipt.customerId : body.customerId, visitId: receipt.visit.id },
        });
        versionId = version.id;
        await tx.projectReturnVersion.create({
          data: { ...version, caseId, number: receipt.version.number + 1, baseVersionId: receipt.version.id },
        });
      }
      for (const lot of stock) await reverseProjectReturnStock(tx, lot, { operationId, actorId, occurredAt: now });
    }

    await tx.projectReturnOperation.create({
      data: { id: operationId, caseId, versionId, kind, actorId, occurredAt: now, clearedDraftNumber, releasedReservationIds },
    });
    await tx.projectReturnCase.update({ where: { id: caseId }, data: { operationStatus } });
    return readProjectReturnOperationalDetails(tx, caseId);
  });
  if (!result) throw conflict('وضعیت پرونده یا موجودی تغییر کرده است. پرونده را دوباره باز کنید.');
  return result;
}
