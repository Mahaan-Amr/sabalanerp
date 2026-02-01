/**
 * CAD Layers Panel Component
 * Manages layers in the CAD design
 */

'use client';

import React from 'react';
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
    <div className="cad-layers-panel bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          لایه‌ها ({layers.length})
        </h3>
        <button
          type="button"
          onClick={onLayerAdd}
          className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors flex items-center gap-1"
          title="افزودن لایه جدید"
        >
          <FaPlus className="w-3 h-3" />
          افزودن
        </button>
      </div>
      
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {sortedLayers.map(layer => (
          <div
            key={layer.id}
            className={`flex items-center gap-2 p-2 rounded transition-colors ${
              activeLayer === layer.id
                ? 'bg-indigo-100 dark:bg-indigo-900/30 border border-indigo-300 dark:border-indigo-700'
                : 'hover:bg-gray-100 dark:hover:bg-gray-700 border border-transparent'
            }`}
          >
            {/* Visibility Toggle */}
            <button
              type="button"
              onClick={() => onLayerUpdate(layer.id, { visible: !layer.visible })}
              className="p-1 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
              title={layer.visible ? 'مخفی کردن' : 'نمایش'}
            >
              {layer.visible ? (
                <FaEye className="w-4 h-4" />
              ) : (
                <FaEyeSlash className="w-4 h-4" />
              )}
            </button>
            
            {/* Lock Toggle */}
            <button
              type="button"
              onClick={() => onLayerUpdate(layer.id, { locked: !layer.locked })}
              className={`p-1 transition-colors ${
                layer.locked
                  ? 'text-yellow-600 dark:text-yellow-400'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
              title={layer.locked ? 'قفل شده' : 'قفل کردن'}
            >
              {layer.locked ? (
                <FaLock className="w-4 h-4" />
              ) : (
                <FaUnlock className="w-4 h-4" />
              )}
            </button>
            
            {/* Layer Name */}
            <input
              type="text"
              value={layer.name}
              onChange={(e) => onLayerUpdate(layer.id, { name: e.target.value })}
              disabled={layer.locked}
              className={`flex-1 px-2 py-1 text-sm border rounded bg-white dark:bg-gray-700 text-gray-800 dark:text-white ${
                layer.locked
                  ? 'border-gray-300 dark:border-gray-600 opacity-50 cursor-not-allowed'
                  : 'border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-indigo-500 focus:border-transparent'
              }`}
              placeholder="نام لایه"
            />
            
            {/* Activate Button */}
            <button
              type="button"
              onClick={() => onLayerSelect(layer.id)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                activeLayer === layer.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500'
              }`}
              title="فعال کردن"
            >
              فعال
            </button>
            
            {/* Delete Button */}
            {layers.length > 1 && (
              <button
                type="button"
                onClick={() => onLayerDelete(layer.id)}
                disabled={layer.locked}
                className={`p-1 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors ${
                  layer.locked ? 'opacity-50 cursor-not-allowed' : ''
                }`}
                title="حذف لایه"
              >
                <FaTrash className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
      </div>
      
      {layers.length === 0 && (
        <div className="text-center py-4 text-sm text-gray-500 dark:text-gray-400">
          هیچ لایه‌ای وجود ندارد
        </div>
      )}
    </div>
  );
}


