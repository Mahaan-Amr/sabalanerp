"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  FaHome,
  FaFileContract,
  FaUsers,
  FaBuilding,
  FaChartLine,
  FaCog,
  FaSignOutAlt,
  FaBars,
  FaTimes,
  FaUser,
  FaFileAlt,
  FaPercent,
  FaShieldAlt,
  FaLifeRing,
  FaHistory,
  FaUserPlus,
  FaClipboardList,
  FaBox,
  FaChevronLeft,
  FaChevronRight,
} from "react-icons/fa";
import { ThemeToggle } from "@/components/ThemeToggle";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";
import { WorkspaceNavigation } from "@/components/WorkspaceNavigation";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { authAPI, dashboardAPI, systemRecoveryAPI } from "@/lib/api";
import { SecurityNoticeHost } from "@/components/SecurityNoticeHost";
import {
  ErpButton,
  ErpCheckbox,
  ErpEmptyState,
  ErpMobileBottomNavigation,
  ErpPage,
  ErpPressable,
  ErpSheet,
} from '@/components/erp';
import { NotificationCenter } from "@/components/NotificationCenter";
import { readContractSubmissionDiagnostic } from "@/features/contract-creation/utils/contractSubmissionDiagnostics";
import { hasHrFeature, type HrBaseFeature } from '@/features/hr/hrAccessNavigation';
import {
  PerformanceBadgeHeaderPrototype,
  type PerformanceBadgeVariant,
} from '@/features/hr/performance-badge-prototype/PerformanceBadgePrototype';

interface User {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  role: string;
  departmentId: string;
  isActive: boolean;
  createdAt: string;
  department?: {
    id: string;
    name: string;
    namePersian: string;
    description: string;
    isActive: boolean;
  };
  profile?: {
    id: string;
    bio: string;
    avatar: string;
    phone: string;
    address: string;
  };
  permissions?: {
    features?: Array<{ feature: string; permissionLevel: string; workspace?: string }>;
  };
}

interface DashboardLayoutProps {
  children: React.ReactNode;
}

const captureSupportOrigin = () => {
  const contractSubmission = readContractSubmissionDiagnostic();
  const recordIdentifiers = contractSubmission
    ? Object.fromEntries(
        Object.entries({
          httpStatus: contractSubmission.httpStatus?.toString(),
          errorCode: contractSubmission.errorCode,
          causeCode: contractSubmission.causeCode,
          errorPath: contractSubmission.errorPath,
          productRowId: contractSubmission.productRowId,
          trackingId: contractSubmission.trackingId
        }).filter((entry): entry is [string, string] =>
          typeof entry[1] === 'string' && entry[1].length > 0
        )
      )
    : undefined;
  return {
    route: `${window.location.pathname}${window.location.search}`,
    pageTitle: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    buildCommit: process.env.NEXT_PUBLIC_BUILD_COMMIT || 'local',
    ...(recordIdentifiers && Object.keys(recordIdentifiers).length > 0
      ? {
          errors: ['شکست ثبت قرارداد'],
          recordIdentifiers
        }
      : {})
  };
};

type SensitiveCandidateItem = {
  id: string;
  label: string;
  kind: 'PAGE_TEXT' | 'FORM_VALUE' | 'FILE_METADATA';
  key?: string;
  value: string | boolean;
  metadata?: { name: string; size: number; type: string };
};

const captureSensitiveCandidateItems = (): SensitiveCandidateItem[] => {
  const secretName = /(password|passcode|token|cookie|secret|authorization|otp|credential|private.?key|api.?key|recovery.?code|رمز|گذرواژه|توکن|کوکی|کلید|کد.?بازیابی|کد.?تأیید|کد.?تایید)/i;
  const items: SensitiveCandidateItem[] = [];
  const main = document.querySelector('main');
  const safeClone = main?.cloneNode(true) as HTMLElement | undefined;
  safeClone?.querySelectorAll(
    'input, textarea, select, option, script, style, [contenteditable="true"], [data-sensitive="true"], [data-support-private="true"]',
  ).forEach((element) => element.remove());
  const pageText = safeClone?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 20_000);
  if (pageText) items.push({ id: 'page-text', label: 'متن قابل‌مشاهده صفحه', kind: 'PAGE_TEXT', value: pageText });
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('main input, main select, main textarea')
    .forEach((element, index) => {
      const key = element.name || element.id || element.getAttribute('aria-label') || `field-${index + 1}`;
      if (secretName.test(key) || (element instanceof HTMLInputElement && ['password', 'hidden'].includes(element.type))) return;
      if (element instanceof HTMLInputElement && element.type === 'file') {
        Array.from(element.files || []).forEach((file, fileIndex) => items.push({
          id: `file-${index}-${fileIndex}`,
          label: `مشخصات فایل: ${file.name}`,
          kind: 'FILE_METADATA',
          value: `${file.name} · ${file.type || 'نامشخص'} · ${file.size.toLocaleString('fa-IR')} بایت`,
          metadata: { name: file.name, size: file.size, type: file.type },
        }));
        return;
      }
      const value = element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)
        ? element.checked
        : element.value.slice(0, 2_000);
      if (value !== '') items.push({ id: `field-${index}`, label: key, kind: 'FORM_VALUE', key, value });
    });
  return items;
};

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const [user, setUser] = useState<User | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [profileDropdownPosition, setProfileDropdownPosition] = useState({
    top: 0,
    left: 0,
  });
  const profileButtonRef = useRef<HTMLButtonElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [sanitizedEnvironment, setSanitizedEnvironment] = useState(false);
  const [routeAvailability, setRouteAvailability] = useState<{ allowed: boolean; reason: string | null } | null>(null);
  const [supportCaptureOpen, setSupportCaptureOpen] = useState(false);
  const [sensitiveCaptureConsent, setSensitiveCaptureConsent] = useState(false);
  const [sensitiveCandidateItems, setSensitiveCandidateItems] = useState<SensitiveCandidateItem[]>([]);
  const [selectedSensitiveItemIds, setSelectedSensitiveItemIds] = useState<string[]>([]);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { currentWorkspace, accessibleWorkspaces, loading: workspaceAccessLoading } = useWorkspace();
  const isHrWorkspace = pathname.startsWith("/dashboard/hr");
  const isPerformanceBadgePrototype = pathname === "/dashboard/hr/personnel/performance-badge-prototype";
  const requestedPerformanceBadgeVariant = searchParams.get("variant")?.toUpperCase();
  const performanceBadgeVariant: PerformanceBadgeVariant =
    requestedPerformanceBadgeVariant === "B" || requestedPerformanceBadgeVariant === "C"
      ? requestedPerformanceBadgeVariant
      : "A";
  const isSalesWorkspace = pathname.startsWith("/dashboard/sales");
  const isSalesLanding = pathname === "/dashboard/sales";
  const isSalesCustomerIndex =
    pathname === "/dashboard/crm/customers" &&
    searchParams.get("workspace") === "sales";
  const showsSalesMobileNavigation = isSalesWorkspace || isSalesCustomerIndex;
  const isNeumorphicWorkspace = isHrWorkspace || isSalesLanding;
  const hasMobileBottomNavigation = isHrWorkspace || showsSalesMobileNavigation;
  const isWorkspaceDetail = pathname !== "/dashboard";
  const effectiveHrFeatures = user?.permissions?.features || [];
  const deniesHrRoute = Boolean(isHrWorkspace && routeAvailability?.allowed === false);
  const isTaskScopedDutyRoute = /\/duties(?:\/|$)/.test(pathname);
  const deniesWorkspaceRoute = Boolean(
    !workspaceAccessLoading
      && currentWorkspace
      && !isTaskScopedDutyRoute
      && !accessibleWorkspaces.some((workspace) => workspace.id === currentWorkspace),
  );
  const deniesFeatureRoute = Boolean(!isHrWorkspace && routeAvailability?.allowed === false);

  useEffect(() => {
    let active = true;
    setRouteAvailability(null);
    if (isTaskScopedDutyRoute) return () => { active = false; };
    dashboardAPI.getRouteAvailability(pathname)
      .then((response) => { if (active) setRouteAvailability(response.data.data); })
      .catch(() => {
        if (active) setRouteAvailability({
          allowed: false,
          reason: 'بررسی دسترسی انجام نشد. پشتیبان سامانه باید وضعیت سرور را بررسی کند.',
        });
      });
    return () => { active = false; };
  }, [isTaskScopedDutyRoute, pathname]);
  const hrMobileNavigation = [
    {
      id: "dashboard",
      label: "داشبورد",
      href: "/dashboard/hr",
      icon: FaChartLine,
      exact: true,
      feature: 'DASHBOARD' as HrBaseFeature,
    },
    {
      id: "structure",
      label: "ساختار",
      href: "/dashboard/hr/structure",
      icon: FaBuilding,
      feature: 'ORGANIZATIONAL_STRUCTURE' as HrBaseFeature,
    },
    {
      id: "hiring",
      label: "جذب",
      href: "/dashboard/hr/hiring",
      icon: FaUserPlus,
      feature: 'RECRUITMENT_CASES' as HrBaseFeature,
    },
    {
      id: "personnel",
      label: "پرسنل",
      href: "/dashboard/hr/personnel",
      icon: FaUsers,
      feature: 'PERSONNEL' as HrBaseFeature,
    },
    {
      id: "migration",
      label: "تطبیق",
      href: "/dashboard/hr/migration",
      icon: FaClipboardList,
      feature: 'DATA_MIGRATION_RECONCILIATION' as HrBaseFeature,
    },
  ];
  const visibleHrMobileNavigation = hrMobileNavigation.filter(({ feature }) => (
    hasHrFeature(effectiveHrFeatures, feature)
  ));
  const salesMobileNavigation = [
    {
      id: "dashboard",
      label: "داشبورد",
      href: "/dashboard/sales",
      icon: FaHome,
      exact: true,
    },
    {
      id: "contracts",
      label: "قراردادها",
      href: "/dashboard/sales/contracts",
      icon: FaFileContract,
    },
    {
      id: "customers",
      label: "مشتریان",
      href: "/dashboard/crm/customers?workspace=sales",
      activePath: "/dashboard/crm/customers",
      exact: true,
      icon: FaUsers,
    },
    {
      id: "products",
      label: "محصولات",
      href: "/dashboard/sales/products",
      icon: FaBox,
    },
    {
      id: "reports",
      label: "گزارش‌ها",
      href: "/dashboard/sales/reports",
      icon: FaChartLine,
    },
  ];

  const continueToSupportTicket = (includeSensitive = false) => {
    const origin = captureSupportOrigin() as ReturnType<typeof captureSupportOrigin> & { sensitiveCandidate?: Record<string, unknown> };
    if (includeSensitive && sensitiveCaptureConsent) {
      const selected = sensitiveCandidateItems.filter((item) => selectedSensitiveItemIds.includes(item.id));
      origin.sensitiveCandidate = {
        pageText: selected.find((item) => item.kind === 'PAGE_TEXT')?.value || '',
        formValues: Object.fromEntries(
          selected.filter((item) => item.kind === 'FORM_VALUE' && item.key).map((item) => [item.key!, item.value]),
        ),
        uploadedFileMetadata: selected.filter((item) => item.kind === 'FILE_METADATA').map((item) => item.metadata),
      };
    }
    sessionStorage.setItem('support-ticket-origin', JSON.stringify(origin));
    setSupportCaptureOpen(false);
    setProfileDropdownOpen(false);
    router.push('/dashboard/support/new');
  };

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (sidebarOpen) {
      setSidebarCollapsed(false);
    }
  }, [sidebarOpen]);

  useEffect(() => {
    if (!profileDropdownOpen || !profileButtonRef.current) return;

    const updatePosition = () => {
      const rect = profileButtonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuWidth = 192;
      const margin = 12;

      setProfileDropdownPosition({
        top: rect.bottom + 8,
        left: Math.max(
          margin,
          Math.min(rect.left, window.innerWidth - menuWidth - margin),
        ),
      });
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProfileDropdownOpen(false);
        profileButtonRef.current?.focus();
      }
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [profileDropdownOpen]);

  // Close profile dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileDropdownOpen) {
        const target = event.target as Element;
        if (!target.closest(".profile-dropdown-container")) {
          setProfileDropdownOpen(false);
        }
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [profileDropdownOpen]);

  const checkAuth = async () => {
    try {
      const response = await dashboardAPI.getProfile();
      if (!response.data.success) throw new Error("Authentication required");
      if (response.data.data.mustChangePassword) {
        router.push("/change-password");
        return;
      }
      setUser(response.data.data);
      const recoveryEnvironment = await systemRecoveryAPI.getEnvironment();
      setSanitizedEnvironment(
        Boolean(recoveryEnvironment.data.data.sanitizedEnvironment),
      );
    } catch (error) {
      console.error('Auth check error:', error);
      if (typeof window !== 'undefined') {
        const returnTo = `${window.location.pathname}${window.location.search}`;
        if (returnTo.startsWith('/dashboard')) sessionStorage.setItem('post-login-return-to', returnTo);
      }
      const status = error && typeof error === 'object' && 'response' in error
        ? Number((error as { response?: { status?: unknown } }).response?.status || 0)
        : 0;
      // The shared HTTP client owns 401 navigation. Starting a second Next.js
      // transition here can cancel both redirects and strand an anonymous user.
      if (status !== 401) router.replace('/login');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await authAPI.logout().catch(() => undefined);
    setProfileDropdownOpen(false);
    router.push("/login");
  };

  const handleSidebarNavigate = () => {
    setSidebarOpen(false);
  };

  const getNavigationItems = () => {
    const baseItems = [
      {
        name: "داشبورد",
        href: "/dashboard",
        icon: FaHome,
        show: true,
      },
      {
        name: "قراردادها",
        href: "/dashboard/contracts",
        icon: FaFileContract,
        show: true,
      },
      {
        name: "قالب قرارداد",
        href: "/dashboard/contract-templates",
        icon: FaFileAlt,
        show: true,
      },
      {
        name: "امنیت",
        href: "/dashboard/security",
        icon: FaShieldAlt,
        show: true,
      },
      {
        name: "مشتریان",
        href: "/dashboard/customers",
        icon: FaUsers,
        show: true,
      },
      {
        name: "گزارش‌ها",
        href: "/dashboard/reports",
        icon: FaChartLine,
        show: true,
      },
    ];

    // Admin/Manager items
    if (user?.role === "ADMIN" || user?.role === "MANAGER") {
      baseItems.push(
        {
          name: "مدیریت پرسنل",
          href: "/dashboard/hr/personnel",
          icon: FaUsers,
          show:
            user.role === "ADMIN" ||
            accessibleWorkspaces.some((workspace) => workspace.id === "hr"),
        },
        {
          name: "سطوح دسترسی",
          href: "/dashboard/hr/permissions",
          icon: FaShieldAlt,
          show: true,
        },
        {
          name: "دپارتمان‌ها",
          href: "/dashboard/departments",
          icon: FaBuilding,
          show: true,
        },
        {
          name: "تنظیمات تخفیف",
          href: "/dashboard/admin/discount-settings",
          icon: FaPercent,
          show: true,
        },
      );
    }

    return baseItems.filter((item) => item.show);
  };

  const isActivePath = (href: string) => {
    if (href === "/dashboard") {
      return pathname === "/dashboard";
    }
    return pathname.startsWith(href);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-subtle)]">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-[var(--sds-accent)] motion-reduce:animate-none"></div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div
      className="dashboard-shell sds-neumorphic-scope min-h-screen overflow-x-hidden bg-[var(--sds-surface-canvas)] text-[var(--sds-text-primary)]"
    >
      <SecurityNoticeHost />
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <ErpPressable
          type="button"
          aria-label="بستن منوی اصلی"
          data-dashboard-overlay
          className="fixed inset-x-0 bottom-0 top-16 z-40 min-h-0 rounded-none !bg-[var(--sds-surface-overlay)] p-0 hover:!bg-[var(--sds-surface-overlay)] lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        data-dashboard-sidebar
        className={`sds-dashboard-sidebar fixed bottom-0 right-0 top-[4.5rem] z-50 w-[min(86vw,288px)] transform overflow-y-auto transition-[width,transform] duration-300 ease-in-out lg:overflow-visible ${sidebarOpen ? "translate-x-0" : "translate-x-full"} lg:translate-x-0 ${sidebarCollapsed ? "lg:w-20" : "lg:w-64"}`}
      >
        <ErpPressable
          type="button"
          aria-label={sidebarCollapsed ? "بازکردن منو" : "جمع‌کردن منو"}
          title={sidebarCollapsed ? "بازکردن منو" : "جمع‌کردن منو"}
          onClick={() => setSidebarCollapsed((current) => !current)}
          variant="ghost"
          className="sds-dashboard-sidebar-toggle absolute left-3 top-1/2 z-10 hidden h-12 w-12 -translate-x-full -translate-y-1/2 items-center justify-center rounded-none p-0 text-[var(--sds-text-muted)] hover:text-[var(--sds-text-primary)] lg:inline-flex"
        >
          {sidebarCollapsed ? (
            <FaChevronLeft className="h-4 w-4" aria-hidden="true" />
          ) : (
            <FaChevronRight className="h-4 w-4" aria-hidden="true" />
          )}
        </ErpPressable>
        <div className="flex min-h-full flex-col lg:h-full">
          <div className={`sds-dashboard-rail flex min-h-0 flex-1 flex-col lg:mx-3 lg:mb-3 lg:overflow-hidden ${sidebarCollapsed ? "sds-dashboard-rail-collapsed" : ""}`}>
          {/* Mobile drawer header. The company mark lives in the persistent site header. */}
          <div
            data-sidebar-section
            className="sds-dashboard-sidebar-header flex items-center justify-between p-3 lg:hidden"
          >
            <span className="text-sm font-bold text-[var(--sds-text-primary)]">منو</span>
            <ErpPressable
              type="button"
              aria-label="بستن منوی اصلی"
              onClick={() => setSidebarOpen(false)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--sds-text-muted)] hover:text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] dark:hover:text-[var(--sds-text-inverse)] lg:hidden"
            >
              <FaTimes />
            </ErpPressable>
          </div>

          {/* User Info */}
          <div data-sidebar-section className={`border-b border-[var(--sds-border-subtle)] p-3 ${sidebarCollapsed ? "lg:hidden" : ""}`}>
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-[var(--sds-surface-subtle)] p-2.5 text-[var(--sds-accent)]">
                  <FaUser className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className="truncate text-sm font-semibold text-[var(--sds-text-primary)]"
                  >
                    {user.firstName} {user.lastName}
                  </p>
                  <p className="truncate text-xs text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">
                    {user.department?.namePersian || "بدون دپارتمان"} · @
                    {user.username}
                  </p>
                </div>
                {user.role === "ADMIN" && (
                  <span className="rounded-full bg-[var(--sds-accent-soft)] px-2 py-1 text-xs font-semibold text-[var(--sds-accent-on-soft)]">
                    مدیر
                  </span>
                )}
              </div>
          </div>

          {/* Workspace Switcher */}
          <div data-sidebar-section className={`border-b border-[var(--sds-border-subtle)] p-3 ${sidebarCollapsed ? "lg:hidden" : ""}`}>
              <WorkspaceSwitcher variant="dropdown" compact />
          </div>

            {/* Workspace Navigation */}
            <div data-sidebar-section className="flex-none lg:flex-1 lg:overflow-hidden">
              <WorkspaceNavigation
                collapsed={sidebarCollapsed}
                onNavigate={handleSidebarNavigate}
              />
            </div>

            {/* Sidebar Footer */}
            <div
              data-sidebar-section
              className={`sds-dashboard-sidebar-footer flex items-center gap-3 p-3 ${sidebarCollapsed ? "sds-dashboard-sidebar-footer-collapsed lg:flex-col lg:items-center lg:justify-center lg:gap-2" : ""}`}
            >
              <ThemeToggle />
              <ErpPressable
                type="button"
                onClick={handleLogout}
                tone="danger"
                className={`sds-dashboard-footer-action flex items-center text-[var(--sds-danger)] transition-all duration-200 hover:bg-[var(--sds-danger-surface)] hover:text-[var(--sds-danger)] dark:text-[var(--sds-danger)] dark:hover:bg-[var(--sds-danger-surface)] dark:hover:text-[var(--sds-danger)] ${
                  sidebarCollapsed
                    ? "h-12 flex-1 gap-3 rounded-lg px-3 py-2 lg:w-12 lg:flex-none lg:justify-center lg:rounded-full lg:px-0 lg:py-0"
                    : "h-12 flex-1 justify-center gap-3 rounded-lg px-3 py-2"
                }`}
              >
                <FaSignOutAlt className="h-5 w-5" />
                <span className={sidebarCollapsed ? "lg:sr-only" : ""}>خروج</span>
              </ErpPressable>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div
        data-dashboard-content
        className={`transition-all duration-300 ${isWorkspaceDetail ? "dashboard-workspace-detail" : ""}`}
      >
        {/* Top Bar */}
        <header
          data-dashboard-topbar
          className={`sds-dashboard-topbar flex items-center px-3 sm:px-4 ${isPerformanceBadgePrototype ? "min-h-16 py-2" : "h-16"}`}
        >
          <div className={`flex w-full items-center justify-between ${isPerformanceBadgePrototype ? "flex-wrap gap-y-2" : ""}`}>
            <div className="flex items-center gap-4">
              <ErpPressable
                type="button"
                aria-label="بازکردن منوی اصلی"
                onClick={() => setSidebarOpen(true)}
                className="inline-flex h-12 w-12 min-h-12 min-w-12 items-center justify-center rounded-lg text-[var(--sds-text-muted)] hover:text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] dark:hover:text-[var(--sds-text-inverse)] lg:hidden"
              >
                <FaBars className="h-6 w-6" />
              </ErpPressable>
              <div className="sds-dashboard-brand flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl sm:h-12 sm:w-12">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/brand/logo-project.png"
                  alt="Sabalan ERP"
                  className="h-full w-full object-cover"
                />
              </div>
              <div>
                <h1
                  className="text-xl font-bold text-[var(--sds-text-primary)] sm:text-2xl"
                >
                  {currentWorkspace
                    ? accessibleWorkspaces.find(
                        (w) => w.id === currentWorkspace,
                      )?.namePersian || "داشبورد اصلی"
                    : "داشبورد اصلی"}
                </h1>
                <p className="sds-text-secondary text-sm">
                  {currentWorkspace
                    ? accessibleWorkspaces.find(
                        (w) => w.id === currentWorkspace,
                      )?.description || ""
                    : "خوش آمدید " + user.firstName + " " + user.lastName}
                </p>
              </div>
            </div>

            <div className={`flex items-center gap-2 ${isPerformanceBadgePrototype ? "w-full justify-end sm:w-auto" : ""}`}>
              {isPerformanceBadgePrototype && (
                <PerformanceBadgeHeaderPrototype variant={performanceBadgeVariant} />
              )}
              <NotificationCenter />
              <div className="relative profile-dropdown-container">
                <ErpPressable
                  type="button"
                  ref={profileButtonRef}
                  aria-label="حساب کاربری"
                  aria-haspopup="menu"
                  aria-expanded={profileDropdownOpen}
                  onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] text-[var(--sds-accent)] transition hover:bg-[var(--sds-accent-soft)]"
                >
                  <FaUser className="h-5 w-5" />
                </ErpPressable>
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main
          data-dashboard-main
          className={`${sidebarCollapsed ? "lg:mr-20" : "lg:mr-64"} transition-[margin] duration-300 ${
            isNeumorphicWorkspace
              ? "p-4 pb-28 sm:p-6 sm:pb-28 xl:p-8"
              : hasMobileBottomNavigation
                ? "p-4 pb-28 sm:p-6 sm:pb-28 lg:pb-6"
                : "p-4 sm:p-6"
          }`}
        >
          {sanitizedEnvironment && (
            <div
              dir="rtl"
              className="mb-4 rounded-xl border-2 border-[var(--sds-warning-border)] bg-[var(--sds-warning-surface)] p-3 text-center font-bold text-[var(--sds-warning)]"
            >
              محیط آزمایشی با داده‌های پاک‌سازی‌شده — استفاده عملیاتی ممنوع
            </div>
          )}
          {deniesWorkspaceRoute || deniesFeatureRoute || deniesHrRoute ? (
            <ErpPage eyebrow={deniesHrRoute ? 'منابع انسانی' : 'دسترسی'} title="دسترسی به این بخش مجاز نیست">
              <ErpEmptyState
                icon={FaShieldAlt}
                title="مجوز لازم برای این بخش به حساب شما داده نشده است"
                description={routeAvailability?.reason || "آدرس صفحه حفظ شده است. برای دسترسی، مجوز مرتبط باید توسط مدیر همان فضای کاری ثبت شود."}
              />
            </ErpPage>
          ) : children}
        </main>
      </div>
      {isHrWorkspace && visibleHrMobileNavigation.length > 0 && (
        <ErpMobileBottomNavigation
          items={visibleHrMobileNavigation}
          ariaLabel="ناوبری منابع انسانی"
        />
      )}
      {showsSalesMobileNavigation && (
        <ErpMobileBottomNavigation
          items={salesMobileNavigation}
          ariaLabel="ناوبری فروش"
        />
      )}
      {profileDropdownOpen && createPortal(
        <div
          role="menu"
          aria-label="حساب کاربری"
          className="profile-dropdown-container fixed z-[100000] w-48 rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-2 shadow-2xl dark:border-[var(--sds-border-subtle)] dark:bg-[var(--sds-surface-subtle)]"
          style={{ top: profileDropdownPosition.top, left: profileDropdownPosition.left }}
        >
          <div className="py-2">
            <div className="border-b border-[var(--sds-border-default)] px-3 py-2 text-sm text-[var(--sds-text-secondary)] dark:border-[var(--sds-border-subtle)] dark:text-[var(--sds-text-secondary)]">
              <p className="font-medium">{user.firstName} {user.lastName}</p>
              <p className="text-xs text-[var(--sds-text-muted)]">@{user.username}</p>
            </div>
            <Link
              href="/dashboard/personal"
              role="menuitem"
              onClick={() => setProfileDropdownOpen(false)}
              className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-sm text-[var(--sds-text-secondary)] transition-colors hover:bg-[var(--sds-accent-soft)] hover:text-[var(--sds-accent)]"
            >
              <FaUser className="h-4 w-4" />
              امور شخصی
            </Link>
            <div className="my-1 rounded-lg border border-[var(--sds-border-subtle)] p-1" role="group" aria-label="پشتیبانی">
              <div className="flex min-h-9 items-center gap-2 px-2 text-sm font-bold text-[var(--sds-text-secondary)]">
                <FaLifeRing className="h-4 w-4" />
                پشتیبانی
              </div>
              <ErpPressable
                type="button"
                role="menuitem"
                onClick={() => {
                  setProfileDropdownOpen(false);
                  setSensitiveCaptureConsent(false);
                  setSensitiveCandidateItems([]);
                  setSelectedSensitiveItemIds([]);
                  continueToSupportTicket();
                }}
                className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-sm text-[var(--sds-text-secondary)] transition-colors hover:bg-[var(--sds-accent-soft)] hover:text-[var(--sds-accent)]"
              >
                <FaLifeRing className="h-4 w-4" />
                ثبت درخواست
              </ErpPressable>
              <Link
                href="/dashboard/support/history"
                role="menuitem"
                onClick={() => setProfileDropdownOpen(false)}
                className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-sm text-[var(--sds-text-secondary)] transition-colors hover:bg-[var(--sds-accent-soft)] hover:text-[var(--sds-accent)]"
              >
                <FaHistory className="h-4 w-4" />
                درخواست‌های پشتیبانی
              </Link>
            </div>
            <ErpPressable
              type="button"
              role="menuitem"
              onClick={handleLogout}
              tone="danger"
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-sm text-[var(--sds-text-secondary)] transition-colors hover:bg-[var(--sds-danger-surface)] hover:text-[var(--sds-danger)] dark:text-[var(--sds-text-secondary)] dark:hover:bg-[var(--sds-danger-surface)] dark:hover:text-[var(--sds-danger)]"
            >
              <FaSignOutAlt className="h-4 w-4" />
              خروج
            </ErpPressable>
          </div>
        </div>,
        document.body
      )}
      <ErpSheet
        open={supportCaptureOpen}
        onClose={() => setSupportCaptureOpen(false)}
        title="اطلاعات همراه تیکت"
        presentation="modal"
        footer={(
          <div className="flex flex-wrap justify-end gap-2">
            <ErpButton label="انصراف" onClick={() => setSupportCaptureOpen(false)} tone="neutral" variant="outline" />
            <ErpButton label="ادامه به ثبت درخواست" onClick={() => continueToSupportTicket(true)} tone="primary" />
          </div>
        )}
      >
        <div className="space-y-4" dir="rtl">
          <p className="text-sm leading-7 text-[var(--sds-text-secondary)]">
            مسیر، نسخه و اطلاعات فنی امن همیشه ثبت می‌شوند. اطلاعات خام فقط پس از اجازهٔ شما جمع‌آوری می‌شوند و پیش از ادامه قابل حذف‌اند.
          </p>
          <ErpCheckbox
            checked={sensitiveCaptureConsent}
            onChange={(event) => {
              const checked = event.target.checked;
              setSensitiveCaptureConsent(checked);
              if (checked) {
                const items = captureSensitiveCandidateItems();
                setSensitiveCandidateItems(items);
                setSelectedSensitiveItemIds(items.map((item) => item.id));
              } else {
                setSensitiveCandidateItems([]);
                setSelectedSensitiveItemIds([]);
              }
            }}
            label="اطلاعات خام این صفحه را برای انتخاب و پیش‌نمایش جمع‌آوری کن"
          />
          {sensitiveCaptureConsent && (
            sensitiveCandidateItems.length ? (
              <div className="space-y-2">
                {sensitiveCandidateItems.map((item) => (
                  <div key={item.id} className="rounded-xl border border-[var(--sds-border-subtle)] p-3">
                    <ErpCheckbox
                      checked={selectedSensitiveItemIds.includes(item.id)}
                      onChange={(event) => setSelectedSensitiveItemIds((current) => event.target.checked
                        ? (current.includes(item.id) ? current : [...current, item.id])
                        : current.filter((id) => id !== item.id))}
                      label={item.label}
                    />
                    <p className="mt-2 max-h-24 overflow-auto break-words text-xs leading-6 text-[var(--sds-text-muted)]">
                      {String(item.value).slice(0, 800)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--sds-text-muted)]">مورد خام قابل‌اشتراکی در این صفحه پیدا نشد.</p>
            )
          )}
        </div>
      </ErpSheet>
    </div>
  );
}
