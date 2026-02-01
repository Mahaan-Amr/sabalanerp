/**
 * Rectangle Drawing Tool
 * Allows users to draw rectangles on the canvas
 */

import { BaseTool, ToolContext } from './BaseTool';
import { KonvaEventObject } from 'konva/lib/Node';
import Konva from 'konva';
import { canvasToReal, realToCanvas } from '../utils/coordinateUtils';
import { CADShape } from '../types/CADTypes';

export class RectangleTool extends BaseTool {
  name = 'rectangle';
  icon = 'FaSquare';
  displayName = 'مستطیل';
  
  private isDrawing = false;
  private startPoint: { x: number; y: number } | null = null;
  private tempRect: any = null; // Konva.Rect
  
  onMouseDown(e: KonvaEventObject<MouseEvent | TouchEvent>, context: ToolContext) {
    const stage = e.target.getStage();
    if (!stage) return;
    
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    
    // Apply snap to grid if enabled
    const gridManager = (context as any).gridManager;
    let snappedPoint = { x: pointer.x, y: pointer.y };
    if (gridManager && gridManager.isSnapEnabled()) {
      snappedPoint = gridManager.snapToGrid(pointer.x, pointer.y, context.coordSystem);
    }
    
    this.isDrawing = true;
    this.startPoint = snappedPoint;
    
    // Create temporary rectangle for preview
    this.tempRect = new Konva.Rect({
      x: snappedPoint.x,
      y: snappedPoint.y,
      width: 0,
      height: 0,
      fill: 'rgba(59, 130, 246, 0.2)', // Blue with transparency
      stroke: '#3b82f6', // Blue
      strokeWidth: 2,
      dash: [5, 5],
      listening: false // Don't interfere with mouse events
    });
    
    context.layer.add(this.tempRect);
    context.layer.draw();
  }
  
  onMouseMove(e: KonvaEventObject<MouseEvent | TouchEvent>, context: ToolContext) {
    if (!this.isDrawing || !this.startPoint || !this.tempRect) return;
    
    const stage = e.target.getStage();
    if (!stage) return;
    
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    
    // Apply snap to grid if enabled
    const gridManager = (context as any).gridManager;
    let snappedPoint = { x: pointer.x, y: pointer.y };
    if (gridManager && gridManager.isSnapEnabled()) {
      snappedPoint = gridManager.snapToGrid(pointer.x, pointer.y, context.coordSystem);
    }
    
    // Calculate rectangle dimensions
    const width = Math.abs(snappedPoint.x - this.startPoint.x);
    const height = Math.abs(snappedPoint.y - this.startPoint.y);
    const x = Math.min(this.startPoint.x, snappedPoint.x);
    const y = Math.min(this.startPoint.y, snappedPoint.y);
    
    // Update temporary rectangle
    this.tempRect.setAttrs({ x, y, width, height });
    context.layer.draw();
  }
  
  onMouseUp(e: KonvaEventObject<MouseEvent | TouchEvent>, context: ToolContext) {
    if (!this.isDrawing || !this.startPoint || !this.tempRect) return;
    
    const stage = e.target.getStage();
    if (!stage) return;
    
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    
    // Apply snap to grid if enabled
    const gridManager = (context as any).gridManager;
    let snappedPoint = { x: pointer.x, y: pointer.y };
    if (gridManager && gridManager.isSnapEnabled()) {
      snappedPoint = gridManager.snapToGrid(pointer.x, pointer.y, context.coordSystem);
    }
    
    // Calculate final dimensions
    const width = Math.abs(snappedPoint.x - this.startPoint.x);
    const height = Math.abs(snappedPoint.y - this.startPoint.y);
    const x = Math.min(this.startPoint.x, snappedPoint.x);
    const y = Math.min(this.startPoint.y, snappedPoint.y);
    
    // Only create shape if it has meaningful size (at least 5px)
    if (width < 5 && height < 5) {
      this.tempRect.destroy();
      this.tempRect = null;
      this.isDrawing = false;
      this.startPoint = null;
      context.layer.draw();
      return;
    }
    
    // Convert to real coordinates
    const realStart = canvasToReal(x, y, context.coordSystem);
    const realEnd = canvasToReal(x + width, y + height, context.coordSystem);
    const realWidth = Math.abs(realEnd.x - realStart.x);
    const realHeight = Math.abs(realEnd.y - realStart.y);
    
    // Create permanent rectangle shape
    const shape: CADShape = {
      id: `rect-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'rectangle',
      x: realStart.x,
      y: realStart.y,
      width: realWidth,
      height: realHeight,
      fill: 'rgba(59, 130, 246, 0.2)',
      stroke: '#3b82f6',
      strokeWidth: 2,
      layer: context.cadState.activeLayer,
      metadata: {
        representsCut: true,
        dimensions: {
          length: realHeight / 100, // Convert cm to meters
          width: realWidth,
          squareMeters: (realWidth * realHeight) / 10000
        }
      }
    };
    
    // Remove temporary rectangle
    this.tempRect.destroy();
    this.tempRect = null;
    this.isDrawing = false;
    this.startPoint = null;
    
    // Add to state
    context.addShape(shape);
    context.layer.draw();
    
    // Trigger dimension calculation callback if available
    if (shape.metadata?.dimensions) {
      const dims = shape.metadata.dimensions;
      const onDimensionsCalculated = (context as any).onDimensionsCalculated;
      if (onDimensionsCalculated) {
        onDimensionsCalculated({
          length: dims.length,
          width: dims.width,
          squareMeters: dims.squareMeters
        });
      }
    }
  }
  
  getCursor(): string {
    return 'crosshair';
  }
}

