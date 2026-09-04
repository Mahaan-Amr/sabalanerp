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
  FaFingerprint,
} from "react-icons/fa";
import {
  useWorkspace,
  WORKSPACES,
  WORKSPACE_CONFIG,
  WORKSPACE_PERMISSIONS,
} from "@/contexts/WorkspaceContext";
import { dashboardAPI, securityAPI } from "@/lib/api";
import { ErpPressable } from '@/components/erp';
import { DutyCountBadge } from '@/features/cross-workspace-duties/DutyCountBadge';
import { useCrossWorkspaceDutyCount } from '@/features/cross-workspace-duties/useCrossWorkspaceDutyCount';
import { projectHrNavigation } from '@/features/hr/hrAccessNavigation';

interface NavigationItem {
  name: string;
  namePersian: string;
  href: string;
  icon: any;
  show: boolean;
  separatorBefore?: boolean;
  children?: NavigationItem[];
  badgeCount?: number;
}

interface WorkspaceNavigationProps {
  className?: string;
  collapsed?: boolean;
  onNavigate?: (href: string) => void;
}

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  permissions?: { features?: Array<{ feature: string; permissionLevel: string; workspace?: string }> };
}

export const WorkspaceNavigation: React.FC<WorkspaceNavigationProps> = ({
  className = "",
  collapsed: collapsedProp,
  onNavigate,
}) => {
  const { currentWorkspace, hasPermission, accessibleWorkspaces } =
    useWorkspace();
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [canOpenSecurityShiftReport, setCanOpenSecurityShiftReport] =
    useState(false);
  const [partnerRouteAccess, setPartnerRouteAccess] = useState<Record<string, boolean>>({});
  const pathname = usePathname();
  const dutyCount = useCrossWorkspaceDutyCount(currentWorkspace || null);

  const collapsed = !!collapsedProp;

  useEffect(() => {
    loadCurrentUser();
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    let active = true;
    const paths = ['/dashboard/sales/partners', '/dashboard/sales/partner-inquiries', '/dashboard/sales/partner-cases'];
    Promise.all(paths.map(async path => {
      try {
        const response = await dashboardAPI.getRouteAvailability(path);
        return [path, response.data.data.allowed === true] as const;
      } catch {
        return [path, false] as const;
      }
    })).then(entries => { if (active) setPartnerRouteAccess(Object.fromEntries(entries)); });
    return () => { active = false; };
  }, [currentUser]);

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
            href: "/dashboard/hr/users",
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
            href: "/dashboard/hr/permissions",
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
            name: "Partner Management",
            namePersian: "مدیریت فروشندگان همکار",
            href: "/dashboard/sales/partners",
            icon: FaHandshake,
            show: partnerRouteAccess['/dashboard/sales/partners'] === true,
          },
          {
            name: "Partner Inquiries",
            namePersian: "پاسخ‌گویی استعلام همکاران",
            href: "/dashboard/sales/partner-inquiries",
            icon: FaClipboardList,
            show: partnerRouteAccess['/dashboard/sales/partner-inquiries'] === true,
          },
          {
            name: "Partner Cases",
            namePersian: "پرونده‌ها و حساب همکار",
            href: "/dashboard/sales/partner-cases",
            icon: FaFileContract,
            show: partnerRouteAccess['/dashboard/sales/partner-cases'] === true,
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
            name: "Business Intelligence",
            namePersian: "هوش تجاری",
            href: "/dashboard/bi",
            icon: FaChartPie,
            show: true,
          },
          {
            name: "Recommendations",
            namePersian: "پیشنهادها",
            href: "/dashboard/bi/recommendations",
            icon: FaChartLine,
            show: true,
          },
          {
            name: "Reconciliation",
            namePersian: "تطبیق",
            href: "/dashboard/bi/reconciliation",
            icon: FaMoneyBillWave,
            show: true,
          },
          {
            name: "Sellers",
            namePersian: "فروشندگان",
            href: "/dashboard/bi/sellers",
            icon: FaUsers,
            show: true,
          },
          {
            name: "Commercial Mix",
            namePersian: "ترکیب تجاری",
            href: "/dashboard/bi/commercial-mix",
            icon: FaWarehouse,
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
        return projectHrNavigation(currentUser?.permissions?.features || [], currentUser?.role).map((item) => ({
          name: item.id,
          namePersian: item.label,
          href: item.href,
          icon: ({
            dashboard: FaChartLine,
            structure: FaBuilding,
            hiring: FaUserPlus,
            tasks: FaClipboardList,
            personnel: FaUsers,
            authority: FaShieldAlt,
            migration: FaClipboardList,
            users: FaUserCog,
          } as Record<string, any>)[item.id] || FaClipboardList,
          show: true,
        }));

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
            name: "Accounting Dispatch",
            namePersian: "فرمان‌های ارسال",
            href: "/dashboard/accounting/dispatch",
            icon: FaTruck,
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
            name: "Biometric Connector",
            namePersian: "وضعیت اسکنر اثر انگشت",
            href: "/dashboard/accounting/settings/biometric-connector",
            icon: FaFingerprint,
            show:
              currentUser?.role === "ADMIN" ||
              Boolean(currentUser?.permissions?.features?.some((permission) => permission.feature === "accounting_biometric_diagnostics_view")),
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
            name: "Personnel Report History",
            namePersian: "سوابق گزارش پرسنل",
            href: "/dashboard/security/personnel-report-history",
            icon: FaHistory,
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
    const labelClassName = `min-w-0 flex-1 truncate text-right font-bold ${collapsed ? "lg:sr-only" : ""}`;

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
          className={`flex items-center rounded-xl transition-all duration-200 ${collapsed ? "min-h-11 gap-2 px-3 py-2 lg:mx-auto lg:h-12 lg:w-12 lg:min-h-12 lg:justify-center lg:p-0" : "min-h-11 gap-2 px-3 py-2"} ${
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
              className={`sds-dashboard-nav-control relative flex min-w-0 flex-1 items-center ${collapsed ? "gap-3 lg:h-12 lg:w-12 lg:flex-none lg:justify-center" : "justify-between gap-4"}`}
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="sds-dashboard-nav-icon"><Icon className="h-5 w-5" /></span>
                <span className={labelClassName}>{item.namePersian}</span>
                {item.badgeCount !== undefined && <DutyCountBadge count={item.badgeCount} collapsed={collapsed} />}
              </span>
              {!collapsed &&
                (isExpanded ? (
                  <FaChevronLeft className="h-4 w-4 shrink-0" />
                ) : (
                  <FaChevronRight className="h-4 w-4 shrink-0" />
                ))}
            </ErpPressable>
          ) : (
            <Link
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              title={collapsed ? item.namePersian : undefined}
              onClick={() => onNavigate?.(item.href)}
              className={`sds-dashboard-nav-control relative flex min-w-0 flex-1 items-center gap-3 ${collapsed ? "lg:h-12 lg:w-12 lg:flex-none lg:justify-center" : ""}`}
            >
              <span className="sds-dashboard-nav-icon"><Icon className="h-5 w-5" /></span>
              <span className={labelClassName}>{item.namePersian}</span>
              {item.badgeCount !== undefined && <DutyCountBadge count={item.badgeCount} collapsed={collapsed} />}
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
  if (currentWorkspace) navigationItems.splice(1, 0, {
    name: 'Task-scoped HR duties',
    namePersian: 'وظایف بین‌واحدی',
    href: `${WORKSPACE_CONFIG[currentWorkspace].path}/duties`,
    icon: FaClipboardList,
    show: true,
    badgeCount: dutyCount,
  });

  return (
    <div className={`flex min-h-0 flex-col lg:h-full ${className}`}>
      {/* Navigation Items */}
      <nav
        aria-label="ناوبری فضای کاری"
        className={`scrollbar-thin w-full flex-none space-y-1 overflow-x-hidden overflow-y-visible p-2 text-sm scrollbar-thumb-[var(--sds-border-strong)] scrollbar-track-[var(--sds-surface-subtle)] lg:flex-1 lg:overflow-y-auto ${collapsed ? "lg:px-0 lg:pb-0 lg:pt-2" : "lg:p-2"}`}
      >
        {navigationItems.map((item) => renderNavigationItem(item))}
      </nav>

    </div>
  );
};
