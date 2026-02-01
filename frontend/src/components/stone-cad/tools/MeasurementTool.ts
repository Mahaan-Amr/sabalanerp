/**
 * Measurement Tool
 * Allows users to measure distances on the canvas
 */

import { BaseTool, ToolContext } from './BaseTool';
import { KonvaEventObject } from 'konva/lib/Node';
import Konva from 'konva';
import { canvasToReal, canvasLengthToReal } from '../utils/coordinateUtils';
import { Measurement } from '../types/CADTypes';

export class MeasurementTool extends BaseTool {
  name = 'measurement';
  icon = 'FaRuler';
  displayName = 'اندازه‌گیری';
  
  private isMeasuring = false;
  private startPoint: { x: number; y: number } | null = null;
  private tempLine: any = null; // Konva.Line
  private tempLabel: any = null; // Konva.Text
  
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
    
    this.isMeasuring = true;
    this.startPoint = snappedPoint;
    
    // Create temporary measurement line
    this.tempLine = new Konva.Line({
      points: [snappedPoint.x, snappedPoint.y, snappedPoint.x, snappedPoint.y],
      stroke: '#10b981', // Green
      strokeWidth: 2,
      dash: [5, 5],
      listening: false
    });
    
    // Create temporary label
    this.tempLabel = new Konva.Text({
      text: '0 cm',
      x: snappedPoint.x,
      y: snappedPoint.y - 20,
      fontSize: 12,
      fill: '#10b981',
      backgroundColor: 'white',
      padding: 4,
      listening: false
    });
    
    context.layer.add(this.tempLine, this.tempLabel);
    context.layer.draw();
  }
  
  onMouseMove(e: KonvaEventObject<MouseEvent | TouchEvent>, context: ToolContext) {
    if (!this.isMeasuring || !this.startPoint || !this.tempLine || !this.tempLabel) return;
    
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
    
    // Update line
    this.tempLine.points([this.startPoint.x, this.startPoint.y, snappedPoint.x, snappedPoint.y]);
    
    // Calculate distance
    const dx = snappedPoint.x - this.startPoint.x;
    const dy = snappedPoint.y - this.startPoint.y;
    const pixelDistance = Math.sqrt(dx * dx + dy * dy);
    const realDistance = canvasLengthToReal(pixelDistance, context.coordSystem);
    
    // Update label
    this.tempLabel.text(`${realDistance.toFixed(1)} cm`);
    this.tempLabel.x((this.startPoint.x + snappedPoint.x) / 2 - 30);
    this.tempLabel.y((this.startPoint.y + snappedPoint.y) / 2 - 20);
    
    context.layer.draw();
  }
  
  onMouseUp(e: KonvaEventObject<MouseEvent | TouchEvent>, context: ToolContext) {
    if (!this.isMeasuring || !this.startPoint || !this.tempLine || !this.tempLabel) return;
    
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
    
    // Calculate final distance
    const dx = snappedPoint.x - this.startPoint.x;
    const dy = snappedPoint.y - this.startPoint.y;
    const pixelDistance = Math.sqrt(dx * dx + dy * dy);
    const realDistance = canvasLengthToReal(pixelDistance, context.coordSystem);
    
    // Only create measurement if distance is meaningful (at least 5px)
    if (pixelDistance < 5) {
      this.tempLine.destroy();
      this.tempLabel.destroy();
      this.tempLine = null;
      this.tempLabel = null;
      this.isMeasuring = false;
      this.startPoint = null;
      context.layer.draw();
      return;
    }
    
    // Create permanent measurement
    const measurement: Measurement = {
      id: `measure-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      startX: this.startPoint.x,
      startY: this.startPoint.y,
      endX: snappedPoint.x,
      endY: snappedPoint.y,
      distance: realDistance,
      labelX: (this.startPoint.x + snappedPoint.x) / 2 - 30,
      labelY: (this.startPoint.y + snappedPoint.y) / 2 - 20
    };
    
    // Remove temporary objects
    this.tempLine.destroy();
    this.tempLabel.destroy();
    this.tempLine = null;
    this.tempLabel = null;
    this.isMeasuring = false;
    this.startPoint = null;
    
    // Add to state
    context.addMeasurement(measurement);
    context.layer.draw();
  }
  
  getCursor(): string {
    return 'crosshair';
  }
}

