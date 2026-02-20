/**
 * Export Utilities
 * Functions for exporting CAD designs to various formats
 */

import { CADState, CoordinateSystem } from '../types/CADTypes';
import { realToCanvas, realLengthToCanvas } from './coordinateUtils';

/**
 * Export canvas to PNG image
 */
export function exportToPNG(
  stage: any, // Konva.Stage
  filename: string = 'cad-design.png',
  options: {
    pixelRatio?: number;
    mimeType?: string;
    quality?: number;
  } = {}
): void {
  const {
    pixelRatio = 2, // High DPI for better quality
    mimeType = 'image/png',
    quality = 1.0
  } = options;

  try {
    const dataURL = stage.toDataURL({
      pixelRatio,
      mimeType,
      quality
    });

    // Create download link
    const link = document.createElement('a');
    link.download = filename;
    link.href = dataURL;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (error) {
    console.error('Error exporting to PNG:', error);
    throw new Error('Failed to export to PNG');
  }
}

/**
 * Export design to SVG
 */
export function exportToSVG(
  cadState: CADState,
  coordSystem: CoordinateSystem,
  canvasWidth: number,
  canvasHeight: number,
  stoneBackgrounds?: any[] // Stone background info
): string {
  let svg = `<svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">\n`;
  
  // Add styles
  svg += `  <defs>\n`;
  svg += `    <style>\n`;
  svg += `      .shape { stroke-width: 2; }\n`;
  svg += `      .measurement { stroke: #10b981; stroke-dasharray: 5,5; }\n`;
  svg += `      .grid { stroke: #ddd; stroke-width: 0.5; opacity: 0.5; }\n`;
  svg += `    </style>\n`;
  svg += `  </defs>\n`;
  
  // Add stone backgrounds if provided
  if (stoneBackgrounds && stoneBackgrounds.length > 0) {
    stoneBackgrounds.forEach((stone, index) => {
      svg += `  <rect x="${stone.x}" y="${stone.y}" width="${stone.width}" height="${stone.height}" fill="#e8e8e8" stroke="#333" stroke-width="2" rx="4" />\n`;
    });
  }
  
  // Add shapes (only from visible layers)
  const visibleLayerIds = new Set(
    cadState.layers.filter(layer => layer.visible).map(layer => layer.id)
  );
  
  cadState.shapes
    .filter(shape => visibleLayerIds.has(shape.layer))
    .forEach(shape => {
      const canvasPos = realToCanvas(shape.x, shape.y, coordSystem);
      
      switch (shape.type) {
        case 'rectangle':
          const canvasWidth = realLengthToCanvas(shape.width || 0, coordSystem);
          const canvasHeight = realLengthToCanvas(shape.height || 0, coordSystem);
          svg += `  <rect x="${canvasPos.x}" y="${canvasPos.y}" width="${canvasWidth}" height="${canvasHeight}" fill="${shape.fill || 'rgba(59, 130, 246, 0.2)'}" stroke="${shape.stroke || '#3b82f6'}" stroke-width="${shape.strokeWidth || 2}" class="shape" />\n`;
          break;
        case 'circle':
          if (shape.radius) {
            const canvasRadius = realLengthToCanvas(shape.radius, coordSystem);
            svg += `  <circle cx="${canvasPos.x}" cy="${canvasPos.y}" r="${canvasRadius}" fill="${shape.fill || 'rgba(0, 0, 255, 0.3)'}" stroke="${shape.stroke || 'blue'}" stroke-width="${shape.strokeWidth || 2}" class="shape" />\n`;
          }
          break;
        case 'line':
          if (shape.points && shape.points.length >= 4) {
            const canvasStart = realToCanvas(shape.points[0], shape.points[1], coordSystem);
            const canvasEnd = realToCanvas(shape.points[2], shape.points[3], coordSystem);
            svg += `  <line x1="${canvasStart.x}" y1="${canvasStart.y}" x2="${canvasEnd.x}" y2="${canvasEnd.y}" stroke="${shape.stroke || '#ef4444'}" stroke-width="${shape.strokeWidth || 2}" class="shape" />\n`;
          }
          break;
        case 'freehand':
          if (shape.points && shape.points.length >= 4) {
            const points = shape.points.map((coord, index) => {
              if (index % 2 === 0) {
                // x coordinate
                const realX = coord;
                const canvasX = realToCanvas(realX, 0, coordSystem).x;
                return canvasX;
              } else {
                // y coordinate
                const realY = coord;
                const canvasY = realToCanvas(0, realY, coordSystem).y;
                return canvasY;
              }
            }).join(' ');
            svg += `  <polyline points="${points}" fill="none" stroke="${shape.stroke || '#000'}" stroke-width="${shape.strokeWidth || 2}" stroke-linecap="round" stroke-linejoin="round" class="shape" />\n`;
          }
          break;
        case 'text':
          svg += `  <text x="${canvasPos.x}" y="${canvasPos.y}" font-size="${shape.fontSize || 16}" fill="${shape.fill || shape.stroke || '#000'}" font-family="Arial" class="shape">${(shape.text || '??').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</text>\n`;
          break;
      }
    });
  
  // Add measurements
  cadState.measurements.forEach(measurement => {
    const start = realToCanvas(measurement.startX, measurement.startY, coordSystem);
    const end = realToCanvas(measurement.endX, measurement.endY, coordSystem);
    const labelPos = realToCanvas(measurement.labelX, measurement.labelY, coordSystem);
    
    svg += `  <line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" class="measurement" />\n`;
    svg += `  <text x="${labelPos.x + 5}" y="${labelPos.y + 5}" font-size="12" fill="#10b981">${measurement.distance.toFixed(1)} cm</text>\n`;
  });
  
  svg += `</svg>`;
  return svg;
}

/**
 * Download SVG as file
 */
export function downloadSVG(svgContent: string, filename: string = 'cad-design.svg'): void {
  const blob = new Blob([svgContent], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = filename;
  link.href = url;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export design to JSON
 */
export function exportToJSON(
  cadState: CADState,
  metadata?: {
    productType?: string;
    stoneDimensions?: {
      length: number;
      width: number;
    };
  }
): string {
  const exportData = {
    version: '1.0',
    shapes: cadState.shapes,
    measurements: cadState.measurements,
    layers: cadState.layers,
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: cadState.lastModified.toISOString(),
      productType: metadata?.productType || 'unknown',
      stoneDimensions: metadata?.stoneDimensions || {},
      gridVisible: cadState.gridVisible,
      gridSize: cadState.gridSize,
      snapEnabled: cadState.snapEnabled
    }
  };
  
  return JSON.stringify(exportData, null, 2);
}

/**
 * Download JSON as file
 */
export function downloadJSON(jsonContent: string, filename: string = 'cad-design.json'): void {
  const blob = new Blob([jsonContent], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = filename;
  link.href = url;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Import design from JSON
 */
export function importFromJSON(jsonContent: string): {
  shapes: any[];
  measurements: any[];
  layers: any[];
  metadata: any;
} {
  try {
    const data = JSON.parse(jsonContent);
    return {
      shapes: data.shapes || [],
      measurements: data.measurements || [],
      layers: data.layers || [],
      metadata: data.metadata || {}
    };
  } catch (error) {
    console.error('Error importing from JSON:', error);
    throw new Error('Failed to import JSON: Invalid format');
  }
}



