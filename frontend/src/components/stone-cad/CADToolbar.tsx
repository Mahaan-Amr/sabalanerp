/**
 * CAD Toolbar Component
 * Tool selection and controls
 */

'use client';

import React from 'react';
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
  { id: 'freehand', icon: FaPencilAlt, label: 'قلم' },
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
    <div className="cad-toolbar bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-3 flex items-center gap-2 flex-wrap">
      {/* Tool Selection */}
      <div className="flex items-center gap-1 border-r border-gray-200 dark:border-gray-700 pr-3">
        {tools.map(tool => {
          const Icon = tool.icon;
          return (
            <button
              key={tool.id}
              type="button"
              onClick={() => onToolChange(tool.id)}
              className={`p-2 rounded-lg transition-colors ${
                selectedTool === tool.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
              title={tool.label}
            >
              <Icon className="w-5 h-5" />
            </button>
          );
        })}
      </div>
      
      {/* Grid Controls */}
      <div className="flex items-center gap-1 border-r border-gray-200 dark:border-gray-700 pr-3">
        <button
          type="button"
          onClick={onToggleGrid}
          className={`p-2 rounded-lg transition-colors ${
            gridVisible
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
          title="نمایش/مخفی کردن شبکه"
        >
          <FaThLarge className="w-5 h-5" />
        </button>
        
        <button
          type="button"
          onClick={onToggleSnap}
          className={`p-2 rounded-lg transition-colors ${
            snapEnabled
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
          title="چسبیدن به شبکه"
        >
          <FaLink className="w-5 h-5" />
        </button>
      </div>
      
      {/* Layers Toggle */}
      {onToggleLayers && (
        <div className="flex items-center gap-1 border-r border-gray-200 dark:border-gray-700 pr-3">
          <button
            type="button"
            onClick={onToggleLayers}
            className={`p-2 rounded-lg transition-colors ${
              showLayersPanel
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
            title="نمایش/مخفی کردن پنل لایه‌ها"
          >
            <FaLayerGroup className="w-5 h-5" />
          </button>
        </div>
      )}
      
      {/* Export */}
      {onExport && (
        <div className="flex items-center gap-1 border-r border-gray-200 dark:border-gray-700 pr-3">
          <div className="relative group">
            <button
              type="button"
              className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              title="خروجی گرفتن"
            >
              <FaDownload className="w-5 h-5" />
            </button>
            <div className="absolute left-0 mt-2 w-32 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
              <button
                type="button"
                onClick={() => onExport('png')}
                className="w-full text-right px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-t-lg"
              >
                PNG
              </button>
              <button
                type="button"
                onClick={() => onExport('svg')}
                className="w-full text-right px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                SVG
              </button>
              <button
                type="button"
                onClick={() => onExport('json')}
                className="w-full text-right px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-b-lg"
              >
                JSON
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Undo/Redo */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          className={`p-2 rounded-lg transition-colors ${
            canUndo
              ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-600 cursor-not-allowed'
          }`}
          title="بازگشت"
        >
          <FaUndo className="w-5 h-5" />
        </button>
        
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          className={`p-2 rounded-lg transition-colors ${
            canRedo
              ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-600 cursor-not-allowed'
          }`}
          title="بازگشت به جلو"
        >
          <FaRedo className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

