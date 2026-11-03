import { prisma } from '../lib/prisma';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { protect } from '../middleware/auth';
import { requireFeatureAccess, FEATURE_PERMISSIONS, FEATURES, getUserFeatures } from '../middleware/feature';
import { getUserWorkspaces } from '../middleware/workspace';
import { resolveCoreDashboardSalesAccess } from '../services/coreDashboardAccess';
import { summarizeCoreDashboard } from '../services/coreDashboardSummary';
import { buildRealizedSalesHeadline, buildSalesReportContractWhere, buildSalesReportScope, resolveAllTimeSalesReportPeriod } from '../services/salesReportingService';

const router = express.Router();

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
    const reportScope = buildSalesReportScope(reportAccess, reportQuery);

    const [contracts, totalCustomers, recentContracts] = await Promise.all([
      prisma.salesContract.findMany({
        where: whereClause,
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
        where: whereClause,
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
    ]);
    const allTimePeriod = resolveAllTimeSalesReportPeriod(contracts);
    const salesHeadline = buildRealizedSalesHeadline({
      contracts,
      sellerId: reportScope.sellerId,
      from: allTimePeriod.from,
      to: allTimePeriod.to,
    });
    const summary = summarizeCoreDashboard({
      contracts,
      totalCustomers,
      realizedSales: {
        total: salesHeadline.netRealized,
        average: salesHeadline.averageRealizedValue,
        successRate: salesHeadline.successRate,
        realizedContracts: salesHeadline.realizedCount,
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

    const [featurePermissions, workspacePermissions] = await Promise.all([
      getUserFeatures(userId, user.role),
      getUserWorkspaces(userId, user.role)
    ]);

    // Remove sensitive information
    const { password, ...userWithoutPassword } = user;

    res.json({
      success: true,
      data: {
        ...userWithoutPassword,
        permissions: {
          features: featurePermissions.map((permission) => ({
            feature: permission.feature,
            permissionLevel: permission.permission,
            workspace: permission.workspace
          })),
          workspaces: workspacePermissions.map((permission) => ({
            workspace: permission.workspace,
            permissionLevel: permission.permission
          }))
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
