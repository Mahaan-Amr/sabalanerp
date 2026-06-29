import express, { Response } from 'express';
import { body, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import { protect } from '../middleware/auth';
import { requireWorkspaceAccess, WORKSPACE_PERMISSIONS, WORKSPACES } from '../middleware/workspace';

const router = express.Router();
const prisma = new PrismaClient();

const LINEAR_TOLERANCE = 0.5;
const EDITABLE_STATUS = 'DRAFT';
const FINALIZED_STATUS = 'FINALIZED';
const CANCELLED_STATUS = 'CANCELLED';

router.use(protect);

const canEdit = requireWorkspaceAccess(WORKSPACES.LOGISTICS, WORKSPACE_PERMISSIONS.EDIT);
const canView = requireWorkspaceAccess(WORKSPACES.LOGISTICS, WORKSPACE_PERMISSIONS.VIEW);

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const decimalInput = (value: unknown) => Number(toNumber(value).toFixed(3));

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

const productSnapshotFor = (contract: any, item: any, itemIndex: number) => {
  const snapshot = itemSnapshot(contract, item, itemIndex);
  return {
    productId: item.productId,
    productType: item.productType,
    name: productDisplayName(item.product, snapshot),
    catalogName: item.product?.namePersian || item.product?.name || null,
    quantity: toNumber(item.quantity),
    unit: inferUnit(item, snapshot),
    width: snapshot?.width ?? item.product?.widthValue ?? null,
    thickness: snapshot?.thickness ?? item.product?.thicknessValue ?? null,
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
  return prisma.salesContract.findMany({
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
      const contractedQuantity = toNumber(item.quantity);
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

const buildDriverSnapshot = (driver: any, override: any = {}) => ({
  driverId: driver?.id || null,
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
      contractedQuantity: toNumber(sourceItem.quantity)
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
    where: { id: { in: itemIds } }
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
    const remaining = toNumber(item.quantity) - (consumed.get(line.sourceContractItemId) || 0);
    const allowed = remaining + (isLinearUnit(line.unit) ? LINEAR_TOLERANCE : 0);
    if (line.quantity > allowed + 0.0001) {
      throw new Error(`Loaded quantity exceeds remaining for source row ${line.sourceContractItemId}`);
    }
  }
};

router.get('/dashboard', canView, async (_req: any, res: Response) => {
  try {
    const [drafts, finalized, cancelled, drivers] = await Promise.all([
      prisma.logisticsLoading.count({ where: { status: EDITABLE_STATUS as any } }),
      prisma.logisticsLoading.count({ where: { status: FINALIZED_STATUS as any } }),
      prisma.logisticsLoading.count({ where: { status: CANCELLED_STATUS as any } }),
      prisma.logisticsDriver.count({ where: { isActive: true } })
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

router.get('/projects', canView, async (req: any, res: Response) => {
  try {
    const search = String(req.query.search || '').trim();
    const projects = await prisma.projectAddress.findMany({
      where: {
        isActive: true,
        ...(search ? {
          OR: [
            { projectName: { contains: search, mode: 'insensitive' } },
            { address: { contains: search, mode: 'insensitive' } },
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

    res.json({
      success: true,
      data: projects.map((project) => ({
        id: project.id,
        projectName: project.projectName,
        address: project.address,
        city: project.city,
        customerId: project.customerId,
        customerName: `${project.customer.firstName} ${project.customer.lastName}`.trim(),
        companyName: project.customer.companyName
      }))
    });
  } catch (error) {
    console.error('Logistics projects error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.get('/projects/:projectId/remaining', canView, async (req: any, res: Response) => {
  try {
    const data = await buildRemainingForProject(req.params.projectId);
    res.json({ success: true, data });
  } catch (error: any) {
    console.error('Logistics remaining error:', error);
    res.status(error.message === 'Project not found' ? 404 : 500).json({ success: false, error: error.message || 'Server error' });
  }
});

router.get('/loadings', canView, async (req: any, res: Response) => {
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

router.post('/loadings', canEdit, [
  body('projectId').notEmpty().withMessage('Project is required'),
  body('lines').optional().isArray().withMessage('Lines must be an array')
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });

    const project = await getProjectWithCustomer(req.body.projectId);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });

    const loadingNumber = await generateLoadingNumber();
    const driver = req.body.driverId ? await prisma.logisticsDriver.findUnique({ where: { id: req.body.driverId } }) : null;
    const driverSnapshot = req.body.driverSnapshot || (driver ? buildDriverSnapshot(driver) : null);
    const lineCreates: any[] = [];
    for (const line of req.body.lines || []) {
      lineCreates.push(await linePayloadToCreate(line));
    }

    const loading = await prisma.logisticsLoading.create({
      data: {
        loadingNumber,
        customerId: project.customerId,
        projectId: project.id,
        loadingDate: req.body.loadingDate ? new Date(req.body.loadingDate) : new Date(),
        notes: req.body.notes || null,
        driverId: driver?.id || null,
        driverSnapshot,
        createdBy: req.user.id,
        lines: { create: lineCreates }
      }
    });

    res.status(201).json({ success: true, data: await loadLoading(loading.id) });
  } catch (error: any) {
    console.error('Create loading error:', error);
    res.status(500).json({ success: false, error: error.message || 'Server error' });
  }
});

router.get('/loadings/:id', canView, async (req: any, res: Response) => {
  try {
    const loading = await loadLoading(req.params.id);
    if (!loading) return res.status(404).json({ success: false, error: 'Loading not found' });
    res.json({ success: true, data: loading });
  } catch (error) {
    console.error('Get loading error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.put('/loadings/:id', canEdit, async (req: any, res: Response) => {
  try {
    const existing = await prisma.logisticsLoading.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ success: false, error: 'Loading not found' });
    if (existing.status !== EDITABLE_STATUS) return res.status(400).json({ success: false, error: 'Only draft loadings can be edited' });

    const driver = req.body.driverId ? await prisma.logisticsDriver.findUnique({ where: { id: req.body.driverId } }) : null;
    const driverSnapshot = req.body.driverSnapshot || (driver ? buildDriverSnapshot(driver) : existing.driverSnapshot);
    const lineCreates: any[] = [];
    for (const line of req.body.lines || []) {
      lineCreates.push(await linePayloadToCreate(line));
    }

    await prisma.$transaction(async (tx) => {
      await tx.logisticsLoadingLine.deleteMany({ where: { loadingId: existing.id } });
      await tx.logisticsLoading.update({
        where: { id: existing.id },
        data: {
          loadingDate: req.body.loadingDate ? new Date(req.body.loadingDate) : existing.loadingDate,
          notes: req.body.notes ?? existing.notes,
          driverId: driver?.id || req.body.driverId || null,
          driverSnapshot,
          lines: { create: lineCreates }
        }
      });
    });

    res.json({ success: true, data: await loadLoading(existing.id) });
  } catch (error: any) {
    console.error('Update loading error:', error);
    res.status(500).json({ success: false, error: error.message || 'Server error' });
  }
});

router.post('/loadings/:id/finalize', canEdit, async (req: any, res: Response) => {
  try {
    const loading = await loadLoading(req.params.id);
    if (!loading) return res.status(404).json({ success: false, error: 'Loading not found' });
    if (loading.status !== EDITABLE_STATUS) return res.status(400).json({ success: false, error: 'Only draft loadings can be finalized' });
    if (!loading.lines.length) return res.status(400).json({ success: false, error: 'At least one loading line is required' });
    if (!validateDriverSnapshot(loading.driverSnapshot)) return res.status(400).json({ success: false, error: 'Complete driver snapshot is required before finalization' });

    await validateLineRemaining(loading.lines.map((line: any) => ({
      sourceContractItemId: line.sourceContractItemId,
      quantity: toNumber(line.quantity),
      unit: line.unit
    })), loading.id);

    const updated = await prisma.logisticsLoading.update({
      where: { id: loading.id },
      data: {
        status: FINALIZED_STATUS as any,
        finalizedAt: new Date(),
        finalizedBy: req.user.id
      }
    });

    res.json({ success: true, data: await loadLoading(updated.id) });
  } catch (error: any) {
    console.error('Finalize loading error:', error);
    res.status(400).json({ success: false, error: error.message || 'Server error' });
  }
});

router.post('/loadings/:id/cancel', canEdit, [
  body('reason').notEmpty().withMessage('Cancellation reason is required')
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });

    const loading = await prisma.logisticsLoading.findUnique({ where: { id: req.params.id } });
    if (!loading) return res.status(404).json({ success: false, error: 'Loading not found' });
    if (loading.status === CANCELLED_STATUS) return res.status(400).json({ success: false, error: 'Loading is already cancelled' });

    const updated = await prisma.logisticsLoading.update({
      where: { id: loading.id },
      data: {
        status: CANCELLED_STATUS as any,
        cancelledAt: new Date(),
        cancelledBy: req.user.id,
        cancellationReason: req.body.reason
      }
    });

    res.json({ success: true, data: await loadLoading(updated.id) });
  } catch (error: any) {
    console.error('Cancel loading error:', error);
    res.status(500).json({ success: false, error: error.message || 'Server error' });
  }
});

router.post('/loadings/:id/corrections', canEdit, [
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

router.get('/drivers', canView, async (req: any, res: Response) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const drivers = await prisma.logisticsDriver.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }]
    });
    res.json({ success: true, data: drivers });
  } catch (error) {
    console.error('Drivers list error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.post('/drivers', canEdit, [
  body('firstName').notEmpty().withMessage('First name is required'),
  body('lastName').notEmpty().withMessage('Last name is required'),
  body('vehiclePlate').notEmpty().withMessage('Vehicle plate is required'),
  body('vehicleType').notEmpty().withMessage('Vehicle type is required'),
  body('phone').notEmpty().withMessage('Phone is required'),
  body('nationalCode').notEmpty().withMessage('National code is required')
], async (req: any, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });

    const driver = await prisma.logisticsDriver.create({
      data: {
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        vehiclePlate: req.body.vehiclePlate,
        vehicleType: req.body.vehicleType,
        phone: req.body.phone,
        nationalCode: req.body.nationalCode,
        notes: req.body.notes || null,
        createdBy: req.user.id
      }
    });
    res.status(201).json({ success: true, data: driver });
  } catch (error) {
    console.error('Create driver error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.put('/drivers/:id', canEdit, async (req: any, res: Response) => {
  try {
    const driver = await prisma.logisticsDriver.update({
      where: { id: req.params.id },
      data: {
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        vehiclePlate: req.body.vehiclePlate,
        vehicleType: req.body.vehicleType,
        phone: req.body.phone,
        nationalCode: req.body.nationalCode,
        notes: req.body.notes,
        isActive: req.body.isActive
      }
    });
    res.json({ success: true, data: driver });
  } catch (error) {
    console.error('Update driver error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

export default router;
