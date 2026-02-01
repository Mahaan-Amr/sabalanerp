/**
 * Text Tool
 * Allows users to add text annotations on the canvas
 */

import { BaseTool, ToolContext } from './BaseTool';
import { KonvaEventObject } from 'konva/lib/Node';
import Konva from 'konva';
import { canvasToReal } from '../utils/coordinateUtils';
import { CADShape } from '../types/CADTypes';

export class TextTool extends BaseTool {
  name = 'text';
  icon = 'FaFont';
  displayName = 'متن';
  
  private isPlacing = false;
  private tempText: any = null; // Konva.Text
  private defaultText = 'متن';
  
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
    
    this.isPlacing = true;
    
    // Create temporary text for preview
    this.tempText = new Konva.Text({
      x: snappedPoint.x,
      y: snappedPoint.y,
      text: this.defaultText,
      fontSize: 16,
      fill: '#000000',
      fontFamily: 'Arial',
      listening: false // Don't interfere with mouse events
    });
    
    context.layer.add(this.tempText);
    context.layer.draw();
  }
  
  onMouseMove(e: KonvaEventObject<MouseEvent | TouchEvent>, context: ToolContext) {
    // Text tool doesn't need move handling - text is placed on click
    // But we can update position if user is dragging
    if (!this.isPlacing || !this.tempText) return;
    
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
    
    // Update text position
    this.tempText.x(snappedPoint.x);
    this.tempText.y(snappedPoint.y);
    context.layer.draw();
  }
  
  onMouseUp(e: KonvaEventObject<MouseEvent | TouchEvent>, context: ToolContext) {
    if (!this.isPlacing || !this.tempText) return;
    
    const stage = e.target.getStage();
    if (!stage) return;
    
    // Convert to real coordinates
    const realPos = canvasToReal(this.tempText.x(), this.tempText.y(), context.coordSystem);
    
    // Create permanent text shape
    const shape: CADShape = {
      id: `text-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'text',
      x: realPos.x,
      y: realPos.y,
      text: this.defaultText,
      fontSize: 16,
      fill: '#000000',
      layer: context.cadState.activeLayer,
      metadata: {
        representsCut: false // Text is for annotations
      }
    };
    
    // Remove temporary text
    this.tempText.destroy();
    this.tempText = null;
    this.isPlacing = false;
    
    // Add to state
    context.addShape(shape);
    context.layer.draw();
    
    // TODO: In the future, we could open an input dialog to edit the text
    // For now, text is placed with default value and can be edited later
  }
  
  getCursor(): string {
    return 'text';
  }
}

