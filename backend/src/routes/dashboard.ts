import express from 'express';
import { PrismaClient } from '@prisma/client';
import { protect } from '../middleware/auth';
import { requireFeatureAccess, FEATURE_PERMISSIONS, FEATURES, getUserFeatures } from '../middleware/feature';
import { getUserWorkspaces } from '../middleware/workspace';

const router = express.Router();
const prisma = new PrismaClient();

// @desc    Get dashboard statistics
// @route   GET /api/dashboard/stats
// @access  Private
router.get('/stats', protect, requireFeatureAccess(FEATURES.CORE_DASHBOARD_STATS_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: any, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const userDepartmentId = req.user.departmentId;

    // Build where clause based on user role
    let whereClause: any = {};
    
    if (userRole === 'ADMIN') {
      // Admins can see all data
      whereClause = {};
    } else {
      // Regular users can only see data from their department
      whereClause = { departmentId: userDepartmentId };
    }

    // Get contract statistics
    const [
      totalContracts,
      pendingContracts,
      signedContracts,
      draftContracts,
      approvedContracts,
      printedContracts,
      cancelledContracts,
      expiredContracts,
      totalCustomers,
      totalRevenue,
      recentContracts
    ] = await Promise.all([
      // Total contracts
      prisma.contract.count({ where: whereClause }),
      
      // Pending approval contracts
      prisma.contract.count({ 
        where: { ...whereClause, status: 'PENDING_APPROVAL' } 
      }),
      
      // Signed contracts
      prisma.contract.count({ 
        where: { ...whereClause, status: 'SIGNED' } 
      }),
      
      // Draft contracts
      prisma.contract.count({ 
        where: { ...whereClause, status: 'DRAFT' } 
      }),
      
      // Approved contracts
      prisma.contract.count({ 
        where: { ...whereClause, status: 'APPROVED' } 
      }),
      
      // Printed contracts
      prisma.contract.count({ 
        where: { ...whereClause, status: 'PRINTED' } 
      }),
      
      // Cancelled contracts
      prisma.contract.count({ 
        where: { ...whereClause, status: 'CANCELLED' } 
      }),
      
      // Expired contracts
      prisma.contract.count({ 
        where: { ...whereClause, status: 'EXPIRED' } 
      }),
      
      // Total customers
      prisma.customer.count(),
      
      // Total revenue (sum of all signed contracts)
      prisma.contract.aggregate({
        where: { ...whereClause, status: 'SIGNED' },
        _sum: { totalAmount: true }
      }),
      
      // Recent contracts (last 5)
      prisma.contract.findMany({
        where: whereClause,
        take: 5,
        include: {
          customer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              companyName: true,
            }
          },
          department: {
            select: {
              id: true,
              namePersian: true,
            }
          },
          createdByUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      })
    ]);

    // Calculate additional metrics
    const completionRate = totalContracts > 0 
      ? Math.round((signedContracts / totalContracts) * 100) 
      : 0;

    const totalRevenueAmount = Number(totalRevenue._sum.totalAmount || 0);
    const averageContractValue = signedContracts > 0 
      ? Math.round(totalRevenueAmount / signedContracts)
      : 0;

    // Get monthly revenue for the last 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const monthlyRevenue = await prisma.contract.groupBy({
      by: ['createdAt'],
      where: {
        ...whereClause,
        status: 'SIGNED',
        createdAt: {
          gte: sixMonthsAgo
        }
      },
      _sum: {
        totalAmount: true
      },
      _count: {
        id: true
      }
    });

    res.json({
      success: true,
      data: {
        contracts: {
          total: totalContracts,
          pending: pendingContracts,
          signed: signedContracts,
          draft: draftContracts,
          approved: approvedContracts,
          printed: printedContracts,
          cancelled: cancelledContracts,
          expired: expiredContracts,
        },
        customers: {
          total: totalCustomers
        },
        revenue: {
          total: totalRevenueAmount,
          average: averageContractValue,
          completionRate
        },
        recentContracts,
        monthlyRevenue: monthlyRevenue.map(item => ({
          month: item.createdAt.toISOString().substring(0, 7), // YYYY-MM
          amount: Number(item._sum.totalAmount || 0),
          count: item._count.id
        }))
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
