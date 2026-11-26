import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { normalizePersianSearchTokens } from './crmCustomerSearch';
import { ExactQuantityDecimal, parseExactQuantityAtoms } from './exactQuantity';
import { calculateLogisticsLinearQuantity } from './logisticsLineQuantity';
import { readVerifiedProjectDispatch, stoneReturnEvidenceRecord, type ProjectReturnContractSource } from './projectReturnDispatch';
import { recordProjectReturnStock } from './projectReturnStock';
import { projectReturnItemArea, projectReturnWidth } from './projectReturnArea';
import { inferLogisticsContractUnit, resolveLogisticsContractRow } from './logisticsContractRow';
import { lockProjectReturnVisit, presentProjectReturnVisit, receiveProjectReturnVisit } from './projectReturnGuardVisits';
import { readCurrentPartnerCaseViews } from './partnerSales/cases/lifecycle';
import { partnerContractWasDeleted } from './partnerSales/cases/operationalDeletion';
import { stoneReturnCustomerName, stoneReturnCustomerSelect } from './stoneReturnReceipts';

export class ProjectReturnReceiptError extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string) {
    super(message);
  }
}

export function projectReturnId(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 100) {
    throw new ProjectReturnReceiptError(400, `شناسهٔ ${label} معتبر نیست.`);
  }
  return value.trim();
}

const units = ['squareMeter', 'meter', 'count', 'ton'] as const;
type ReturnUnit = typeof units[number];

export function projectReturnProjectIds(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) {
    throw new ProjectReturnReceiptError(400, 'بین ۱ تا ۵۰ پروژه انتخاب کنید.');
  }
  return [...new Set(value.map(id => projectReturnId(id, 'پروژه')))].sort();
}

function quantityInput(value: unknown, whole = false) {
  if (typeof value !== 'string' || value.length > 100) throw new Error('Invalid quantity');
  parseExactQuantityAtoms(value);
  const quantity = new ExactQuantityDecimal(value.trim());
  if (quantity.lt(0) || (whole && !quantity.isInteger())) throw new Error('Invalid quantity');
  return quantity;
}

function receiptQuantity(direct: unknown, linear: unknown, unit: ReturnUnit, label: string) {
  try {
    if (linear === undefined) return { quantity: quantityInput(direct, unit === 'count').toFixed() };
    if (unit !== 'meter' || direct !== undefined || !linear || typeof linear !== 'object' || Array.isArray(linear)) {
      throw new Error('Invalid calculation');
    }
    const input = linear as Record<string, unknown>;
    const khatRas = quantityInput(input.khatRas);
    const pieceCount = quantityInput(input.pieceCount, true);
    const plus = quantityInput(input.plus ?? '0');
    const minus = quantityInput(input.minus ?? '0');
    if (khatRas.lte(0) || pieceCount.lte(0)) throw new Error('Invalid calculation');
    const quantity = calculateLogisticsLinearQuantity(khatRas, pieceCount, plus, minus);
    if (quantity.lt(0)) throw new Error('Negative calculated quantity');
    return {
      quantity: quantity.toFixed(),
      calculation: { khatRas: khatRas.toFixed(), pieceCount: pieceCount.toFixed(), plus: plus.toFixed(), minus: minus.toFixed() },
    };
  } catch {
    throw new ProjectReturnReceiptError(400, `مقدار ${label} یا ورودی خط راس آن معتبر نیست.`);
  }
}

export const projectReturnProductKey = (product: { productId: string; unit: string }) => JSON.stringify([product.productId, product.unit]);

export function parseProjectReturnItems(body: Record<string, unknown>) {
  const projectIds = projectReturnProjectIds(body.projectIds);
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) {
    throw new ProjectReturnReceiptError(400, 'بین ۱ تا ۱۰۰ محصول انتخاب کنید.');
  }
  type Calculation = NonNullable<ReturnType<typeof receiptQuantity>['calculation']>;
  type Item = {
    productId: string; unit: ReturnUnit; healthyQuantity: string; damagedQuantity: string;
    healthyCalculation?: Calculation; damagedCalculation?: Calculation; effectiveWidthMeters?: string; partnerContractId?: string;
  };
  const items = new Map<string, Item>();
  for (const input of body.items) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new ProjectReturnReceiptError(400, 'ردیف محصول معتبر نیست.');
    }
    const unit = units.find(candidate => input.unit === candidate);
    if (!unit) throw new ProjectReturnReceiptError(400, 'واحد محصول معتبر نیست.');
    const healthy = receiptQuantity(input.healthyQuantity, input.healthyCalculation, unit, 'سالم');
    const damaged = receiptQuantity(input.damagedQuantity, input.damagedCalculation, unit, 'آسیب‌دیده');
    if (healthy.quantity === '0' && damaged.quantity === '0') {
      throw new ProjectReturnReceiptError(400, 'مقدار سالم یا آسیب‌دیده را وارد کنید.');
    }
    let effectiveWidthMeters: string | null = null;
    if (input.effectiveWidthMeters !== undefined) {
      if (unit === 'meter' && typeof input.effectiveWidthMeters === 'string' && input.effectiveWidthMeters.length <= 100
        && /^\d+(?:\.\d+)?$/.test(input.effectiveWidthMeters.trim())) {
        effectiveWidthMeters = projectReturnWidth(input.effectiveWidthMeters, 'm');
      }
      if (!effectiveWidthMeters) throw new ProjectReturnReceiptError(400, 'عرض سنگ به متر باید بزرگ‌تر از صفر باشد.');
    }
    const item = {
      productId: projectReturnId(input.productId, 'محصول'), unit,
      healthyQuantity: healthy.quantity, damagedQuantity: damaged.quantity,
      ...(healthy.calculation && { healthyCalculation: healthy.calculation }),
      ...(damaged.calculation && { damagedCalculation: damaged.calculation }),
      ...(effectiveWidthMeters && { effectiveWidthMeters }),
      ...(input.partnerContractId !== undefined && { partnerContractId: projectReturnId(input.partnerContractId, 'قرارداد فروش همکار') }),
    };
    const key = projectReturnProductKey(item);
    if (items.has(key)) throw new ProjectReturnReceiptError(400, 'محصول با این واحد تکراری است.');
    items.set(key, item);
  }
  return {
    projectIds,
    items: [...items].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, item]) => item),
  };
}

const projectSelect = { id: true, projectName: true, address: true } satisfies Prisma.ProjectAddressSelect;
export const projectLabel = (project: { projectName: string | null; address: string }) => project.projectName || project.address;

const activePartnerSale = {
  state: 'COMMITTED',
  customerContract: { is: { isInactive: false } },
} satisfies Prisma.PartnerSaleCaseWhereInput;

export const projectReturnCustomerScope = {
  cardDeletedAt: null,
  OR: [{ partnerOwnerProfileId: null }, { partnerSaleCases: { some: activePartnerSale } }],
} satisfies Prisma.CrmCustomerWhereInput;

async function readProjectReturnPartnerContracts(db: Prisma.TransactionClient, customerId: string, projectIds: string[], contractId?: string) {
  const cases = await db.partnerSaleCase.findMany({
    where: {
      ...activePartnerSale, customerId, ...(contractId ? { customerContractId: contractId } : {}),
      OR: projectIds.map(projectId => ({ head: { customerContent: { path: ['projectId'], equals: projectId } } })),
    },
    select: { id: true, customerContractId: true },
    orderBy: { caseNumber: 'asc' },
  });
  const contracts: Array<{
    id: string; projectId: string; caseId: string; revision: number;
    products: Array<{ productRowId: string; unit: string }>; graph: Prisma.JsonValue;
    label: string; description: string;
  }> = [];
  for (const entry of cases) {
    const id = entry.customerContractId;
    if (!id || await partnerContractWasDeleted(db, id)) continue;
    const view = await readCurrentPartnerCaseViews(db, entry.id);
    if (!view?.accounting || view.row.customerContractId !== id
      || view.row.state !== 'COMMITTED' || !view.partner.customerContractNumber) continue;
    const projectId = stoneReturnEvidenceRecord(view.row.head.customerContent).projectId;
    if (typeof projectId !== 'string' || !projectIds.includes(projectId)) continue;
    contracts.push({
      id, projectId, caseId: view.row.id, revision: view.row.headRevision,
      products: view.accounting.products, graph: view.row.head.graph,
      label: view.partner.customerContractNumber, description: view.partner.caseNumber,
    });
  }
  return contracts;
}

export async function searchProjectReturnPartnerContracts(db: Prisma.TransactionClient, customerId: string, projectIds: string[], search: string) {
  await findProjectReturnProjects(db, customerId, projectIds);
  const terms = normalizePersianSearchTokens(search);
  return (await readProjectReturnPartnerContracts(db, customerId, projectIds))
    .filter(({ label, description }) => terms.every(term =>
      normalizePersianSearchTokens(`${label} ${description}`).some(key => key.includes(term))))
    .slice(0, 30).map(({ id, label, description }) => ({ id, label, description }));
}

export async function listProjectReturnProjects(db: Prisma.TransactionClient, customerId: string) {
  const projects = await db.projectAddress.findMany({
    where: { customerId, customer: projectReturnCustomerScope },
    select: projectSelect, orderBy: [{ projectName: 'asc' }, { id: 'asc' }],
  });
  return projects.map(project => ({ id: project.id, label: projectLabel(project), description: project.address }));
}

export async function findProjectReturnProjects(db: Prisma.TransactionClient, customerId: string, projectIds: string[]) {
  const projects = await db.projectAddress.findMany({
    where: { id: { in: projectIds }, customerId, customer: projectReturnCustomerScope },
    select: { ...projectSelect, customer: { select: stoneReturnCustomerSelect } },
    orderBy: { id: 'asc' },
  });
  if (projects.length !== projectIds.length) throw new ProjectReturnReceiptError(400, 'همهٔ پروژه‌ها باید به مشتری انتخاب‌شده تعلق داشته باشند.');
  return projects;
}

type PartnerReturnSource = { projectId: string; contractId: string; partnerCaseId: string; partnerRevision: number; productRowId: string };

type ReturnProduct = {
  productId: string; productName: string; productCode: string; unit: ReturnUnit;
  suggestedWidthMeters: string | null;
  contractSources: Array<ProjectReturnContractSource | PartnerReturnSource>;
};

export function projectReturnVersionItem(
  product: ReturnProduct,
  item: ReturnType<typeof parseProjectReturnItems>['items'][number],
) {
  const { suggestedWidthMeters, ...productFacts } = product;
  if (suggestedWidthMeters && item.effectiveWidthMeters && item.effectiveWidthMeters !== suggestedWidthMeters) {
    throw new ProjectReturnReceiptError(400, 'عرض ثبت‌شدهٔ محصول تغییر کرده است. دوباره عرض محصول را بررسی کنید.');
  }
  const effectiveWidthMeters = suggestedWidthMeters ?? item.effectiveWidthMeters ?? null;
  let area: ReturnType<typeof projectReturnItemArea>;
  try {
    area = projectReturnItemArea(item, effectiveWidthMeters);
  } catch {
    throw new ProjectReturnReceiptError(400, 'مساحت بازگشت از محدودهٔ قابل ثبت بیشتر است.');
  }
  const { partnerContractId: _partnerContractId, ...quantityFacts } = item;
  return { ...productFacts, ...quantityFacts, ...area };
}

export async function readProjectReturnProducts(
  db: Prisma.TransactionClient, customerId: string, projectIds: string[], productIds?: string[], deliveredBefore = new Date(), partnerContractId?: string,
) {
  const [items, revisions, partnerContracts] = await Promise.all([
    partnerContractId ? [] : db.contractItem.findMany({
      where: {
        ...(productIds ? { productId: { in: productIds } } : {}),
        retiredAt: null,
        contract: { customerId, partnerCaseId: null, OR: projectIds.map(projectId => ({ contractData: { path: ['projectId'], equals: projectId } })) },
      },
      select: {
        id: true, contractId: true, productId: true, productRowId: true, productType: true,
        contract: { select: { contractData: true } },
        product: { select: { code: true, name: true, namePersian: true } },
      },
      orderBy: [{ product: { namePersian: 'asc' } }, { id: 'asc' }],
    }),
    partnerContractId ? [] : db.logisticsAllocationRevision.findMany({
      where: { sourceKind: 'SALES_CONTRACT',
        snapshot: { path: ['loading', 'customer', 'id'], equals: customerId },
        OR: projectIds.map(projectId => ({ snapshot: { path: ['loading', 'project', 'id'], equals: projectId } })),
        lines: { some: { sourceKind: 'SALES_CONTRACT', ...(productIds && { productId: { in: productIds } }) } },
        finalizedAt: { lte: deliveredBefore },
      },
      select: {
        physicalExit: { select: { id: true } }, manualOutageExit: { select: { id: true } },
        lines: {
          where: { sourceKind: 'SALES_CONTRACT', ...(productIds && { productId: { in: productIds } }) },
          select: { id: true },
        },
      },
    }),
    readProjectReturnPartnerContracts(db, customerId, projectIds, partnerContractId),
  ]);
  const products = new Map<string, ReturnProduct>();
  const ordinaryWidths = new Map<string, string | null>();
  function addSource(productId: string, productData: { code: string; name: string; namePersian: string | null },
    unit: ReturnUnit, source: ProjectReturnContractSource | PartnerReturnSource, width: string | null) {
    const key = projectReturnProductKey({ productId, unit });
    const product = products.get(key) ?? {
      productId, productName: productData.namePersian || productData.name, productCode: productData.code, unit, contractSources: [], suggestedWidthMeters: width,
    };
    if (product.suggestedWidthMeters !== width) product.suggestedWidthMeters = null;
    product.contractSources.push(source);
    products.set(key, product);
  }
  for (const item of items) {
    let snapshot: ReturnType<typeof resolveLogisticsContractRow>;
    try {
      snapshot = resolveLogisticsContractRow(item.contract.contractData, item);
    } catch {
      // A missing or ambiguous contract-row snapshot cannot establish its unit.
      continue;
    }
    const contractUnit = inferLogisticsContractUnit(item, snapshot);
    const unit = units.find(candidate => candidate === contractUnit);
    if (!unit) continue;
    const { projectId } = item.contract.contractData as { projectId: string };
    const width = unit === 'meter'
      ? projectReturnWidth(snapshot.widthMeters, 'm') ?? projectReturnWidth(snapshot.width, snapshot.widthUnit)
      : null;
    ordinaryWidths.set(item.id, width);
    addSource(item.productId, item.product, unit, { projectId, contractId: item.contractId,
      contractItemId: item.id, productRowId: item.productRowId }, width);
  }
  const partnerRows = partnerContracts.flatMap(({ id, projectId, caseId, revision, products, graph: snapshot }) => {
    const graph = stoneReturnEvidenceRecord(snapshot);
    const rows = Array.isArray(graph.rows) ? graph.rows.map(stoneReturnEvidenceRecord) : [];
    return products.flatMap(row => {
      const unit = units.find(candidate => candidate === row.unit || (candidate === 'meter' && row.unit === 'm'));
      const graphRow = rows.find(item => item.productRowId === row.productRowId);
      const productId = graphRow?.catalogProductId;
      if (!unit || typeof productId !== 'string' || (productIds && !productIds.includes(productId))) return [];
      const rowWidth = stoneReturnEvidenceRecord(graphRow?.commercial).requestedWidthMeters;
      return [{ productId, unit, rowWidth, source: { projectId, contractId: id, productRowId: row.productRowId,
        partnerCaseId: caseId, partnerRevision: revision } }];
    });
  });
  if (partnerRows.length) {
    const catalog = await db.product.findMany({
      where: { id: { in: [...new Set(partnerRows.map(row => row.productId))] } },
      select: { id: true, code: true, name: true, namePersian: true },
    });
    const byId = new Map(catalog.map(product => [product.id, product]));
    for (const { productId, unit, rowWidth, source } of partnerRows) {
      const product = byId.get(productId);
      if (product) addSource(productId, product, unit, source, unit === 'meter'
        ? projectReturnWidth(rowWidth, 'm')
        : null);
    }
  }
  const exits = revisions.flatMap(revision => [revision.physicalExit, revision.manualOutageExit]
    .flatMap(exit => exit ? revision.lines.map(line => `${exit.id}:${line.id}`) : []));
  if (exits.length) {
    const dispatches = await db.shipmentQuantityEvidence.findMany({
      where: { sourceKind: 'SALES_CONTRACT', contract: { customerId },
        kind: { in: ['PHYSICAL_EXIT', 'MANUAL_OUTAGE_EXIT'] }, effectiveAt: { lte: deliveredBefore },
        contractItem: { ...(productIds && { productId: { in: productIds } }) },
        sourceId: { in: exits },
      },
      include: { contractItem: { select: { productId: true, product: { select: { code: true, name: true, namePersian: true } } } } },
      orderBy: [{ effectiveAt: 'desc' }, { id: 'asc' }],
    });
    for (const dispatch of dispatches) {
      const item = dispatch.contractItem;
      const unit = units.find(candidate => candidate === dispatch.unit);
      if (!item || !unit) continue;
      const source = await readVerifiedProjectDispatch(db, dispatch, customerId, item.productId);
      if (!source || !projectIds.includes(source.projectId)) continue;
      const { projectName: _projectName, ...contractSource } = source;
      addSource(item.productId, item.product, unit, contractSource, ordinaryWidths.get(contractSource.contractItemId) ?? null);
    }
  }
  return products;
}


type IntakeItems = ReturnType<typeof parseProjectReturnItems>['items'];

export async function readProjectReturnIntakeProducts(
  tx: Prisma.TransactionClient, customerId: string, projectIds: string[], items: IntakeItems, deliveredBefore: Date,
) {
  const productIdsByContract = new Map<string | undefined, string[]>();
  for (const item of items) {
    const productIds = productIdsByContract.get(item.partnerContractId) ?? [];
    productIds.push(item.productId);
    productIdsByContract.set(item.partnerContractId, productIds);
  }
  const scopes = await Promise.all([...productIdsByContract].map(async ([partnerContractId, productIds]) => [
    partnerContractId,
    await readProjectReturnProducts(tx, customerId, projectIds, productIds, deliveredBefore, partnerContractId),
  ] as const));
  const products = new Map(scopes);
  return items.map(item => products.get(item.partnerContractId)?.get(projectReturnProductKey(item)));
}

export async function searchProjectReturnProducts(db: Prisma.TransactionClient, customerId: string, projectIds: string[], search: string, partnerContractId?: string) {
  await findProjectReturnProjects(db, customerId, projectIds);
  const terms = normalizePersianSearchTokens(search);
  const products = await readProjectReturnProducts(db, customerId, projectIds, undefined, new Date(), partnerContractId);
  return [...products.values()].flatMap(({ contractSources: _sources, suggestedWidthMeters, ...product }) => {
    const keys = normalizePersianSearchTokens(`${product.productName} ${product.productCode}`);
    return terms.every(term => keys.some(key => key.includes(term)))
      ? [{ ...product, ...(product.unit === 'meter' && { suggestedWidthMeters }) }] : [];
  }).slice(0, 50);
}

const initialCaseInclude = {
  guardVisit: {
    select: { id: true, status: true, projectReturnStatus: true, admittedAt: true, driverSource: true, admissionSnapshot: true },
  },
  // Intake replay always refers to the immutable original version.
  versions: { where: { number: 1 }, include: { projects: { orderBy: { projectId: 'asc' } }, items: { orderBy: [{ productId: 'asc' }, { unit: 'asc' }] } } },
} satisfies Prisma.ProjectReturnCaseInclude;

const latestCaseInclude = {
  ...initialCaseInclude,
  versions: { take: 1, orderBy: { number: 'desc' }, include: initialCaseInclude.versions.include },
} satisfies Prisma.ProjectReturnCaseInclude;

function projectReturnPartnerScope(value: Prisma.JsonValue) {
  if (!Array.isArray(value) || !value.length) return null;
  const sources = value.map(stoneReturnEvidenceRecord);
  const contractId = sources[0].contractId;
  return typeof contractId === 'string' && sources.every(source =>
    typeof source.partnerCaseId === 'string' && source.contractId === contractId) ? contractId : null;
}

function presentReceipt(receipt: Prisma.ProjectReturnCaseGetPayload<{ include: typeof initialCaseInclude }>) {
  const { guardVisit, versions: [version], id, createdAt, operationStatus } = receipt;
  return {
    id, customerId: version.customerId, customerName: version.customerName, createdAt, operationStatus,
    visit: guardVisit ? presentProjectReturnVisit(guardVisit) : null,
    legacyFinalizationId: receipt.legacyFinalizationId,
    version: {
      id: version.id, number: version.number, baseVersionId: version.baseVersionId,
      submittedAt: version.submittedAt, submittedBy: version.submittedBy, assignedAt: version.assignedAt, assignedBy: version.assignedBy,
      projects: version.projects.map(({ projectId, projectName }) => ({ projectId, projectName })),
      items: version.items.map(({ id, productId, productName, productCode, unit, healthyQuantity, damagedQuantity,
        healthyCalculation, damagedCalculation, inventoryIdentityId, effectiveWidthMeters, healthyAreaSquareMeters, damagedAreaSquareMeters, contractSources }) => ({
        id, productId, productName, productCode, unit, healthyQuantity: healthyQuantity.toFixed(), damagedQuantity: damagedQuantity.toFixed(),
        healthyCalculation, damagedCalculation, inventoryIdentityId,
        partnerContractId: projectReturnPartnerScope(contractSources),
        effectiveWidthMeters: effectiveWidthMeters?.toFixed() ?? null,
        healthyAreaSquareMeters: healthyAreaSquareMeters?.toFixed() ?? (unit === 'squareMeter' ? healthyQuantity.toFixed() : null),
        damagedAreaSquareMeters: damagedAreaSquareMeters?.toFixed() ?? (unit === 'squareMeter' ? damagedQuantity.toFixed() : null),
      })),
    },
  };
}

export async function readProjectReturnReceipt(db: Prisma.TransactionClient, id: string, version: 'initial' | 'latest' | { id: string } = 'initial') {
  const receipt = await db.projectReturnCase.findFirst({
    where: { id, ...(version === 'initial' && { guardVisitId: { not: null } }) },
    include: typeof version === 'object'
      ? { ...initialCaseInclude, versions: { where: { id: version.id }, include: initialCaseInclude.versions.include } }
      : version === 'latest' ? latestCaseInclude : initialCaseInclude,
  });
  if (!receipt?.versions.length) throw new ProjectReturnReceiptError(404, 'رسید مرجوعی پروژه پیدا نشد.');
  return presentReceipt(receipt);
}

export async function listProjectReturnReceipts(db: Prisma.TransactionClient, after?: string, version: 'initial' | 'latest' = 'initial') {
  const where = version === 'initial' ? { guardVisitId: { not: null } } : {};
  if (after && !await db.projectReturnCase.findFirst({ where: { id: after, ...where }, select: { id: true } })) {
    throw new ProjectReturnReceiptError(404, 'صفحهٔ مرجوعی‌ها پیدا نشد.');
  }
  const rows = await db.projectReturnCase.findMany({
    where, include: version === 'latest' ? latestCaseInclude : initialCaseInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 31, ...(after ? { cursor: { id: after }, skip: 1 } : {}),
  });
  return { items: rows.slice(0, 30).map(presentReceipt), nextCursor: rows.length > 30 ? rows[29].id : null };
}

function parseIntake(body: Record<string, unknown>) {
  return {
    visitId: projectReturnId(body.visitId, 'ورود'),
    customerId: projectReturnId(body.customerId, 'مشتری'),
    ...parseProjectReturnItems(body),
  };
}

export async function prepareProjectReturnVersion(tx: Prisma.TransactionClient, input: {
  caseId: string; actorId: string; body: Record<string, unknown>; deliveredBefore: Date;
}) {
  const command = parseIntake(input.body);
  const projects = await findProjectReturnProjects(tx, command.customerId, command.projectIds);
  const { customer } = projects[0];
  const products = await readProjectReturnIntakeProducts(tx, command.customerId, command.projectIds, command.items, input.deliveredBefore);
  const id = randomUUID();
  const submittedAt = new Date();
  const items: Prisma.ProjectReturnVersionItemUncheckedCreateWithoutVersionInput[] = [];
  for (const [index, row] of command.items.entries()) {
    const product = products[index];
    if (!product) throw new ProjectReturnReceiptError(400, 'محصول با این واحد در قراردادهای پروژه پیدا نشد.');
    const versionItem = projectReturnVersionItem(product, row);
    const itemId = randomUUID();
    const inventoryIdentityId = await recordProjectReturnStock(tx, {
      caseId: input.caseId, versionId: id, guardVisitId: command.visitId, customerId: customer.id,
      actorId: input.actorId, occurredAt: submittedAt, itemId, productId: row.productId,
      unit: row.unit, healthyQuantity: row.healthyQuantity,
    });
    items.push({ ...versionItem, id: itemId, inventoryIdentityId });
  }
  return {
    customer,
    version: {
      id, submittedAt, submittedBy: input.actorId, customerId: customer.id, customerName: stoneReturnCustomerName(customer),
      projects: { create: projects.map(project => ({ projectId: project.id, projectName: projectLabel(project) })) },
      items: { create: items },
    },
  };
}

export async function submitProjectReturnReceipt(db: PrismaClient, actorId: string, body: Record<string, unknown>) {
  const command = parseIntake(body);
  const intakeHash = createHash('sha256').update(JSON.stringify(command)).digest('hex');
  const visit = { turnId: command.visitId, actorId };

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await db.$transaction(async tx => {
        await lockProjectReturnVisit(tx, visit.turnId);
        const existing = await tx.projectReturnCase.findUnique({ where: { guardVisitId: visit.turnId }, include: initialCaseInclude });
        if (existing) {
          if (existing.intakeHash !== intakeHash) {
            throw new ProjectReturnReceiptError(409, 'برای این مراجعه رسید دیگری ثبت شده است.');
          }
          return { receipt: presentReceipt(existing), replayed: true };
        }
        const admitted = await receiveProjectReturnVisit(tx, visit);
        const caseId = randomUUID();
        const { customer, version } = await prepareProjectReturnVersion(tx, { caseId, actorId, body, deliveredBefore: admitted.admittedAt });
        const saved = await tx.projectReturnCase.create({
          data: {
            id: caseId, guardVisitId: visit.turnId, customerId: customer.id, customerName: stoneReturnCustomerName(customer), intakeHash,
            versions: { create: { ...version, number: 1 } },
          },
          include: initialCaseInclude,
        });
        return { receipt: presentReceipt(saved), replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError)
        || (error.code !== 'P2034' && !(error.code === 'P2010' && error.meta?.code === '40001'))) throw error;
    }
  }
  throw new ProjectReturnReceiptError(409, 'وضعیت مراجعه تغییر کرده است. دوباره تلاش کنید.');
}
