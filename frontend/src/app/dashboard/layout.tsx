'use client';

import { useState, useEffect } from 'react';
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
  FaShieldAlt
} from 'react-icons/fa';
import { ThemeToggle } from '@/components/ThemeToggle';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { WorkspaceNavigation } from '@/components/WorkspaceNavigation';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { dashboardAPI } from '@/lib/api';

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
      const token = localStorage.getItem('token');
      const userData = localStorage.getItem('user');

      if (!token || !userData) {
        router.push('/login');
        return;
      }

      // Try to fetch fresh user data from API
      try {
        const response = await dashboardAPI.getProfile();
        if (response.data.success) {
          setUser(response.data.data);
          // Update localStorage with fresh data
          localStorage.setItem('user', JSON.stringify(response.data.data));
        } else {
          // Fallback to localStorage data
          const parsedUser = JSON.parse(userData);
          setUser(parsedUser);
        }
      } catch (apiError) {
        // Fallback to localStorage data if API fails
        const parsedUser = JSON.parse(userData);
        setUser(parsedUser);
      }
    } catch (error) {
      console.error('Auth check error:', error);
      router.push('/login');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setProfileDropdownOpen(false);
    router.push('/login');
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
        name: 'قالب‌های قرارداد',
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
        name: 'گزارشات',
        href: '/dashboard/reports',
        icon: FaChartLine,
        show: true
      }
    ];

    // Admin-only items
    if (user?.role === 'ADMIN') {
      baseItems.push(
        {
          name: 'مدیریت کاربران',
          href: '/dashboard/users',
          icon: FaUsers,
          show: true
        },
        {
          name: 'مدیریت بخش‌ها',
          href: '/dashboard/departments',
          icon: FaBuilding,
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
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500"></div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`fixed inset-y-0 right-0 z-50 bg-gray-900/95 backdrop-blur-xl border-l border-gray-700/50 transform transition-transform duration-300 ease-in-out ${sidebarOpen ? 'translate-x-0' : 'translate-x-full'} lg:translate-x-0 ${sidebarCollapsed ? 'lg:w-20' : 'lg:w-64'} w-64`}>
        <div className="flex flex-col h-full">
          {/* Sidebar Header */}
          <div className={`flex items-center border-b border-gray-700/50 ${sidebarCollapsed ? 'justify-center p-4' : 'justify-between p-6'}`}>
            <div className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-3'}`}>
              <div className="glass-liquid-card p-2">
                <FaFileContract className="h-6 w-6 text-teal-400" />
              </div>
              {!sidebarCollapsed && (
                <h1 className="text-xl font-bold text-white">سبلان ERP</h1>
              )}
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden text-gray-400 hover:text-white"
            >
              <FaTimes />
            </button>
          </div>

          {/* User Info */}
          {!sidebarCollapsed && (
            <div className="p-6 border-b border-gray-700/50">
              <div className="flex items-center gap-3">
                <div className="glass-liquid-card p-3">
                  <FaUser className="h-6 w-6 text-teal-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium truncate">
                    {user.firstName} {user.lastName}
                  </p>
                  <p className="text-gray-400 text-sm truncate">
                    {user.department?.namePersian || 'بدون بخش'}
                  </p>
                  <p className="text-gray-500 text-xs truncate">
                    @{user.username}
                  </p>
                  {user.role === 'ADMIN' && (
                    <span className="inline-block mt-1 px-2 py-1 bg-teal-500/20 text-teal-400 text-xs rounded-full">
                      مدیر سیستم
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Workspace Switcher */}
          {!sidebarCollapsed && (
            <div className="p-6 border-b border-gray-700/50">
              <WorkspaceSwitcher variant="sidebar" />
            </div>
          )}

          {/* Workspace Navigation */}
          <div className="flex-1 overflow-hidden">
            <WorkspaceNavigation
              collapsed={sidebarCollapsed}
              onToggleCollapse={setSidebarCollapsed}
            />
          </div>

          {/* Sidebar Footer */}
          <div className={`${sidebarCollapsed ? 'p-4' : 'p-6 space-y-4'} border-t border-gray-700/50`}>
            <div className={`flex ${sidebarCollapsed ? 'flex-col items-center gap-2' : 'items-center justify-between gap-3'}`}>
              {!sidebarCollapsed && <span className="text-gray-400 text-sm">تم</span>}
              <ThemeToggle />
            </div>
            <button
              onClick={handleLogout}
              className={`flex items-center text-gray-300 hover:bg-red-500/20 hover:text-red-400 transition-all duration-200 ${
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
      <div className={`transition-all duration-300 ${sidebarCollapsed ? 'lg:mr-20' : 'lg:mr-64'}`}>
        {/* Top Bar */}
        <header className="bg-gray-900/50 backdrop-blur-xl border-b border-gray-700/50 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden text-gray-400 hover:text-white"
              >
                <FaBars className="h-6 w-6" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-white">
                  {currentWorkspace ? 
                    accessibleWorkspaces.find(w => w.id === currentWorkspace)?.namePersian || 'فضای کاری' :
                    'داشبورد اصلی'
                  }
                </h1>
                <p className="text-gray-400 text-sm">
                  {currentWorkspace ? 
                    accessibleWorkspaces.find(w => w.id === currentWorkspace)?.description || '' :
                    'خوش آمدید، ' + user.firstName + ' ' + user.lastName
                  }
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <button className="glass-liquid-btn p-3">
                <FaBell className="h-5 w-5" />
              </button>
              <div className="relative profile-dropdown-container">
                <button 
                  onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                  className="glass-liquid-card p-3 hover:bg-teal-500/20 transition-colors"
                >
                  <FaUser className="h-5 w-5 text-teal-400" />
                </button>
                {/* Profile Dropdown */}
                {profileDropdownOpen && (
                  <div className="absolute left-0 top-full mt-2 w-48 glass-liquid-card p-2 z-50">
                    <div className="py-2">
                      <div className="px-3 py-2 text-sm text-gray-300 border-b border-gray-700/50">
                        <p className="font-medium">{user.firstName} {user.lastName}</p>
                        <p className="text-xs text-gray-500">@{user.username}</p>
                      </div>
                      <button
                        onClick={handleLogout}
                        className="w-full text-right px-3 py-2 text-sm text-gray-300 hover:bg-red-500/20 hover:text-red-400 transition-colors flex items-center gap-2"
                      >
                        <FaSignOutAlt className="h-4 w-4" />
                        خروج
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
