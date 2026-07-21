import express, { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import { protect, authorize, AuthRequest } from '../middleware/auth';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { WORKSPACE_PERMISSIONS, WORKSPACES } from '../middleware/workspace';
import { FEATURE_PERMISSIONS, FEATURE_WORKSPACE_MAP, FEATURES } from '../middleware/feature';
import { savePersonnelWorkSchedule } from '../utils/personnelWorkSchedule';
import { newOpaqueToken, revokeSessions, serializeSession } from '../services/identitySessionService';
import { selectionVersionHash } from '../services/personnelBulkPolicy';

const router = express.Router();
const prisma = new PrismaClient();
const CUID_REGEX = /^c[a-z0-9]{24}$/;
const FEATURE_EXCEPTION_PERMISSION_LEVELS = [
  FEATURE_PERMISSIONS.VIEW,
  FEATURE_PERMISSIONS.EDIT
];
const provenanceSelect = {
  creationSource: true,
  creatorAttributionKind: true,
  createdByUserId: true,
  creatorDisplayNameSnapshot: true,
  creatorUsernameSnapshot: true,
  creatorAttributionReason: true,
  creatorAttributedAt: true,
  erasedAt: true,
  createdByUser: { select: { id: true, firstName: true, lastName: true, username: true, erasedAt: true, erasedDisplayName: true } },
};

const getFeatureWorkspace = (feature: string): string | null => {
  if (!Object.values(FEATURES).includes(feature as any)) {
    return null;
  }
  return FEATURE_WORKSPACE_MAP[feature as keyof typeof FEATURE_WORKSPACE_MAP] || null;
};

const hasAdminPermissionLevel = (permissions: Array<{ permissionLevel?: string }>) =>
  permissions.some((permission) => permission.permissionLevel === WORKSPACE_PERMISSIONS.ADMIN);

const isScheduleValidationError = (error: unknown) => error instanceof Error
  && ['ساعت کاری', 'روز کاری', 'تاریخ اجرای'].some((part) => error.message.includes(part));

const normalizePhone = (value?: string | null) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  return trimmed
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[\s\-().]/g, '');
};

const personnelSelect = {
  id: true,
  firstName: true,
  lastName: true,
  isActive: true,
  department: {
    select: {
      id: true,
      name: true,
      namePersian: true,
    }
  },
  workSchedules: {
    include: { days: { orderBy: { weekday: 'asc' as const } } },
    orderBy: { effectiveFrom: 'desc' as const },
    take: 1
  }
};

const samePersonnelWhere = (firstName: string, lastName: string, departmentId?: string | null) => ({
  firstName,
  lastName,
  departmentId: departmentId || null
});

const ensurePersonnelForUser = async (
  tx: any,
  input: {
    firstName: string;
    lastName: string;
    departmentId?: string | null;
    isActive: boolean;
    personnelMode?: string;
    personnelId?: string;
    currentUserId?: string;
  }
) => {
  const firstName = String(input.firstName || '').trim();
  const lastName = String(input.lastName || '').trim();
  const departmentId = input.departmentId || null;

  if (input.personnelMode === 'existing' && input.personnelId) {
    const existing = await tx.personnel.findUnique({
      where: { id: input.personnelId },
      include: { user: { select: { id: true } } }
    });
    if (!existing) throw new Error('پرسنل انتخاب‌شده پیدا نشد.');
    if (existing.user && existing.user.id !== input.currentUserId) throw new Error('این پرسنل قبلاً به کاربر دیگری متصل شده است.');
    return tx.personnel.update({
      where: { id: existing.id },
      data: { firstName, lastName, departmentId, isActive: input.isActive },
      select: { id: true }
    });
  }

  if (input.personnelId) {
    const linked = await tx.personnel.findUnique({
      where: { id: input.personnelId },
      include: { user: { select: { id: true } } }
    });
    if (linked && (!linked.user || linked.user.id === input.currentUserId)) {
      return tx.personnel.update({
        where: { id: linked.id },
        data: { firstName, lastName, departmentId, isActive: input.isActive },
        select: { id: true }
      });
    }
  }

  const matching = await tx.personnel.findFirst({
    where: samePersonnelWhere(firstName, lastName, departmentId),
    include: { user: { select: { id: true } } }
  });
  if (matching) {
    if (matching.user && matching.user.id !== input.currentUserId) throw new Error('پرسنل هم‌نام در همین بخش قبلاً به کاربر دیگری متصل شده است.');
    return tx.personnel.update({
      where: { id: matching.id },
      data: { firstName, lastName, departmentId, isActive: input.isActive },
      select: { id: true }
    });
  }

  return tx.personnel.create({
    data: { firstName, lastName, departmentId, isActive: input.isActive },
    select: { id: true }
  });
};

// @desc    Get all users
// @route   GET /api/users
// @access  Private/Admin
router.get('/', protect, authorize('ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const whereClause = req.user?.role === 'MANAGER'
      ? { role: { not: 'ADMIN' as const }, erasedAt: null }
      : { erasedAt: null };

    const users = await prisma.user.findMany({
      where: whereClause,
      skip,
      take: limit,
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        ...provenanceSelect,
        department: {
          select: {
            id: true,
            name: true,
            namePersian: true,
          }
        },
        profile: true,
        personnel: { select: personnelSelect },
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    const total = await prisma.user.count({ where: whereClause });

    res.json({
      success: true,
      data: users,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Create new user (Admin only)
// @route   POST /api/users
// @access  Private/Admin
router.post('/', protect, authorize('ADMIN', 'MANAGER'), [
  body('email').isEmail().normalizeEmail(),
  body('username').isLength({ min: 3 }).trim().escape(),
  body('password').isLength({ min: 6 }),
  body('firstName').trim().escape(),
  body('lastName').trim().escape(),
  body('phone').optional({ values: 'falsy' }).isString().trim(),
  body('role').optional().isIn(['USER', 'MODERATOR', 'ADMIN', 'SALES', 'MANAGER']),
  body('departmentId')
    .optional({ values: 'falsy' })
    .isString()
    .custom((value) => CUID_REGEX.test(value))
    .withMessage('Invalid department ID'),
  body('isActive').optional().isBoolean(),
  body('personnelMode').optional().isIn(['auto', 'existing']),
  body('personnelId').optional({ values: 'falsy' }).isString(),
  body('workSchedule').optional().isObject(),
  body('workspacePermissions').optional().isArray(),
  body('workspacePermissions.*.workspace')
    .optional()
    .isIn(Object.values(WORKSPACES))
    .withMessage('Invalid workspace'),
  body('workspacePermissions.*.permissionLevel')
    .optional()
    .isIn(Object.values(WORKSPACE_PERMISSIONS))
    .withMessage('Invalid workspace permission level'),
  body('workspacePermissions.*.expiresAt')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('Invalid workspace permission expiration date'),
  body('featurePermissions').optional().isArray(),
  body('featurePermissions.*.workspace')
    .optional()
    .isIn(Object.values(WORKSPACES))
    .withMessage('Invalid feature workspace'),
  body('featurePermissions.*.feature')
    .optional()
    .isIn(Object.values(FEATURES))
    .withMessage('Invalid feature'),
  body('featurePermissions.*.permissionLevel')
    .optional()
    .isIn(FEATURE_EXCEPTION_PERMISSION_LEVELS)
    .withMessage('Feature exceptions only support view or edit'),
  body('featurePermissions.*.expiresAt')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('Invalid feature permission expiration date'),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { 
      email, 
      username, 
      password, 
      firstName, 
      lastName, 
      phone,
      role = 'USER',
      departmentId,
      isActive = true,
      personnelMode = 'auto',
      personnelId,
      workSchedule,
      workspacePermissions = [],
      featurePermissions = []
    } = req.body;

    const normalizedWorkspacePermissions = Array.from(
      new Map(
        (Array.isArray(workspacePermissions) ? workspacePermissions : [])
          .filter((permission) => permission?.workspace && permission?.permissionLevel)
          .map((permission) => [permission.workspace, permission])
      ).values()
    );
    const normalizedFeaturePermissions = Array.from(
      new Map(
        (Array.isArray(featurePermissions) ? featurePermissions : [])
          .filter((permission) => permission?.workspace && permission?.feature && permission?.permissionLevel)
          .map((permission) => [`${permission.workspace}:${permission.feature}`, permission])
      ).values()
    );

    for (const permission of normalizedFeaturePermissions) {
      const expectedWorkspace = getFeatureWorkspace(permission.feature);
      if (!expectedWorkspace || expectedWorkspace !== permission.workspace) {
        return res.status(400).json({
          success: false,
          error: `Workspace "${permission.workspace}" is not valid for feature "${permission.feature}"`
        });
      }
      if (permission.permissionLevel === FEATURE_PERMISSIONS.ADMIN) {
        return res.status(400).json({
          success: false,
          error: 'Feature exceptions only support view or edit'
        });
      }
    }

    if (departmentId) {
      const department = await prisma.department.findUnique({
        where: { id: departmentId },
        select: { id: true, isActive: true }
      });

      if (!department || !department.isActive) {
        return res.status(400).json({
          success: false,
          error: 'Department not found or inactive'
        });
      }
    }

    if (req.user?.role === 'MANAGER' && ['ADMIN', 'MANAGER'].includes(role)) {
      return res.status(403).json({
        success: false,
        error: 'Managers cannot create admin or manager users'
      });
    }

    if (
      req.user?.role === 'MANAGER' &&
      (hasAdminPermissionLevel(normalizedWorkspacePermissions as Array<{ permissionLevel?: string }>) ||
        hasAdminPermissionLevel(normalizedFeaturePermissions as Array<{ permissionLevel?: string }>))
    ) {
      return res.status(403).json({
        success: false,
        error: 'Managers cannot grant admin-level permissions'
      });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email },
          { username }
        ]
      }
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'User already exists with this email or username'
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const normalizedPhone = normalizePhone(phone);
    const creationActor = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { firstName: true, lastName: true, username: true } });

    const user = await prisma.$transaction(async (tx) => {
      const personnel = await ensurePersonnelForUser(tx, {
        firstName,
        lastName,
        departmentId: departmentId || null,
        isActive,
        personnelMode,
        personnelId
      });
      await savePersonnelWorkSchedule(tx, personnel.id, workSchedule);

      const createdUser = await tx.user.create({
        data: {
          email,
          username,
          password: hashedPassword,
          firstName,
          lastName,
          role,
          departmentId: departmentId || null,
          personnelId: personnel.id,
          isActive,
          creationSource: 'MANAGED',
          creatorAttributionKind: 'AUTOMATIC',
          createdByUserId: req.user!.id,
          creatorDisplayNameSnapshot: `${creationActor.firstName} ${creationActor.lastName}`.trim(),
          creatorUsernameSnapshot: creationActor.username,
          creatorAttributedAt: new Date(),
          ...(normalizedPhone && {
            profile: {
              create: {
                phone: normalizedPhone
              }
            }
          }),
        },
        select: {
          id: true,
          email: true,
          username: true,
          firstName: true,
          lastName: true,
          role: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          ...provenanceSelect,
          department: {
            select: {
              id: true,
              name: true,
              namePersian: true,
            }
          },
          profile: true,
          personnel: { select: personnelSelect },
        }
      });

      if (normalizedWorkspacePermissions.length > 0) {
        await tx.workspacePermission.createMany({
          data: normalizedWorkspacePermissions.map((permission) => ({
            userId: createdUser.id,
            workspace: permission.workspace,
            permissionLevel: permission.permissionLevel,
            grantedBy: req.user?.id,
            expiresAt: permission.expiresAt ? new Date(permission.expiresAt) : null
          }))
        });
      }

      if (normalizedFeaturePermissions.length > 0) {
        await tx.featurePermission.createMany({
          data: normalizedFeaturePermissions.map((permission) => ({
            userId: createdUser.id,
            workspace: permission.workspace,
            feature: permission.feature,
            permissionLevel: permission.permissionLevel,
            grantedBy: req.user?.id,
            expiresAt: permission.expiresAt ? new Date(permission.expiresAt) : null
          }))
        });
      }

      return {
        ...createdUser,
        permissionSummary: {
          workspacePermissions: normalizedWorkspacePermissions.length,
          featurePermissions: normalizedFeaturePermissions.length
        }
      };
    });

    res.status(201).json({
      success: true,
      data: user
    });
  } catch (error: any) {
    console.error('Create user error:', error);
    const invalidSchedule = isScheduleValidationError(error);
    res.status(invalidSchedule ? 400 : error.message?.includes('پرسنل') ? 409 : 500).json({
      success: false,
      error: invalidSchedule || error.message?.includes('پرسنل') ? error.message : 'Server error during user creation'
    });
  }
});

const USER_BULK_OPERATIONS = ['ACTIVATE', 'DEACTIVATE', 'ASSIGN_ROLE', 'ASSIGN_DEPARTMENT', 'APPLY_WORKSPACE_PERMISSIONS'];

router.post('/bulk/preview', protect, authorize('ADMIN', 'MANAGER'), [body('ids').isArray({ min: 1, max: 500 }), body('operation').isIn(USER_BULK_OPERATIONS)], async (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Bulk selection or operation is invalid' });
  if (req.user!.role !== 'ADMIN' && ['ASSIGN_ROLE', 'APPLY_WORKSPACE_PERMISSIONS'].includes(req.body.operation)) return res.status(403).json({ success: false, error: 'Only administrators can perform this bulk operation' });
  const ids = Array.from(new Set(req.body.ids.map(String))) as string[];
  const records = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, updatedAt: true, role: true, isActive: true, erasedAt: true } });
  const eligible: any[] = [];
  const conflicting: any[] = [];
  const activeAdmins = await prisma.user.count({ where: { role: 'ADMIN', isActive: true, erasedAt: null } });
  const selectedActiveAdmins = records.filter((item) => item.role === 'ADMIN' && item.isActive).length;
  const removesAdministratorAccess = req.body.operation === 'DEACTIVATE'
    || (req.body.operation === 'ASSIGN_ROLE' && req.body.role !== 'ADMIN');
  for (const record of records) {
    const reason = record.erasedAt ? 'ERASED_ACCOUNT'
      : record.id === req.user!.id && removesAdministratorAccess ? 'CANNOT_AFFECT_SELF'
        : req.user!.role === 'MANAGER' && record.role === 'ADMIN' ? 'MANAGER_CANNOT_AFFECT_ADMIN'
          : record.role === 'ADMIN' && record.isActive && removesAdministratorAccess && activeAdmins <= selectedActiveAdmins ? 'CANNOT_REMOVE_LAST_ADMIN'
            : null;
    (reason ? conflicting : eligible).push(reason ? { id: record.id, reason } : { id: record.id });
  }
  const preview = { selected: records.map(({ id }) => ({ id })), eligible, skipped: ids.filter((id) => !records.some((record) => record.id === id)).map((id) => ({ id, reason: 'NOT_FOUND' })), conflicting, selectionHash: selectionVersionHash(records) };
  const previewToken = newOpaqueToken();
  await prisma.userBulkOperation.create({ data: { actorId: req.user!.id, operation: req.body.operation, previewToken, selectionHash: preview.selectionHash, status: 'PREVIEWED', requestedData: req.body, previewData: preview } });
  res.json({ success: true, data: { ...preview, previewToken } });
});

router.post('/bulk/execute', protect, authorize('ADMIN', 'MANAGER'), [body('previewToken').isString().notEmpty()], async (req: AuthRequest, res: Response) => {
  const stored = await prisma.userBulkOperation.findFirst({ where: { previewToken: req.body.previewToken, actorId: req.user!.id, status: 'PREVIEWED' } });
  if (!stored) return res.status(404).json({ success: false, error: 'Bulk preview not found or already used' });
  const preview: any = stored.previewData;
  const requested: any = stored.requestedData || {};
  const selectedIds = preview.selected.map((item: any) => item.id);
  const eligibleIds = preview.eligible.map((item: any) => item.id);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.userBulkOperation.updateMany({ where: { id: stored.id, status: 'PREVIEWED' }, data: { status: 'EXECUTING' } });
      if (claimed.count !== 1) throw new Error('Bulk preview has already been used');
      const current = await tx.user.findMany({ where: { id: { in: selectedIds } }, select: { id: true, updatedAt: true, role: true, isActive: true, erasedAt: true } });
      if (current.length !== selectedIds.length || selectionVersionHash(current) !== stored.selectionHash) throw new Error('Bulk preview is stale; refresh and confirm again');
      const removesAdministratorAccess = stored.operation === 'DEACTIVATE'
        || (stored.operation === 'ASSIGN_ROLE' && requested.role !== 'ADMIN');
      if (current.some((item) => eligibleIds.includes(item.id) && item.id === req.user!.id && removesAdministratorAccess)) throw new Error('Bulk preview is stale; refresh and confirm again');
      if (req.user!.role === 'MANAGER' && current.some((item) => eligibleIds.includes(item.id) && item.role === 'ADMIN')) throw new Error('Bulk preview is stale; refresh and confirm again');
      if (removesAdministratorAccess) {
        const selectedActiveAdmins = current.filter((item) => eligibleIds.includes(item.id) && item.role === 'ADMIN' && item.isActive).length;
        if (selectedActiveAdmins) {
          const activeAdmins = await tx.user.count({ where: { role: 'ADMIN', isActive: true, erasedAt: null } });
          if (activeAdmins <= selectedActiveAdmins) throw new Error('Bulk preview is stale; refresh and confirm again');
        }
      }
      const userAuditSelect = { id: true, role: true, isActive: true, departmentId: true, personnelId: true, workspacePermissions: { select: { workspace: true, permissionLevel: true, expiresAt: true }, orderBy: { workspace: 'asc' as const } } };
      const before = await tx.user.findMany({ where: { id: { in: eligibleIds } }, select: userAuditSelect });
      if (stored.operation === 'ACTIVATE') await tx.user.updateMany({ where: { id: { in: eligibleIds } }, data: { isActive: true } });
      if (stored.operation === 'DEACTIVATE') {
        await tx.user.updateMany({ where: { id: { in: eligibleIds } }, data: { isActive: false } });
        for (const id of eligibleIds) await revokeSessions(tx, { userId: id, actorId: req.user!.id, reason: 'USER_BULK_DEACTIVATION' });
      }
      if (stored.operation === 'ASSIGN_ROLE') {
        if (!['USER', 'MODERATOR', 'ADMIN', 'SALES', 'MANAGER'].includes(requested.role)) throw new Error('Invalid role');
        await tx.user.updateMany({ where: { id: { in: eligibleIds } }, data: { role: requested.role } });
      }
      if (stored.operation === 'ASSIGN_DEPARTMENT') {
        const department = requested.departmentId ? await tx.department.findFirst({ where: { id: requested.departmentId, isActive: true } }) : null;
        if (requested.departmentId && !department) throw new Error('Selected department is unavailable');
        await tx.user.updateMany({ where: { id: { in: eligibleIds } }, data: { departmentId: requested.departmentId || null } });
        const personnelIds = before.map((item) => item.personnelId).filter(Boolean) as string[];
        if (personnelIds.length) await tx.personnel.updateMany({ where: { id: { in: personnelIds } }, data: { departmentId: requested.departmentId || null } });
      }
      if (stored.operation === 'APPLY_WORKSPACE_PERMISSIONS') {
        const permissions = Array.isArray(requested.workspacePermissions) ? requested.workspacePermissions : [];
        await tx.workspacePermission.deleteMany({ where: { userId: { in: eligibleIds } } });
        if (permissions.length) await tx.workspacePermission.createMany({ data: eligibleIds.flatMap((userId: string) => permissions.map((permission: any) => ({ userId, workspace: permission.workspace, permissionLevel: permission.permissionLevel, grantedBy: req.user!.id, expiresAt: permission.expiresAt ? new Date(permission.expiresAt) : null }))) });
      }
      const after = await tx.user.findMany({ where: { id: { in: eligibleIds } }, select: userAuditSelect });
      const resultData = { operation: stored.operation, applied: after.map((item) => ({ id: item.id, before: before.find((old) => old.id === item.id), after: item })), skipped: preview.skipped, conflicting: preview.conflicting };
      await tx.userBulkOperation.update({ where: { id: stored.id }, data: { status: 'COMPLETED', confirmedAt: new Date(), resultData } });
      return resultData;
    }, { isolationLevel: 'Serializable' });
    res.json({ success: true, data: result });
  } catch (error: any) {
    const stale = error.message?.includes('stale') || error.message?.includes('already been used') || error.code === 'P2034';
    if (stale) await prisma.userBulkOperation.updateMany({ where: { id: stored.id, status: 'PREVIEWED' }, data: { status: 'STALE' } });
    res.status(stale ? 409 : 400).json({ success: false, error: stale ? 'Bulk preview is stale; refresh and confirm again' : error.message || 'Bulk execution failed' });
  }
});

// @desc    Get user by ID
// @route   GET /api/users/:id
// @access  Private
router.get('/:id', protect, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        mustChangePassword: true,
        ...provenanceSelect,
        department: {
          select: {
            id: true,
            name: true,
            namePersian: true,
          }
        },
        profile: true,
        personnel: { select: personnelSelect },
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Users can only view their own profile unless they're admin or manager
    if (req.user!.id !== user.id && !['ADMIN', 'MANAGER'].includes(req.user!.role)) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to view this user'
      });
    }

    if (req.user!.role === 'MANAGER' && user.role === 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Managers cannot view admin users'
      });
    }

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Update user
// @route   PUT /api/users/:id
// @access  Private
router.put('/:id', protect, authorize('ADMIN', 'MANAGER'), [
  body('firstName').optional().trim().escape(),
  body('lastName').optional().trim().escape(),
  body('email').optional().isEmail().normalizeEmail(),
  body('username').optional().isLength({ min: 3 }).trim().escape(),
  body('phone').optional({ values: 'falsy' }).isString().trim(),
  body('role').optional().isIn(['USER', 'MODERATOR', 'ADMIN', 'SALES', 'MANAGER']),
  body('departmentId')
    .optional({ values: 'falsy' })
    .isString()
    .custom((value) => CUID_REGEX.test(value))
    .withMessage('Invalid department ID'),
  body('isActive').optional().isBoolean(),
  body('personnelMode').optional().isIn(['auto', 'existing']),
  body('personnelId').optional({ values: 'falsy' }).isString(),
  body('workSchedule').optional().isObject(),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { firstName, lastName, email, username, phone, role, departmentId, isActive, personnelMode, personnelId, workSchedule } = req.body;

    if (departmentId) {
      const department = await prisma.department.findUnique({
        where: { id: departmentId },
        select: { id: true, isActive: true }
      });

      if (!department || !department.isActive) {
        return res.status(400).json({
          success: false,
          error: 'Department not found or inactive'
        });
      }
    }

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: { personnel: true }
    });

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Users can only update their own profile unless they're admin or manager
    if (req.user!.id !== existingUser.id && !['ADMIN', 'MANAGER'].includes(req.user!.role)) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to update this user'
      });
    }
    if (existingUser.erasedAt) return res.status(409).json({ success: false, error: 'Erased users cannot be changed' });
    if (isActive === false && existingUser.id === req.user!.id) return res.status(409).json({ success: false, error: 'You cannot deactivate your own account' });
    if (isActive === false && existingUser.role === 'ADMIN') {
      const activeAdmins = await prisma.user.count({ where: { role: 'ADMIN', isActive: true, erasedAt: null } });
      if (activeAdmins <= 1) return res.status(409).json({ success: false, error: 'The last active administrator cannot be deactivated' });
    }

    if (req.user!.role === 'MANAGER' && existingUser.role === 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Managers cannot update admin users'
      });
    }

    if (req.user!.role === 'MANAGER' && role) {
      return res.status(403).json({
        success: false,
        error: 'Only administrators can change roles'
      });
    }

    // Check if email is already taken by another user
    if (email && email !== existingUser.email) {
      const emailExists = await prisma.user.findUnique({
        where: { email }
      });

      if (emailExists) {
        return res.status(400).json({
          success: false,
          error: 'Email already taken'
        });
      }
    }

    if (username && username !== existingUser.username) {
      const usernameExists = await prisma.user.findUnique({
        where: { username }
      });

      if (usernameExists) {
        return res.status(400).json({
          success: false,
          error: 'Username already taken'
        });
      }
    }

    const normalizedPhone = phone !== undefined ? normalizePhone(phone) : undefined;

    const updatedUser = await prisma.$transaction(async (tx) => {
      const removesActiveAdministrator = existingUser.role === 'ADMIN' && existingUser.isActive
        && ((role && role !== 'ADMIN') || isActive === false);
      if (removesActiveAdministrator) {
        const activeAdmins = await tx.user.count({ where: { role: 'ADMIN', isActive: true, erasedAt: null } });
        if (activeAdmins <= 1) throw new Error('The last active administrator cannot lose administrator access');
      }
      const nextFirstName = firstName || existingUser.firstName;
      const nextLastName = lastName || existingUser.lastName;
      const nextDepartmentId = departmentId !== undefined ? departmentId || null : existingUser.departmentId;
      const nextIsActive = isActive !== undefined ? Boolean(isActive) : existingUser.isActive;
      const shouldRelink = personnelMode === 'existing' && personnelId;
      const linkedPersonnel = await ensurePersonnelForUser(tx, {
        firstName: nextFirstName,
        lastName: nextLastName,
        departmentId: nextDepartmentId,
        isActive: nextIsActive,
        personnelMode: shouldRelink ? 'existing' : 'auto',
        personnelId: shouldRelink ? personnelId : existingUser.personnelId || undefined,
        currentUserId: existingUser.id
      });
      await savePersonnelWorkSchedule(tx, linkedPersonnel.id, workSchedule);

      const updated = await tx.user.update({
        where: { id: req.params.id },
        data: {
          ...(firstName && { firstName }),
          ...(lastName && { lastName }),
          ...(email && { email }),
          ...(username && { username }),
          ...(role && { role }),
          personnelId: linkedPersonnel.id,
          ...(departmentId !== undefined && { departmentId: departmentId || null }),
          ...(isActive !== undefined && { isActive }),
          ...(normalizedPhone !== undefined && {
            profile: {
              upsert: {
                create: { phone: normalizedPhone },
                update: { phone: normalizedPhone }
              }
            }
          }),
        },
        select: {
          id: true,
          email: true,
          username: true,
          firstName: true,
          lastName: true,
          role: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          mustChangePassword: true,
          ...provenanceSelect,
          department: {
            select: {
              id: true,
              name: true,
              namePersian: true,
            }
          },
          profile: true,
          personnel: { select: personnelSelect },
        }
      });
      if (isActive === false) await revokeSessions(tx, { userId: existingUser.id, actorId: req.user!.id, reason: 'USER_DEACTIVATED' });
      return updated;
    }, { isolationLevel: 'Serializable' });

    res.json({
      success: true,
      data: updatedUser
    });
  } catch (error: any) {
    console.error('Update user error:', error);
    const invalidSchedule = isScheduleValidationError(error);
    const conflict = error.message?.includes('پرسنل') || error.message?.includes('last active administrator');
    res.status(invalidSchedule ? 400 : conflict ? 409 : 500).json({
      success: false,
      error: invalidSchedule || conflict ? error.message : 'Server error'
    });
  }
});

router.get('/:id/authentication', protect, authorize('ADMIN'), async (req: AuthRequest, res: Response) => {
  const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, email: true, username: true } });
  if (!target) return res.status(404).json({ success: false, error: 'User not found' });
  const tab = String(req.query.tab || 'active');
  if (tab === 'failed') {
    const data = await prisma.authenticationEvent.findMany({
      where: { type: 'LOGIN_FAILED', OR: [{ userId: target.id }, { attemptedIdentifier: { in: [target.email, target.username] } }] },
      orderBy: { createdAt: 'desc' }, take: 200,
    });
    return res.json({ success: true, data });
  }
  const now = new Date();
  const sessions = await prisma.authSession.findMany({
    where: { userId: target.id, ...(tab === 'active' ? { revokedAt: null, idleExpiresAt: { gt: now }, absoluteExpiresAt: { gt: now } } : {}) },
    include: { browserProfile: true, revokedBy: { select: { id: true, firstName: true, lastName: true, username: true } } },
    orderBy: { lastActivityAt: 'desc' }, take: 200,
  });
  res.json({ success: true, data: sessions.map((session) => serializeSession(session)) });
});

router.post('/:id/sessions/:sessionId/revoke', protect, authorize('ADMIN'), [body('reason').isString().trim().notEmpty()], async (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Revocation reason is required' });
  const count = await revokeSessions(prisma, { userId: req.params.id, actorId: req.user!.id, sessionId: req.params.sessionId, reason: req.body.reason.trim() });
  if (!count) return res.status(404).json({ success: false, error: 'Active session not found' });
  res.json({ success: true });
});

router.post('/:id/sessions/revoke-all', protect, authorize('ADMIN'), [body('reason').isString().trim().notEmpty()], async (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Revocation reason is required' });
  const revoked = await revokeSessions(prisma, { userId: req.params.id, actorId: req.user!.id, reason: req.body.reason.trim() });
  res.json({ success: true, data: { revoked } });
});

router.post('/:id/reset-password', protect, authorize('ADMIN'), [
  body('temporaryPassword').isLength({ min: 8 }), body('adminPassword').isString().notEmpty(),
  body('requireChange').optional().isBoolean(),
], async (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Temporary password must be at least 8 characters' });
  if (req.params.id === req.user!.id) return res.status(409).json({ success: false, error: 'Use your personal password-change action' });
  const [actor, target] = await Promise.all([
    prisma.user.findUnique({ where: { id: req.user!.id }, select: { password: true } }),
    prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, erasedAt: true } }),
  ]);
  if (!target || target.erasedAt) return res.status(404).json({ success: false, error: 'Active user account not found' });
  if (!actor || !(await bcrypt.compare(req.body.adminPassword, actor.password))) return res.status(403).json({ success: false, error: 'Administrator password is incorrect' });
  const password = await bcrypt.hash(req.body.temporaryPassword, 12);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: target.id }, data: { password, mustChangePassword: req.body.requireChange === true } });
    await revokeSessions(tx, { userId: target.id, actorId: req.user!.id, reason: 'ADMIN_PASSWORD_RESET' });
    await tx.authenticationEvent.create({ data: { type: 'ADMIN_PASSWORD_RESET', userId: target.id, actorId: req.user!.id } });
  });
  res.json({ success: true });
});

router.post('/:id/creator-attribution', protect, authorize('ADMIN'), [body('creatorId').isString().notEmpty(), body('reason').isString().trim().notEmpty()], async (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Creator and reason are required' });
  const [target, creator] = await Promise.all([
    prisma.user.findUnique({ where: { id: req.params.id } }),
    prisma.user.findUnique({ where: { id: req.body.creatorId } }),
  ]);
  if (!target || !creator) return res.status(404).json({ success: false, error: 'User or creator not found' });
  if (target.creatorAttributionKind !== 'UNKNOWN') return res.status(409).json({ success: false, error: 'Captured creator attribution is immutable' });
  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id: target.id }, data: {
      createdByUserId: creator.id, creatorAttributionKind: 'MANUAL',
      creatorDisplayNameSnapshot: `${creator.firstName} ${creator.lastName}`.trim(), creatorUsernameSnapshot: creator.username,
      creatorAttributedById: req.user!.id, creatorAttributionReason: req.body.reason.trim(), creatorAttributedAt: new Date(),
    }, select: { id: true, ...provenanceSelect } });
    await tx.authenticationEvent.create({ data: { type: 'HISTORICAL_CREATOR_ATTRIBUTED', userId: target.id, actorId: req.user!.id, reason: req.body.reason.trim(), details: { creatorId: creator.id } } });
    return user;
  });
  res.json({ success: true, data: updated });
});

router.get('/:id/erasure-preview', protect, authorize('ADMIN'), async (req: AuthRequest, res: Response) => {
  const target = await prisma.user.findUnique({ where: { id: req.params.id }, include: { personnel: { select: { id: true, firstName: true, lastName: true } }, _count: { select: {
    authSessions: true, workspacePermissions: true, grantedPermissions: true, createdContracts: true,
    createdSalesContracts: true, createdCrmCustomers: true, missionAssignments: true, attendanceRecords: true,
  } } } });
  if (!target) return res.status(404).json({ success: false, error: 'User not found' });
  res.json({ success: true, data: { id: target.id, displayName: `${target.firstName} ${target.lastName}`.trim(), username: target.username, role: target.role, personnel: target.personnel, references: target._count, blocked: target.id === req.user!.id } });
});

router.post('/:id/erase', protect, authorize('ADMIN'), [body('reason').isString().trim().isLength({ min: 3 }), body('adminPassword').isString().notEmpty()], async (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Reason and administrator password are required' });
  if (req.params.id === req.user!.id) return res.status(409).json({ success: false, error: 'You cannot erase your own account' });
  const [actor, target] = await Promise.all([
    prisma.user.findUnique({ where: { id: req.user!.id }, select: { password: true } }),
    prisma.user.findUnique({ where: { id: req.params.id } }),
  ]);
  if (!target || target.erasedAt) return res.status(404).json({ success: false, error: 'User account not found' });
  if (!actor || !(await bcrypt.compare(req.body.adminPassword, actor.password))) return res.status(403).json({ success: false, error: 'Administrator password is incorrect' });
  if (target.role === 'ADMIN') {
    const activeAdmins = await prisma.user.count({ where: { role: 'ADMIN', isActive: true, erasedAt: null } });
    if (activeAdmins <= 1) return res.status(409).json({ success: false, error: 'The last active administrator cannot be erased' });
  }
  const erasedAt = new Date();
  const displayName = `${target.firstName} ${target.lastName}`.trim() || target.username;
  const randomPassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
  await prisma.$transaction(async (tx) => {
    const currentTarget = await tx.user.findUnique({ where: { id: target.id }, select: { role: true, isActive: true, erasedAt: true } });
    if (!currentTarget || currentTarget.erasedAt) throw new Error('User account is no longer available');
    if (currentTarget.role === 'ADMIN' && currentTarget.isActive) {
      const activeAdmins = await tx.user.count({ where: { role: 'ADMIN', isActive: true, erasedAt: null } });
      if (activeAdmins <= 1) throw new Error('The last active administrator cannot be erased');
    }
    await revokeSessions(tx, { userId: target.id, actorId: req.user!.id, reason: 'ACCOUNT_ERASURE' });
    await tx.authSession.deleteMany({ where: { userId: target.id } });
    await tx.recognizedBrowserProfile.deleteMany({ where: { userId: target.id } });
    await tx.securityNotification.deleteMany({ where: { userId: target.id } });
    await tx.authenticationEvent.deleteMany({ where: { userId: target.id, type: { in: ['LOGIN_FAILED', 'LOGIN_SUCCEEDED'] } } });
    await tx.workspacePermission.deleteMany({ where: { userId: target.id } });
    await tx.featurePermission.deleteMany({ where: { userId: target.id } });
    await tx.profile.deleteMany({ where: { userId: target.id } });
    await tx.securityPersonnel.updateMany({ where: { userId: target.id }, data: { isActive: false } });
    await tx.user.update({ where: { id: target.id }, data: {
      email: `deleted-${target.id}@invalid.local`, username: `deleted_${target.id}`, password: randomPassword,
      firstName: 'Deleted', lastName: 'User', isActive: false, mustChangePassword: false, departmentId: null, personnelId: null,
      erasedAt, erasureReason: req.body.reason.trim(), erasedById: req.user!.id,
      erasedDisplayName: displayName, erasedUsernameSnapshot: null,
    } });
    await tx.authenticationEvent.create({ data: { type: 'USER_ACCOUNT_ERASED', userId: target.id, actorId: req.user!.id, reason: req.body.reason.trim(), details: { formerUserId: target.id, displayName, erasedAt: erasedAt.toISOString() } } });
  }, { isolationLevel: 'Serializable' });
  res.json({ success: true });
});

router.delete('/:id', protect, authorize('ADMIN'), (_req, res) => res.status(405).json({ success: false, error: 'Use the reviewed account-erasure workflow' }));

export default router;
