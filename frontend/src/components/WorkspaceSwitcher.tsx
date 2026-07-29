"use client";

import React from "react";
import {
  FaCalculator,
  FaChartPie,
  FaChevronDown,
  FaChevronUp,
  FaFileContract,
  FaHome,
  FaShieldAlt,
  FaTruck,
  FaUserTie,
  FaUsers,
  FaWarehouse,
} from "react-icons/fa";
import { ErpBadge, ErpPressable } from '@/components/erp';
import {
  useWorkspace,
  WORKSPACE_CONFIG,
  type WORKSPACES,
} from "@/contexts/WorkspaceContext";

const iconMap = {
  FaFileContract,
  FaUsers,
  FaUserTie,
  FaCalculator,
  FaWarehouse,
  FaShieldAlt,
  FaChartPie,
  FaTruck,
};

interface WorkspaceSwitcherProps {
  className?: string;
  showLabel?: boolean;
  compact?: boolean;
  variant?: "dropdown" | "grid" | "sidebar";
}

const permissionPresentation = {
  view: { text: "مشاهده", tone: "info" as const },
  edit: { text: "ویرایش", tone: "success" as const },
  admin: { text: "مدیر", tone: "purple" as const },
};

export const WorkspaceSwitcher: React.FC<WorkspaceSwitcherProps> = ({
  className = "",
  showLabel = true,
  compact = false,
  variant = "dropdown",
}) => {
  const {
    currentWorkspace,
    accessibleWorkspaces,
    setCurrentWorkspace,
    getWorkspacePermission,
  } = useWorkspace();
  const [isOpen, setIsOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  const permissionBadge = (workspace: WORKSPACES) => {
    const permission = getWorkspacePermission(workspace);
    if (!permission) return null;
    const presentation = permissionPresentation[permission];
    return <ErpBadge tone={presentation.tone}>{presentation.text}</ErpBadge>;
  };

  const selectWorkspace = (workspace: WORKSPACES | null) => {
    setCurrentWorkspace(workspace);
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const currentInfo = currentWorkspace
    ? WORKSPACE_CONFIG[currentWorkspace]
    : {
        namePersian: "داشبورد اصلی",
        description: "نمای کلی سیستم",
        icon: "FaHome",
      };
  const CurrentIcon = currentWorkspace
    ? iconMap[currentInfo.icon as keyof typeof iconMap] || FaFileContract
    : FaHome;

  const choices = [
    {
      id: null,
      namePersian: "داشبورد اصلی",
      description: "نمای کلی سیستم",
      icon: FaHome,
    },
    ...accessibleWorkspaces.map((workspace) => ({
      ...workspace,
      icon: iconMap[workspace.icon as keyof typeof iconMap] || FaFileContract,
    })),
  ];

  const choice = (
    workspace: (typeof choices)[number],
    layout: "card" | "row",
  ) => {
    const Icon = workspace.icon;
    const active = currentWorkspace === workspace.id;
    return (
      <ErpPressable
        key={workspace.id ?? "main"}
        type="button"
        aria-pressed={active}
        tone={active ? "primary" : "neutral"}
        variant={active ? "soft" : "ghost"}
        onClick={() => selectWorkspace(workspace.id)}
        className={
          layout === "card"
            ? "min-h-28 w-full justify-start p-4 text-right"
            : "w-full justify-start gap-3 px-3 py-2 text-right"
        }
      >
        <span className="sds-tone-primary sds-tone-surface inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--sds-radius-control)]">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <strong className="sds-text-primary block truncate text-sm">
            {workspace.namePersian}
          </strong>
          {(layout === "card" || !compact) && (
            <span className="sds-text-muted mt-1 block truncate text-xs">
              {workspace.description}
            </span>
          )}
        </span>
        {workspace.id && permissionBadge(workspace.id)}
      </ErpPressable>
    );
  };

  if (variant === "grid") {
    return (
      <div
        className={`grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 ${className}`}
      >
        {choices.map((workspace) => choice(workspace, "card"))}
      </div>
    );
  }

  if (variant === "sidebar") {
    return (
      <div className={`space-y-1 ${className}`}>
        {choices.map((workspace) => choice(workspace, "row"))}
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      <ErpPressable
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className={`w-full justify-between gap-3 ${compact ? "px-3 py-2 text-sm" : "px-4 py-3"}`}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="sds-tone-primary sds-tone-surface inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--sds-radius-control)]">
            <CurrentIcon className="h-5 w-5" aria-hidden="true" />
          </span>
          {showLabel && (
            <span className="min-w-0 text-right">
              <strong className="sds-text-primary block truncate text-sm">
                {currentInfo.namePersian}
              </strong>
              {!compact && (
                <span className="sds-text-muted block truncate text-xs">
                  فضای کاری فعال
                </span>
              )}
            </span>
          )}
        </span>
        {isOpen ? (
          <FaChevronUp className="h-4 w-4" aria-hidden="true" />
        ) : (
          <FaChevronDown className="h-4 w-4" aria-hidden="true" />
        )}
      </ErpPressable>

      {isOpen && (
        <>
          <ErpPressable
            type="button"
            aria-label="بستن فهرست فضاهای کاری"
            data-workspace-switcher-backdrop
            onClick={() => setIsOpen(false)}
            className="fixed inset-0 z-10 min-h-0 rounded-none bg-transparent p-0 hover:!bg-transparent"
          />
          <div
            role="listbox"
            aria-label="فضای کاری"
            className="sds-workspace-surface absolute inset-x-0 top-full z-20 mt-2 max-h-96 space-y-1 overflow-y-auto p-2 shadow-[var(--sds-shadow-raised)]"
          >
            {choices.map((workspace) => choice(workspace, "row"))}
          </div>
        </>
      )}
    </div>
  );
};
