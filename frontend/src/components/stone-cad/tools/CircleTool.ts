/**
 * Circle Drawing Tool
 * Allows users to draw circles on the canvas
 */

import { BaseTool, ToolContext } from './BaseTool';
import { KonvaEventObject } from 'konva/lib/Node';
import Konva from 'konva';
import { canvasToReal, canvasLengthToReal } from '../utils/coordinateUtils';
import { CADShape } from '../types/CADTypes';

export class CircleTool extends BaseTool {
  name = 'circle';
  icon = 'FaCircle';
  displayName = 'دایره';
  
  private isDrawing = false;
  private centerPoint: { x: number; y: number } | null = null;
  private tempCircle: any = null; // Konva.Circle
  
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
    this.centerPoint = snappedPoint;
    
    // Create temporary circle for preview
    this.tempCircle = new Konva.Circle({
      x: snappedPoint.x,
      y: snappedPoint.y,
      radius: 0,
      fill: 'rgba(139, 92, 246, 0.2)', // Purple with transparency
      stroke: '#8b5cf6', // Purple
      strokeWidth: 2,
      dash: [5, 5],
      listening: false // Don't interfere with mouse events
    });
    
    context.layer.add(this.tempCircle);
    context.layer.draw();
  }
  
  onMouseMove(e: KonvaEventObject<MouseEvent | TouchEvent>, context: ToolContext) {
    if (!this.isDrawing || !this.centerPoint || !this.tempCircle) return;
    
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
    
    // Calculate radius
    const dx = snappedPoint.x - this.centerPoint.x;
    const dy = snappedPoint.y - this.centerPoint.y;
    const radius = Math.sqrt(dx * dx + dy * dy);
    
    // Update temporary circle
    this.tempCircle.radius(radius);
    context.layer.draw();
  }
  
  onMouseUp(e: KonvaEventObject<MouseEvent | TouchEvent>, context: ToolContext) {
    if (!this.isDrawing || !this.centerPoint || !this.tempCircle) return;
    
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
    
    // Calculate final radius
    const dx = snappedPoint.x - this.centerPoint.x;
    const dy = snappedPoint.y - this.centerPoint.y;
    const pixelRadius = Math.sqrt(dx * dx + dy * dy);
    const realRadius = canvasLengthToReal(pixelRadius, context.coordSystem);
    
    // Only create shape if it has meaningful size (at least 5px radius)
    if (pixelRadius < 5) {
      this.tempCircle.destroy();
      this.tempCircle = null;
      this.isDrawing = false;
      this.centerPoint = null;
      context.layer.draw();
      return;
    }
    
    // Convert center to real coordinates
    const realCenter = canvasToReal(this.centerPoint.x, this.centerPoint.y, context.coordSystem);
    
    // Create permanent circle shape
    const shape: CADShape = {
      id: `circle-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'circle',
      x: realCenter.x,
      y: realCenter.y,
      radius: realRadius,
      fill: 'rgba(139, 92, 246, 0.2)',
      stroke: '#8b5cf6',
      strokeWidth: 2,
      layer: context.cadState.activeLayer,
      metadata: {
        representsCut: false, // Circles are typically annotations, not cuts
        dimensions: {
          // Calculate area for circle
          squareMeters: (Math.PI * realRadius * realRadius) / 10000
        }
      }
    };
    
    // Remove temporary circle
    this.tempCircle.destroy();
    this.tempCircle = null;
    this.isDrawing = false;
    this.centerPoint = null;
    
    // Add to state
    context.addShape(shape);
    context.layer.draw();
  }
  
  getCursor(): string {
    return 'crosshair';
  }
}

