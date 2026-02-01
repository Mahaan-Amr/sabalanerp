/**
 * Freehand Drawing Tool (Pencil)
 * Allows users to draw freehand strokes on the canvas
 */

import { BaseTool, ToolContext } from './BaseTool';
import { KonvaEventObject } from 'konva/lib/Node';
import Konva from 'konva';
import { canvasToReal } from '../utils/coordinateUtils';
import { CADShape } from '../types/CADTypes';

export class FreehandTool extends BaseTool {
  name = 'freehand';
  icon = 'FaPencilAlt';
  displayName = 'قلم';
  
  private isDrawing = false;
  private points: number[] = [];
  private tempLine: any = null; // Konva.Line
  
  onMouseDown(e: KonvaEventObject<MouseEvent | TouchEvent>, context: ToolContext) {
    const stage = e.target.getStage();
    if (!stage) return;
    
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    
    // Apply snap to grid if enabled (only for start point)
    const gridManager = (context as any).gridManager;
    let snappedPoint = { x: pointer.x, y: pointer.y };
    if (gridManager && gridManager.isSnapEnabled()) {
      snappedPoint = gridManager.snapToGrid(pointer.x, pointer.y, context.coordSystem);
    }
    
    this.isDrawing = true;
    this.points = [snappedPoint.x, snappedPoint.y];
    
    // Create temporary line for preview
    this.tempLine = new Konva.Line({
      points: this.points,
      stroke: '#000000', // Black
      strokeWidth: 2,
      lineCap: 'round',
      lineJoin: 'round',
      tension: 0.5, // Smooth curves
      listening: false // Don't interfere with mouse events
    });
    
    context.layer.add(this.tempLine);
    context.layer.draw();
  }
  
  onMouseMove(e: KonvaEventObject<MouseEvent | TouchEvent>, context: ToolContext) {
    if (!this.isDrawing || !this.tempLine) return;
    
    const stage = e.target.getStage();
    if (!stage) return;
    
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    
    // For freehand, we don't snap to grid during drawing (only start point)
    // Add point to the path
    this.points.push(pointer.x, pointer.y);
    
    // Update temporary line
    this.tempLine.points(this.points);
    context.layer.draw();
  }
  
  onMouseUp(e: KonvaEventObject<MouseEvent | TouchEvent>, context: ToolContext) {
    if (!this.isDrawing || !this.tempLine || this.points.length < 4) return;
    
    // Only create shape if it has meaningful length (at least 2 points)
    if (this.points.length < 4) {
      this.tempLine.destroy();
      this.tempLine = null;
      this.isDrawing = false;
      this.points = [];
      context.layer.draw();
      return;
    }
    
    // Convert points to real coordinates
    const realPoints: number[] = [];
    for (let i = 0; i < this.points.length; i += 2) {
      const realPoint = canvasToReal(this.points[i], this.points[i + 1], context.coordSystem);
      realPoints.push(realPoint.x, realPoint.y);
    }
    
    // Create permanent freehand shape
    const shape: CADShape = {
      id: `freehand-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'freehand',
      x: realPoints[0], // First point x
      y: realPoints[1], // First point y
      points: realPoints,
      stroke: '#000000',
      strokeWidth: 2,
      layer: context.cadState.activeLayer,
      metadata: {
        representsCut: false // Freehand is typically for annotations
      }
    };
    
    // Remove temporary line
    this.tempLine.destroy();
    this.tempLine = null;
    this.isDrawing = false;
    this.points = [];
    
    // Add to state
    context.addShape(shape);
    context.layer.draw();
  }
  
  getCursor(): string {
    return 'crosshair';
  }
}

