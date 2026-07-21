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
  FaBell,
  FaFileAlt,
  FaPercent,
  FaShieldAlt
} from 'react-icons/fa';
import { ThemeToggle } from '@/components/ThemeToggle';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { WorkspaceNavigation } from '@/components/WorkspaceNavigation';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { authAPI, dashboardAPI } from '@/lib/api';
import { SecurityNoticeHost } from '@/components/SecurityNoticeHost';

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
  const router = useRouter();
  const pathname = usePathname();
  const { currentWorkspace, accessibleWorkspaces } = useWorkspace();

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

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
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
          href: '/dashboard/personnel',
          icon: FaUsers,
          show: true
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
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-[#074747] dark:border-teal-300"></div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="dashboard-shell min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-white">
      <SecurityNoticeHost />
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div 
          data-dashboard-overlay
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div data-dashboard-sidebar className={`fixed inset-y-0 right-0 z-50 w-[min(86vw,320px)] transform overflow-y-auto border-l border-slate-200 bg-white/95 shadow-xl backdrop-blur-xl transition-transform duration-300 ease-in-out dark:border-slate-800 dark:bg-slate-950/95 lg:overflow-hidden ${sidebarOpen ? 'translate-x-0' : 'translate-x-full'} lg:translate-x-0 ${sidebarCollapsed ? 'lg:w-20' : 'lg:w-64'}`}>
        <div className="flex min-h-full flex-col lg:h-full">
          {/* Sidebar Header */}
          <div className={`flex items-center border-b border-slate-200 p-4 dark:border-slate-800 lg:p-6 ${sidebarCollapsed ? 'lg:justify-center lg:p-4' : 'justify-between'}`}>
            <div className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-3'}`}>
              <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-lg border border-[#074747]/20 bg-white shadow-sm dark:border-teal-800 dark:bg-slate-900">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/logo-project.png" alt="Sabalan ERP" className="h-full w-full object-cover" />
              </div>
              {!sidebarCollapsed && (
                <h1 className="text-xl font-bold text-slate-950 dark:text-white">Sabalan ERP</h1>
              )}
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white lg:hidden"
            >
              <FaTimes />
            </button>
          </div>

          {/* User Info */}
          {!sidebarCollapsed && (
            <div className="border-b border-slate-200 p-4 dark:border-slate-800 lg:p-5">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-slate-100 p-2.5 text-[#074747] dark:bg-slate-900 dark:text-teal-200">
                  <FaUser className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-950 dark:text-white">
                    {user.firstName} {user.lastName}
                  </p>
                  <p className="truncate text-xs text-slate-400 dark:text-slate-500">
                    {user.department?.namePersian || 'بدون دپارتمان'} · @{user.username}
                  </p>
                </div>
                {user.role === 'ADMIN' && (
                  <span className="rounded-full bg-[#074747]/10 px-2 py-1 text-xs font-semibold text-[#074747] dark:bg-teal-900/30 dark:text-teal-200">
                    مدیر
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Workspace Switcher */}
          {!sidebarCollapsed && (
            <div className="border-b border-slate-200 p-4 dark:border-slate-800 lg:p-5">
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
          <div className={`${sidebarCollapsed ? 'p-4' : 'space-y-3 p-4 lg:p-5'} border-t border-slate-200 dark:border-slate-800`}>
            <div className={`flex ${sidebarCollapsed ? 'flex-col items-center gap-2' : 'items-center justify-between gap-3'}`}>
              {!sidebarCollapsed && <span className="text-sm text-slate-500 dark:text-slate-400">حالت نمایش</span>}
              <ThemeToggle />
            </div>
            <button
              onClick={handleLogout}
              className={`flex items-center text-slate-600 transition-all duration-200 hover:bg-red-50 hover:text-red-600 dark:text-slate-300 dark:hover:bg-red-500/20 dark:hover:text-red-300 ${
                sidebarCollapsed
                  ? 'justify-center w-12 h-12 rounded-full mx-auto'
                  : 'gap-3 w-full px-4 py-3 rounded-lg'
              }`}
            >
              <FaSignOutAlt className="h-5 w-5" />
              {!sidebarCollapsed && <span>خروج</span>}
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div data-dashboard-content className={`transition-all duration-300 ${sidebarCollapsed ? 'lg:mr-20' : 'lg:mr-64'}`}>
        {/* Top Bar */}
        <header data-dashboard-topbar className="border-b border-slate-200 bg-white/85 p-4 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/70">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSidebarOpen(true)}
                className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white lg:hidden"
              >
                <FaBars className="h-6 w-6" />
              </button>
              <div>
                <h1 className="text-xl font-bold text-slate-950 dark:text-white sm:text-2xl">
                  {currentWorkspace ? 
                    accessibleWorkspaces.find(w => w.id === currentWorkspace)?.namePersian || 'داشبورد اصلی' :
                    'داشبورد اصلی'
                  }
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {currentWorkspace ? 
                    accessibleWorkspaces.find(w => w.id === currentWorkspace)?.description || '' :
                    'خوش آمدید ' + user.firstName + ' ' + user.lastName
                  }
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <button className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:text-[#074747] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                <FaBell className="h-5 w-5" />
              </button>
              <div className="relative profile-dropdown-container">
                <button 
                  ref={profileButtonRef}
                  onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-[#074747] transition hover:bg-[#074747]/10 dark:border-slate-700 dark:bg-slate-900 dark:text-teal-200"
                >
                  <FaUser className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main data-dashboard-main className="p-4 sm:p-6">
          {children}
        </main>
      </div>
      {profileDropdownOpen && createPortal(
        <div
          className="profile-dropdown-container fixed z-[100000] w-48 rounded-lg border border-slate-200 bg-white p-2 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          style={{ top: profileDropdownPosition.top, left: profileDropdownPosition.left }}
        >
          <div className="py-2">
            <div className="border-b border-slate-200 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-300">
              <p className="font-medium">{user.firstName} {user.lastName}</p>
              <p className="text-xs text-slate-500">@{user.username}</p>
            </div>
            <Link
              href="/dashboard/personal"
              onClick={() => setProfileDropdownOpen(false)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-sm text-slate-600 transition-colors hover:bg-[#074747]/10 hover:text-[#074747] dark:text-slate-300 dark:hover:bg-teal-500/20 dark:hover:text-teal-200"
            >
              <FaUser className="h-4 w-4" />
              امور شخص
            </Link>
            <button
              onClick={handleLogout}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-sm text-slate-600 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-slate-300 dark:hover:bg-red-500/20 dark:hover:text-red-300"
            >
              <FaSignOutAlt className="h-4 w-4" />
              خروج
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
