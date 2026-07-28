'use client';
import { ErpPressable } from '@/components/erp';
/**
 * CAD Toolbar Component
 * Tool selection and controls
 */import React from 'react';
import { FaSquare, FaRuler, FaHandPointer, FaThLarge, FaLink, FaUndo, FaRedo, FaLayerGroup, FaCircle, FaMinus, FaPencilAlt, FaFont, FaDownload } from 'react-icons/fa';

interface CADToolbarProps {
  selectedTool: string;
  onToolChange: (tool: string) => void;
  gridVisible: boolean;
  onToggleGrid: () => void;
  snapEnabled: boolean;
  onToggleSnap: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onToggleLayers?: () => void;
  showLayersPanel?: boolean;
  onExport?: (format: 'png' | 'svg' | 'json') => void;
}

const tools = [
  { id: 'select', icon: FaHandPointer, label: 'انتخاب' },
  { id: 'rectangle', icon: FaSquare, label: 'مستطیل' },
  { id: 'circle', icon: FaCircle, label: 'دایره' },
  { id: 'line', icon: FaMinus, label: 'خط' },
  { id: 'freehand', icon: FaPencilAlt, label: 'طراحی آزاد' },
  { id: 'text', icon: FaFont, label: 'متن' },
  { id: 'measurement', icon: FaRuler, label: 'اندازه‌گیری' }
];

export function CADToolbar({
  selectedTool,
  onToolChange,
  gridVisible,
  onToggleGrid,
  snapEnabled,
  onToggleSnap,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onToggleLayers,
  showLayersPanel = false,
  onExport
}: CADToolbarProps) {
  return (
    <div className="cad-toolbar bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-raised)] border-b border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)] p-3 flex items-center gap-2 flex-wrap">
      {/* Tool Selection */}
      <div className="flex items-center gap-1 border-r border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)] pr-3">
        {tools.map(tool => {
          const Icon = tool.icon;
          return (
            <ErpPressable
              key={tool.id}
              type="button"
              onClick={() => onToolChange(tool.id)}
              className={`p-2 rounded-lg transition-colors ${
                selectedTool === tool.id
                  ? 'bg-[var(--sds-info)] text-[var(--sds-text-inverse)]'
                  : 'bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] hover:bg-[var(--sds-surface-subtle)] dark:hover:bg-[var(--sds-surface-subtle)]'
              }`}
              title={tool.label}
            >
              <Icon className="w-5 h-5" />
            </ErpPressable>
          );
        })}
      </div>

      {/* Grid Controls */}
      <div className="flex items-center gap-1 border-r border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)] pr-3">
        <ErpPressable
          type="button"
          onClick={onToggleGrid}
          className={`p-2 rounded-lg transition-colors ${
            gridVisible
              ? 'bg-[var(--sds-info)] text-[var(--sds-text-inverse)]'
              : 'bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] hover:bg-[var(--sds-surface-subtle)] dark:hover:bg-[var(--sds-surface-subtle)]'
          }`}
          title="نمایش/مخفی کردن شبکه"
        >
          <FaThLarge className="w-5 h-5" />
        </ErpPressable>

        <ErpPressable
          type="button"
          onClick={onToggleSnap}
          className={`p-2 rounded-lg transition-colors ${
            snapEnabled
              ? 'bg-[var(--sds-info)] text-[var(--sds-text-inverse)]'
              : 'bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] hover:bg-[var(--sds-surface-subtle)] dark:hover:bg-[var(--sds-surface-subtle)]'
          }`}
          title="چسبیدن به شبکه"
        >
          <FaLink className="w-5 h-5" />
        </ErpPressable>
      </div>

      {/* Layers Toggle */}
      {onToggleLayers && (
        <div className="flex items-center gap-1 border-r border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)] pr-3">
          <ErpPressable
            type="button"
            onClick={onToggleLayers}
            className={`p-2 rounded-lg transition-colors ${
              showLayersPanel
                ? 'bg-[var(--sds-info)] text-[var(--sds-text-inverse)]'
                : 'bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] hover:bg-[var(--sds-surface-subtle)] dark:hover:bg-[var(--sds-surface-subtle)]'
            }`}
            title="نمایش/مخفی کردن پنل لایه‌ها"
          >
            <FaLayerGroup className="w-5 h-5" />
          </ErpPressable>
        </div>
      )}

      {/* Export */}
      {onExport && (
        <div className="flex items-center gap-1 border-r border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)] pr-3">
          <div className="relative group">
            <ErpPressable
              type="button"
              className="p-2 rounded-lg bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] hover:bg-[var(--sds-surface-subtle)] dark:hover:bg-[var(--sds-surface-subtle)] transition-colors"
              title="خروجی گرفتن"
            >
              <FaDownload className="w-5 h-5" />
            </ErpPressable>
            <div className="absolute left-0 mt-2 w-32 bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)] rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
              <ErpPressable
                type="button"
                onClick={() => onExport('png')}
                className="w-full text-right px-3 py-2 text-sm text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] hover:bg-[var(--sds-surface-subtle)] dark:hover:bg-[var(--sds-surface-raised)] rounded-t-lg"
              >
                PNG
              </ErpPressable>
              <ErpPressable
                type="button"
                onClick={() => onExport('svg')}
                className="w-full text-right px-3 py-2 text-sm text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] hover:bg-[var(--sds-surface-subtle)] dark:hover:bg-[var(--sds-surface-raised)]"
              >
                SVG
              </ErpPressable>
              <ErpPressable
                type="button"
                onClick={() => onExport('json')}
                className="w-full text-right px-3 py-2 text-sm text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] hover:bg-[var(--sds-surface-subtle)] dark:hover:bg-[var(--sds-surface-raised)] rounded-b-lg"
              >
                JSON
              </ErpPressable>
            </div>
          </div>
        </div>
      )}

      {/* Undo/Redo */}
      <div className="flex items-center gap-1">
        <ErpPressable
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          className={`p-2 rounded-lg transition-colors ${
            canUndo
              ? 'bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] hover:bg-[var(--sds-surface-subtle)] dark:hover:bg-[var(--sds-surface-subtle)]'
              : 'bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-raised)] text-[var(--sds-text-muted)] dark:text-[var(--sds-text-secondary)] cursor-not-allowed'
          }`}
          title="واگرد"
        >
          <FaUndo className="w-5 h-5" />
        </ErpPressable>

        <ErpPressable
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          className={`p-2 rounded-lg transition-colors ${
            canRedo
              ? 'bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] hover:bg-[var(--sds-surface-subtle)] dark:hover:bg-[var(--sds-surface-subtle)]'
              : 'bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-raised)] text-[var(--sds-text-muted)] dark:text-[var(--sds-text-secondary)] cursor-not-allowed'
          }`}
          title="انجام دوباره"
        >
          <FaRedo className="w-5 h-5" />
        </ErpPressable>
      </div>
    </div>
  );
}


