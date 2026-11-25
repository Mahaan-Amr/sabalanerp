import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type StoneReturnReceipt } from '@prisma/client';
import { publishStoneReturnAcceptanceEvidence, resolveAccountingOperationalEvidence } from './accountingOperationalEvidence';
import { ExactQuantityDecimal, parseExactQuantityAtoms } from './exactQuantity';
import { expandPersianSearchTokenVariants, normalizePersianSearchTokens } from './crmCustomerSearch';

export class StoneReturnReceiptError extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string) {
    super(message);
  }
}

const returnUnits = ['squareMeter', 'meter', 'count', 'ton'] as const;

function inputText(value: unknown, maximum: number, label: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new StoneReturnReceiptError(400, `${label} معتبر نیست.`);
  }
  return value.trim();
}

function inputQuantity(value: unknown, label: string) {
  const text = inputText(value, 100, label);
  try {
    parseExactQuantityAtoms(text);
    return new ExactQuantityDecimal(text);
  } catch {
    throw new StoneReturnReceiptError(400, `${label} معتبر نیست.`);
  }
}

export function parseStoneReturnAcceptance(body: Record<string, unknown>) {
  const requestId = inputText(body.requestId, 36, 'شناسه درخواست');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) {
    throw new StoneReturnReceiptError(400, 'شناسه درخواست معتبر نیست.');
  }
  const received = inputQuantity(body.receivedQuantity, 'مقدار دریافتی');
  const accepted = inputQuantity(body.acceptedQuantity, 'مقدار پذیرفته‌شده');
  const unit = returnUnits.find(value => value === body.unit);
  if (!unit) throw new StoneReturnReceiptError(400, 'واحد سنگ را انتخاب کنید.');
  if (received.lte(0) || accepted.lt(0) || accepted.gt(received)) {
    throw new StoneReturnReceiptError(400, 'مقدار دریافتی باید مثبت و مقدار پذیرفته‌شده بین صفر و مقدار دریافتی باشد.');
  }
  if (unit === 'count' && (!received.isInteger() || !accepted.isInteger())) {
    throw new StoneReturnReceiptError(400, 'مقدار در واحد عدد باید صحیح باشد.');
  }
  const rejected = received.minus(accepted);
  return {
    requestId,
    customerId: inputText(body.customerId, 100, 'مشتری'),
    productId: inputText(body.productId, 100, 'سنگ'),
    guardReturnMovementId: body.guardReturnMovementId == null
      ? null : inputText(body.guardReturnMovementId, 100, 'شاهد گارد'),
    unit, receivedQuantity: received.toFixed(), acceptedQuantity: accepted.toFixed(),
    rejectedQuantity: rejected.toFixed(),
    rejectionReason: rejected.gt(0) ? inputText(body.rejectionReason, 2000, 'دلیل رد') : null,
  };
}

const customerScope = { cardDeletedAt: null, partnerOwnerProfileId: null } satisfies Prisma.CrmCustomerWhereInput;
const productScope = { deletedAt: null, isActive: true } satisfies Prisma.ProductWhereInput;
const customerSelect = { id: true, firstName: true, lastName: true, companyName: true } satisfies Prisma.CrmCustomerSelect;
const productSelect = { id: true, code: true, name: true, namePersian: true } satisfies Prisma.ProductSelect;

function customerName(customer: { firstName: string; lastName: string; companyName: string | null }) {
  return `${customer.firstName} ${customer.lastName}`.trim() || customer.companyName || 'مشتری';
}

function textFilter(search: string) {
  return { contains: search, mode: 'insensitive' as const };
}

function guardReturnScope(customerId: string) {
  return {
    customerId, direction: 'INBOUND', purpose: 'SALES_RETURN', status: 'INFO_COMPLETED',
  } satisfies Prisma.SecurityVehicleMovementWhereInput;
}

export async function searchStoneReturnCustomers(db: PrismaClient, search: string) {
  const terms = normalizePersianSearchTokens(search).slice(0, 8);
  const rows = await db.crmCustomer.findMany({
    where: { ...customerScope, AND: terms.map(term => ({
      OR: expandPersianSearchTokenVariants(term).flatMap(variant => {
        const filter = textFilter(variant);
        return [
          { firstName: filter }, { lastName: filter }, { companyName: filter }, { brandName: filter },
          { phoneNumbers: { some: { number: filter, isActive: true } } },
        ];
      }),
    })) },
    select: customerSelect, take: 30, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
  });
  return rows.map(row => ({ id: row.id, label: customerName(row), description: row.companyName }));
}

export async function searchStoneReturnProducts(db: PrismaClient, search: string) {
  const terms = normalizePersianSearchTokens(search).slice(0, 8);
  const rows = await db.product.findMany({
    where: { ...productScope, AND: terms.map(term => ({
      OR: expandPersianSearchTokenVariants(term).flatMap(variant => {
        const filter = textFilter(variant);
        return [
          { namePersian: filter }, { name: filter }, { code: filter }, { mineNamePersian: filter },
          { stoneTypeNamePersian: filter }, { finishNamePersian: filter }, { qualityNamePersian: filter },
        ];
      }),
    })) },
    select: { ...productSelect, widthValue: true, thicknessValue: true, finishNamePersian: true, qualityNamePersian: true },
    take: 30, orderBy: [{ namePersian: 'asc' }, { id: 'asc' }],
  });
  return rows.map(row => ({
    id: row.id, label: row.namePersian || row.name,
    description: [row.code, `${row.widthValue.toFixed()}×${row.thicknessValue.toFixed()}`, row.finishNamePersian, row.qualityNamePersian].filter(Boolean).join(' · '),
  }));
}

export function searchStoneReturnGuardMovements(db: PrismaClient, customerId: string, search: string) {
  return db.securityVehicleMovement.findMany({
    where: { ...guardReturnScope(customerId), ...(search && { movementNumber: textFilter(search) }) },
    select: { id: true, movementNumber: true, occurredAt: true },
    take: 30, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
  });
}

function presentReceipt(row: StoneReturnReceipt) {
  const { id, customerId, customerName, productId, productCode, productName, unit, rejectionReason,
    createdAt, createdBy, guardReturnMovementId, inventoryIdentityId } = row;
  return {
    id, customerId, customerName, productId, productCode, productName, unit, rejectionReason,
    createdAt, createdBy, guardReturnMovementId, inventoryIdentityId,
    receivedQuantity: row.receivedQuantity.toFixed(),
    acceptedQuantity: row.acceptedQuantity.toFixed(),
    rejectedQuantity: row.rejectedQuantity.toFixed(),
  };
}

export function findPriorGuardReturnForStone(tx: Prisma.TransactionClient, movementId: string, productId: string, unit: string) {
  return tx.shipmentQuantityEvidence.findFirst({
    where: { guardReturnMovementId: movementId, sourceKind: 'SALES_CONTRACT', kind: 'GUARD_RETURN_VERIFIED',
      unit, contractItem: { productId } },
    select: { id: true },
  });
}

export function recordStoneReturnReceipt(db: PrismaClient | Prisma.TransactionClient, actorId: string, body: Record<string, unknown>) {
  const command = parseStoneReturnAcceptance(body);
  const record = async (tx: Prisma.TransactionClient) => {
    const lock = `stone-return-intake:${actorId}:${command.requestId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lock}))`;
    const prior = await tx.stoneReturnReceipt.findUnique({
      where: { createdBy_requestId: { createdBy: actorId, requestId: command.requestId } },
    });
    if (prior) {
      const data = presentReceipt(prior);
      const { requestId: _requestId, ...immutableInput } = command;
      if (Object.entries(immutableInput).some(([field, value]) => data[field as keyof typeof immutableInput] !== value)) {
        throw new StoneReturnReceiptError(409, 'این درخواست قبلاً با اطلاعات دیگری ثبت شده است.');
      }
      return { data, replayed: true };
    }

    if (command.guardReturnMovementId) {
      const guardReturnLock = `GUARD_RETURN:${command.guardReturnMovementId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${guardReturnLock}))`;
      const existing = await tx.stoneReturnReceipt.findFirst({
        where: { guardReturnMovementId: command.guardReturnMovementId, productId: command.productId, unit: command.unit },
        select: { id: true },
      });
      if (existing || await findPriorGuardReturnForStone(tx, command.guardReturnMovementId, command.productId, command.unit)) {
        throw new StoneReturnReceiptError(409, 'برای این شاهد ورود، همین سنگ و واحد قبلاً ثبت شده است.');
      }
    }

    const [customer, product, movement] = await Promise.all([
      tx.crmCustomer.findFirst({ where: { id: command.customerId, ...customerScope }, select: customerSelect }),
      tx.product.findFirst({ where: { id: command.productId, ...productScope }, select: productSelect }),
      command.guardReturnMovementId ? tx.securityVehicleMovement.findFirst({
        where: { id: command.guardReturnMovementId, ...guardReturnScope(command.customerId) },
        select: { id: true, movementNumber: true, occurredAt: true },
      }) : null,
    ]);
    if (!customer) throw new StoneReturnReceiptError(404, 'پرونده مشتری در CRM پیدا نشد.');
    if (!product) throw new StoneReturnReceiptError(404, 'سنگ در فهرست محصولات فعال پیدا نشد.');
    if (command.guardReturnMovementId && !movement) {
      throw new StoneReturnReceiptError(400, 'فقط شاهد تکمیل‌شده برگشت همین مشتری قابل انتخاب است.');
    }
    const guardEvidence = movement ? await resolveAccountingOperationalEvidence(
      tx, { type: 'GUARD_INBOUND_MOVEMENT', id: movement.id, version: 1 }, ['GUARD_INBOUND_MOVEMENT'],
    ) : null;

    const id = randomUUID();
    const createdAt = new Date();
    const inventoryIdentityId = command.acceptedQuantity === '0' ? null : `stone-return-receipt:${id}`;
    const data = {
      ...command, id, customerName: customerName(customer), productCode: product.code,
      productName: product.namePersian || product.name, inventoryIdentityId, createdAt, createdBy: actorId,
    };
    const evidence = await publishStoneReturnAcceptanceEvidence(tx, {
      sourceId: id, occurredAt: createdAt,
      sourcePayload: { ...data, guardEvidence: guardEvidence && {
        type: guardEvidence.type, id: guardEvidence.id, version: guardEvidence.version, hash: guardEvidence.hash,
        movementNumber: movement?.movementNumber, occurredAt: movement?.occurredAt,
      } },
    });
    if (inventoryIdentityId) {
      await tx.accountingInventoryIdentity.create({ data: {
        id: inventoryIdentityId, originId: id, kind: 'FINISHED_GOOD',
        valuationMethod: 'SPECIFIC_IDENTIFICATION', governedUnit: command.unit,
      } });
      await tx.accountingInventoryEvent.create({ data: {
        identityId: inventoryIdentityId, eventType: 'RECEIPT', statusAfter: 'AVAILABLE',
        warehouseId: 'sabalan-warehouse', locationId: 'انبار سبلان',
        unit: command.unit, quantity: command.acceptedQuantity, occurredAt: createdAt,
        sourceType: evidence.type, sourceId: evidence.id, sourceVersion: evidence.version,
        sourceHash: evidence.hash, sourcePayload: evidence.payload as Prisma.InputJsonValue,
      } });
    }
    const row = await tx.stoneReturnReceipt.create({ data });
    return { data: presentReceipt(row), replayed: false };
  };
  return '$transaction' in db ? recordWithRetry(db, record) : record(db);
}

async function recordWithRetry<Result>(db: PrismaClient, record: (tx: Prisma.TransactionClient) => Promise<Result>) {
  const attempts = 3;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await db.$transaction(record, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const failure = error as { code?: string; meta?: { code?: string } } | null;
      if (failure?.code !== 'P2034' && failure?.code !== 'P2002'
        && !(failure?.code === 'P2010' && failure.meta?.code === '40001')) throw error;
    }
  }
  throw new StoneReturnReceiptError(409, 'اطلاعات دریافت هم‌زمان تغییر کرد. همین درخواست را دوباره ثبت کنید.');
}

export async function listStoneReturnReceipts(db: PrismaClient, after?: string) {
  if (after && !await db.stoneReturnReceipt.findUnique({ where: { id: after }, select: { id: true } })) {
    throw new StoneReturnReceiptError(404, 'صفحه مرجوعی‌ها پیدا نشد.');
  }
  const pageSize = 50;
  const rows = await db.stoneReturnReceipt.findMany({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: pageSize + 1,
    ...(after && { cursor: { id: after }, skip: 1 }),
  });
  return {
    items: rows.slice(0, pageSize).map(presentReceipt),
    nextCursor: rows.length > pageSize ? rows[pageSize - 1].id : null,
  };
}

export async function readStoneReturnReceipt(db: Prisma.TransactionClient, id: string) {
  const row = await db.stoneReturnReceipt.findUnique({ where: { id } });
  if (!row) throw new StoneReturnReceiptError(404, 'مرجوعی پیدا نشد.');
  return presentReceipt(row);
}
