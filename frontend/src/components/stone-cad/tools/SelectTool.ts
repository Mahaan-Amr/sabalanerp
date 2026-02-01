/**
 * Selection Tool
 * Allows users to select and move objects on the canvas
 */

import { BaseTool, ToolContext } from './BaseTool';
import { KonvaEventObject } from 'konva/lib/Node';
import Konva from 'konva';

export class SelectTool extends BaseTool {
  name = 'select';
  icon = 'FaHandPointer';
  displayName = 'انتخاب';
  
  private isSelecting = false;
  private selectionBox: any = null; // Konva.Rect
  private startPoint: { x: number; y: number } | null = null;
  
  onMouseDown(e: KonvaEventObject<MouseEvent | TouchEvent>, context: ToolContext) {
    const stage = e.target.getStage();
    if (!stage) return;
    
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    
    // Check if clicking on a shape
    const clickedOnShape = e.target !== stage && e.target !== context.layer;
    
    if (clickedOnShape) {
      // Select the clicked shape
      const shapeId = e.target.id();
      if (shapeId && context.setSelectedObjects) {
        context.setSelectedObjects([shapeId]);
      }
      return;
    }
    
    // Start selection box
    this.isSelecting = true;
    this.startPoint = pointer;
    
    this.selectionBox = new Konva.Rect({
      x: pointer.x,
      y: pointer.y,
      width: 0,
      height: 0,
      fill: 'rgba(59, 130, 246, 0.1)',
      stroke: '#3b82f6',
      strokeWidth: 1,
      dash: [5, 5],
      listening: false
    });
    
    context.layer.add(this.selectionBox);
    context.layer.draw();
  }
  
  onMouseMove(e: KonvaEventObject<MouseEvent | TouchEvent>, context: ToolContext) {
    if (!this.isSelecting || !this.startPoint || !this.selectionBox) return;
    
    const stage = e.target.getStage();
    if (!stage) return;
    
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    
    // Update selection box
    const width = Math.abs(pointer.x - this.startPoint.x);
    const height = Math.abs(pointer.y - this.startPoint.y);
    const x = Math.min(this.startPoint.x, pointer.x);
    const y = Math.min(this.startPoint.y, pointer.y);
    
    this.selectionBox.setAttrs({ x, y, width, height });
    context.layer.draw();
  }
  
  onMouseUp(e: KonvaEventObject<MouseEvent | TouchEvent>, context: ToolContext) {
    if (!this.isSelecting || !this.selectionBox) return;
    
    // Remove selection box
    this.selectionBox.destroy();
    this.selectionBox = null;
    this.isSelecting = false;
    this.startPoint = null;
    
    context.layer.draw();
  }
  
  getCursor(): string {
    return 'default';
  }
}

