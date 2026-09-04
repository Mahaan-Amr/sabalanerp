import { prisma } from '../lib/prisma';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { protect } from '../middleware/auth';
import { requireFeatureAccess, FEATURE_PERMISSIONS, FEATURES } from '../middleware/feature';
import { getUserWorkspaces } from '../middleware/workspace';
import { getEffectiveUserAccess } from '../services/effectiveAccessService';
import { resolveCoreDashboardSalesAccess } from '../services/coreDashboardAccess';
import { summarizeCoreDashboard } from '../services/coreDashboardSummary';
import { buildSalesReport, buildSalesReportContractWhere } from '../services/salesReportingService';
import { resolveWorkspaceRouteAvailability } from '../services/workspaceRouteAvailability';
import { resolveWorkspaceActionAvailability, WORKSPACE_ACTION_RULES } from '../services/workspaceActionAvailability';

const router = express.Router();

router.get('/route-availability', protect, async (req: any, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie, Authorization');
  const path = typeof req.query.path === 'string' ? req.query.path : '';
  if (!path.startsWith('/dashboard')) return res.status(400).json({ success: false, message: 'مسیر ارسال‌شده معتبر نیست.' });
  const data = await resolveWorkspaceRouteAvailability(prisma, { userId: req.user.id, role: req.user.role, path });
  return res.json({ success: true, data });
});

export const createActionAvailabilityHandler = (
  resolver = resolveWorkspaceActionAvailability,
) => async (req: any, res: any) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie, Authorization');
  const workspace = String(req.query.workspace || '').toLowerCase() as keyof typeof WORKSPACE_ACTION_RULES;
  if (!Object.prototype.hasOwnProperty.call(WORKSPACE_ACTION_RULES, workspace)) return res.status(400).json({
    success: false,
    message: 'فضای کاری ارسال‌شده معتبر نیست.',
  });
  const data = await resolver(prisma, { userId: req.user.id, role: req.user.role, workspace });
  return res.json({ success: true, data });
};

router.get('/action-availability', protect, createActionAvailabilityHandler());

// @desc    Get dashboard statistics
// @route   GET /api/dashboard/stats
// @access  Private
router.get('/stats', protect, requireFeatureAccess(FEATURES.CORE_DASHBOARD_STATS_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: any, res) => {
  try {
    const userRole = req.user.role;
    const workspacePermissions = await getUserWorkspaces(req.user.id, userRole);
    const reportAccess = resolveCoreDashboardSalesAccess({ user: req.user, workspacePermissions });
    if (!reportAccess) {
      return res.status(403).json({ success: false, error: 'Sales workspace access is required' });
    }
    const reportQuery = { period: 'all' };
    const whereClause = buildSalesReportContractWhere(reportAccess, reportQuery);
    const ordinaryWhere = { AND: [whereClause, { OR: [{ partnerKind: null },
      { partnerKind: { not: 'PARTNER_CUSTOMER' } }] }] };

    const [contracts, totalCustomers, recentContracts, salesReport] = await Promise.all([
      prisma.salesContract.findMany({
        where: ordinaryWhere,
        select: {
          id: true,
          status: true,
          customerId: true,
          createdAt: true,
          updatedAt: true,
          lostAt: true,
          createdBy: true,
          responsibleSellerId: true,
          realizedSellerId: true,
          reportingEvents: {
            select: { contractId: true, eventType: true, amount: true, sellerId: true, effectiveAt: true },
          },
        },
      }),
      prisma.crmCustomer.count(),
      prisma.salesContract.findMany({
        where: ordinaryWhere,
        take: 5,
        select: {
          id: true,
          contractNumber: true,
          titlePersian: true,
          status: true,
          totalAmount: true,
          currency: true,
          createdAt: true,
          customer: { select: { firstName: true, lastName: true, companyName: true } },
          department: { select: { namePersian: true } },
          createdByUser: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      buildSalesReport(reportAccess, reportQuery),
    ]);
    const summary = summarizeCoreDashboard({
      contracts,
      totalCustomers,
      realizedSales: {
        total: salesReport.cards.netRealized,
        average: salesReport.cards.averageRealizedValue,
        successRate: salesReport.cards.successRate,
        realizedContracts: salesReport.cards.realizedCount,
      },
    });

    res.json({
      success: true,
      data: {
        ...summary,
        recentContracts,
      }
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Get user profile with department info
// @route   GET /api/dashboard/profile
// @access  Private
// A user's own profile is a core self-service resource; workspace permissions
// must not prevent a Security-only (or other single-workspace) user signing in.
router.get('/profile', protect, async (req: any, res) => {
  try {
    const userId = req.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        department: {
          select: {
            id: true,
            name: true,
            namePersian: true,
            description: true,
            isActive: true
          }
        },
        profile: true
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const effectiveAccess = await getEffectiveUserAccess(prisma, { userId, userRole: user.role });

    // Remove sensitive information
    const { password, ...userWithoutPassword } = user;

    res.json({
      success: true,
      data: {
        ...userWithoutPassword,
        permissions: {
          features: effectiveAccess.features.map((permission) => ({
            feature: permission.feature,
            permissionLevel: permission.permission,
            workspace: permission.workspace
          })),
          workspaces: effectiveAccess.workspaces.map((permission) => ({
            workspace: permission.workspace,
            permissionLevel: permission.permission
          })),
          provenance: effectiveAccess.provenance,
        }
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

export default router;
