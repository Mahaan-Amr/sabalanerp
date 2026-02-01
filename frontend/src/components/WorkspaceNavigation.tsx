'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  FaFileContract, 
  FaUsers, 
  FaUserTie, 
  FaCalculator, 
  FaWarehouse, 
  FaShieldAlt,
  FaChevronLeft,
  FaChevronRight,
  FaPlus,
  FaList,
  FaChartLine,
  FaCog,
  FaUser,
  FaBuilding,
  FaFileAlt,
  FaHandshake,
  FaBullhorn,
  FaHistory,
  FaCalendarAlt,
  FaClipboardList,
  FaExclamationTriangle,
  FaSignOutAlt,
  FaClock,
  FaCheckCircle,
  FaTimesCircle,
  FaSignature,
  FaUserCog,
  FaUserShield
} from 'react-icons/fa';
import { useWorkspace, WORKSPACES, WORKSPACE_CONFIG } from '@/contexts/WorkspaceContext';
import { dashboardAPI } from '@/lib/api';

interface NavigationItem {
  name: string;
  namePersian: string;
  href: string;
  icon: any;
  show: boolean;
  children?: NavigationItem[];
}

interface WorkspaceNavigationProps {
  className?: string;
  collapsed?: boolean;
  onToggleCollapse?: (collapsed: boolean) => void;
}

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}

export const WorkspaceNavigation: React.FC<WorkspaceNavigationProps> = ({ className = '', collapsed: collapsedProp, onToggleCollapse }) => {
  const { currentWorkspace, hasPermission } = useWorkspace();
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const pathname = usePathname();

  const isControlled = typeof collapsedProp === 'boolean';
  const collapsed = isControlled ? !!collapsedProp : internalCollapsed;

  const handleToggleCollapse = () => {
    if (isControlled && onToggleCollapse) {
      onToggleCollapse(!collapsed);
    } else {
      setInternalCollapsed(prev => !prev);
    }
  };

  useEffect(() => {
    loadCurrentUser();
  }, []);

  const loadCurrentUser = async () => {
    try {
      const response = await dashboardAPI.getProfile();
      if (response.data.success) {
        setCurrentUser(response.data.data);
      }
    } catch (error) {
      console.error('Error loading user profile:', error);
    }
  };

  const toggleExpanded = (itemName: string) => {
    setExpandedItems(prev => 
      prev.includes(itemName) 
        ? prev.filter(name => name !== itemName)
        : [...prev, itemName]
    );
  };

  const getNavigationItems = (): NavigationItem[] => {
    if (!currentWorkspace) {
      // Main dashboard navigation
      const baseItems: NavigationItem[] = [
        {
          name: 'Dashboard',
          namePersian: 'داشبورد',
          href: '/dashboard',
          icon: FaChartLine,
          show: true
        },
        {
          name: 'Contracts',
          namePersian: 'قراردادها',
          href: '/dashboard/contracts',
          icon: FaFileContract,
          show: true
        },
        {
          name: 'Contract Templates',
          namePersian: 'قالب‌های قرارداد',
          href: '/dashboard/contract-templates',
          icon: FaFileAlt,
          show: true
        },
        {
          name: 'Customers',
          namePersian: 'مشتریان',
          href: '/dashboard/customers',
          icon: FaUsers,
          show: true
        },
        {
          name: 'Security',
          namePersian: 'امنیت',
          href: '/dashboard/security',
          icon: FaShieldAlt,
          show: true
        },
        {
          name: 'Reports',
          namePersian: 'گزارشات',
          href: '/dashboard/reports',
          icon: FaChartLine,
          show: true
        }
      ];

      // Add admin navigation items if user is admin
      if (currentUser?.role === 'ADMIN') {
        baseItems.push(
          {
            name: 'User Management',
            namePersian: 'مدیریت کاربران',
            href: '/dashboard/users',
            icon: FaUserCog,
            show: true
          },
          {
            name: 'Permissions',
            namePersian: 'مدیریت دسترسی‌ها',
            href: '/dashboard/admin/permissions',
            icon: FaShieldAlt,
            show: true
          },
          {
            name: 'Departments',
            namePersian: 'مدیریت بخش‌ها',
            href: '/dashboard/departments',
            icon: FaBuilding,
            show: true
          },
          {
            name: 'System Settings',
            namePersian: 'تنظیمات سیستم',
            href: '/dashboard/admin/settings',
            icon: FaCog,
            show: true
          },
          {
            name: 'Security',
            namePersian: 'امنیت سیستم',
            href: '/dashboard/admin/security',
            icon: FaUserShield,
            show: true
          }
        );
      }

      return baseItems;
    }

    // Workspace-specific navigation
    switch (currentWorkspace) {
      case WORKSPACES.SALES:
        return [
          {
            name: 'Sales Dashboard',
            namePersian: 'داشبورد فروش',
            href: '/dashboard/sales',
            icon: FaChartLine,
            show: true
          },
          {
            name: 'Contracts',
            namePersian: 'قراردادها',
            href: '/dashboard/sales/contracts',
            icon: FaFileContract,
            show: true,
            children: [
              {
                name: 'All Contracts',
                namePersian: 'همه قراردادها',
                href: '/dashboard/sales/contracts',
                icon: FaList,
                show: true
              },
              {
                name: 'Create Contract',
                namePersian: 'ایجاد قرارداد',
                href: '/dashboard/sales/contracts/create',
                icon: FaPlus,
                show: hasPermission(WORKSPACES.SALES, 'edit' as any)
              },
              {
                name: 'Draft Contracts',
                namePersian: 'پیش نویس‌ها',
                href: '/dashboard/sales/contracts?status=DRAFT',
                icon: FaFileAlt,
                show: true
              },
              {
                name: 'Pending Approval',
                namePersian: 'در انتظار تایید',
                href: '/dashboard/sales/contracts?status=PENDING_APPROVAL',
                icon: FaClock,
                show: true
              },
              {
                name: 'Signed Contracts',
                namePersian: 'امضا شده',
                href: '/dashboard/sales/contracts?status=SIGNED',
                icon: FaSignature,
                show: true
              }
            ]
          },
          {
            name: 'Customers',
            namePersian: 'مشتریان',
            href: '/dashboard/crm/customers',
            icon: FaUsers,
            show: true,
            children: [
              {
                name: 'All Customers',
                namePersian: 'همه مشتریان',
                href: '/dashboard/crm/customers',
                icon: FaList,
                show: true
              },
              {
                name: 'Add Customer',
                namePersian: 'افزودن مشتری',
                href: '/dashboard/crm/customers/create',
                icon: FaPlus,
                show: hasPermission(WORKSPACES.SALES, 'edit' as any)
              }
            ]
          },
          {
            name: 'Products',
            namePersian: 'محصولات',
            href: '/dashboard/sales/products',
            icon: FaHandshake,
            show: true,
            children: [
              {
                name: 'Product Catalog',
                namePersian: 'کاتالوگ محصولات',
                href: '/dashboard/sales/products',
                icon: FaList,
                show: true
              }
            ]
          },
          {
            name: 'Reports',
            namePersian: 'گزارشات فروش',
            href: '/dashboard/sales/reports',
            icon: FaChartLine,
            show: true
          }
        ];

      case WORKSPACES.CRM:
        return [
          {
            name: 'CRM Dashboard',
            namePersian: 'داشبورد CRM',
            href: '/dashboard/crm',
            icon: FaChartLine,
            show: true
          },
          {
            name: 'Customers',
            namePersian: 'مشتریان',
            href: '/dashboard/crm/customers',
            icon: FaUsers,
            show: true,
            children: [
              {
                name: 'All Customers',
                namePersian: 'همه مشتریان',
                href: '/dashboard/crm/customers',
                icon: FaList,
                show: true
              },
              {
                name: 'Add Customer',
                namePersian: 'افزودن مشتری',
                href: '/dashboard/crm/customers/create',
                icon: FaPlus,
                show: hasPermission(WORKSPACES.CRM, 'edit' as any)
              }
            ]
          },
          {
            name: 'Contacts',
            namePersian: 'مخاطبین',
            href: '/dashboard/crm/contacts',
            icon: FaUser,
            show: true
          },
          {
            name: 'Leads',
            namePersian: 'سرنخ‌ها',
            href: '/dashboard/crm/leads',
            icon: FaBullhorn,
            show: true
          },
          {
            name: 'Communications',
            namePersian: 'ارتباطات',
            href: '/dashboard/crm/communications',
            icon: FaHandshake,
            show: true
          },
          {
            name: 'Reports',
            namePersian: 'گزارشات CRM',
            href: '/dashboard/crm/reports',
            icon: FaChartLine,
            show: true
          }
        ];

      case WORKSPACES.HR:
        return [
          {
            name: 'HR Dashboard',
            namePersian: 'داشبورد منابع انسانی',
            href: '/dashboard/hr',
            icon: FaChartLine,
            show: true
          },
          {
            name: 'Employees',
            namePersian: 'پرسنل',
            href: '/dashboard/hr/employees',
            icon: FaUsers,
            show: true
          },
          {
            name: 'Payroll',
            namePersian: 'حقوق و دستمزد',
            href: '/dashboard/hr/payroll',
            icon: FaCalculator,
            show: true
          },
          {
            name: 'Attendance',
            namePersian: 'حضور و غیاب',
            href: '/dashboard/hr/attendance',
            icon: FaCalendarAlt,
            show: true
          },
          {
            name: 'Reports',
            namePersian: 'گزارشات HR',
            href: '/dashboard/hr/reports',
            icon: FaChartLine,
            show: true
          }
        ];

      case WORKSPACES.ACCOUNTING:
        return [
          {
            name: 'Accounting Dashboard',
            namePersian: 'داشبورد حسابداری',
            href: '/dashboard/accounting',
            icon: FaChartLine,
            show: true
          },
          {
            name: 'Invoices',
            namePersian: 'فاکتورها',
            href: '/dashboard/accounting/invoices',
            icon: FaFileContract,
            show: true
          },
          {
            name: 'Payments',
            namePersian: 'پرداخت‌ها',
            href: '/dashboard/accounting/payments',
            icon: FaCalculator,
            show: true
          },
          {
            name: 'Reports',
            namePersian: 'گزارشات مالی',
            href: '/dashboard/accounting/reports',
            icon: FaChartLine,
            show: true
          }
        ];

      case WORKSPACES.INVENTORY:
        return [
          {
            name: 'Inventory Dashboard',
            namePersian: 'داشبورد موجودی',
            href: '/dashboard/inventory',
            icon: FaChartLine,
            show: true
          },
          {
            name: 'Master Data',
            namePersian: 'کد کالا',
            href: '/dashboard/inventory/master-data',
            icon: FaCog,
            show: true
          },
          {
            name: 'Products',
            namePersian: 'محصولات',
            href: '/dashboard/sales/products',
            icon: FaWarehouse,
            show: true
          },
          {
            name: 'Stock Movements',
            namePersian: 'حرکات موجودی',
            href: '/dashboard/inventory/movements',
            icon: FaClipboardList,
            show: true
          },
          {
            name: 'Reports',
            namePersian: 'گزارشات موجودی',
            href: '/dashboard/inventory/reports',
            icon: FaChartLine,
            show: true
          }
        ];

      case WORKSPACES.SECURITY:
        return [
          {
            name: 'Security Dashboard',
            namePersian: 'داشبورد امنیت',
            href: '/dashboard/security',
            icon: FaChartLine,
            show: true
          },
          {
            name: 'Attendance',
            namePersian: 'حضور و غیاب',
            href: '/dashboard/security/attendance',
            icon: FaCalendarAlt,
            show: true
          },
          {
            name: 'Shifts',
            namePersian: 'شیفت‌ها',
            href: '/dashboard/security/shifts',
            icon: FaClock,
            show: true
          },
          {
            name: 'Personnel',
            namePersian: 'پرسنل امنیت',
            href: '/dashboard/security/personnel',
            icon: FaShieldAlt,
            show: true
          },
          {
            name: 'Exceptions',
            namePersian: 'استثنائات',
            href: '/dashboard/security/exceptions',
            icon: FaExclamationTriangle,
            show: true
          },
          {
            name: 'Reports',
            namePersian: 'گزارشات امنیت',
            href: '/dashboard/security/reports',
            icon: FaChartLine,
            show: true
          }
        ];

      default:
        return [];
    }
  };

  const isActivePath = (href: string) => {
    if (href === '/dashboard') {
      return pathname === '/dashboard';
    }
    return pathname.startsWith(href);
  };

  const renderNavigationItem = (item: NavigationItem, level = 0) => {
    const Icon = item.icon;
    const isActive = isActivePath(item.href);
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedItems.includes(item.name);
    const showChildren = hasChildren && isExpanded;

    if (!item.show) return null;

    return (
      <div key={item.name}>
        <div
          className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
            level > 0 ? 'mr-4' : ''
          } ${
            isActive
              ? 'bg-teal-500/20 text-teal-400 border border-teal-500/30'
              : 'text-gray-300 hover:bg-white/5 hover:text-white'
          }`}
        >
          {hasChildren ? (
            <button
              onClick={() => toggleExpanded(item.name)}
              className="flex items-center gap-3 flex-1"
            >
              <Icon className="h-5 w-5" />
              {!collapsed && <span className="flex-1 text-right">{item.namePersian}</span>}
              {!collapsed && (
                isExpanded ? <FaChevronLeft className="h-4 w-4" /> : <FaChevronRight className="h-4 w-4" />
              )}
            </button>
          ) : (
            <Link
              href={item.href}
              className="flex items-center gap-3 flex-1"
            >
              <Icon className="h-5 w-5" />
              {!collapsed && <span className="flex-1 text-right">{item.namePersian}</span>}
            </Link>
          )}
        </div>

        {showChildren && !collapsed && (
          <div className="mt-1 space-y-1">
            {item.children?.map(child => renderNavigationItem(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  const navigationItems = getNavigationItems();

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Collapse Toggle */}
      <div className="p-4 border-b border-gray-700/50 flex-shrink-0">
        <button
          onClick={handleToggleCollapse}
          className="glass-liquid-btn w-full flex items-center justify-center gap-2"
        >
          {collapsed ? <FaChevronRight className="h-4 w-4" /> : <FaChevronLeft className="h-4 w-4" />}
          {!collapsed && <span>بستن منو</span>}
        </button>
      </div>

      {/* Navigation Items */}
      <nav className="flex-1 p-4 space-y-2 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
        {navigationItems.map(item => renderNavigationItem(item))}
      </nav>

      {/* Workspace Info */}
      {!collapsed && currentWorkspace && (
        <div className="p-4 border-t border-gray-700/50 flex-shrink-0">
          <div className="glass-liquid-card p-3">
            <div className="flex items-center gap-3">
              <div className="glass-liquid-card p-2">
                <FaShieldAlt className="h-4 w-4 text-teal-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium truncate">
                  {WORKSPACE_CONFIG[currentWorkspace].namePersian}
                </p>
                <p className="text-gray-400 text-xs truncate">
                  {WORKSPACE_CONFIG[currentWorkspace].description}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
