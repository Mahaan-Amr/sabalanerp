/**
 * Base Tool Interface
 * All drawing tools must extend this base class
 */

import { KonvaEventObject } from 'konva/lib/Node';
import { CADState, CoordinateSystem } from '../types/CADTypes';

export interface ToolContext {
  stage: any; // Konva.Stage
  layer: any; // Konva.Layer
  coordSystem: CoordinateSystem;
  cadState: CADState;
  updateState: (updater: (prev: CADState) => CADState) => void;
  addShape: (shape: any) => void;
  addMeasurement: (measurement: any) => void;
  gridManager?: any; // GridManager instance
  onDimensionsCalculated?: (dimensions: { length?: number; width?: number; squareMeters?: number }) => void;
  setSelectedObjects?: (ids: string[]) => void;
}

export abstract class BaseTool {
  abstract name: string;
  abstract icon: string;
  abstract displayName: string;
  
  protected isActive: boolean = false;
  
  /**
   * Called when tool is activated
   */
  onActivate?(context: ToolContext): void;
  
  /**
   * Called when tool is deactivated
   */
  onDeactivate?(context: ToolContext): void;
  
  /**
   * Handle mouse/touch down event
   */
  abstract onMouseDown(
    e: KonvaEventObject<MouseEvent | TouchEvent>,
    context: ToolContext
  ): void;
  
  /**
   * Handle mouse/touch move event
   */
  abstract onMouseMove(
    e: KonvaEventObject<MouseEvent | TouchEvent>,
    context: ToolContext
  ): void;
  
  /**
   * Handle mouse/touch up event
   */
  abstract onMouseUp(
    e: KonvaEventObject<MouseEvent | TouchEvent>,
    context: ToolContext
  ): void;
  
  /**
   * Get cursor style for this tool
   */
  getCursor(): string {
    return 'default';
  }
  
  /**
   * Check if tool is currently active
   */
  isToolActive(): boolean {
    return this.isActive;
  }
  
  /**
   * Set tool active state
   */
  setActive(active: boolean) {
    this.isActive = active;
  }
}

