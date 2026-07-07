import express, { Response } from 'express';
import { body, validationResult } from 'express-validator';
import { Prisma, PrismaClient, SecurityDriverQueueTurnStatus } from '@prisma/client';
import { protect } from '../middleware/auth';
import { requireWorkspaceAccess, WORKSPACE_PERMISSIONS, WORKSPACES } from '../middleware/workspace';
import { requireFeatureAccess, FEATURE_PERMISSIONS, FEATURES } from '../middleware/feature';

const router = express.Router();
const prisma = new PrismaClient();

const LINEAR_TOLERANCE = 0.5;
const EDITABLE_STATUS = 'DRAFT';
const FINALIZED_STATUS = 'FINALIZED';
const CANCELLED_STATUS = 'CANCELLED';

router.use(protect);

const canEdit = requireWorkspaceAccess(WORKSPACES.LOGISTICS, WORKSPACE_PERMISSIONS.EDIT);
const canView = requireWorkspaceAccess(WORKSPACES.LOGISTICS, WORKSPACE_PERMISSIONS.VIEW);
const canViewDashboard = requireFeatureAccess(FEATURES.LOGISTICS_DASHBOARD_VIEW, FEATURE_PERMISSIONS.VIEW);
const canViewLoadings = requireFeatureAccess(FEATURES.LOGISTICS_LOADINGS_VIEW, FEATURE_PERMISSIONS.VIEW);
const canCreateLoadings = requireFeatureAccess(FEATURES.LOGISTICS_LOADINGS_CREATE, FEATURE_PERMISSIONS.EDIT);
const canEditLoadings = requireFeatureAccess(FEATURES.LOGISTICS_LOADINGS_EDIT, FEATURE_PERMISSIONS.EDIT);
const canFinalizeLoadings = requireFeatureAccess(FEATURES.LOGISTICS_LOADINGS_FINALIZE, FEATURE_PERMISSIONS.EDIT);
const canCancelLoadings = requireFeatureAccess(FEATURES.LOGISTICS_LOADINGS_CANCEL, FEATURE_PERMISSIONS.EDIT);
const canCreateCorrections = requireFeatureAccess(FEATURES.LOGISTICS_CORRECTIONS_CREATE, FEATURE_PERMISSIONS.EDIT);
const canViewDrivers = requireFeatureAccess(FEATURES.LOGISTICS_DRIVERS_VIEW, FEATURE_PERMISSIONS.VIEW);

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const decimalInput = (value: unknown) => Number(toNumber(value).toFixed(3));

const normalizeDigits = (value: unknown): string => {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value)
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/\D/g, '');
};

const normalizePhoneSearch = (value: unknown): string => {
  const digits = normalizeDigits(value);
  if (digits.startsWith('0098')) return `0${digits.slice(4)}`;
  if (digits.startsWith('98') && digits.length === 12) return `0${digits.slice(2)}`;
  if (digits.startsWith('9') && digits.length === 10) return `0${digits}`;
  return digits;
};

const isLinearUnit = (unit?: string | null) => {
  const normalized = String(unit || '').toLowerCase();
  return ['meter', 'linear_meter', 'linear-meter', 'm'].includes(normalized) || normalized.includes('طول');
};

const inferUnit = (item: any, snapshot: any) => {
  const explicitUnit = snapshot?.unit || snapshot?.preparedUnit || snapshot?.meta?.unit;
  if (explicitUnit) {
    const unit = String(explicitUnit);
    if (unit.includes('متر طول') || unit === 'meter') return 'meter';
    if (unit.includes('متر مربع') || unit === 'squareMeter') return 'squareMeter';
    if (unit.includes('عدد') || unit === 'count') return 'count';
    return unit;
  }

  const productType = String(item?.productType || snapshot?.productType || '').toLowerCase();
  if (productType.includes('longitudinal') || productType.includes('طولی')) return 'meter';
  if (productType.includes('slab') || productType.includes('اسلب')) return 'squareMeter';
  return 'count';
};

const unitLabel = (unit: string) => {
  if (unit === 'meter') return 'متر طول';
  if (unit === 'squareMeter') return 'متر مربع';
  if (unit === 'count') return 'عدد';
  return unit;
};

const productDisplayName = (product: any, snapshot?: any) => {
  return snapshot?.stoneName || snapshot?.name || product?.namePersian || product?.name || 'محصول';
};

const getContractProducts = (contract: any) => {
  const data = contract?.contractData as any;
  return Array.isArray(data?.products) ? data.products : Array.isArray(data?.items) ? data.items : [];
};

const itemSnapshot = (contract: any, item: any, itemIndex: number) => {
  const products = getContractProducts(contract);
  const byIndex = products[itemIndex];
  if (byIndex && (!byIndex.productId || byIndex.productId === item.productId)) return byIndex;
  return products.find((product: any) => product?.productId === item.productId) || null;
};

const getDeliverableQuantity = (item: any, snapshot: any, unit: string) => {
  if (unit === 'meter') {
    const length = toNumber(snapshot?.length ?? snapshot?.actualLength ?? snapshot?.actualLengthMeters);
    const lengthM = snapshot?.lengthUnit === 'cm' ? length / 100 : length;
    const quantity = toNumber(snapshot?.quantity, 1);
    const total = lengthM * quantity;
    return total > 0 ? Number(total.toFixed(3)) : toNumber(item.quantity);
  }

  if (unit === 'squareMeter') {
    const squareMeters = toNumber(snapshot?.squareMeters);
    if (squareMeters > 0) return Number(squareMeters.toFixed(3));
    const preparedQuantity = toNumber(snapshot?.preparedQuantity);
    if (preparedQuantity > 0) return Number(preparedQuantity.toFixed(3));
  }

  if (unit === 'ton') {
    const preparedQuantity = toNumber(snapshot?.preparedQuantity);
    if (preparedQuantity > 0) return Number(preparedQuantity.toFixed(3));
  }

  return toNumber(snapshot?.preparedQuantity ?? snapshot?.quantity ?? item.quantity);
};

const productSnapshotFor = (contract: any, item: any, itemIndex: number) => {
  const snapshot = itemSnapshot(contract, item, itemIndex);
  const unit = inferUnit(item, snapshot);
  const contractedQuantity = getDeliverableQuantity(item, snapshot, unit);
  return {
    productId: item.productId,
    productType: item.productType,
    name: productDisplayName(item.product, snapshot),
    catalogName: item.product?.namePersian || item.product?.name || null,
    quantity: contractedQuantity,
    rowQuantity: toNumber(item.quantity),
    unit,
    width: snapshot?.width ?? item.product?.widthValue ?? null,
    thickness: snapshot?.thickness ?? item.product?.thicknessValue ?? null,
    length: snapshot?.length ?? snapshot?.actualLength ?? snapshot?.actualLengthMeters ?? null,
    lengthUnit: snapshot?.lengthUnit ?? null,
    squareMeters: snapshot?.squareMeters ?? null,
    preparedQuantity: snapshot?.preparedQuantity ?? null,
    preparedUnit: snapshot?.preparedUnit ?? null,
    services: snapshot?.services || snapshot?.selectedServices || [],
    tools: snapshot?.tools || snapshot?.selectedTools || [],
    finishing: snapshot?.finishing || snapshot?.stoneFinishing || null,
    description: item.description || snapshot?.description || null,
    snapshot
  };
};

const getProjectWithCustomer = async (projectId: string) => {
  return prisma.projectAddress.findUnique({
    where: { id: projectId },
    include: { customer: true }
  });
};

const getProjectContracts = async (projectId: string, customerId: string) => {
  const contracts = await prisma.salesContract.findMany({
    where: {
      customerId,
      status: { notIn: ['CANCELLED', 'EXPIRED'] as any },
      contractData: {
        path: ['projectId'],
        equals: projectId
      }
    },
    include: {
      items: {
        include: { product: true },
        orderBy: { createdAt: 'asc' }
      }
    },
    orderBy: { createdAt: 'asc' }
  });

  if (!contracts.length) return [];

  const approvedRecords = await prisma.accountingFinancialRecord.findMany({
    where: {
      contractId: { in: contracts.map((contract) => contract.id) },
      financiallyApprovedAt: { not: null }
    },
    select: { contractId: true }
  });
  const financiallyApprovedContractIds = new Set(approvedRecords.map((record) => record.contractId).filter(Boolean));

  return contracts.filter((contract) => financiallyApprovedContractIds.has(contract.id));
};

const getConsumptionByItemIds = async (itemIds: string[]) => {
  if (!itemIds.length) return new Map<string, number>();

  const lines = await prisma.logisticsLoadingLine.findMany({
    where: {
      sourceContractItemId: { in: itemIds },
      loading: { status: FINALIZED_STATUS as any }
    },
    select: { sourceContractItemId: true, quantity: true }
  });

  const corrections = await prisma.logisticsLoadingCorrection.findMany({
    where: { sourceContractItemId: { in: itemIds } },
    select: { sourceContractItemId: true, deltaQuantity: true }
  });

  const totals = new Map<string, number>();
  for (const line of lines) {
    totals.set(line.sourceContractItemId, (totals.get(line.sourceContractItemId) || 0) + toNumber(line.quantity));
  }
  for (const correction of corrections) {
    totals.set(correction.sourceContractItemId, (totals.get(correction.sourceContractItemId) || 0) + toNumber(correction.deltaQuantity));
  }
  return totals;
};

const buildRemainingForProject = async (projectId: string) => {
  const project = await getProjectWithCustomer(projectId);
  if (!project) {
    throw new Error('Project not found');
  }

  const contracts = await getProjectContracts(projectId, project.customerId);
  const itemIds = contracts.flatMap((contract) => contract.items.map((item) => item.id));
  const consumed = await getConsumptionByItemIds(itemIds);
  const groups = new Map<string, any>();

  for (const contract of contracts) {
    contract.items.forEach((item, index) => {
      const snapshot = productSnapshotFor(contract, item, index);
      const unit = snapshot.unit;
      const contractedQuantity = snapshot.quantity;
      const finalizedLoadedQuantity = consumed.get(item.id) || 0;
      const remainingQuantity = Number((contractedQuantity - finalizedLoadedQuantity).toFixed(3));
      const groupKey = [
        item.productId,
        item.productType || '',
        unit,
        snapshot.width ?? '',
        snapshot.thickness ?? '',
        JSON.stringify(snapshot.services || []),
        JSON.stringify(snapshot.tools || []),
        JSON.stringify(snapshot.finishing || null)
      ].join('|');

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          groupKey,
          productId: item.productId,
          unit,
          unitLabel: unitLabel(unit),
          productType: item.productType,
          displayName: snapshot.name,
          productSnapshot: snapshot,
          contractedTotal: 0,
          finalizedLoadedTotal: 0,
          remainingTotal: 0,
          sources: []
        });
      }

      const group = groups.get(groupKey);
      group.contractedTotal += contractedQuantity;
      group.finalizedLoadedTotal += finalizedLoadedQuantity;
      group.remainingTotal += remainingQuantity;
      group.sources.push({
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        contractStatus: contract.status,
        contractItemId: item.id,
        productId: item.productId,
        productType: item.productType,
        unit,
        unitLabel: unitLabel(unit),
        contractedQuantity,
        finalizedLoadedQuantity,
        remainingQuantity,
        productSnapshot: snapshot
      });
    });
  }

  return {
    project: {
      id: project.id,
      projectName: project.projectName,
      address: project.address,
      city: project.city,
      customerId: project.customerId,
      customerName: `${project.customer.firstName} ${project.customer.lastName}`.trim(),
      companyName: project.customer.companyName
    },
    groups: Array.from(groups.values())
      .map((group) => ({
        ...group,
        contractedTotal: Number(group.contractedTotal.toFixed(3)),
        finalizedLoadedTotal: Number(group.finalizedLoadedTotal.toFixed(3)),
        remainingTotal: Number(group.remainingTotal.toFixed(3)),
        sources: group.sources.sort((a: any, b: any) => a.contractNumber.localeCompare(b.contractNumber))
      }))
      .filter((group) => group.remainingTotal > 0)
  };
};

const customerDisplayName = (customer: any) => {
  return `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || customer.companyName || 'Customer';
};

const customerSearchWhere = (search: string, phoneContains: any) => ({
  isActive: true,
  ...(search ? {
    OR: [
      { firstName: { contains: search, mode: 'insensitive' as const } },
      { lastName: { contains: search, mode: 'insensitive' as const } },
      { companyName: { contains: search, mode: 'insensitive' as const } },
      { brandName: { contains: search, mode: 'insensitive' as const } },
      { nationalCode: { contains: search, mode: 'insensitive' as const } },
      { projectManagerName: { contains: search, mode: 'insensitive' as const } },
      { referrerFirstName: { contains: search, mode: 'insensitive' as const } },
      { referrerLastName: { contains: search, mode: 'insensitive' as const } },
      { projectAddresses: { some: { projectName: { contains: search, mode: 'insensitive' as const } } } },
      { projectAddresses: { some: { address: { contains: search, mode: 'insensitive' as const } } } },
      { projectAddresses: { some: { projectManagerName: { contains: search, mode: 'insensitive' as const } } } },
      ...(phoneContains ? [
        { phoneNumbers: { some: { number: phoneContains } } },
        { homeNumber: phoneContains },
        { workNumber: phoneContains },
        { projectManagerNumber: phoneContains },
        { referrerPhoneNumber: phoneContains },
        { primaryContact: { is: { phone: phoneContains } } },
        { primaryContact: { is: { mobile: phoneContains } } },
        { contacts: { some: { OR: [{ phone: phoneContains }, { mobile: phoneContains }] } } },
        { projectAddresses: { some: { projectManagerNumber: phoneContains } } },
        { projectAddresses: { some: { marketerPhoneNumber: phoneContains } } }
      ] : [])
    ]
  } : {})
});

const loadableProjectsForCustomer = async (customerId: string) => {
  const projects = await prisma.projectAddress.findMany({
    where: { customerId, isActive: true },
    include: { customer: true },
    orderBy: { updatedAt: 'desc' }
  });

  const loadableProjects: Array<{ project: any; remainingCount: number; remainingTotal: number }> = [];
  for (const project of projects) {
    const remaining = await buildRemainingForProject(project.id);
    if (remaining.groups.length > 0) {
      loadableProjects.push({
        project,
        remainingCount: remaining.groups.length,
        remainingTotal: remaining.groups.reduce((sum: number, group: any) => sum + toNumber(group.remainingTotal), 0)
      });
    }
  }

  return loadableProjects;
};

const buildDriverSnapshot = (driver: any, override: any = {}) => ({
  driverId: driver?.id || null,
  vehiclePairId: driver?.id || null,
  firstName: override.firstName ?? driver?.firstName ?? '',
  lastName: override.lastName ?? driver?.lastName ?? '',
  vehiclePlate: override.vehiclePlate ?? driver?.vehiclePlate ?? '',
  vehicleType: override.vehicleType ?? driver?.vehicleType ?? '',
  phone: override.phone ?? driver?.phone ?? '',
  nationalCode: override.nationalCode ?? driver?.nationalCode ?? '',
  capturedAt: new Date().toISOString()
});

const validateDriverSnapshot = (snapshot: any) => {
  const required = ['firstName', 'lastName', 'vehiclePlate', 'vehicleType', 'phone', 'nationalCode'];
  return required.every((field) => String(snapshot?.[field] || '').trim().length > 0);
};

const reserveQueueTurn = async (tx: Prisma.TransactionClient, queueTurnId: string | null | undefined, loadingId: string, actorId: string) => {
  const previous = await tx.securityDriverQueueTurn.findFirst({ where: { loadingId } });
  if (previous && previous.id !== queueTurnId) {
    await tx.securityDriverQueueTurn.update({
      where: { id: previous.id },
      data: { status: SecurityDriverQueueTurnStatus.WAITING, loadingId: null, reservedAt: null, reservedBy: null, reservedPosition: null }
    });
  }
  if (!queueTurnId) return null;
  const turn = await tx.securityDriverQueueTurn.findUnique({ where: { id: queueTurnId }, include: { vehiclePair: { include: { photos: true } } } });
  if (!turn || !turn.vehiclePair.isActive) throw new Error('Selected driver queue turn is not active');
  if (turn.status === SecurityDriverQueueTurnStatus.RESERVED && turn.loadingId !== loadingId) throw new Error('Selected driver is reserved for another loading');
  if (turn.status !== SecurityDriverQueueTurnStatus.WAITING && turn.status !== SecurityDriverQueueTurnStatus.RESERVED) throw new Error('Selected driver is no longer waiting in the queue');
  const complete = Boolean(turn.vehiclePair.homeAddress && turn.vehiclePair.relativePhone && ['DRIVER_LICENSE', 'VEHICLE_CARD', 'DRIVER_PHOTO'].every((category) => turn.vehiclePair.photos.some((photo) => photo.category === category)));
  if (!complete && (!turn.vehiclePair.informationGraceEndsAt || turn.vehiclePair.informationGraceEndsAt <= new Date())) throw new Error('Selected driver registry information must be completed by security');
  const position = await tx.securityDriverQueueTurn.count({ where: { status: SecurityDriverQueueTurnStatus.WAITING, enteredAt: { lte: turn.enteredAt } } });
  if (turn.status === SecurityDriverQueueTurnStatus.WAITING) {
    const claimed = await tx.securityDriverQueueTurn.updateMany({
      where: { id: turn.id, status: SecurityDriverQueueTurnStatus.WAITING },
      data: { status: SecurityDriverQueueTurnStatus.RESERVED, loadingId, reservedAt: new Date(), reservedBy: actorId, reservedPosition: Math.max(position, 1) }
    });
    if (claimed.count !== 1) throw new Error('Selected driver was reserved or removed by another user');
  }
  return turn.vehiclePair;
};

const releaseQueueTurn = async (tx: Prisma.TransactionClient, loadingId: string) => {
  await tx.securityDriverQueueTurn.updateMany({
    where: { loadingId, status: SecurityDriverQueueTurnStatus.RESERVED },
    data: { status: SecurityDriverQueueTurnStatus.WAITING, loadingId: null, reservedAt: null, reservedBy: null, reservedPosition: null }
  });
};

const generateLoadingNumber = async () => {
  const now = new Date();
  const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const count = await prisma.logisticsLoading.count({
    where: {
      createdAt: {
        gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
        lt: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      }
    }
  });
  return `L-${datePart}-${String(count + 1).padStart(4, '0')}`;
};

const linePayloadToCreate = async (line: any) => {
  const sourceItem = await prisma.contractItem.findUnique({
    where: { id: line.sourceContractItemId },
    include: {
      product: true,
      contract: true
    }
  });

  if (!sourceItem) {
    throw new Error('Source contract item not found');
  }

  const financiallyApprovedRecord = await prisma.accountingFinancialRecord.findFirst({
    where: {
      contractId: sourceItem.contractId,
      financiallyApprovedAt: { not: null }
    },
    select: { id: true }
  });

  if (!financiallyApprovedRecord) {
    throw new Error('Contract is not financially approved for logistics loading');
  }

  const unit = String(line.unit || inferUnit(sourceItem, null));
  const khatRas = line.khatRas === undefined || line.khatRas === null || line.khatRas === '' ? null : decimalInput(line.khatRas);
  const pieceCount = line.pieceCount === undefined || line.pieceCount === null || line.pieceCount === '' ? null : decimalInput(line.pieceCount);
  const plus = decimalInput(line.plus || 0);
  const minus = decimalInput(line.minus || 0);
  const calculated = khatRas !== null && pieceCount !== null
    ? decimalInput((khatRas * pieceCount) + plus - minus)
    : decimalInput(line.quantity);

  return {
    sourceContractId: sourceItem.contractId,
    sourceContractItemId: sourceItem.id,
    productId: sourceItem.productId,
    quantity: calculated,
    unit,
    khatRas,
    pieceCount,
    plus,
    minus,
    productSnapshot: line.productSnapshot || {
      productId: sourceItem.productId,
      name: sourceItem.product.namePersian || sourceItem.product.name,
      productType: sourceItem.productType
    },
    sourceSnapshot: line.sourceSnapshot || {
      contractId: sourceItem.contractId,
      contractNumber: sourceItem.contract.contractNumber,
      contractItemId: sourceItem.id,
      contractedQuantity: productSnapshotFor(sourceItem.contract, sourceItem, 0).quantity
    },
    calculationSnapshot: {
      formula: khatRas !== null && pieceCount !== null ? 'khatRas * pieceCount + plus - minus' : 'direct',
      khatRas,
      pieceCount,
      plus,
      minus,
      calculatedQuantity: calculated,
      unit
    },
    notes: line.notes || null
  };
};

const loadLoading = (id: string) => {
  return prisma.logisticsLoading.findUnique({
    where: { id },
    include: {
      customer: true,
      project: true,
      driver: true,
      vehiclePair: true,
      driverQueueTurn: true,
      lines: {
        include: {
          product: true,
          sourceContract: true,
          sourceContractItem: true,
          corrections: true
        },
        orderBy: { createdAt: 'asc' }
      },
      corrections: {
        include: {
          product: true,
          sourceContractItem: {
            include: { contract: true }
          }
        },
        orderBy: { createdAt: 'desc' }
      }
    }
  });
};

const validateLineRemaining = async (lines: Array<{ sourceContractItemId: string; quantity: number; unit: string }>, excludeLoadingId?: string) => {
  const itemIds = lines.map((line) => line.sourceContractItemId);
  const sourceItems = await prisma.contractItem.findMany({
    where: { id: { in: itemIds } },
    include: { contract: true, product: true }
  });
  const sourceById = new Map(sourceItems.map((item) => [item.id, item]));
  const consumed = await getConsumptionByItemIds(itemIds);

  if (excludeLoadingId) {
    const existingLines = await prisma.logisticsLoadingLine.findMany({
      where: { loadingId: excludeLoadingId },
      select: { sourceContractItemId: true, quantity: true }
    });
    for (const existing of existingLines) {
      consumed.set(existing.sourceContractItemId, (consumed.get(existing.sourceContractItemId) || 0) - toNumber(existing.quantity));
    }
  }

  for (const line of lines) {
    const item = sourceById.get(line.sourceContractItemId);
    if (!item) throw new Error('Source contract item not found');
    const snapshot = productSnapshotFor((item as any).contract, item, 0);
    const remaining = snapshot.quantity - (consumed.get(line.sourceContractItemId) || 0);
    const allowed = remaining + (isLinearUnit(line.unit) ? LINEAR_TOLERANCE : 0);
    if (line.quantity > allowed + 0.0001) {
      throw new Error(`Loaded quantity exceeds remaining for source row ${line.sourceContractItemId}`);
    }
  }
};

router.get('/dashboard', canView, canViewDashboard, async (_req: any, res: Response) => {
  try {
    const [drafts, finalized, cancelled, drivers] = await Promise.all([
      prisma.logisticsLoading.count({ where: { status: EDITABLE_STATUS as any } }),
      prisma.logisticsLoading.count({ where: { status: FINALIZED_STATUS as any } }),
      prisma.logisticsLoading.count({ where: { status: CANCELLED_STATUS as any } }),
      prisma.securityDriverQueueTurn.count({ where: { status: SecurityDriverQueueTurnStatus.WAITING } })
    ]);

    const recent = await prisma.logisticsLoading.findMany({
      take: 8,
      orderBy: { updatedAt: 'desc' },
      include: { customer: true, project: true, lines: true }
    });

    res.json({
      success: true,
      data: {
        metrics: { drafts, finalized, cancelled, drivers },
        recent: recent.map((loading) => ({
          id: loading.id,
          loadingNumber: loading.loadingNumber,
          status: loading.status,
          customerName: `${loading.customer.firstName} ${loading.customer.lastName}`.trim(),
          projectName: loading.project.projectName || loading.project.address,
          loadingDate: loading.loadingDate,
          lineCount: loading.lines.length
        }))
      }
    });
  } catch (error) {
    console.error('Logistics dashboard error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.get('/customers', canView, canCreateLoadings, async (req: any, res: Response) => {
  try {
    const search = String(req.query.search || '').trim();
    const phoneSearch = normalizePhoneSearch(search);
    const phoneContains = phoneSearch.length >= 3 ? { contains: phoneSearch, mode: 'insensitive' as const } : null;
    const customers = await prisma.crmCustomer.findMany({
      where: customerSearchWhere(search, phoneContains),
      include: {
        phoneNumbers: { where: { isActive: true }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
        projectAddresses: { where: { isActive: true }, orderBy: { updatedAt: 'desc' } },
        primaryContact: true
      },
      orderBy: { updatedAt: 'desc' },
      take: 50
    });

    const loadableCustomers: any[] = [];
    for (const customer of customers) {
      const projects = await loadableProjectsForCustomer(customer.id);
      if (projects.length > 0) {
        loadableCustomers.push({
          id: customer.id,
          customerName: customerDisplayName(customer),
          companyName: customer.companyName,
          brandName: customer.brandName,
          projectManagerName: customer.projectManagerName,
          projectManagerNumber: customer.projectManagerNumber,
          primaryPhone: customer.phoneNumbers[0]?.number || customer.primaryContact?.mobile || customer.primaryContact?.phone || customer.homeNumber || customer.workNumber || null,
          loadableProjectCount: projects.length,
          remainingGroupCount: projects.reduce((sum, item) => sum + item.remainingCount, 0)
        });
      }
    }

    res.json({ success: true, data: loadableCustomers });
  } catch (error) {
    console.error('Logistics customers error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.get('/customers/:customerId/projects', canView, canCreateLoadings, async (req: any, res: Response) => {
  try {
    const customer = await prisma.crmCustomer.findUnique({ where: { id: req.params.customerId } });
    if (!customer) return res.status(404).json({ success: false, error: 'Customer not found' });

    const projects = await loadableProjectsForCustomer(customer.id);
    res.json({
      success: true,
      data: projects.map(({ project, remainingCount, remainingTotal }) => ({
        id: project.id,
        projectName: project.projectName,
        projectType: project.projectType,
        address: project.address,
        city: project.city,
        customerId: project.customerId,
        customerName: customerDisplayName(project.customer),
        companyName: project.customer.companyName,
        projectManagerName: project.projectManagerName || project.customer.projectManagerName,
        projectManagerNumber: project.projectManagerNumber || project.customer.projectManagerNumber,
        remainingCount,
        remainingTotal: Number(remainingTotal.toFixed(3))
      }))
    });
  } catch (error) {
    console.error('Logistics customer projects error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.get('/projects', canView, canCreateLoadings, async (req: any, res: Response) => {
  try {
    const search = String(req.query.search || '').trim();
    const phoneSearch = normalizePhoneSearch(search);
    const phoneContains = phoneSearch.length >= 3 ? { contains: phoneSearch, mode: 'insensitive' as const } : null;
    const projects = await prisma.projectAddress.findMany({
      where: {
        isActive: true,
        ...(search ? {
          OR: [
            { projectName: { contains: search, mode: 'insensitive' } },
            { address: { contains: search, mode: 'insensitive' } },
            { city: { contains: search, mode: 'insensitive' } },
            ...(phoneContains ? [
              { projectManagerNumber: phoneContains },
              { marketerPhoneNumber: phoneContains },
              { customer: { phoneNumbers: { some: { number: phoneContains } } } },
              { customer: { homeNumber: phoneContains } },
              { customer: { workNumber: phoneContains } },
              { customer: { projectManagerNumber: phoneContains } },
              { customer: { referrerPhoneNumber: phoneContains } },
              { customer: { primaryContact: { is: { phone: phoneContains } } } },
              { customer: { primaryContact: { is: { mobile: phoneContains } } } },
              { customer: { contacts: { some: { OR: [{ phone: phoneContains }, { mobile: phoneContains }] } } } }
            ] : []),
            { customer: { firstName: { contains: search, mode: 'insensitive' } } },
            { customer: { lastName: { contains: search, mode: 'insensitive' } } },
            { customer: { companyName: { contains: search, mode: 'insensitive' } } }
          ]
        } : {})
      },
      include: { customer: true },
      orderBy: { updatedAt: 'desc' },
      take: 50
    });

    const loadableProjects: Array<{ project: any; remainingCount: number }> = [];
    for (const project of projects) {
      const remaining = await buildRemainingForProject(project.id);
      if (remaining.groups.length > 0) {
        loadableProjects.push({ project, remainingCount: remaining.groups.length });
      }
    }

    res.json({
      success: true,
      data: loadableProjects.map(({ project, remainingCount }) => ({
        id: project.id,
        projectName: project.projectName,
        address: project.address,
        city: project.city,
        customerId: project.customerId,
        customerName: `${project.customer.firstName} ${project.customer.lastName}`.trim(),
        companyName: project.customer.companyName,
        remainingCount
      }))
    });
  } catch (error) {
    console.error('Logistics projects error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.get('/projects/:projectId/remaining', canView, canCreateLoadings, async (req: any, res: Response) => {
  try {
    const data = await buildRemainingForProject(req.params.projectId);
    res.json({ success: true, data });
  } catch (error: any) {
    console.error('Logistics remaining error:', error);
    res.status(error.message === 'Project not found' ? 404 : 500).json({ success: false, error: error.message || 'Server error' });
  }
});

router.post('/projects/:projectId/draft', canEdit, canCreateLoadings, async (req: any, res: Response) => {
  try {
    const project = await getProjectWithCustomer(req.params.projectId);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });

    const forceNew = req.body?.forceNew === true;
    if (!forceNew) {
      const existingDraft = await prisma.logisticsLoading.findFirst({
        where: {
          projectId: project.id,
          status: EDITABLE_STATUS as any
        },
        orderBy: { updatedAt: 'desc' }
      });

      if (existingDraft) {
        return res.json({ success: true, resumed: true, data: await loadLoading(existingDraft.id) });
      }
    }

    const remaining = await buildRemainingForProject(project.id);
    if (remaining.groups.length === 0) {
      return res.status(400).json({ success: false, error: 'No loadable remaining exists for this project' });
    }

    const loading = await prisma.logisticsLoading.create({
      data: {
        loadingNumber: await generateLoadingNumber(),
        customerId: project.customerId,
        projectId: project.id,
        loadingDate: req.body?.loadingDate ? new Date(req.body.loadingDate) : new Date(),
        notes: req.body?.notes || null,
        createdBy: req.user.id
      }
    });

    res.status(201).json({ success: true, resumed: false, data: await loadLoading(loading.id) });
  } catch (error: any) {
    console.error('Create or resume logistics draft error:', error);
    res.status(500).json({ success: false, error: error.message || 'Server error' });
  }
});

router.get('/loadings', canView, canViewLoadings, async (req: any, res: Response) => {
  try {
    const status = req.query.status ? String(req.query.status) : undefined;
    const projectId = req.query.projectId ? String(req.query.projectId) : undefined;
    const loadings = await prisma.logisticsLoading.findMany({
      where: {
        ...(status ? { status: status as any } : {}),
        ...(projectId ? { projectId } : {})
      },
      include: { customer: true, project: true, lines: true, corrections: true },
      orderBy: { updatedAt: 'desc' },
      take: 100
    });

    res.json({
      success: true,
      data: loadings.map((loading) => ({
        id: loading.id,
        loadingNumber: loading.loadingNumber,
        status: loading.status,
        loadingDate: loading.loadingDate,
        finalizedAt: loading.finalizedAt,
        cancelledAt: loading.cancelledAt,
        customerName: `${loading.customer.firstName} ${loading.customer.lastName}`.trim(),
        projectName: loading.project.projectName || loading.project.address,
        projectId: loading.projectId,
        lineCount: loading.lines.length,
        correctionCount: loading.corrections.length,
        driverSnapshot: loading.driverSnapshot
      }))
    });
  } catch (error) {
    console.error('Logistics list error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.post('/loadings', canEdit, canCreateLoadings, [
  body('projectId').notEmpty().withMessage('Project is required'),
  body('lines').optional().isArray().withMessage('Lines must be an array')
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });

    const project = await getProjectWithCustomer(req.body.projectId);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });

    const loadingNumber = await generateLoadingNumber();
    const lineCreates: any[] = [];
    for (const line of req.body.lines || []) {
      lineCreates.push(await linePayloadToCreate(line));
    }

    const loading = await prisma.$transaction(async (tx) => {
      const created = await tx.logisticsLoading.create({
        data: { loadingNumber, customerId: project.customerId, projectId: project.id, loadingDate: req.body.loadingDate ? new Date(req.body.loadingDate) : new Date(), notes: req.body.notes || null, createdBy: req.user.id, lines: { create: lineCreates } }
      });
      const driver = await reserveQueueTurn(tx, req.body.driverId, created.id, req.user.id);
      return tx.logisticsLoading.update({
        where: { id: created.id },
        data: { vehiclePairId: driver?.id || null, driverSnapshot: driver ? buildDriverSnapshot(driver) : Prisma.JsonNull }
      });
    }, { isolationLevel: 'Serializable' });

    res.status(201).json({ success: true, data: await loadLoading(loading.id) });
  } catch (error: any) {
    console.error('Create loading error:', error);
    res.status(500).json({ success: false, error: error.message || 'Server error' });
  }
});

router.get('/loadings/:id', canView, canViewLoadings, async (req: any, res: Response) => {
  try {
    const loading = await loadLoading(req.params.id);
    if (!loading) return res.status(404).json({ success: false, error: 'Loading not found' });
    res.json({ success: true, data: loading });
  } catch (error) {
    console.error('Get loading error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.put('/loadings/:id', canEdit, canEditLoadings, async (req: any, res: Response) => {
  try {
    const existing = await prisma.logisticsLoading.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ success: false, error: 'Loading not found' });
    if (existing.status !== EDITABLE_STATUS) return res.status(400).json({ success: false, error: 'Only draft loadings can be edited' });

    const lineCreates: any[] = [];
    for (const line of req.body.lines || []) {
      lineCreates.push(await linePayloadToCreate(line));
    }

    await prisma.$transaction(async (tx) => {
      const driver = await reserveQueueTurn(tx, req.body.driverId, existing.id, req.user.id);
      await tx.logisticsLoadingLine.deleteMany({ where: { loadingId: existing.id } });
      await tx.logisticsLoading.update({
        where: { id: existing.id },
        data: {
          loadingDate: req.body.loadingDate ? new Date(req.body.loadingDate) : existing.loadingDate,
          notes: req.body.notes ?? existing.notes,
          vehiclePairId: driver?.id || null,
          driverSnapshot: driver ? buildDriverSnapshot(driver) : Prisma.JsonNull,
          lines: { create: lineCreates }
        }
      });
    }, { isolationLevel: 'Serializable' });

    res.json({ success: true, data: await loadLoading(existing.id) });
  } catch (error: any) {
    console.error('Update loading error:', error);
    res.status(500).json({ success: false, error: error.message || 'Server error' });
  }
});

router.delete('/loadings/:id', canEdit, canEditLoadings, async (req: any, res: Response) => {
  try {
    const existing = await prisma.logisticsLoading.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ success: false, error: 'Loading not found' });
    if (existing.status !== EDITABLE_STATUS) return res.status(400).json({ success: false, error: 'Only draft loadings can be deleted' });

    await prisma.$transaction(async (tx) => {
      await releaseQueueTurn(tx, existing.id);
      await tx.logisticsLoading.delete({ where: { id: existing.id } });
    });
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete loading draft error:', error);
    res.status(500).json({ success: false, error: error.message || 'Server error' });
  }
});

router.post('/loadings/:id/finalize', canEdit, canFinalizeLoadings, async (req: any, res: Response) => {
  try {
    const loading = await loadLoading(req.params.id);
    if (!loading) return res.status(404).json({ success: false, error: 'Loading not found' });
    if (loading.status !== EDITABLE_STATUS) return res.status(400).json({ success: false, error: 'Only draft loadings can be finalized' });
    if (!loading.lines.length) return res.status(400).json({ success: false, error: 'At least one loading line is required' });
    if (!loading.vehiclePairId) return res.status(400).json({ success: false, error: 'Select a waiting security driver and vehicle before finalization' });
    const queueTurn = await prisma.securityDriverQueueTurn.findFirst({ where: { loadingId: loading.id, status: SecurityDriverQueueTurnStatus.RESERVED } });
    if (!queueTurn) return res.status(400).json({ success: false, error: 'The selected driver queue turn is not reserved for this loading' });
    if (!validateDriverSnapshot(loading.driverSnapshot)) return res.status(400).json({ success: false, error: 'Complete driver snapshot is required before finalization' });

    await validateLineRemaining(loading.lines.map((line: any) => ({
      sourceContractItemId: line.sourceContractItemId,
      quantity: toNumber(line.quantity),
      unit: line.unit
    })), loading.id);

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.logisticsLoading.update({ where: { id: loading.id }, data: { status: FINALIZED_STATUS as any, finalizedAt: new Date(), finalizedBy: req.user.id } });
      await tx.securityDriverQueueTurn.update({ where: { id: queueTurn.id }, data: { status: SecurityDriverQueueTurnStatus.DISPATCHED, dispatchedAt: new Date(), dispatchedBy: req.user.id } });
      return saved;
    });

    res.json({ success: true, data: await loadLoading(updated.id) });
  } catch (error: any) {
    console.error('Finalize loading error:', error);
    res.status(400).json({ success: false, error: error.message || 'Server error' });
  }
});

router.post('/loadings/:id/cancel', canEdit, canCancelLoadings, [
  body('reason').notEmpty().withMessage('Cancellation reason is required')
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });

    const loading = await prisma.logisticsLoading.findUnique({ where: { id: req.params.id } });
    if (!loading) return res.status(404).json({ success: false, error: 'Loading not found' });
    if (loading.status === CANCELLED_STATUS) return res.status(400).json({ success: false, error: 'Loading is already cancelled' });

    const updated = await prisma.$transaction(async (tx) => {
      await releaseQueueTurn(tx, loading.id);
      return tx.logisticsLoading.update({ where: { id: loading.id }, data: { status: CANCELLED_STATUS as any, cancelledAt: new Date(), cancelledBy: req.user.id, cancellationReason: req.body.reason } });
    });

    res.json({ success: true, data: await loadLoading(updated.id) });
  } catch (error: any) {
    console.error('Cancel loading error:', error);
    res.status(500).json({ success: false, error: error.message || 'Server error' });
  }
});

router.post('/loadings/:id/corrections', canEdit, canCreateCorrections, [
  body('sourceContractItemId').notEmpty().withMessage('Source row is required'),
  body('deltaQuantity').isNumeric().withMessage('Delta quantity is required'),
  body('reason').notEmpty().withMessage('Reason is required')
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });

    const loading = await loadLoading(req.params.id);
    if (!loading) return res.status(404).json({ success: false, error: 'Loading not found' });
    if (loading.status !== FINALIZED_STATUS) return res.status(400).json({ success: false, error: 'Corrections require a finalized loading' });

    const sourceItem = await prisma.contractItem.findUnique({ where: { id: req.body.sourceContractItemId } });
    if (!sourceItem) return res.status(404).json({ success: false, error: 'Source contract item not found' });
    const deltaQuantity = decimalInput(req.body.deltaQuantity);
    const unit = String(req.body.unit || inferUnit(sourceItem, null));

    if (deltaQuantity > 0) {
      await validateLineRemaining([{ sourceContractItemId: sourceItem.id, quantity: deltaQuantity, unit }]);
    } else {
      const consumed = await getConsumptionByItemIds([sourceItem.id]);
      if (Math.abs(deltaQuantity) > (consumed.get(sourceItem.id) || 0) + 0.0001) {
        return res.status(400).json({ success: false, error: 'Correction cannot reduce loaded amount below zero' });
      }
    }

    const correction = await prisma.logisticsLoadingCorrection.create({
      data: {
        loadingId: loading.id,
        loadingLineId: req.body.loadingLineId || null,
        sourceContractItemId: sourceItem.id,
        productId: sourceItem.productId,
        deltaQuantity,
        unit,
        reason: req.body.reason,
        metadata: req.body.metadata || null,
        createdBy: req.user.id
      }
    });

    res.status(201).json({ success: true, data: correction });
  } catch (error: any) {
    console.error('Create correction error:', error);
    res.status(400).json({ success: false, error: error.message || 'Server error' });
  }
});

router.get('/drivers', canView, canViewDrivers, async (req: any, res: Response) => {
  try {
    const turns = await prisma.securityDriverQueueTurn.findMany({
      where: { status: { in: [SecurityDriverQueueTurnStatus.WAITING, SecurityDriverQueueTurnStatus.RESERVED] } },
      include: { vehiclePair: true, loading: { select: { id: true, loadingNumber: true } } },
      orderBy: [{ enteredAt: 'asc' }, { id: 'asc' }]
    });
    res.json({ success: true, data: turns.map((turn, index) => ({
      id: turn.id,
      queueTurnId: turn.id,
      vehiclePairId: turn.vehiclePairId,
      firstName: turn.vehiclePair.firstName,
      lastName: turn.vehiclePair.lastName,
      vehiclePlate: turn.vehiclePair.vehiclePlate,
      vehicleType: turn.vehiclePair.vehicleType,
      phone: turn.vehiclePair.phone,
      nationalCode: turn.vehiclePair.nationalCode,
      queueStatus: turn.status,
      queuePosition: index + 1,
      enteredAt: turn.enteredAt,
      reservedLoading: turn.loading
    })) });
  } catch (error) {
    console.error('Drivers list error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

export default router;
