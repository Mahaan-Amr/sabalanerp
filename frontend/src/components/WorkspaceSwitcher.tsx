'use client';

import React, { useState } from 'react';
import { 
  FaFileContract, 
  FaUsers, 
  FaUserTie, 
  FaCalculator, 
  FaWarehouse, 
  FaShieldAlt,
  FaChevronDown,
  FaChevronUp,
  FaHome
} from 'react-icons/fa';
import { useWorkspace, WORKSPACES, WORKSPACE_CONFIG } from '@/contexts/WorkspaceContext';

// Icon mapping
const iconMap = {
  FaFileContract,
  FaUsers,
  FaUserTie,
  FaCalculator,
  FaWarehouse,
  FaShieldAlt
};

interface WorkspaceSwitcherProps {
  className?: string;
  showLabel?: boolean;
  variant?: 'dropdown' | 'grid' | 'sidebar';
}

export const WorkspaceSwitcher: React.FC<WorkspaceSwitcherProps> = ({ 
  className = '', 
  showLabel = true,
  variant = 'dropdown'
}) => {
  const { 
    currentWorkspace, 
    accessibleWorkspaces, 
    setCurrentWorkspace,
    getWorkspacePermission 
  } = useWorkspace();
  
  const [isOpen, setIsOpen] = useState(false);

  const getCurrentWorkspaceInfo = () => {
    if (!currentWorkspace) {
      return {
        name: 'داشبورد اصلی',
        namePersian: 'داشبورد اصلی',
        icon: FaHome,
        color: 'gray'
      };
    }
    
    const config = WORKSPACE_CONFIG[currentWorkspace];
    return {
      ...config,
      icon: iconMap[config.icon as keyof typeof iconMap] || FaFileContract
    };
  };

  const getPermissionBadge = (workspace: WORKSPACES) => {
    const permission = getWorkspacePermission(workspace);
    if (!permission) return null;

    const badges = {
      view: { text: 'مشاهده', color: 'bg-blue-500/20 text-blue-400' },
      edit: { text: 'ویرایش', color: 'bg-green-500/20 text-green-400' },
      admin: { text: 'مدیر', color: 'bg-purple-500/20 text-purple-400' }
    };

    const badge = badges[permission];
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${badge.color}`}>
        {badge.text}
      </span>
    );
  };

  const handleWorkspaceSelect = (workspace: WORKSPACES) => {
    setCurrentWorkspace(workspace);
    setIsOpen(false);
  };

  const handleMainDashboard = () => {
    setCurrentWorkspace(null);
    setIsOpen(false);
  };

  const currentInfo = getCurrentWorkspaceInfo();
  const CurrentIcon = currentInfo.icon;

  if (variant === 'grid') {
    return (
      <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 ${className}`}>
        {/* Main Dashboard */}
        <div
          onClick={handleMainDashboard}
          className={`glass-liquid-card p-6 cursor-pointer transition-all duration-200 hover:bg-white/10 ${
            !currentWorkspace ? 'ring-2 ring-teal-500/50' : ''
          }`}
        >
          <div className="flex items-center gap-4">
            <div className="glass-liquid-card p-3">
              <FaHome className="h-6 w-6 text-gray-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-white font-semibold">داشبورد اصلی</h3>
              <p className="text-gray-400 text-sm">نمای کلی سیستم</p>
            </div>
          </div>
        </div>

        {/* Workspace Cards */}
        {accessibleWorkspaces.map((workspace) => {
          const Icon = iconMap[workspace.icon as keyof typeof iconMap] || FaFileContract;
          const isActive = currentWorkspace === workspace.id;
          
          return (
            <div
              key={workspace.id}
              onClick={() => handleWorkspaceSelect(workspace.id)}
              className={`glass-liquid-card p-6 cursor-pointer transition-all duration-200 hover:bg-white/10 ${
                isActive ? `ring-2 ring-${workspace.color}-500/50` : ''
              }`}
            >
              <div className="flex items-center gap-4">
                <div className={`glass-liquid-card p-3`}>
                  <Icon className={`h-6 w-6 text-${workspace.color}-400`} />
                </div>
                <div className="flex-1">
                  <h3 className="text-white font-semibold">{workspace.namePersian}</h3>
                  <p className="text-gray-400 text-sm">{workspace.description}</p>
                  <div className="mt-2">
                    {getPermissionBadge(workspace.id)}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (variant === 'sidebar') {
    return (
      <div className={`space-y-2 ${className}`}>
        {/* Main Dashboard */}
        <div
          onClick={handleMainDashboard}
          className={`flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer transition-all duration-200 ${
            !currentWorkspace 
              ? 'bg-teal-500/20 text-teal-400 border border-teal-500/30' 
              : 'text-gray-300 hover:bg-white/5 hover:text-white'
          }`}
        >
          <FaHome className="h-5 w-5" />
          <span>داشبورد اصلی</span>
        </div>

        {/* Workspace Items */}
        {accessibleWorkspaces.map((workspace) => {
          const Icon = iconMap[workspace.icon as keyof typeof iconMap] || FaFileContract;
          const isActive = currentWorkspace === workspace.id;
          
          return (
            <div
              key={workspace.id}
              onClick={() => handleWorkspaceSelect(workspace.id)}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer transition-all duration-200 ${
                isActive 
                  ? `bg-${workspace.color}-500/20 text-${workspace.color}-400 border border-${workspace.color}-500/30` 
                  : 'text-gray-300 hover:bg-white/5 hover:text-white'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="flex-1">{workspace.namePersian}</span>
              {getPermissionBadge(workspace.id)}
            </div>
          );
        })}
      </div>
    );
  }

  // Default dropdown variant
  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="glass-liquid-btn flex items-center gap-3 px-4 py-3 w-full justify-between"
      >
        <div className="flex items-center gap-3">
          <div className="glass-liquid-card p-2">
            <CurrentIcon className={`h-5 w-5 text-${currentInfo.color}-400`} />
          </div>
          {showLabel && (
            <div className="text-right">
              <p className="text-white font-medium">{currentInfo.namePersian}</p>
              <p className="text-gray-400 text-sm">انتخاب فضای کاری</p>
            </div>
          )}
        </div>
        {isOpen ? <FaChevronUp className="h-4 w-4" /> : <FaChevronDown className="h-4 w-4" />}
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 z-10" 
            onClick={() => setIsOpen(false)}
          />
          
          {/* Dropdown */}
          <div className="absolute top-full left-0 right-0 mt-2 glass-liquid-card p-2 z-20 max-h-96 overflow-y-auto">
            {/* Main Dashboard */}
            <div
              onClick={handleMainDashboard}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer transition-all duration-200 ${
                !currentWorkspace 
                  ? 'bg-teal-500/20 text-teal-400' 
                  : 'text-gray-300 hover:bg-white/5 hover:text-white'
              }`}
            >
              <FaHome className="h-5 w-5" />
              <div className="flex-1">
                <p className="font-medium">داشبورد اصلی</p>
                <p className="text-sm opacity-75">نمای کلی سیستم</p>
              </div>
            </div>

            {/* Workspace Items */}
            {accessibleWorkspaces.map((workspace) => {
              const Icon = iconMap[workspace.icon as keyof typeof iconMap] || FaFileContract;
              const isActive = currentWorkspace === workspace.id;
              
              return (
                <div
                  key={workspace.id}
                  onClick={() => handleWorkspaceSelect(workspace.id)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer transition-all duration-200 ${
                    isActive 
                      ? `bg-${workspace.color}-500/20 text-${workspace.color}-400` 
                      : 'text-gray-300 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  <div className="flex-1">
                    <p className="font-medium">{workspace.namePersian}</p>
                    <p className="text-sm opacity-75">{workspace.description}</p>
                  </div>
                  {getPermissionBadge(workspace.id)}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
