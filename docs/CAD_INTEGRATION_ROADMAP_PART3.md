# CAD Integration Roadmap - Part 3: Implementation Plan

## 📋 Table of Contents
1. [Implementation Phases](#implementation-phases)
2. [Phase 1: Foundation](#phase-1-foundation)
3. [Phase 2: Core Tools](#phase-2-core-tools)
4. [Phase 3: Integration](#phase-3-integration)
5. [Phase 4: Advanced Features](#phase-4-advanced-features)

---

## Implementation Phases

### Overview

```
Phase 1: Foundation (2 weeks)
  ├── Setup Konva.js
  ├── Basic canvas
  └── Stone background rendering

Phase 2: Core Tools (3 weeks)
  ├── Rectangle tool
  ├── Measurement tool
  ├── Grid system
  └── Basic selection

Phase 3: Integration (3 weeks)
  ├── Product config integration
  ├── Cost calculation
  ├── Remaining stone integration
  └── Data persistence

Phase 4: Advanced Features (4 weeks)
  ├── Multiple tools
  ├── Layers
  ├── Undo/redo
  └── Export

Total: 12 weeks
```

---

## Phase 1: Foundation (Weeks 1-2)

### Goals
- Set up Konva.js infrastructure
- Render stone backgrounds
- Basic canvas interactions
- Coordinate system

### Tasks

#### Task 1.1: Install Dependencies
```bash
npm install konva react-konva
npm install --save-dev @types/konva
```

**Files to create:**
- `package.json` (update)

---

#### Task 1.2: Create Base Components

**File:** `frontend/src/components/stone-cad/StoneCADDesigner.tsx`

```typescript
'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Stage, Layer, Rect, Text } from 'react-konva';
import { SlabStandardDimensionEntry } from '@/types/contract';

interface StoneCADDesignerProps {
  originalLength: number;
  originalWidth: number;
  lengthUnit: 'cm' | 'm';
  widthUnit: 'cm' | 'm';
  standardDimensions?: SlabStandardDimensionEntry[];
  productType: 'longitudinal' | 'slab';
  mode?: 'design' | 'view';
  onDesignChange?: (design: any) => void;
}

export function StoneCADDesigner({
  originalLength,
  originalWidth,
  lengthUnit,
  widthUnit,
  standardDimensions,
  productType,
  mode = 'design',
  onDesignChange
}: StoneCADDesignerProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  
  // Convert units to canvas coordinates
  const originalLengthCm = lengthUnit === 'm' ? originalLength * 100 : originalLength;
  const originalWidthCm = widthUnit === 'm' ? originalWidth * 100 : originalWidth;
  
  // Calculate canvas size based on stone dimensions
  useEffect(() => {
    const container = stageRef.current?.container();
    if (container) {
      const containerWidth = container.clientWidth || 800;
      const aspectRatio = originalLengthCm / originalWidthCm;
      const canvasHeight = containerWidth / aspectRatio;
      setDimensions({
        width: containerWidth,
        height: Math.max(canvasHeight, 400)
      });
    }
  }, [originalLengthCm, originalWidthCm]);
  
  // Render stone background(s)
  const renderStoneBackgrounds = () => {
    if (productType === 'slab' && standardDimensions && standardDimensions.length > 0) {
      // Multiple stones for slab
      const spacing = 50; // Space between stones
      let currentX = 50;
      
      return standardDimensions.map((entry, index) => {
        const stoneX = currentX;
        const stoneWidth = entry.standardWidthCm;
        const stoneHeight = entry.standardLengthCm * 100; // Convert to cm
        currentX += stoneWidth + spacing;
        
        return (
          <Group key={`stone-${entry.id}`} x={stoneX} y={50}>
            {/* Stone background */}
            <Rect
              width={stoneWidth}
              height={stoneHeight}
              fill="#e8e8e8"
              stroke="#333"
              strokeWidth={2}
              cornerRadius={4}
            />
            
            {/* Stone label */}
            <Text
              text={`${entry.standardLengthCm}×${entry.standardWidthCm}cm`}
              x={10}
              y={10}
              fontSize={14}
              fill="#333"
              fontStyle="bold"
            />
            
            {/* Quantity label */}
            <Text
              text={`تعداد: ${entry.quantity}`}
              x={10}
              y={30}
              fontSize={12}
              fill="#666"
            />
          </Group>
        );
      });
    } else {
      // Single stone for longitudinal
      return (
        <Group x={50} y={50}>
          <Rect
            width={originalWidthCm}
            height={originalLengthCm}
            fill="#e8e8e8"
            stroke="#333"
            strokeWidth={2}
            cornerRadius={4}
          />
          <Text
            text={`${originalLengthCm}×${originalWidthCm}cm`}
            x={10}
            y={10}
            fontSize={14}
            fill="#333"
            fontStyle="bold"
          />
        </Group>
      );
    }
  };
  
  return (
    <div className="stone-cad-designer w-full">
      <div className="cad-canvas-container border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
        <Stage
          ref={stageRef}
          width={dimensions.width}
          height={dimensions.height}
        >
          <Layer>
            {renderStoneBackgrounds()}
          </Layer>
        </Stage>
      </div>
    </div>
  );
}
```

**Deliverable:** Basic canvas with stone backgrounds rendering

---

#### Task 1.3: Coordinate System Utilities

**File:** `frontend/src/components/stone-cad/utils/coordinateUtils.ts`

```typescript
/**
 * Coordinate conversion utilities
 * Handles conversion between real-world units (cm, meters) and canvas pixels
 */

export interface CoordinateSystem {
  scale: number; // Pixels per cm
  originX: number;
  originY: number;
}

/**
 * Initialize coordinate system based on stone dimensions and canvas size
 */
export function initializeCoordinateSystem(
  stoneLengthCm: number,
  stoneWidthCm: number,
  canvasWidth: number,
  canvasHeight: number,
  padding: number = 50
): CoordinateSystem {
  // Calculate available space
  const availableWidth = canvasWidth - (padding * 2);
  const availableHeight = canvasHeight - (padding * 2);
  
  // Calculate scale to fit stone in canvas
  const scaleX = availableWidth / stoneWidthCm;
  const scaleY = availableHeight / stoneLengthCm;
  const scale = Math.min(scaleX, scaleY, 1); // Don't scale up, only down
  
  // Center the stone
  const scaledWidth = stoneWidthCm * scale;
  const scaledHeight = stoneLengthCm * scale;
  const originX = (canvasWidth - scaledWidth) / 2;
  const originY = (canvasHeight - scaledHeight) / 2;
  
  return { scale, originX, originY };
}

/**
 * Convert real-world coordinates (cm) to canvas coordinates (pixels)
 */
export function realToCanvas(
  realX: number, // cm
  realY: number, // cm
  coordSystem: CoordinateSystem
): { x: number; y: number } {
  return {
    x: coordSystem.originX + (realX * coordSystem.scale),
    y: coordSystem.originY + (realY * coordSystem.scale)
  };
}

/**
 * Convert canvas coordinates (pixels) to real-world coordinates (cm)
 */
export function canvasToReal(
  canvasX: number,
  canvasY: number,
  coordSystem: CoordinateSystem
): { x: number; y: number } {
  return {
    x: (canvasX - coordSystem.originX) / coordSystem.scale,
    y: (canvasY - coordSystem.originY) / coordSystem.scale
  };
}

/**
 * Convert length from real units to canvas pixels
 */
export function realLengthToCanvas(
  realLength: number, // cm
  coordSystem: CoordinateSystem
): number {
  return realLength * coordSystem.scale;
}

/**
 * Convert length from canvas pixels to real units
 */
export function canvasLengthToReal(
  canvasLength: number,
  coordSystem: CoordinateSystem
): number {
  return canvasLength / coordSystem.scale;
}
```

**Deliverable:** Coordinate conversion utilities

---

#### Task 1.4: Basic Integration in Product Modal

**File:** `frontend/src/app/dashboard/sales/contracts/create/page.tsx`

**Location:** Add after standard dimensions section (around line 14600)

```typescript
// Add import
import { StoneCADDesigner } from '@/components/stone-cad/StoneCADDesigner';

// Add state for CAD mode
const [showCADDesigner, setShowCADDesigner] = useState(false);

// Add button to toggle CAD designer
{productConfig.productType === 'slab' && (
  <div className="mt-4">
    <button
      type="button"
      onClick={() => setShowCADDesigner(!showCADDesigner)}
      className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
    >
      {showCADDesigner ? 'مخفی کردن' : 'نمایش'} ابزار طراحی
    </button>
    
    {showCADDesigner && (
      <div className="mt-4">
        <StoneCADDesigner
          originalLength={productConfig.length || 0}
          originalWidth={productConfig.width || 0}
          lengthUnit={lengthUnit}
          widthUnit={widthUnit}
          standardDimensions={productConfig.slabStandardDimensions || []}
          productType="slab"
          mode="design"
        />
      </div>
    )}
  </div>
)}
```

**Deliverable:** CAD designer accessible in product modal

---

### Phase 1 Success Criteria
- ✅ Konva.js installed and working
- ✅ Stone backgrounds render correctly
- ✅ Coordinate system works
- ✅ CAD designer appears in product modal
- ✅ No console errors

---

## Phase 2: Core Tools (Weeks 3-5)

### Goals
- Rectangle drawing tool
- Measurement tool
- Grid system
- Basic selection

### Tasks

#### Task 2.1: Tool System Architecture

**File:** `frontend/src/components/stone-cad/tools/BaseTool.ts`

```typescript
import { KonvaEventObject } from 'konva/lib/Node';

export interface ToolContext {
  stage: Konva.Stage;
  layer: Konva.Layer;
  coordSystem: CoordinateSystem;
  cadState: CADState;
  updateState: (updater: (prev: CADState) => CADState) => void;
}

export abstract class BaseTool {
  abstract name: string;
  abstract icon: string;
  
  abstract onMouseDown(
    e: KonvaEventObject<MouseEvent>,
    context: ToolContext
  ): void;
  
  abstract onMouseMove(
    e: KonvaEventObject<MouseEvent>,
    context: ToolContext
  ): void;
  
  abstract onMouseUp(
    e: KonvaEventObject<MouseEvent>,
    context: ToolContext
  ): void;
  
  getCursor(): string {
    return 'default';
  }
}
```

---

#### Task 2.2: Rectangle Tool

**File:** `frontend/src/components/stone-cad/tools/RectangleTool.ts`

```typescript
import { BaseTool, ToolContext } from './BaseTool';
import { KonvaEventObject } from 'konva/lib/Node';
import { canvasToReal, realLengthToCanvas } from '../utils/coordinateUtils';

export class RectangleTool extends BaseTool {
  name = 'rectangle';
  icon = 'FaSquare';
  private isDrawing = false;
  private startPoint: { x: number; y: number } | null = null;
  private tempRect: Konva.Rect | null = null;
  
  onMouseDown(e: KonvaEventObject<MouseEvent>, context: ToolContext) {
    const stage = e.target.getStage();
    if (!stage) return;
    
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    
    this.isDrawing = true;
    this.startPoint = pointer;
    
    // Convert to real coordinates
    const realPoint = canvasToReal(pointer.x, pointer.y, context.coordSystem);
    
    // Create temporary rectangle
    this.tempRect = new Konva.Rect({
      x: pointer.x,
      y: pointer.y,
      width: 0,
      height: 0,
      fill: 'rgba(255, 0, 0, 0.3)',
      stroke: 'red',
      strokeWidth: 2,
      dash: [5, 5]
    });
    
    context.layer.add(this.tempRect);
  }
  
  onMouseMove(e: KonvaEventObject<MouseEvent>, context: ToolContext) {
    if (!this.isDrawing || !this.startPoint || !this.tempRect) return;
    
    const stage = e.target.getStage();
    if (!stage) return;
    
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    
    // Calculate rectangle dimensions
    const width = Math.abs(pointer.x - this.startPoint.x);
    const height = Math.abs(pointer.y - this.startPoint.y);
    const x = Math.min(this.startPoint.x, pointer.x);
    const y = Math.min(this.startPoint.y, pointer.y);
    
    // Update temporary rectangle
    this.tempRect.setAttrs({ x, y, width, height });
    context.layer.draw();
  }
  
  onMouseUp(e: KonvaEventObject<MouseEvent>, context: ToolContext) {
    if (!this.isDrawing || !this.startPoint || !this.tempRect) return;
    
    const stage = e.target.getStage();
    if (!stage) return;
    
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    
    // Calculate final dimensions
    const width = Math.abs(pointer.x - this.startPoint.x);
    const height = Math.abs(pointer.y - this.startPoint.y);
    const x = Math.min(this.startPoint.x, pointer.x);
    const y = Math.min(this.startPoint.y, pointer.y);
    
    // Convert to real coordinates
    const realStart = canvasToReal(x, y, context.coordSystem);
    const realEnd = canvasToReal(x + width, y + height, context.coordSystem);
    const realWidth = Math.abs(realEnd.x - realStart.x);
    const realHeight = Math.abs(realEnd.y - realStart.y);
    
    // Create permanent rectangle shape
    const shape: CADShape = {
      id: `rect-${Date.now()}`,
      type: 'rectangle',
      x: realStart.x,
      y: realStart.y,
      width: realWidth,
      height: realHeight,
      fill: 'rgba(255, 0, 0, 0.3)',
      stroke: 'red',
      strokeWidth: 2,
      layer: context.cadState.activeLayer
    };
    
    // Remove temporary rectangle
    this.tempRect.destroy();
    this.tempRect = null;
    this.isDrawing = false;
    this.startPoint = null;
    
    // Add to state
    context.updateState(prev => ({
      ...prev,
      shapes: [...prev.shapes, shape]
    }));
    
    // Trigger dimension calculation
    this.calculateDimensions(shape, context);
  }
  
  private calculateDimensions(shape: CADShape, context: ToolContext) {
    // Calculate dimensions and trigger callback
    const dimensions = {
      length: shape.height / 100, // Convert cm to meters
      width: shape.width,
      squareMeters: (shape.width * shape.height) / 10000
    };
    
    // This will be connected to onDimensionsCalculated callback
    // For now, we'll add it to the shape metadata
    shape.metadata = { ...shape.metadata, dimensions };
  }
  
  getCursor(): string {
    return 'crosshair';
  }
}
```

**Deliverable:** Rectangle drawing tool working

---

#### Task 2.3: Measurement Tool

**File:** `frontend/src/components/stone-cad/tools/MeasurementTool.ts`

```typescript
import { BaseTool, ToolContext } from './BaseTool';
import { KonvaEventObject } from 'konva/lib/Node';
import { canvasToReal, realLengthToCanvas } from '../utils/coordinateUtils';

export class MeasurementTool extends BaseTool {
  name = 'measurement';
  icon = 'FaRuler';
  private isMeasuring = false;
  private startPoint: { x: number; y: number } | null = null;
  private tempLine: Konva.Line | null = null;
  private tempLabel: Konva.Text | null = null;
  
  onMouseDown(e: KonvaEventObject<MouseEvent>, context: ToolContext) {
    const stage = e.target.getStage();
    if (!stage) return;
    
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    
    this.isMeasuring = true;
    this.startPoint = pointer;
    
    // Create temporary measurement line
    this.tempLine = new Konva.Line({
      points: [pointer.x, pointer.y, pointer.x, pointer.y],
      stroke: '#00ff00',
      strokeWidth: 2,
      dash: [5, 5]
    });
    
    this.tempLabel = new Konva.Text({
      text: '0 cm',
      x: pointer.x,
      y: pointer.y - 20,
      fontSize: 12,
      fill: '#00ff00',
      backgroundColor: 'white',
      padding: 4
    });
    
    context.layer.add(this.tempLine, this.tempLabel);
  }
  
  onMouseMove(e: KonvaEventObject<MouseEvent>, context: ToolContext) {
    if (!this.isMeasuring || !this.startPoint || !this.tempLine || !this.tempLabel) return;
    
    const stage = e.target.getStage();
    if (!stage) return;
    
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    
    // Update line
    this.tempLine.points([this.startPoint.x, this.startPoint.y, pointer.x, pointer.y]);
    
    // Calculate distance
    const dx = pointer.x - this.startPoint.x;
    const dy = pointer.y - this.startPoint.y;
    const pixelDistance = Math.sqrt(dx * dx + dy * dy);
    const realDistance = canvasLengthToReal(pixelDistance, context.coordSystem);
    
    // Update label
    this.tempLabel.text(`${realDistance.toFixed(1)} cm`);
    this.tempLabel.x((this.startPoint.x + pointer.x) / 2 - 30);
    this.tempLabel.y((this.startPoint.y + pointer.y) / 2 - 20);
    
    context.layer.draw();
  }
  
  onMouseUp(e: KonvaEventObject<MouseEvent>, context: ToolContext) {
    if (!this.isMeasuring || !this.startPoint || !this.tempLine || !this.tempLabel) return;
    
    const stage = e.target.getStage();
    if (!stage) return;
    
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    
    // Calculate final distance
    const dx = pointer.x - this.startPoint.x;
    const dy = pointer.y - this.startPoint.y;
    const pixelDistance = Math.sqrt(dx * dx + dy * dy);
    const realDistance = canvasLengthToReal(pixelDistance, context.coordSystem);
    
    // Create permanent measurement
    const measurement: Measurement = {
      id: `measure-${Date.now()}`,
      startX: this.startPoint.x,
      startY: this.startPoint.y,
      endX: pointer.x,
      endY: pointer.y,
      distance: realDistance,
      labelX: (this.startPoint.x + pointer.x) / 2,
      labelY: (this.startPoint.y + pointer.y) / 2 - 20
    };
    
    // Remove temporary objects
    this.tempLine.destroy();
    this.tempLabel.destroy();
    this.tempLine = null;
    this.tempLabel = null;
    this.isMeasuring = false;
    this.startPoint = null;
    
    // Add to state
    context.updateState(prev => ({
      ...prev,
      measurements: [...prev.measurements, measurement]
    }));
  }
  
  getCursor(): string {
    return 'crosshair';
  }
}
```

**Deliverable:** Measurement tool working

---

#### Task 2.4: Grid System

**File:** `frontend/src/components/stone-cad/managers/GridManager.ts`

```typescript
export class GridManager {
  private visible: boolean = true;
  private size: number = 10; // 10cm grid
  private color: string = '#ddd';
  
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
    const realWidth = canvasLengthToReal(canvasWidth, coordSystem);
    const realHeight = canvasLengthToReal(canvasHeight, coordSystem);
    
    // Vertical lines
    for (let x = 0; x <= realWidth; x += this.size) {
      const canvasX = realToCanvas(x, 0, coordSystem).x;
      lines.push({
        points: [canvasX, 0, canvasX, canvasHeight]
      });
    }
    
    // Horizontal lines
    for (let y = 0; y <= realHeight; y += this.size) {
      const canvasY = realToCanvas(0, y, coordSystem).y;
      lines.push({
        points: [0, canvasY, canvasWidth, canvasY]
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
    const real = canvasToReal(x, y, coordSystem);
    const snappedX = Math.round(real.x / this.size) * this.size;
    const snappedY = Math.round(real.y / this.size) * this.size;
    return realToCanvas(snappedX, snappedY, coordSystem);
  }
}
```

**Deliverable:** Grid system working

---

### Phase 2 Success Criteria
- ✅ Rectangle tool draws shapes
- ✅ Measurement tool shows distances
- ✅ Grid displays correctly
- ✅ Snap-to-grid works
- ✅ Shapes persist in state

---

## Phase 3: Integration (Weeks 6-8)

### Goals
- Integrate with product config
- Connect to cost calculation
- Remaining stone integration
- Data persistence

### Tasks

#### Task 3.1: Dimension Extraction & Sync

**File:** `frontend/src/components/stone-cad/utils/costCalculationUtils.ts`

```typescript
import { CADShape, CADState } from '../types/CADTypes';
import { calculateSlabCutting } from '@/app/dashboard/sales/contracts/create/page';

/**
 * Extract dimensions from CAD design
 */
export function extractDimensionsFromDesign(
  cadState: CADState,
  productType: 'longitudinal' | 'slab'
): {
  length?: number;
  width?: number;
  squareMeters?: number;
  shapes: Array<{ type: string; dimensions: any }>;
} {
  // Find all rectangle shapes (representing desired cuts)
  const rectangles = cadState.shapes.filter(s => s.type === 'rectangle');
  
  if (rectangles.length === 0) {
    return { shapes: [] };
  }
  
  // For now, use the largest rectangle as the desired dimension
  // In future, can support multiple pieces
  const largestRect = rectangles.reduce((largest, current) => {
    const currentArea = (current.width || 0) * (current.height || 0);
    const largestArea = (largest.width || 0) * (largest.height || 0);
    return currentArea > largestArea ? current : largest;
  }, rectangles[0]);
  
  const length = (largestRect.height || 0) / 100; // Convert cm to meters
  const width = largestRect.width || 0; // Already in cm
  const squareMeters = (length * 100 * width) / 10000;
  
  return {
    length,
    width,
    squareMeters,
    shapes: rectangles.map(r => ({
      type: r.type,
      dimensions: {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height
      }
    }))
  };
}

/**
 * Calculate cutting costs from CAD design
 */
export function calculateCostsFromDesign(
  cadState: CADState,
  originalLength: number,
  originalWidth: number,
  standardDimensions: SlabStandardDimensionEntry[],
  cuttingCostPerMeterLongitudinal: number,
  cuttingCostPerMeterCross: number,
  productType: 'longitudinal' | 'slab'
): number {
  const extracted = extractDimensionsFromDesign(cadState, productType);
  
  if (!extracted.length || !extracted.width) {
    return 0;
  }
  
  if (productType === 'slab' && standardDimensions.length > 0) {
    // Calculate for each standard dimension
    let totalCost = 0;
    
    for (const entry of standardDimensions) {
      const entryLength = lengthUnit === 'm' ? entry.standardLengthCm / 100 : entry.standardLengthCm;
      const entryWidth = widthUnit === 'm' ? entry.standardWidthCm / 100 : entry.standardWidthCm;
      
      const cutting = calculateSlabCutting({
        originalLength: entryLength,
        originalWidth: entryWidth,
        desiredLength: extracted.length,
        desiredWidth: extracted.width / 100, // Convert cm to meters
        lengthUnit: 'm',
        widthUnit: 'cm',
        cuttingCostPerMeterLongitudinal,
        cuttingCostPerMeterCross,
        quantity: entry.quantity
      });
      
      totalCost += cutting.totalCuttingCost || 0;
    }
    
    return totalCost;
  } else {
    // Longitudinal stone
    // Use existing calculateStoneCutting function
    // ...
  }
  
  return 0;
}
```

**Deliverable:** Cost calculation from CAD design

---

#### Task 3.2: Product Config Integration

**Update:** `frontend/src/app/dashboard/sales/contracts/create/page.tsx`

```typescript
// Add CAD design state
const [cadDesign, setCadDesign] = useState<any>(null);

// In StoneCADDesigner component
<StoneCADDesigner
  // ... props
  onDesignChange={(design) => {
    setCadDesign(design);
    
    // Extract dimensions
    const extracted = extractDimensionsFromDesign(design, productConfig.productType);
    
    // Update product config
    if (extracted.length && extracted.width) {
      setProductConfig(prev => ({
        ...prev,
        length: extracted.length,
        width: extracted.width,
        squareMeters: extracted.squareMeters
      }));
    }
    
    // Calculate costs
    if (enableCostCalculation) {
      const costs = calculateCostsFromDesign(
        design,
        originalLength,
        originalWidth,
        standardDimensions,
        cuttingCostPerMeterLongitudinal,
        cuttingCostPerMeterCross,
        productConfig.productType
      );
      
      // Update cutting cost in product config
      setProductConfig(prev => ({
        ...prev,
        cuttingCost: costs
      }));
    }
  }}
/>

// Save CAD design with product
const finalProduct: ContractProduct = {
  // ... existing fields
  cadDesign: cadDesign, // NEW: Save design
};
```

**Deliverable:** CAD design syncs with product config

---

### Phase 3 Success Criteria
- ✅ CAD dimensions update product config
- ✅ Costs calculated from CAD design
- ✅ Remaining stones shown in CAD
- ✅ Design saved with product

---

## Phase 4: Advanced Features (Weeks 9-12)

### Goals
- Multiple drawing tools
- Layer system
- Undo/redo
- Export functionality

### Tasks

#### Task 4.1: Additional Tools
- Circle tool
- Line tool
- Freehand tool
- Text tool

#### Task 4.2: Layer System
- Multiple layers
- Layer visibility toggle
- Layer ordering

#### Task 4.3: History Management
- Undo/redo stack
- History limits
- Performance optimization

#### Task 4.4: Export
- Export to PNG
- Export to SVG
- Export design data (JSON)

---

## Testing Strategy

### Unit Tests
- Coordinate conversion utilities
- Geometry calculations
- Cost calculations

### Integration Tests
- CAD → Product config sync
- Cost calculation integration
- Remaining stone integration

### E2E Tests
- Complete design workflow
- Save and load designs
- Export functionality

---

## Migration Plan

### Step 1: Coexistence
- Keep StoneCanvas for visualization
- Add CAD designer as optional tool
- Users can choose which to use

### Step 2: Feature Parity
- CAD designer matches StoneCanvas features
- Both show same data

### Step 3: Gradual Migration
- Default to CAD designer for new products
- Keep StoneCanvas for existing products
- Migrate on edit

### Step 4: Full Migration
- Remove StoneCanvas
- CAD designer is primary tool

---

*Last Updated: January 2025*
*Document Version: 1.0 - Part 3*

