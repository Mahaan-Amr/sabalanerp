'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
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
  FaShieldAlt
} from 'react-icons/fa';
import { ThemeToggle } from '@/components/ThemeToggle';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { WorkspaceNavigation } from '@/components/WorkspaceNavigation';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { authAPI, dashboardAPI, systemRecoveryAPI } from '@/lib/api';
import { SecurityNoticeHost } from '@/components/SecurityNoticeHost';
import { ErpPressable } from '@/components/erp';

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
}

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const [user, setUser] = useState<User | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [profileDropdownPosition, setProfileDropdownPosition] = useState({ top: 0, left: 0 });
  const profileButtonRef = useRef<HTMLButtonElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [sanitizedEnvironment, setSanitizedEnvironment] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { currentWorkspace, accessibleWorkspaces } = useWorkspace();
  const isHrLanding = pathname === '/dashboard/hr';

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
        left: Math.max(margin, Math.min(rect.left, window.innerWidth - menuWidth - margin)),
      });
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProfileDropdownOpen(false);
        profileButtonRef.current?.focus();
      }
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [profileDropdownOpen]);

  // Close profile dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileDropdownOpen) {
        const target = event.target as Element;
        if (!target.closest('.profile-dropdown-container')) {
          setProfileDropdownOpen(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [profileDropdownOpen]);

  const checkAuth = async () => {
    try {
      const response = await dashboardAPI.getProfile();
      if (!response.data.success) throw new Error('Authentication required');
      if (response.data.data.mustChangePassword) {
        router.push('/change-password');
        return;
      }
      setUser(response.data.data);
      const recoveryEnvironment = await systemRecoveryAPI.getEnvironment();
      setSanitizedEnvironment(Boolean(recoveryEnvironment.data.data.sanitizedEnvironment));
    } catch (error) {
      console.error('Auth check error:', error);
      router.push('/login');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await authAPI.logout().catch(() => undefined);
    setProfileDropdownOpen(false);
    router.push('/login');
  };

  const handleSidebarNavigate = () => {
    setSidebarOpen(false);
  };

  const getNavigationItems = () => {
    const baseItems = [
      {
        name: 'داشبورد',
        href: '/dashboard',
        icon: FaHome,
        show: true
      },
      {
        name: 'قراردادها',
        href: '/dashboard/contracts',
        icon: FaFileContract,
        show: true
      },
      {
        name: 'قالب قرارداد',
        href: '/dashboard/contract-templates',
        icon: FaFileAlt,
        show: true
      },
      {
        name: 'امنیت',
        href: '/dashboard/security',
        icon: FaShieldAlt,
        show: true
      },
      {
        name: 'مشتریان',
        href: '/dashboard/customers',
        icon: FaUsers,
        show: true
      },
      {
        name: 'گزارش‌ها',
        href: '/dashboard/reports',
        icon: FaChartLine,
        show: true
      }
    ];

    // Admin/Manager items
    if (user?.role === 'ADMIN' || user?.role === 'MANAGER') {
      baseItems.push(
        {
          name: 'مدیریت کاربران',
          href: '/dashboard/users',
          icon: FaUsers,
          show: true
        },
        {
          name: 'مدیریت پرسنل',
          href: '/dashboard/hr/personnel',
          icon: FaUsers,
          show: user.role === 'ADMIN' || accessibleWorkspaces.some((workspace) => workspace.id === 'hr')
        },
        {
          name: 'سطوح دسترسی',
          href: '/dashboard/admin/permissions',
          icon: FaShieldAlt,
          show: true
        },
        {
          name: 'دپارتمان‌ها',
          href: '/dashboard/departments',
          icon: FaBuilding,
          show: true
        },
        {
          name: 'تنظیمات تخفیف',
          href: '/dashboard/admin/discount-settings',
          icon: FaPercent,
          show: true
        }
      );
    }

    return baseItems.filter(item => item.show);
  };

  const isActivePath = (href: string) => {
    if (href === '/dashboard') {
      return pathname === '/dashboard';
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
    <div className={`dashboard-shell min-h-screen bg-[var(--sds-surface-canvas)] text-[var(--sds-text-primary)] ${isHrLanding ? 'sds-neumorphic-scope' : ''}`}>
      <SecurityNoticeHost />
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <ErpPressable
          type="button"
          aria-label="بستن منوی اصلی"
          data-dashboard-overlay
          className="fixed inset-0 z-40 min-h-0 rounded-none bg-[var(--sds-surface-overlay)] p-0 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div data-dashboard-sidebar className={`fixed inset-y-0 right-0 z-50 w-[min(86vw,320px)] transform overflow-y-auto border-l border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] shadow-xl backdrop-blur-xl transition-transform duration-300 ease-in-out dark:border-[var(--sds-border-subtle)] dark:bg-[var(--sds-surface-subtle)] lg:overflow-hidden ${sidebarOpen ? 'translate-x-0' : 'translate-x-full'} lg:translate-x-0 ${sidebarCollapsed ? 'lg:w-20' : 'lg:w-64'}`}>
        <div className="flex min-h-full flex-col lg:h-full">
          {/* Sidebar Header */}
          <div className={`flex items-center border-b border-[var(--sds-border-default)] p-4 dark:border-[var(--sds-border-subtle)] lg:p-6 ${sidebarCollapsed ? 'lg:justify-center lg:p-4' : 'justify-between'}`}>
            <div className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-3'}`}>
              <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-lg border border-[var(--sds-accent)] bg-[var(--sds-surface-raised)] shadow-sm dark:border-[var(--sds-accent)] dark:bg-[var(--sds-surface-subtle)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/logo-project.png" alt="Sabalan ERP" className="h-full w-full object-cover" />
              </div>
              {!sidebarCollapsed && (
                <h1 className="text-xl font-bold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)]">Sabalan ERP</h1>
              )}
            </div>
            <ErpPressable
              type="button"
              aria-label="بستن منوی اصلی"
              onClick={() => setSidebarOpen(false)}
              className="text-[var(--sds-text-muted)] hover:text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] dark:hover:text-[var(--sds-text-inverse)] lg:hidden"
            >
              <FaTimes />
            </ErpPressable>
          </div>

          {/* User Info */}
          {!sidebarCollapsed && (
            <div className="border-b border-[var(--sds-border-default)] p-4 dark:border-[var(--sds-border-subtle)] lg:p-5">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-[var(--sds-surface-subtle)] p-2.5 text-[var(--sds-accent)]">
                  <FaUser className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)]">
                    {user.firstName} {user.lastName}
                  </p>
                  <p className="truncate text-xs text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">
                    {user.department?.namePersian || 'بدون دپارتمان'} · @{user.username}
                  </p>
                </div>
                {user.role === 'ADMIN' && (
                  <span className="rounded-full bg-[var(--sds-accent-soft)] px-2 py-1 text-xs font-semibold text-[var(--sds-accent-on-soft)]">
                    مدیر
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Workspace Switcher */}
          {!sidebarCollapsed && (
            <div className="border-b border-[var(--sds-border-default)] p-4 dark:border-[var(--sds-border-subtle)] lg:p-5">
              <WorkspaceSwitcher variant="dropdown" compact />
            </div>
          )}

          {/* Workspace Navigation */}
          <div className="flex-none lg:flex-1 lg:overflow-hidden">
            <WorkspaceNavigation
              collapsed={sidebarCollapsed}
              onToggleCollapse={setSidebarCollapsed}
              onNavigate={handleSidebarNavigate}
            />
          </div>

          {/* Sidebar Footer */}
          <div className={`${sidebarCollapsed ? 'p-4' : 'space-y-3 p-4 lg:p-5'} border-t border-[var(--sds-border-default)] dark:border-[var(--sds-border-subtle)]`}>
            <div className={`flex ${sidebarCollapsed ? 'flex-col items-center gap-2' : 'items-center justify-between gap-3'}`}>
              {!sidebarCollapsed && <span className="text-sm text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">حالت نمایش</span>}
              <ThemeToggle />
            </div>
            <ErpPressable
              type="button"
              onClick={handleLogout}
              tone="danger"
              className={`flex items-center text-[var(--sds-text-secondary)] transition-all duration-200 hover:bg-[var(--sds-danger-surface)] hover:text-[var(--sds-danger)] dark:text-[var(--sds-text-secondary)] dark:hover:bg-[var(--sds-danger-surface)] dark:hover:text-[var(--sds-danger)] ${
                sidebarCollapsed
                  ? 'justify-center w-12 h-12 rounded-full mx-auto'
                  : 'gap-3 w-full px-4 py-3 rounded-lg'
              }`}
            >
              <FaSignOutAlt className="h-5 w-5" />
              {!sidebarCollapsed && <span>خروج</span>}
            </ErpPressable>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div data-dashboard-content className={`transition-all duration-300 ${sidebarCollapsed ? 'lg:mr-20' : 'lg:mr-64'}`}>
        {/* Top Bar */}
        <header data-dashboard-topbar className="border-b border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-4 backdrop-blur-xl dark:border-[var(--sds-border-subtle)] dark:bg-[var(--sds-surface-subtle)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <ErpPressable
                type="button"
                aria-label="بازکردن منوی اصلی"
                onClick={() => setSidebarOpen(true)}
                className="text-[var(--sds-text-muted)] hover:text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] dark:hover:text-[var(--sds-text-inverse)] lg:hidden"
              >
                <FaBars className="h-6 w-6" />
              </ErpPressable>
              <div>
                <h1 className={`text-xl font-bold text-[var(--sds-text-primary)] sm:text-2xl ${isHrLanding ? '' : 'dark:text-[var(--sds-text-inverse)]'}`}>
                  {currentWorkspace ? 
                    accessibleWorkspaces.find(w => w.id === currentWorkspace)?.namePersian || 'داشبورد اصلی' :
                    'داشبورد اصلی'
                  }
                </h1>
                <p className="text-sm text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">
                  {currentWorkspace ? 
                    accessibleWorkspaces.find(w => w.id === currentWorkspace)?.description || '' :
                    'خوش آمدید ' + user.firstName + ' ' + user.lastName
                  }
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
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
        <main data-dashboard-main className={isHrLanding ? 'p-4 pb-28 sm:p-6 sm:pb-28 xl:p-8' : 'p-4 sm:p-6'}>
          {sanitizedEnvironment && (
                <div dir="rtl" className="mb-4 rounded-xl border-2 border-[var(--sds-warning-border)] bg-[var(--sds-warning-surface)] p-3 text-center font-bold text-[var(--sds-warning)]">
              محیط آزمایشی با داده‌های پاک‌سازی‌شده — استفاده عملیاتی ممنوع
            </div>
          )}
          {children}
        </main>
      </div>
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
              امور شخص
            </Link>
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
    </div>
  );
}
