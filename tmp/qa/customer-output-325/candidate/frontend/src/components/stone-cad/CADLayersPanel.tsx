'use client';
import { ErpInput, ErpPressable } from '@/components/erp';
/**
 * CAD Layers Panel Component
 * Manages layers in the CAD design
 */import React from 'react';
import { FaPlus, FaTrash, FaEye, FaEyeSlash, FaLock, FaUnlock } from 'react-icons/fa';
import { CADLayer } from './types/CADTypes';

interface CADLayersPanelProps {
  layers: CADLayer[];
  activeLayer: string;
  onLayerAdd: () => void;
  onLayerUpdate: (layerId: string, updates: Partial<CADLayer>) => void;
  onLayerDelete: (layerId: string) => void;
  onLayerSelect: (layerId: string) => void;
}

export function CADLayersPanel({
  layers,
  activeLayer,
  onLayerAdd,
  onLayerUpdate,
  onLayerDelete,
  onLayerSelect
}: CADLayersPanelProps) {
  // Sort layers by order
  const sortedLayers = [...layers].sort((a, b) => a.order - b.order);

  return (
    <div className="cad-layers-panel bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-raised)] rounded-lg p-4 border border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)]">
          لایه‌ها ({layers.length})
        </h3>
        <ErpPressable
          type="button"
          onClick={onLayerAdd}
          className="px-3 py-1.5 text-xs bg-[var(--sds-info)] text-[var(--sds-text-inverse)] rounded hover:bg-[var(--sds-info)] transition-colors flex items-center gap-1"
          title="افزودن لایه جدید"
        >
          <FaPlus className="w-3 h-3" />
          افزودن
        </ErpPressable>
      </div>

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {sortedLayers.map(layer => (
          <div
            key={layer.id}
            className={`flex items-center gap-2 p-2 rounded transition-colors ${
              activeLayer === layer.id
                ? 'bg-[var(--sds-info-surface)] dark:bg-[var(--sds-info-surface)] border border-[var(--sds-info-border)] dark:border-[var(--sds-info-border)]'
                : 'hover:bg-[var(--sds-surface-subtle)] dark:hover:bg-[var(--sds-surface-raised)] border border-transparent'
            }`}
          >
            {/* Visibility Toggle */}
            <ErpPressable
              type="button"
              onClick={() => onLayerUpdate(layer.id, { visible: !layer.visible })}
              className="p-1 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)] hover:text-[var(--sds-text-primary)] dark:hover:text-[var(--sds-text-primary)] transition-colors"
              title={layer.visible ? 'مخفی کردن' : 'نمایش'}
            >
              {layer.visible ? (
                <FaEye className="w-4 h-4" />
              ) : (
                <FaEyeSlash className="w-4 h-4" />
              )}
            </ErpPressable>

            {/* Lock Toggle */}
            <ErpPressable
              type="button"
              onClick={() => onLayerUpdate(layer.id, { locked: !layer.locked })}
              className={`p-1 transition-colors ${
                layer.locked
                  ? 'text-[var(--sds-warning)] dark:text-[var(--sds-warning)]'
                  : 'text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)] hover:text-[var(--sds-text-primary)] dark:hover:text-[var(--sds-text-primary)]'
              }`}
              title={layer.locked ? 'باز کردن قفل' : 'قفل کردن'}
            >
              {layer.locked ? (
                <FaLock className="w-4 h-4" />
              ) : (
                <FaUnlock className="w-4 h-4" />
              )}
            </ErpPressable>

            {/* Layer Name */}
            <ErpInput
              type="text"
              value={layer.name}
              onChange={(e) => onLayerUpdate(layer.id, { name: e.target.value })}
              disabled={layer.locked}
              className={`flex-1 px-2 py-1 text-sm border rounded bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)] ${
                layer.locked
                  ? 'border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)] opacity-50 cursor-not-allowed'
                  : 'border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)] focus:ring-2 focus:ring-[var(--sds-focus-ring)] focus:border-transparent'
              }`}
              placeholder="نام لایه"
            />

            {/* Activate Button */}
            <ErpPressable
              type="button"
              onClick={() => onLayerSelect(layer.id)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                activeLayer === layer.id
                  ? 'bg-[var(--sds-info)] text-[var(--sds-text-inverse)]'
                  : 'bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-subtle)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] hover:bg-[var(--sds-surface-subtle)] dark:hover:bg-[var(--sds-surface-subtle)]'
              }`}
              title="فعال کردن"
            >
              فعال
            </ErpPressable>

            {/* Delete Button */}
            {layers.length > 1 && (
              <ErpPressable
                type="button"
                onClick={() => onLayerDelete(layer.id)}
                disabled={layer.locked}
                className={`p-1 text-[var(--sds-danger)] dark:text-[var(--sds-danger)] hover:bg-[var(--sds-danger-surface)] dark:hover:bg-[var(--sds-danger-surface)] rounded transition-colors ${
                  layer.locked ? 'opacity-50 cursor-not-allowed' : ''
                }`}
                title="حذف لایه"
              >
                <FaTrash className="w-4 h-4" />
              </ErpPressable>
            )}
          </div>
        ))}
      </div>

      {layers.length === 0 && (
        <div className="text-center py-4 text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
          هیچ لایه‌ای وجود ندارد
        </div>
      )}
    </div>
  );
}



