/**
 * Line Drawing Tool
 * Allows users to draw straight lines on the canvas
 */

import { BaseTool, ToolContext } from './BaseTool';
import { KonvaEventObject } from 'konva/lib/Node';
import Konva from 'konva';
import { canvasToReal } from '../utils/coordinateUtils';
import { CADShape } from '../types/CADTypes';

export class LineTool extends BaseTool {
  name = 'line';
  icon = 'FaMinus';
  displayName = 'خط';
  
  private isDrawing = false;
  private startPoint: { x: number; y: number } | null = null;
  private tempLine: any = null; // Konva.Line
  
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
    
    // Create temporary line for preview
    this.tempLine = new Konva.Line({
      points: [snappedPoint.x, snappedPoint.y, snappedPoint.x, snappedPoint.y],
      stroke: '#ef4444', // Red
      strokeWidth: 2,
      dash: [5, 5],
      listening: false // Don't interfere with mouse events
    });
    
    context.layer.add(this.tempLine);
    context.layer.draw();
  }
  
  onMouseMove(e: KonvaEventObject<MouseEvent | TouchEvent>, context: ToolContext) {
    if (!this.isDrawing || !this.startPoint || !this.tempLine) return;
    
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
    
    // Update temporary line
    this.tempLine.points([this.startPoint.x, this.startPoint.y, snappedPoint.x, snappedPoint.y]);
    context.layer.draw();
  }
  
  onMouseUp(e: KonvaEventObject<MouseEvent | TouchEvent>, context: ToolContext) {
    if (!this.isDrawing || !this.startPoint || !this.tempLine) return;
    
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
    
    // Calculate line length
    const dx = snappedPoint.x - this.startPoint.x;
    const dy = snappedPoint.y - this.startPoint.y;
    const pixelLength = Math.sqrt(dx * dx + dy * dy);
    
    // Only create shape if it has meaningful length (at least 5px)
    if (pixelLength < 5) {
      this.tempLine.destroy();
      this.tempLine = null;
      this.isDrawing = false;
      this.startPoint = null;
      context.layer.draw();
      return;
    }
    
    // Convert to real coordinates
    const realStart = canvasToReal(this.startPoint.x, this.startPoint.y, context.coordSystem);
    const realEnd = canvasToReal(snappedPoint.x, snappedPoint.y, context.coordSystem);
    
    // Create permanent line shape (stored as points array)
    const shape: CADShape = {
      id: `line-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'line',
      x: realStart.x,
      y: realStart.y,
      points: [realStart.x, realStart.y, realEnd.x, realEnd.y],
      stroke: '#ef4444',
      strokeWidth: 2,
      layer: context.cadState.activeLayer,
      metadata: {
        representsCut: false // Lines are typically annotations
      }
    };
    
    // Remove temporary line
    this.tempLine.destroy();
    this.tempLine = null;
    this.isDrawing = false;
    this.startPoint = null;
    
    // Add to state
    context.addShape(shape);
    context.layer.draw();
  }
  
  getCursor(): string {
    return 'crosshair';
  }
}

