# CAD Integration Roadmap - Part 2: Architecture & Component Design

## 📋 Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Component Structure](#component-structure)
3. [Data Flow](#data-flow)
4. [State Management](#state-management)
5. [Integration Patterns](#integration-patterns)

---

## Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│         Contract Creation Wizard (page.tsx)              │
│                                                           │
│  ┌─────────────────────────────────────────────────┐    │
│  │      Product Configuration Modal                │    │
│  │                                                  │    │
│  │  ┌──────────────────────────────────────────┐  │    │
│  │  │  Product Type Tabs                       │  │    │
│  │  │  (Longitudinal | Slab | Stair)           │  │    │
│  │  └──────────────────────────────────────────┘  │    │
│  │                                                  │    │
│  │  ┌──────────────────────────────────────────┐  │    │
│  │  │  Configuration Form                      │  │    │
│  │  │  (Dimensions, Quantity, Price, etc.)     │  │    │
│  │  └──────────────────────────────────────────┘  │    │
│  │                                                  │    │
│  │  ┌──────────────────────────────────────────┐  │    │
│  │  │  CAD Designer (NEW)                       │  │    │
│  │  │  ┌────────────────────────────────────┐  │    │
│  │  │  │  Toolbar (Tools, Layers, Settings) │  │    │
│  │  │  └────────────────────────────────────┘  │    │
│  │  │  ┌────────────────────────────────────┐  │    │
│  │  │  │  Canvas Area (Konva Stage)         │  │    │
│  │  │  │  - Stone Background                │  │    │
│  │  │  │  - User Drawings                   │  │    │
│  │  │  │  - Measurements                    │  │    │
│  │  │  │  - Grid & Snap                     │  │    │
│  │  │  └────────────────────────────────────┘  │    │
│  │  │  ┌────────────────────────────────────┐  │    │
│  │  │  │  Properties Panel                  │  │    │
│  │  │  │  (Selected Object Properties)       │  │    │
│  │  │  └────────────────────────────────────┘  │    │
│  │  └──────────────────────────────────────────┘  │    │
│  │                                                  │    │
│  │  ┌──────────────────────────────────────────┐  │    │
│  │  │  StoneCanvas (Existing - View Mode)      │  │    │
│  │  │  (Visualization Only)                    │  │    │
│  │  └──────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────┘    │
│                                                           │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Remaining Stone Modal                           │    │
│  │  ┌──────────────────────────────────────────┐  │    │
│  │  │  CAD Designer (NEW)                       │  │    │
│  │  │  (For planning cuts on remaining stone)   │  │    │
│  │  └──────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

---

## Component Structure

### File Organization

```
frontend/src/
  components/
    stone-cad/                          # NEW: CAD Tool Components
      StoneCADDesigner.tsx              # Main CAD component
      CADToolbar.tsx                    # Tool selection bar
      CADCanvas.tsx                     # Konva canvas wrapper
      CADPropertiesPanel.tsx            # Object properties editor
      CADLayersPanel.tsx                # Layer management
      CADMeasurementsPanel.tsx           # Rulers & measurements
      
      tools/                            # Drawing tools
        BaseTool.ts                     # Base tool interface
        SelectTool.ts                   # Selection tool
        RectangleTool.ts                # Rectangle drawing
        CircleTool.ts                   # Circle drawing
        LineTool.ts                     # Line drawing
        FreehandTool.ts                 # Pencil/freehand
        MeasurementTool.ts              # Ruler tool
        TextTool.ts                     # Text annotation
        
      managers/                         # Core managers
        CADManager.ts                   # Main CAD state manager
        ToolManager.ts                  # Tool switching
        SelectionManager.ts             # Selection handling
        GridManager.ts                  # Grid system
        SnapManager.ts                  # Snap-to-grid
        MeasurementManager.ts            # Measurement calculations
        HistoryManager.ts               # Undo/redo
        ExportManager.ts                # Export functions
        
      utils/                            # Utilities
        coordinateUtils.ts              # Coordinate conversion
        geometryUtils.ts                # Geometry calculations
        costCalculationUtils.ts         # Cost integration
        validationUtils.ts              # Validation logic
        
      types/                            # TypeScript types
        CADTypes.ts                     # Core CAD types
        ToolTypes.ts                    # Tool definitions
        MeasurementTypes.ts             # Measurement types
        
      hooks/                            # React hooks
        useCADState.ts                  # CAD state management
        useCADTools.ts                  # Tool management
        useCADMeasurements.ts           # Measurement hooks
        
    StoneCanvas.tsx                     # EXISTING: Keep for visualization
```

---

### Core Component: StoneCADDesigner

**Location:** `frontend/src/components/stone-cad/StoneCADDesigner.tsx`

**Props Interface:**
```typescript
interface StoneCADDesignerProps {
  // Stone dimensions
  originalLength: number;        // meters
  originalWidth: number;         // cm
  lengthUnit: 'cm' | 'm';
  widthUnit: 'cm' | 'm';
  
  // For slab: multiple standard dimensions
  standardDimensions?: SlabStandardDimensionEntry[];
  
  // Mode
  mode: 'design' | 'view';       // Design mode or view-only
  productType: 'longitudinal' | 'slab';
  
  // Callbacks
  onDesignChange?: (design: CADDesign) => void;
  onDimensionsCalculated?: (dimensions: CalculatedDimensions) => void;
  onCostCalculated?: (cost: number) => void;
  
  // Initial design (for editing)
  initialDesign?: CADDesign;
  
  // Integration
  enableCostCalculation?: boolean;
  enableAutoSync?: boolean;      // Auto-sync with product config
}
```

**Component Structure:**
```typescript
export function StoneCADDesigner({
  originalLength,
  originalWidth,
  standardDimensions,
  mode,
  productType,
  onDesignChange,
  onDimensionsCalculated,
  onCostCalculated,
  initialDesign,
  enableCostCalculation = true,
  enableAutoSync = false
}: StoneCADDesignerProps) {
  // State management
  const [cadState, setCadState] = useCADState(initialDesign);
  const [selectedTool, setSelectedTool] = useState<string>('select');
  const [selectedObjects, setSelectedObjects] = useState<string[]>([]);
  
  // Managers
  const toolManager = useRef(new ToolManager());
  const gridManager = useRef(new GridManager());
  const measurementManager = useRef(new MeasurementManager());
  const historyManager = useRef(new HistoryManager());
  
  // Effects
  useEffect(() => {
    // Initialize canvas
    // Load initial design if provided
    // Set up event handlers
  }, []);
  
  useEffect(() => {
    // Sync with product config if enableAutoSync
    // Calculate dimensions
    // Calculate costs
    // Call callbacks
  }, [cadState]);
  
  return (
    <div className="stone-cad-designer">
      <CADToolbar
        selectedTool={selectedTool}
        onToolChange={setSelectedTool}
        onUndo={historyManager.current.undo}
        onRedo={historyManager.current.redo}
        onExport={handleExport}
      />
      
      <div className="cad-main-area">
        <CADCanvas
          cadState={cadState}
          selectedTool={selectedTool}
          onStateChange={setCadState}
          gridManager={gridManager.current}
          measurementManager={measurementManager.current}
          productType={productType}
          standardDimensions={standardDimensions}
        />
        
        <div className="cad-sidebar">
          <CADPropertiesPanel
            selectedObjects={selectedObjects}
            cadState={cadState}
            onUpdate={handleObjectUpdate}
          />
          
          <CADLayersPanel
            layers={cadState.layers}
            onLayerChange={handleLayerChange}
          />
          
          {enableCostCalculation && (
            <CADCostPanel
              dimensions={calculatedDimensions}
              costs={calculatedCosts}
            />
          )}
        </div>
      </div>
    </div>
  );
}
```

---

### CAD Canvas Component

**Location:** `frontend/src/components/stone-cad/CADCanvas.tsx`

**Implementation:**
```typescript
import { Stage, Layer, Group, Rect, Line, Text } from 'react-konva';

interface CADCanvasProps {
  cadState: CADState;
  selectedTool: string;
  onStateChange: (state: CADState) => void;
  gridManager: GridManager;
  measurementManager: MeasurementManager;
  productType: 'longitudinal' | 'slab';
  standardDimensions?: SlabStandardDimensionEntry[];
}

export function CADCanvas({
  cadState,
  selectedTool,
  onStateChange,
  gridManager,
  measurementManager,
  productType,
  standardDimensions
}: CADCanvasProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  
  // Handle tool-specific interactions
  const handleMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    const tool = toolManager.getTool(selectedTool);
    tool.onMouseDown(e, cadState, onStateChange);
  }, [selectedTool, cadState]);
  
  // Render stone backgrounds
  const renderStoneBackgrounds = () => {
    if (productType === 'slab' && standardDimensions) {
      // Render multiple standard slabs
      return standardDimensions.map((entry, index) => (
        <Group key={`stone-${entry.id}`} x={index * 300} y={0}>
          <Rect
            width={entry.standardWidthCm}
            height={entry.standardLengthCm * 100}
            fill="#e8e8e8"
            stroke="#333"
            strokeWidth={2}
          />
          <Text
            text={`${entry.standardLengthCm}×${entry.standardWidthCm}cm (${entry.quantity})`}
            x={10}
            y={10}
            fontSize={12}
          />
        </Group>
      ));
    } else {
      // Single stone for longitudinal
      return (
        <Rect
          width={originalWidth}
          height={originalLength * 100}
          fill="#e8e8e8"
          stroke="#333"
          strokeWidth={2}
        />
      );
    }
  };
  
  // Render user drawings
  const renderDrawings = () => {
    return cadState.shapes.map(shape => {
      switch (shape.type) {
        case 'rectangle':
          return (
            <Rect
              key={shape.id}
              x={shape.x}
              y={shape.y}
              width={shape.width}
              height={shape.height}
              fill={shape.fill}
              stroke={shape.stroke}
              strokeWidth={shape.strokeWidth}
              draggable={selectedTool === 'select'}
            />
          );
        case 'line':
          return (
            <Line
              key={shape.id}
              points={shape.points}
              stroke={shape.stroke}
              strokeWidth={shape.strokeWidth}
            />
          );
        // ... other shape types
      }
    });
  };
  
  // Render measurements
  const renderMeasurements = () => {
    return measurementManager.getMeasurements().map(measurement => (
      <Group key={measurement.id}>
        <Line
          points={measurement.points}
          stroke="#00ff00"
          strokeWidth={2}
          strokeDashArray={[5, 5]}
        />
        <Text
          text={`${measurement.distance.toFixed(1)}cm`}
          x={measurement.labelX}
          y={measurement.labelY}
          fontSize={12}
          fill="#00ff00"
        />
      </Group>
    ));
  };
  
  // Render grid
  const renderGrid = () => {
    if (!gridManager.isVisible()) return null;
    
    const gridLines = gridManager.getGridLines(dimensions);
    return gridLines.map((line, index) => (
      <Line
        key={`grid-${index}`}
        points={line.points}
        stroke="#ddd"
        strokeWidth={1}
        listening={false}
      />
    ));
  };
  
  return (
    <div className="cad-canvas-container">
      <Stage
        ref={stageRef}
        width={dimensions.width}
        height={dimensions.height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        {/* Background Layer */}
        <Layer>
          {renderGrid()}
          {renderStoneBackgrounds()}
        </Layer>
        
        {/* Drawing Layer */}
        <Layer>
          {renderDrawings()}
          {renderMeasurements()}
        </Layer>
        
        {/* UI Overlay Layer */}
        <Layer>
          {/* Selection handles, tool previews, etc. */}
        </Layer>
      </Stage>
    </div>
  );
}
```

---

## Data Flow

### Design → Product Config Flow

```
┌─────────────────┐
│  CAD Designer   │
│  (User Draws)  │
└────────┬────────┘
         │
         │ onDesignChange
         ▼
┌─────────────────┐
│  CAD Design     │
│  - Shapes       │
│  - Dimensions   │
│  - Measurements │
└────────┬────────┘
         │
         │ Extract Dimensions
         ▼
┌─────────────────┐
│  Dimension      │
│  Calculator     │
│  - Length       │
│  - Width        │
│  - Area         │
└────────┬────────┘
         │
         │ Update Product Config
         ▼
┌─────────────────┐
│  Product Config │
│  - length       │
│  - width        │
│  - squareMeters │
└────────┬────────┘
         │
         │ Trigger Calculation
         ▼
┌─────────────────┐
│  Cost           │
│  Calculator     │
│  - Cutting Cost │
│  - Total Price  │
└────────┬────────┘
         │
         │ Update CAD Display
         ▼
┌─────────────────┐
│  CAD Designer   │
│  (Show Costs)   │
└─────────────────┘
```

### Product Config → CAD Flow

```
┌─────────────────┐
│  Product Config │
│  (User Inputs)  │
└────────┬────────┘
         │
         │ enableAutoSync = true
         ▼
┌─────────────────┐
│  CAD Designer   │
│  (Auto Update)  │
│  - Draw shapes  │
│  - Show cuts    │
│  - Update view  │
└─────────────────┘
```

---

## State Management

### CAD State Structure

```typescript
interface CADState {
  // Design data
  shapes: CADShape[];
  measurements: Measurement[];
  layers: CADLayer[];
  
  // UI state
  selectedTool: string;
  selectedObjects: string[];
  activeLayer: string;
  
  // Settings
  gridVisible: boolean;
  gridSize: number;
  snapEnabled: boolean;
  showMeasurements: boolean;
  
  // History
  history: CADState[];
  historyIndex: number;
  
  // Metadata
  version: number;
  lastModified: Date;
}

interface CADShape {
  id: string;
  type: 'rectangle' | 'circle' | 'line' | 'freehand' | 'text';
  x: number;
  y: number;
  width?: number;
  height?: number;
  radius?: number;
  points?: number[];
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  layer: string;
  metadata?: {
    representsCut?: boolean;
    representsRemaining?: boolean;
    cost?: number;
  };
}

interface CADLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  order: number;
}
```

### State Management Hook

```typescript
// hooks/useCADState.ts
export function useCADState(initialDesign?: CADDesign) {
  const [state, setState] = useState<CADState>(() => {
    if (initialDesign) {
      return deserializeCADDesign(initialDesign);
    }
    return createEmptyCADState();
  });
  
  const updateState = useCallback((updater: (prev: CADState) => CADState) => {
    setState(prev => {
      const newState = updater(prev);
      // Save to history
      historyManager.addToHistory(newState);
      return newState;
    });
  }, []);
  
  const addShape = useCallback((shape: CADShape) => {
    updateState(prev => ({
      ...prev,
      shapes: [...prev.shapes, shape]
    }));
  }, [updateState]);
  
  const updateShape = useCallback((id: string, updates: Partial<CADShape>) => {
    updateState(prev => ({
      ...prev,
      shapes: prev.shapes.map(s => 
        s.id === id ? { ...s, ...updates } : s
      )
    }));
  }, [updateState]);
  
  const deleteShape = useCallback((id: string) => {
    updateState(prev => ({
      ...prev,
      shapes: prev.shapes.filter(s => s.id !== id)
    }));
  }, [updateState]);
  
  return {
    state,
    setState: updateState,
    addShape,
    updateShape,
    deleteShape,
    // ... other methods
  };
}
```

---

## Integration Patterns

### Pattern 1: CAD as Input Method

**Use Case:** User draws desired dimensions instead of typing

```typescript
// In product modal
const [useCADInput, setUseCADInput] = useState(false);

{useCADInput ? (
  <StoneCADDesigner
    originalLength={originalLength}
    originalWidth={originalWidth}
    mode="design"
    onDimensionsCalculated={(dims) => {
      // Auto-fill product config
      setProductConfig(prev => ({
        ...prev,
        length: dims.length,
        width: dims.width,
        squareMeters: dims.squareMeters
      }));
    }}
  />
) : (
  <FormattedNumberInput
    value={productConfig.length}
    onChange={...}
  />
)}
```

---

### Pattern 2: CAD as Visualization

**Use Case:** Show existing product design in CAD

```typescript
// In product card
<StoneCADDesigner
  originalLength={product.originalLength}
  originalWidth={product.originalWidth}
  mode="view"
  initialDesign={product.cadDesign} // Load saved design
  enableCostCalculation={false}
/>
```

---

### Pattern 3: CAD for Remaining Stones

**Use Case:** Plan cuts on remaining stone

```typescript
// In remaining stone modal
<StoneCADDesigner
  originalLength={remainingStone.length}
  originalWidth={remainingStone.width}
  mode="design"
  onDesignChange={(design) => {
    // Calculate partitions from design
    const partitions = extractPartitionsFromDesign(design);
    setPartitions(partitions);
  }}
/>
```

---

### Pattern 4: CAD for Slab Multi-Stone

**Use Case:** Design cuts on multiple standard slabs

```typescript
// In slab configuration
<StoneCADDesigner
  standardDimensions={productConfig.slabStandardDimensions}
  productType="slab"
  mode="design"
  onDesignChange={(design) => {
    // Extract cuts for each standard dimension
    const cuts = extractCutsFromDesign(design);
    // Update cutting costs
    updateCuttingCosts(cuts);
  }}
/>
```

---

## Next Steps

**Part 3 will cover:**
- Phase-by-phase implementation plan
- Detailed code examples
- Testing strategy
- Migration from StoneCanvas

**Part 4 will cover:**
- Cost calculation integration
- Export functionality
- Performance optimization
- Mobile support

---

*Last Updated: January 2025*
*Document Version: 1.0 - Part 2*

