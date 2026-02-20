import express from 'express';
import { PrismaClient } from '@prisma/client';
import { protect } from '../middleware/auth';
import { requireFeatureAccess, FEATURE_PERMISSIONS, FEATURES } from '../middleware/feature';

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

    const averageContractValue = signedContracts > 0 
      ? Math.round(Number(totalRevenue._sum.totalAmount || 0) / signedContracts)
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
          total: totalRevenue._sum.totalAmount || 0,
          average: averageContractValue,
          completionRate
        },
        recentContracts,
        monthlyRevenue: monthlyRevenue.map(item => ({
          month: item.createdAt.toISOString().substring(0, 7), // YYYY-MM
          amount: item._sum.totalAmount || 0,
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
router.get('/profile', protect, requireFeatureAccess(FEATURES.CORE_DASHBOARD_PROFILE_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: any, res) => {
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

    // Get user's feature permissions (user-specific)
    const userFeaturePermissions = await prisma.featurePermission.findMany({
      where: {
        userId: userId,
        isActive: true
      },
      select: {
        feature: true,
        permissionLevel: true,
        workspace: true
      }
    });

    // Get user's role-based feature permissions
    const roleFeaturePermissions = await prisma.roleFeaturePermission.findMany({
      where: {
        role: user.role,
        isActive: true
      },
      select: {
        feature: true,
        permissionLevel: true,
        workspace: true
      }
    });

    // Combine user-specific and role-based feature permissions
    const featurePermissions = [...userFeaturePermissions, ...roleFeaturePermissions];

    // Get user's workspace permissions (user-specific)
    const userWorkspacePermissions = await prisma.workspacePermission.findMany({
      where: {
        userId: userId,
        isActive: true
      },
      select: {
        workspace: true,
        permissionLevel: true
      }
    });

    // Get user's role-based workspace permissions
    const roleWorkspacePermissions = await prisma.roleWorkspacePermission.findMany({
      where: {
        role: user.role,
        isActive: true
      },
      select: {
        workspace: true,
        permissionLevel: true
      }
    });

    // Combine user-specific and role-based workspace permissions
    const workspacePermissions = [...userWorkspacePermissions, ...roleWorkspacePermissions];

    // Remove sensitive information
    const { password, ...userWithoutPassword } = user;

    res.json({
      success: true,
      data: {
        ...userWithoutPassword,
        permissions: {
          features: featurePermissions,
          workspaces: workspacePermissions
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
