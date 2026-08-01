"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
  FaUserPlus,
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
  FaUserClock,
  FaCheckCircle,
  FaTimesCircle,
  FaSignature,
  FaUserCog,
  FaUserShield,
  FaChartPie,
  FaMoneyBillWave,
  FaTruck,
  FaBell,
} from "react-icons/fa";
import {
  useWorkspace,
  WORKSPACES,
  WORKSPACE_CONFIG,
  WORKSPACE_PERMISSIONS,
} from "@/contexts/WorkspaceContext";
import { dashboardAPI, securityAPI } from "@/lib/api";
import { ErpPressable } from '@/components/erp';

interface NavigationItem {
  name: string;
  namePersian: string;
  href: string;
  icon: any;
  show: boolean;
  separatorBefore?: boolean;
  children?: NavigationItem[];
}

interface WorkspaceNavigationProps {
  className?: string;
  collapsed?: boolean;
  onToggleCollapse?: (collapsed: boolean) => void;
  onNavigate?: (href: string) => void;
}

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}

export const WorkspaceNavigation: React.FC<WorkspaceNavigationProps> = ({
  className = "",
  collapsed: collapsedProp,
  onToggleCollapse,
  onNavigate,
}) => {
  const { currentWorkspace, hasPermission, accessibleWorkspaces } =
    useWorkspace();
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [canOpenSecurityShiftReport, setCanOpenSecurityShiftReport] =
    useState(false);
  const pathname = usePathname();

  const isControlled = typeof collapsedProp === "boolean";
  const collapsed = isControlled ? !!collapsedProp : internalCollapsed;

  const handleToggleCollapse = () => {
    if (isControlled && onToggleCollapse) {
      onToggleCollapse(!collapsed);
    } else {
      setInternalCollapsed((prev) => !prev);
    }
  };

  useEffect(() => {
    loadCurrentUser();
  }, []);

  useEffect(() => {
    if (currentWorkspace !== WORKSPACES.SECURITY) {
      setCanOpenSecurityShiftReport(false);
      return;
    }
    let active = true;
    securityAPI
      .getDashboardCurrentShift()
      .then((response) => {
        if (!active) return;
        const awareness = response.data?.data;
        setCanOpenSecurityShiftReport(
          Boolean(
            awareness?.authorized &&
            (awareness?.access === "manager" ||
              (awareness?.access === "operator" &&
                awareness?.overview?.state === "ACTIVE")),
          ),
        );
      })
      .catch(() => {
        if (active) setCanOpenSecurityShiftReport(false);
      });
    return () => {
      active = false;
    };
  }, [currentWorkspace]);

  const loadCurrentUser = async () => {
    try {
      const response = await dashboardAPI.getProfile();
      if (response.data.success) {
        setCurrentUser(response.data.data);
      }
    } catch (error) {
      console.error("Error loading user profile:", error);
    }
  };

  const toggleExpanded = (itemKey: string) => {
    setExpandedItems((prev) =>
      prev.includes(itemKey)
        ? prev.filter((name) => name !== itemKey)
        : [...prev, itemKey],
    );
  };

  const getNavigationItems = (): NavigationItem[] => {
    if (!currentWorkspace) {
      if (
        currentUser &&
        currentUser.role !== "ADMIN" &&
        currentUser.role !== "MANAGER"
      ) {
        const workspaceIcons: Record<string, any> = {
          FaFileContract,
          FaUsers,
          FaUserTie,
          FaCalculator,
          FaWarehouse,
          FaShieldAlt,
          FaTruck,
        };

        return accessibleWorkspaces.map((workspace) => ({
          name: workspace.name,
          namePersian: workspace.namePersian,
          href: workspace.path,
          icon: workspaceIcons[workspace.icon] || FaChartLine,
          show: true,
        }));
      }

      if (!currentUser) return [];

      // Main dashboard navigation
      const baseItems: NavigationItem[] = [
        {
          name: "Dashboard",
          namePersian: "داشبورد",
          href: "/dashboard",
          icon: FaChartLine,
          show: true,
        },
        {
          name: "Contracts",
          namePersian: "قراردادها",
          href: "/dashboard/contracts",
          icon: FaFileContract,
          show: true,
        },
        {
          name: "Contract Templates",
          namePersian: "قالب قرارداد",
          href: "/dashboard/contract-templates",
          icon: FaFileAlt,
          show: true,
        },
        {
          name: "Customers",
          namePersian: "مشتریان",
          href: "/dashboard/customers",
          icon: FaUsers,
          show: true,
        },
        {
          name: "Security",
          namePersian: "گارد",
          href: "/dashboard/security",
          icon: FaShieldAlt,
          show: true,
        },
        {
          name: "Reports",
          namePersian: "گزارش‌ها",
          href: "/dashboard/reports",
          icon: FaChartLine,
          show: true,
        },
      ];

      // Add admin/manager navigation items
      if (currentUser?.role === "ADMIN" || currentUser?.role === "MANAGER") {
        baseItems.push(
          {
            name: "User Management",
            namePersian: "مدیریت کاربران",
            href: "/dashboard/users",
            icon: FaUserCog,
            show: true,
          },
          {
            name: "Personnel Management",
            namePersian: "مدیریت پرسنل",
            href: "/dashboard/hr/personnel",
            icon: FaUserTie,
            show:
              currentUser.role === "ADMIN" ||
              hasPermission(WORKSPACES.HR, "view" as any),
          },
          {
            name: "Permissions",
            namePersian: "سطوح دسترسی",
            href: "/dashboard/admin/permissions",
            icon: FaShieldAlt,
            show: true,
          },
          {
            name: "Departments",
            namePersian: "دپارتمان‌ها",
            href: "/dashboard/departments",
            icon: FaBuilding,
            show: true,
          },
          {
            name: "System Settings",
            namePersian: "تنظیمات سیستم",
            href: "/dashboard/admin/settings",
            icon: FaCog,
            show: true,
          },
          {
            name: 'Notification Policies',
            namePersian: 'سیاست‌های اعلان',
            href: '/dashboard/admin/notification-policies',
            icon: FaBell,
            show: currentUser?.role === 'ADMIN'
          },
          {
            name: 'Support Targets',
            namePersian: 'اهداف زمانی پشتیبانی',
            href: '/dashboard/admin/support-targets',
            icon: FaClock,
            show: currentUser?.role === 'ADMIN'
          },
          {
            name: 'Sabalan Calendar',
            namePersian: 'تقویم سالیانه سبلان',
            href: '/dashboard/admin/sabalan-calendar',
            icon: FaCalendarAlt,
            show: currentUser?.role === "ADMIN",
          },
          {
            name: "Security",
            namePersian: "امنیت سامانه",
            href: "/dashboard/admin/security",
            icon: FaUserShield,
            show: true,
          },
        );
      }

      return baseItems;
    }

    // Workspace-specific navigation
    switch (currentWorkspace) {
      case WORKSPACES.SALES:
        return [
          {
            name: "Sales Dashboard",
            namePersian: "داشبورد فروش",
            href: "/dashboard/sales",
            icon: FaChartLine,
            show: true,
          },
          {
            name: "Contracts",
            namePersian: "قراردادها",
            href: "/dashboard/sales/contracts",
            icon: FaFileContract,
            show: true,
            children: [
              {
                name: "All Contracts",
                namePersian: "همه قراردادها",
                href: "/dashboard/sales/contracts",
                icon: FaList,
                show: true,
              },
              {
                name: "Create Contract",
                namePersian: "ایجاد قرارداد",
                href: "/dashboard/sales/contracts/create",
                icon: FaPlus,
                show: hasPermission(WORKSPACES.SALES, "edit" as any),
              },
              {
                name: "Draft Contracts",
                namePersian: "پیش‌نویس‌ها",
                href: "/dashboard/sales/contracts?status=DRAFT",
                icon: FaFileAlt,
                show: true,
              },
              {
                name: "Pending Approval",
                namePersian: "در انتظار تایید",
                href: "/dashboard/sales/contracts?status=PENDING_APPROVAL",
                icon: FaClock,
                show: true,
              },
              {
                name: "Signed Contracts",
                namePersian: "امضا شده‌ها",
                href: "/dashboard/sales/contracts?status=SIGNED",
                icon: FaSignature,
                show: true,
              },
            ],
          },
          {
            name: "Customers",
            namePersian: "مشتریان",
            href: "/dashboard/crm/customers",
            icon: FaUsers,
            show: true,
            children: [
              {
                name: "All Customers",
                namePersian: "همه مشتریان",
                href: "/dashboard/crm/customers",
                icon: FaList,
                show: true,
              },
              {
                name: "Add Customer",
                namePersian: "افزودن مشتری",
                href: "/dashboard/crm/customers/create",
                icon: FaPlus,
                show: hasPermission(WORKSPACES.SALES, "edit" as any),
              },
            ],
          },
          {
            name: "Products",
            namePersian: "محصولات",
            href: "/dashboard/sales/products",
            icon: FaHandshake,
            show: true,
            children: [
              {
                name: "Product Catalog",
                namePersian: "کاتالوگ محصولات",
                href: "/dashboard/sales/products",
                icon: FaList,
                show: true,
              },
            ],
          },
          {
            name: "Reports",
            namePersian: "گزارش‌های فروش",
            href: "/dashboard/sales/reports",
            icon: FaChartLine,
            show: true,
          },
        ];

      case WORKSPACES.BI:
        return [
          {
            name: "BI Command Center",
            namePersian: "مرکز فرمان BI فروش",
            href: "/dashboard/bi",
            icon: FaChartPie,
            show: true,
          },
          {
            name: "Seller Performance",
            namePersian: "عملکرد فروشندگان",
            href: "/dashboard/bi?tab=sellers",
            icon: FaUsers,
            show: true,
          },
          {
            name: "Financial Sales",
            namePersian: "مالی فروش",
            href: "/dashboard/bi?tab=finance",
            icon: FaMoneyBillWave,
            show: true,
          },
          {
            name: "Products and Customers",
            namePersian: "محصولات و مشتریان",
            href: "/dashboard/bi?tab=products",
            icon: FaWarehouse,
            show: true,
          },
          {
            name: "Delivery Risk",
            namePersian: "ریسک تحویل",
            href: "/dashboard/bi?tab=delivery",
            icon: FaTruck,
            show: true,
          },
        ];

      case WORKSPACES.CRM:
        return [
          {
            name: "CRM Dashboard",
            namePersian: "داشبورد CRM",
            href: "/dashboard/crm",
            icon: FaChartLine,
            show: true,
          },
          {
            name: "Customers",
            namePersian: "مشتریان",
            href: "/dashboard/crm/customers",
            icon: FaUsers,
            show: true,
            children: [
              {
                name: "All Customers",
                namePersian: "همه مشتریان",
                href: "/dashboard/crm/customers",
                icon: FaList,
                show: true,
              },
              {
                name: "Add Customer",
                namePersian: "افزودن مشتری",
                href: "/dashboard/crm/customers/create",
                icon: FaPlus,
                show: hasPermission(WORKSPACES.CRM, "edit" as any),
              },
            ],
          },
          {
            name: "Contacts",
            namePersian: "مخاطبین",
            href: "/dashboard/crm/contacts",
            icon: FaUser,
            show: true,
          },
          {
            name: "Leads",
            namePersian: "سرنخ‌ها",
            href: "/dashboard/crm/leads",
            icon: FaBullhorn,
            show: true,
          },
          {
            name: "Communications",
            namePersian: "ارتباطات",
            href: "/dashboard/crm/communications",
            icon: FaHandshake,
            show: true,
          },
          {
            name: "Reports",
            namePersian: "گزارش‌های CRM",
            href: "/dashboard/crm/reports",
            icon: FaChartLine,
            show: true,
          },
        ];

      case WORKSPACES.HR:
        return [
          {
            name: "HR Dashboard",
            namePersian: "داشبورد منابع انسانی",
            href: "/dashboard/hr",
            icon: FaChartLine,
            show: true,
          },
          {
            name: "Organization",
            namePersian: "ساختار سازمانی",
            href: "/dashboard/hr/structure",
            icon: FaBuilding,
            show: true,
          },
          {
            name: "Recruitment",
            namePersian: "جذب و پرونده‌های متقاضیان",
            href: "/dashboard/hr/hiring",
            icon: FaUserPlus,
            show: true,
          },
          {
            name: "My HR Tasks",
            namePersian: "وظایف منابع انسانی",
            href: "/dashboard/hr/tasks",
            icon: FaClipboardList,
            show: true,
          },
          {
            name: "Personnel",
            namePersian: "پرسنل و روابط استخدامی",
            href: "/dashboard/hr/personnel",
            icon: FaUsers,
            show: true,
          },
          {
            name: "Migration",
            namePersian: "مهاجرت و تطبیق",
            href: "/dashboard/hr/migration",
            icon: FaClipboardList,
            show: hasPermission(WORKSPACES.HR, "admin" as any),
          },
        ];

      case WORKSPACES.ACCOUNTING:
        return [
          {
            name: "Accounting Dashboard",
            namePersian: "داشبورد حسابداری",
            href: "/dashboard/accounting",
            icon: FaChartLine,
            show: true,
          },
          {
            name: "Contracts",
            namePersian: "قراردادهای قابل بررسی",
            href: "/dashboard/accounting/contracts",
            icon: FaFileContract,
            show: true,
          },
          {
            name: "Invoice Candidates",
            namePersian: "پیش‌نویس صورتحساب‌ها",
            href: "/dashboard/accounting/invoice-candidates",
            icon: FaFileAlt,
            show: true,
          },
          {
            name: "Receivables",
            namePersian: "دریافتنی‌ها",
            href: "/dashboard/accounting/receivables",
            icon: FaCalculator,
            show: true,
          },
          {
            name: "Payments",
            namePersian: "دریافت‌ها و چک‌ها",
            href: "/dashboard/accounting/payments",
            icon: FaCalculator,
            show: true,
          },
          {
            name: "Tax",
            namePersian: "مالیات و سامانه مودیان",
            href: "/dashboard/accounting/tax",
            icon: FaClipboardList,
            show: true,
          },
          {
            name: "Audit",
            namePersian: "سوابق عملیات",
            href: "/dashboard/accounting/audit",
            icon: FaChartLine,
            show: true,
          },
          {
            name: "Accountant Performance",
            namePersian: "عملکرد حسابداران",
            href: "/dashboard/accounting/performance",
            icon: FaUserClock,
            show: true,
          },
          {
            name: "Settings",
            namePersian: "تنظیمات حسابداری",
            href: "/dashboard/accounting/settings",
            icon: FaCog,
            show: true,
          },
        ];

      case WORKSPACES.INVENTORY:
        return [
          {
            name: "Inventory Dashboard",
            namePersian: "داشبورد انبار",
            href: "/dashboard/inventory",
            icon: FaChartLine,
            show: true,
          },
          {
            name: "Master Data",
            namePersian: "داده‌های پایه",
            href: "/dashboard/inventory/master-data",
            icon: FaCog,
            show: true,
          },
          {
            name: "Products",
            namePersian: "محصولات",
            href: "/dashboard/sales/products",
            icon: FaWarehouse,
            show: true,
          },
          {
            name: "Stock Movements",
            namePersian: "گردش موجودی",
            href: "/dashboard/inventory/movements",
            icon: FaClipboardList,
            show: true,
          },
          {
            name: "Reports",
            namePersian: "گزارش‌های انبار",
            href: "/dashboard/inventory/reports",
            icon: FaChartLine,
            show: true,
          },
        ];

      case WORKSPACES.SECURITY:
        return [
          {
            name: "Security Dashboard",
            namePersian: "داشبورد گارد",
            href: "/dashboard/security",
            icon: FaChartLine,
            show: true,
          },
          {
            name: "Attendance",
            namePersian: "حضور و غیاب",
            href: "/dashboard/security/attendance",
            icon: FaCalendarAlt,
            show: true,
          },
          {
            name: "Shift Reports",
            namePersian: "گزارش شیفت",
            href: "/dashboard/security/supervisor-reports",
            icon: FaClipboardList,
            show:
              hasPermission(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.ADMIN) ||
              canOpenSecurityShiftReport,
          },
          {
            name: "Vehicles",
            namePersian: "خودرویی",
            href: "/dashboard/security/vehicles",
            icon: FaTruck,
            show: true,
          },
          {
            name: "Exceptions",
            namePersian: "استثناها و مأموریت‌ها",
            href: "/dashboard/security/exceptions",
            icon: FaExclamationTriangle,
            show: true,
          },
          {
            name: "Shifts",
            namePersian: "شیفت‌ها",
            href: "/dashboard/security/shifts",
            icon: FaClock,
            show: true,
            separatorBefore: true,
          },
          {
            name: "Reports",
            namePersian: "گزارش‌ها",
            href: "/dashboard/security/reports",
            icon: FaChartLine,
            show: hasPermission(
              WORKSPACES.SECURITY,
              WORKSPACE_PERMISSIONS.ADMIN,
            ),
          },
          {
            name: "Personnel",
            namePersian: "کارکنان گارد",
            href: "/dashboard/security/personnel",
            icon: FaShieldAlt,
            show: hasPermission(
              WORKSPACES.SECURITY,
              WORKSPACE_PERMISSIONS.ADMIN,
            ),
          },
          {
            name: "Settings",
            namePersian: "تنظیمات گارد",
            href: "/dashboard/security/settings",
            icon: FaCog,
            show: hasPermission(
              WORKSPACES.SECURITY,
              WORKSPACE_PERMISSIONS.ADMIN,
            ),
          },
        ];

      case WORKSPACES.LOGISTICS:
        return [
          {
            name: "Logistics Dashboard",
            namePersian: "داشبورد لجستیک",
            href: "/dashboard/logistics",
            icon: FaChartLine,
            show: true,
          },
          {
            name: "Loadings",
            namePersian: "بارگیری‌ها",
            href: "/dashboard/logistics/loadings",
            icon: FaTruck,
            show: true,
            children: [
              {
                name: "All Loadings",
                namePersian: "همه بارگیری‌ها",
                href: "/dashboard/logistics/loadings",
                icon: FaList,
                show: true,
              },
              {
                name: "New Loading",
                namePersian: "بارگیری جدید",
                href: "/dashboard/logistics/loadings/new",
                icon: FaPlus,
                show: hasPermission(WORKSPACES.LOGISTICS, "edit" as any),
              },
            ],
          },
        ];

      default:
        return [];
    }
  };

  const isActivePath = (href: string) => {
    if (href === "/dashboard") {
      return pathname === "/dashboard";
    }
    const workspaceRoot = currentWorkspace
      ? WORKSPACE_CONFIG[currentWorkspace].path
      : null;
    if (workspaceRoot && href === workspaceRoot) {
      return pathname === workspaceRoot;
    }
    return pathname.startsWith(href);
  };

  const renderNavigationItem = (item: NavigationItem, level = 0) => {
    const Icon = item.icon;
    const isActive = isActivePath(item.href);
    const hasChildren = item.children && item.children.length > 0;
    const itemKey = item.href;
    const isExpanded = expandedItems.includes(itemKey);
    const showChildren = hasChildren && isExpanded;

    if (!item.show) return null;

    return (
      <div
        key={itemKey}
        className={
          item.separatorBefore && !collapsed
            ? "mt-3 border-t border-[var(--sds-border-default)] pt-3 dark:border-[var(--sds-border-subtle)]"
            : undefined
        }
      >
        <div
          className={`flex items-center rounded-xl transition-all duration-200 ${collapsed ? "min-h-11 gap-2 px-3 py-2 lg:min-h-12 lg:justify-center lg:px-1.5" : "min-h-11 gap-2 px-3 py-2"} ${
            level > 0 ? "mr-4" : ""
          } ${
            isActive
              ? "sds-dashboard-nav-active border border-[var(--sds-accent)] bg-[var(--sds-accent-soft)] text-[var(--sds-accent)]"
              : "text-[var(--sds-text-primary)] hover:bg-[var(--sds-surface-subtle)] dark:text-[var(--sds-text-secondary)] dark:hover:bg-[var(--sds-surface-raised)] dark:hover:text-[var(--sds-text-inverse)]"
          }`}
        >
          {hasChildren ? (
            <ErpPressable
              type="button"
              aria-expanded={isExpanded}
              aria-current={isActive ? "page" : undefined}
              onClick={() => toggleExpanded(itemKey)}
              className={`flex min-w-0 flex-1 items-center ${collapsed ? "gap-3 lg:flex-col lg:justify-center lg:gap-1" : "gap-3"}`}
            >
              <span className="sds-dashboard-nav-icon"><Icon className="h-5 w-5" /></span>
              <span className={collapsed ? "flex-1 text-right font-bold lg:sr-only" : "flex-1 text-right font-bold"}>{item.namePersian}</span>
              {!collapsed &&
                (isExpanded ? (
                  <FaChevronLeft className="h-4 w-4" />
                ) : (
                  <FaChevronRight className="h-4 w-4" />
                ))}
            </ErpPressable>
          ) : (
            <Link
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              title={collapsed ? item.namePersian : undefined}
              onClick={() => onNavigate?.(item.href)}
              className={`flex min-w-0 flex-1 items-center ${collapsed ? "gap-3 lg:flex-col lg:justify-center lg:gap-1" : "gap-3"}`}
            >
              <span className="sds-dashboard-nav-icon"><Icon className="h-5 w-5" /></span>
              <span className={collapsed ? "flex-1 text-right font-bold lg:sr-only" : "flex-1 text-right font-bold"}>{item.namePersian}</span>
            </Link>
          )}
        </div>

        {showChildren && !collapsed && (
          <div className="mt-1 space-y-1">
            {item.children?.map((child) =>
              renderNavigationItem(child, level + 1),
            )}
          </div>
        )}
      </div>
    );
  };

  const navigationItems = getNavigationItems();

  return (
    <div className={`flex min-h-0 flex-col lg:h-full ${className}`}>
      {/* Collapse Toggle */}
      <div className="hidden flex-shrink-0 border-b border-[var(--sds-border-default)] p-3 lg:block">
        <ErpPressable
          type="button"
          aria-label={collapsed ? "بازکردن منو" : "جمع‌کردن منو"}
          onClick={handleToggleCollapse}
          className="sds-action sds-action-ghost flex w-full items-center justify-center gap-2 text-sm"
        >
          {collapsed ? (
            <FaChevronRight className="h-4 w-4" />
          ) : (
            <FaChevronLeft className="h-4 w-4" />
          )}
        </ErpPressable>
      </div>

      {/* Navigation Items */}
      <nav
        aria-label="ناوبری فضای کاری"
        className="scrollbar-thin flex-none space-y-1 overflow-visible p-2 text-sm scrollbar-thumb-[var(--sds-border-strong)] scrollbar-track-[var(--sds-surface-subtle)] lg:flex-1 lg:overflow-y-auto lg:p-2"
      >
        {navigationItems.map((item) => renderNavigationItem(item))}
      </nav>

    </div>
  );
};
