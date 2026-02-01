# CAD Integration Roadmap - Part 4: Advanced Features & Optimization

## 📋 Table of Contents
1. [Advanced Features](#advanced-features)
2. [Performance Optimization](#performance-optimization)
3. [Mobile Support](#mobile-support)
4. [Export & Persistence](#export--persistence)
5. [Testing & Quality Assurance](#testing--quality-assurance)

---

## Advanced Features

### Feature 1: Multiple Drawing Tools

#### Circle Tool
**File:** `frontend/src/components/stone-cad/tools/CircleTool.ts`

```typescript
export class CircleTool extends BaseTool {
  name = 'circle';
  icon = 'FaCircle';
  private isDrawing = false;
  private centerPoint: { x: number; y: number } | null = null;
  private tempCircle: Konva.Circle | null = null;
  
  onMouseDown(e: KonvaEventObject<MouseEvent>, context: ToolContext) {
    const stage = e.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    
    this.isDrawing = true;
    this.centerPoint = pointer;
    
    this.tempCircle = new Konva.Circle({
      x: pointer.x,
      y: pointer.y,
      radius: 0,
      fill: 'rgba(0, 0, 255, 0.3)',
      stroke: 'blue',
      strokeWidth: 2,
      dash: [5, 5]
    });
    
    context.layer.add(this.tempCircle);
  }
  
  onMouseMove(e: KonvaEventObject<MouseEvent>, context: ToolContext) {
    if (!this.isDrawing || !this.centerPoint || !this.tempCircle) return;
    
    const stage = e.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    
    const dx = pointer.x - this.centerPoint.x;
    const dy = pointer.y - this.centerPoint.y;
    const radius = Math.sqrt(dx * dx + dy * dy);
    
    this.tempCircle.radius(radius);
    context.layer.draw();
  }
  
  onMouseUp(e: KonvaEventObject<MouseEvent>, context: ToolContext) {
    if (!this.isDrawing || !this.centerPoint || !this.tempCircle) return;
    
    const stage = e.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    
    const dx = pointer.x - this.centerPoint.x;
    const dy = pointer.y - this.centerPoint.y;
    const radius = Math.sqrt(dx * dx + dy * dy);
    const realRadius = canvasLengthToReal(radius, context.coordSystem);
    
    const shape: CADShape = {
      id: `circle-${Date.now()}`,
      type: 'circle',
      x: this.centerPoint.x,
      y: this.centerPoint.y,
      radius: realRadius,
      fill: 'rgba(0, 0, 255, 0.3)',
      stroke: 'blue',
      strokeWidth: 2,
      layer: context.cadState.activeLayer
    };
    
    this.tempCircle.destroy();
    this.tempCircle = null;
    this.isDrawing = false;
    this.centerPoint = null;
    
    context.updateState(prev => ({
      ...prev,
      shapes: [...prev.shapes, shape]
    }));
  }
  
  getCursor(): string {
    return 'crosshair';
  }
}
```

---

#### Freehand Tool (Pencil)
**File:** `frontend/src/components/stone-cad/tools/FreehandTool.ts`

```typescript
export class FreehandTool extends BaseTool {
  name = 'freehand';
  icon = 'FaPencilAlt';
  private isDrawing = false;
  private points: number[] = [];
  private tempLine: Konva.Line | null = null;
  
  onMouseDown(e: KonvaEventObject<MouseEvent>, context: ToolContext) {
    const stage = e.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    
    this.isDrawing = true;
    this.points = [pointer.x, pointer.y];
    
    this.tempLine = new Konva.Line({
      points: this.points,
      stroke: '#000',
      strokeWidth: 2,
      lineCap: 'round',
      lineJoin: 'round',
      tension: 0.5
    });
    
    context.layer.add(this.tempLine);
  }
  
  onMouseMove(e: KonvaEventObject<MouseEvent>, context: ToolContext) {
    if (!this.isDrawing || !this.tempLine) return;
    
    const stage = e.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    
    this.points.push(pointer.x, pointer.y);
    this.tempLine.points(this.points);
    context.layer.draw();
  }
  
  onMouseUp(e: KonvaEventObject<MouseEvent>, context: ToolContext) {
    if (!this.isDrawing || !this.tempLine) return;
    
    // Convert points to real coordinates
    const realPoints = this.points.map((coord, index) => {
      if (index % 2 === 0) {
        // x coordinate
        return canvasToReal(coord, 0, context.coordSystem).x;
      } else {
        // y coordinate
        return canvasToReal(0, coord, context.coordSystem).y;
      }
    });
    
    const shape: CADShape = {
      id: `freehand-${Date.now()}`,
      type: 'freehand',
      points: realPoints,
      stroke: '#000',
      strokeWidth: 2,
      layer: context.cadState.activeLayer
    };
    
    this.tempLine.destroy();
    this.tempLine = null;
    this.isDrawing = false;
    this.points = [];
    
    context.updateState(prev => ({
      ...prev,
      shapes: [...prev.shapes, shape]
    }));
  }
  
  getCursor(): string {
    return 'crosshair';
  }
}
```

---

### Feature 2: Layer System

**File:** `frontend/src/components/stone-cad/CADLayersPanel.tsx`

```typescript
interface CADLayersPanelProps {
  layers: CADLayer[];
  activeLayer: string;
  onLayerChange: (layerId: string, updates: Partial<CADLayer>) => void;
  onLayerAdd: () => void;
  onLayerDelete: (layerId: string) => void;
  onLayerSelect: (layerId: string) => void;
}

export function CADLayersPanel({
  layers,
  activeLayer,
  onLayerChange,
  onLayerAdd,
  onLayerDelete,
  onLayerSelect
}: CADLayersPanelProps) {
  return (
    <div className="cad-layers-panel bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          لایه‌ها
        </h3>
        <button
          onClick={onLayerAdd}
          className="px-2 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700"
        >
          + افزودن
        </button>
      </div>
      
      <div className="space-y-2">
        {layers.map(layer => (
          <div
            key={layer.id}
            className={`flex items-center gap-2 p-2 rounded ${
              activeLayer === layer.id
                ? 'bg-indigo-100 dark:bg-indigo-900/30'
                : 'hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            <input
              type="checkbox"
              checked={layer.visible}
              onChange={(e) => onLayerChange(layer.id, { visible: e.target.checked })}
              className="w-4 h-4"
            />
            
            <input
              type="text"
              value={layer.name}
              onChange={(e) => onLayerChange(layer.id, { name: e.target.value })}
              className="flex-1 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
            />
            
            <button
              onClick={() => onLayerSelect(layer.id)}
              className={`px-2 py-1 text-xs rounded ${
                activeLayer === layer.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300'
              }`}
            >
              فعال
            </button>
            
            {layers.length > 1 && (
              <button
                onClick={() => onLayerDelete(layer.id)}
                className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
              >
                حذف
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

### Feature 3: Undo/Redo System

**File:** `frontend/src/components/stone-cad/managers/HistoryManager.ts`

```typescript
export class HistoryManager {
  private history: CADState[] = [];
  private currentIndex: number = -1;
  private maxHistory: number = 50;
  
  /**
   * Add state to history
   */
  addToHistory(state: CADState) {
    // Remove any future history if we're not at the end
    if (this.currentIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.currentIndex + 1);
    }
    
    // Add new state
    this.history.push(JSON.parse(JSON.stringify(state))); // Deep clone
    this.currentIndex++;
    
    // Limit history size
    if (this.history.length > this.maxHistory) {
      this.history.shift();
      this.currentIndex--;
    }
  }
  
  /**
   * Undo to previous state
   */
  undo(): CADState | null {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      return JSON.parse(JSON.stringify(this.history[this.currentIndex]));
    }
    return null;
  }
  
  /**
   * Redo to next state
   */
  redo(): CADState | null {
    if (this.currentIndex < this.history.length - 1) {
      this.currentIndex++;
      return JSON.parse(JSON.stringify(this.history[this.currentIndex]));
    }
    return null;
  }
  
  /**
   * Check if undo is available
   */
  canUndo(): boolean {
    return this.currentIndex > 0;
  }
  
  /**
   * Check if redo is available
   */
  canRedo(): boolean {
    return this.currentIndex < this.history.length - 1;
  }
  
  /**
   * Clear history
   */
  clear() {
    this.history = [];
    this.currentIndex = -1;
  }
}
```

---

## Performance Optimization

### Optimization 1: Layer Separation

```typescript
// Separate layers for better performance
const backgroundLayer = new Konva.Layer(); // Static - rarely changes
const drawingLayer = new Konva.Layer();    // Dynamic - changes frequently
const uiLayer = new Konva.Layer();         // UI overlays

// Only redraw changed layers
drawingLayer.draw(); // Only redraws this layer
```

---

### Optimization 2: Object Caching

```typescript
// Cache complex shapes
shape.cache();
shape.getLayer().draw(); // Uses cached version

// Clear cache when needed
shape.clearCache();
```

---

### Optimization 3: Virtual Rendering

```typescript
// Only render visible objects
const visibleShapes = shapes.filter(shape => {
  return isShapeVisible(shape, viewport);
});

// Render only visible shapes
visibleShapes.forEach(shape => renderShape(shape));
```

---

### Optimization 4: Debouncing Expensive Operations

```typescript
import { debounce } from 'lodash';

const debouncedRender = useMemo(
  () => debounce(() => {
    layer.draw();
  }, 100),
  []
);

// Use debounced render for frequent updates
const handleShapeUpdate = () => {
  updateShape();
  debouncedRender();
};
```

---

## Mobile Support

### Touch Event Handling

```typescript
// Handle touch events
const handleTouchStart = (e: KonvaEventObject<TouchEvent>) => {
  const touch = e.e.touches[0];
  const stage = e.target.getStage();
  const pointer = stage?.getPointerPosition();
  // ... handle touch
};

// Prevent default touch behaviors
<Stage
  onTouchStart={handleTouchStart}
  onTouchMove={handleTouchMove}
  onTouchEnd={handleTouchEnd}
  style={{ touchAction: 'none' }}
>
```

---

### Mobile UI Adjustments

```typescript
// Responsive toolbar
const isMobile = window.innerWidth < 768;

{isMobile ? (
  <MobileToolbar
    tools={tools}
    selectedTool={selectedTool}
    onToolChange={setSelectedTool}
  />
) : (
  <DesktopToolbar
    tools={tools}
    selectedTool={selectedTool}
    onToolChange={setSelectedTool}
  />
)}
```

---

## Export & Persistence

### Export to Image

```typescript
// Export canvas as PNG
const exportToPNG = (stage: Konva.Stage, filename: string) => {
  const dataURL = stage.toDataURL({
    pixelRatio: 2, // High DPI
    mimeType: 'image/png',
    quality: 1.0
  });
  
  const link = document.createElement('a');
  link.download = filename;
  link.href = dataURL;
  link.click();
};
```

---

### Export to SVG

```typescript
// Export design as SVG
const exportToSVG = (cadState: CADState, coordSystem: CoordinateSystem) => {
  let svg = `<svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">`;
  
  // Add stone backgrounds
  svg += renderStoneBackgroundsToSVG();
  
  // Add user drawings
  cadState.shapes.forEach(shape => {
    svg += renderShapeToSVG(shape, coordSystem);
  });
  
  // Add measurements
  cadState.measurements.forEach(measurement => {
    svg += renderMeasurementToSVG(measurement);
  });
  
  svg += '</svg>';
  return svg;
};
```

---

### Design Persistence

```typescript
// Save design with product
interface CADDesign {
  version: string;
  shapes: CADShape[];
  measurements: Measurement[];
  layers: CADLayer[];
  metadata: {
    createdAt: Date;
    updatedAt: Date;
    productType: string;
    stoneDimensions: {
      length: number;
      width: number;
    };
  };
}

// Serialize for storage
const serializeDesign = (cadState: CADState): CADDesign => {
  return {
    version: '1.0',
    shapes: cadState.shapes,
    measurements: cadState.measurements,
    layers: cadState.layers,
    metadata: {
      createdAt: new Date(),
      updatedAt: new Date(),
      productType: productType,
      stoneDimensions: {
        length: originalLength,
        width: originalWidth
      }
    }
  };
};

// Deserialize from storage
const deserializeDesign = (design: CADDesign): CADState => {
  return {
    shapes: design.shapes,
    measurements: design.measurements,
    layers: design.layers,
    // ... restore other state
  };
};
```

---

## Testing & Quality Assurance

### Unit Tests

**File:** `frontend/src/components/stone-cad/__tests__/coordinateUtils.test.ts`

```typescript
import { realToCanvas, canvasToReal, initializeCoordinateSystem } from '../utils/coordinateUtils';

describe('Coordinate Utils', () => {
  it('should convert real to canvas coordinates', () => {
    const coordSystem = initializeCoordinateSystem(300, 200, 800, 600);
    const canvas = realToCanvas(100, 50, coordSystem);
    expect(canvas.x).toBeGreaterThan(0);
    expect(canvas.y).toBeGreaterThan(0);
  });
  
  it('should convert canvas to real coordinates', () => {
    const coordSystem = initializeCoordinateSystem(300, 200, 800, 600);
    const real = canvasToReal(400, 300, coordSystem);
    expect(real.x).toBeGreaterThan(0);
    expect(real.y).toBeGreaterThan(0);
  });
  
  it('should maintain accuracy in round-trip conversion', () => {
    const coordSystem = initializeCoordinateSystem(300, 200, 800, 600);
    const original = { x: 100, y: 50 };
    const canvas = realToCanvas(original.x, original.y, coordSystem);
    const back = canvasToReal(canvas.x, canvas.y, coordSystem);
    expect(back.x).toBeCloseTo(original.x, 1);
    expect(back.y).toBeCloseTo(original.y, 1);
  });
});
```

---

### Integration Tests

**File:** `frontend/src/components/stone-cad/__tests__/integration.test.tsx`

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { StoneCADDesigner } from '../StoneCADDesigner';

describe('CAD Integration', () => {
  it('should sync dimensions with product config', () => {
    const onDimensionsCalculated = jest.fn();
    
    render(
      <StoneCADDesigner
        originalLength={3}
        originalWidth={200}
        lengthUnit="m"
        widthUnit="cm"
        productType="slab"
        onDimensionsCalculated={onDimensionsCalculated}
      />
    );
    
    // Draw a rectangle
    // ... simulate drawing
    
    // Verify callback called with correct dimensions
    expect(onDimensionsCalculated).toHaveBeenCalledWith({
      length: expect.any(Number),
      width: expect.any(Number),
      squareMeters: expect.any(Number)
    });
  });
});
```

---

### E2E Tests

**File:** `e2e/cad-workflow.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test('Complete CAD design workflow', async ({ page }) => {
  // Navigate to contract creation
  await page.goto('/dashboard/sales/contracts/create');
  
  // Select slab product
  await page.click('text=سنگ اسلب');
  
  // Open product modal
  await page.click('text=افزودن محصول');
  
  // Enable CAD designer
  await page.click('text=نمایش ابزار طراحی');
  
  // Draw rectangle
  const canvas = page.locator('.cad-canvas-container canvas');
  await canvas.click({ position: { x: 100, y: 100 } });
  await canvas.click({ position: { x: 300, y: 200 } });
  
  // Verify dimensions updated
  const lengthInput = page.locator('input[name="length"]');
  await expect(lengthInput).toHaveValue(expect.stringMatching(/\d+/));
  
  // Save product
  await page.click('text=افزودن به قرارداد');
  
  // Verify product added
  await expect(page.locator('.product-card')).toBeVisible();
});
```

---

## Performance Benchmarks

### Target Performance

| Scenario | Target FPS | Current Status |
|----------|------------|----------------|
| < 50 objects | 60 FPS | ✅ |
| 50-100 objects | 45 FPS | ✅ |
| 100-200 objects | 30 FPS | ✅ |
| > 200 objects | 20+ FPS | ⚠️ (needs optimization) |

---

## Deployment Checklist

### Pre-Deployment
- [ ] All unit tests passing
- [ ] Integration tests passing
- [ ] E2E tests passing
- [ ] Performance benchmarks met
- [ ] Mobile testing completed
- [ ] Browser compatibility verified
- [ ] Documentation updated

### Deployment
- [ ] Feature flag enabled
- [ ] Gradual rollout (10% → 50% → 100%)
- [ ] Monitor error rates
- [ ] Monitor performance metrics
- [ ] User feedback collection

### Post-Deployment
- [ ] Monitor usage analytics
- [ ] Collect user feedback
- [ ] Fix critical issues
- [ ] Plan next iteration

---

## Risk Mitigation

### Risk 1: Performance Issues
**Mitigation:**
- Implement layer separation
- Use object caching
- Virtual rendering for large designs
- Performance monitoring

### Risk 2: Mobile Compatibility
**Mitigation:**
- Extensive mobile testing
- Touch event optimization
- Responsive UI design
- Fallback to basic mode

### Risk 3: Data Loss
**Mitigation:**
- Auto-save functionality
- Design versioning
- Backup before major changes
- Undo/redo system

### Risk 4: Integration Complexity
**Mitigation:**
- Gradual integration
- Feature flags
- Backward compatibility
- Comprehensive testing

---

## Success Metrics

### User Adoption
- % of users using CAD tool
- Average time saved per order
- User satisfaction score

### Business Impact
- Reduction in material waste
- Increase in order accuracy
- Cost savings

### Technical Metrics
- Performance (FPS)
- Error rate
- Load time
- Bundle size impact

---

*Last Updated: January 2025*
*Document Version: 1.0 - Part 4*

