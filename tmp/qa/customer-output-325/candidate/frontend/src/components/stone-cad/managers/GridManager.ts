/**
 * Grid Manager
 * Handles grid rendering and snap-to-grid functionality
 */

import { CoordinateSystem } from '../types/CADTypes';
import { realToCanvas, canvasToReal } from '../utils/coordinateUtils';

export class GridManager {
  private visible: boolean = true;
  private size: number = 10; // 10cm grid by default
  private color: string = '#ddd';
  private snapEnabled: boolean = true;
  
  constructor(initialSize: number = 10) {
    this.size = initialSize;
  }
  
  setVisible(visible: boolean) {
    this.visible = visible;
  }
  
  isVisible(): boolean {
    return this.visible;
  }
  
  setSize(size: number) {
    this.size = size;
  }
  
  getSize(): number {
    return this.size;
  }
  
  setSnapEnabled(enabled: boolean) {
    this.snapEnabled = enabled;
  }
  
  isSnapEnabled(): boolean {
    return this.snapEnabled;
  }
  
  /**
   * Generate grid lines for rendering
   */
  getGridLines(
    canvasWidth: number,
    canvasHeight: number,
    coordSystem: CoordinateSystem
  ): Array<{ points: number[] }> {
    if (!this.visible) return [];
    
    const lines: Array<{ points: number[] }> = [];
    
    // Calculate real-world bounds
    const topLeft = canvasToReal(0, 0, coordSystem);
    const bottomRight = canvasToReal(canvasWidth, canvasHeight, coordSystem);
    
    // Vertical lines
    const startX = Math.floor(topLeft.x / this.size) * this.size;
    const endX = Math.ceil(bottomRight.x / this.size) * this.size;
    
    for (let x = startX; x <= endX; x += this.size) {
      const canvasStart = realToCanvas(x, topLeft.y, coordSystem);
      const canvasEnd = realToCanvas(x, bottomRight.y, coordSystem);
      lines.push({
        points: [canvasStart.x, canvasStart.y, canvasEnd.x, canvasEnd.y]
      });
    }
    
    // Horizontal lines
    const startY = Math.floor(topLeft.y / this.size) * this.size;
    const endY = Math.ceil(bottomRight.y / this.size) * this.size;
    
    for (let y = startY; y <= endY; y += this.size) {
      const canvasStart = realToCanvas(topLeft.x, y, coordSystem);
      const canvasEnd = realToCanvas(bottomRight.x, y, coordSystem);
      lines.push({
        points: [canvasStart.x, canvasStart.y, canvasEnd.x, canvasEnd.y]
      });
    }
    
    return lines;
  }
  
  /**
   * Snap point to nearest grid intersection
   */
  snapToGrid(
    x: number,
    y: number,
    coordSystem: CoordinateSystem
  ): { x: number; y: number } {
    if (!this.snapEnabled) {
      return { x, y };
    }
    
    const real = canvasToReal(x, y, coordSystem);
    const snappedX = Math.round(real.x / this.size) * this.size;
    const snappedY = Math.round(real.y / this.size) * this.size;
    return realToCanvas(snappedX, snappedY, coordSystem);
  }
  
  /**
   * Get grid color
   */
  getColor(): string {
    return this.color;
  }
  
  /**
   * Set grid color
   */
  setColor(color: string) {
    this.color = color;
  }
}

