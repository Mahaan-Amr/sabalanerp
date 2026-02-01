# CAD Integration Roadmap - Part 1: System Analysis & Decision

## 📋 Table of Contents
1. [System Analysis](#system-analysis)
2. [Product Types & Use Cases](#product-types--use-cases)
3. [Library Decision](#library-decision)
4. [Integration Points](#integration-points)

---

## System Analysis

### Current System Architecture

**Contract Creation Flow:**
```
Step 1: Contract Date
Step 2: Customer Selection
Step 3: Project Selection
Step 4: Product Type Selection (longitudinal | stair | slab)
Step 5: Products Configuration
  ├── Longitudinal Stones
  ├── Slab Stones
  └── Stair Systems
Step 6: Delivery Schedule
Step 7: Payment Method
```

### Product Types in System

#### 1. **Longitudinal Stones** (سنگ طولی)
**Characteristics:**
- **Dimensions**: Length (m) × Width (cm)
- **Cutting**: 1D cutting (longitudinal only - width reduction)
- **Original Width**: Fixed (from product.widthValue)
- **Cutting Logic**: `calculateStoneCutting()`
- **Remaining Stones**: Single remaining piece (width-based)
- **Mandatory Pricing**: ✅ Yes (حکمی)
- **Current Visualization**: ✅ StoneCanvas (shows used/remaining)

**Key Data Structure:**
```typescript
{
  productType: 'longitudinal',
  length: number,        // meters
  width: number,         // cm (desired, must be <= originalWidth)
  originalWidth: number, // cm (fixed)
  isCut: boolean,
  cutType: 'longitudinal' | null,
  remainingStones: RemainingStone[], // Single piece typically
  cuttingCost: number
}
```

**CAD Tool Use Case:**
- **Primary**: Visual planning of cuts on stone
- **Secondary**: Measurement and dimension verification
- **Complexity**: Low (1D cutting, simple rectangles)

---

#### 2. **Slab Stones** (سنگ اسلب)
**Characteristics:**
- **Dimensions**: Length (m) × Width (cm) - 2D cutting
- **Cutting**: 2D cutting (longitudinal + cross)
- **Standard Dimensions**: Multiple entries (array)
  - Each entry: `{ standardLengthCm, standardWidthCm, quantity }`
- **Cutting Modes**: 
  - `lineBased`: Per meter cutting cost
  - `perSquareMeter`: Per square meter cutting cost
- **برش قائم**: 4-side edge cuts (top, bottom, left, right)
- **Remaining Stones**: Multiple pieces (width, length, corner)
- **Mandatory Pricing**: ❌ No
- **Current Visualization**: ✅ StoneCanvas (shows used/remaining)

**Key Data Structure:**
```typescript
{
  productType: 'slab',
  length: number,              // meters (desired)
  width: number,               // cm (desired)
  slabStandardDimensions: [    // Array of standard stones
    {
      id: string,
      standardLengthCm: number,
      standardWidthCm: number,
      quantity: number
    }
  ],
  slabCuttingMode: 'lineBased' | 'perSquareMeter',
  slabVerticalCutSides: {
    top: boolean,
    bottom: boolean,
    left: boolean,
    right: boolean
  },
  remainingStones: RemainingStone[], // Multiple pieces
  cuttingCost: number
}
```

**CAD Tool Use Case:**
- **Primary**: ⭐⭐⭐ CRITICAL - Visual planning of cuts on multiple standard slabs
- **Secondary**: Measurement, optimization, waste reduction
- **Complexity**: High (2D cutting, multiple stones, complex remaining pieces)

---

#### 3. **Stair Systems** (دستگاه پله)
**Characteristics:**
- **Components**: Tread (کف پله), Riser (خیز پله), Landing (پاگرد)
- **Dimensions**: Complex (tread width/depth, riser height, landing dimensions)
- **Cutting**: Nosing cuts (for tread)
- **Layers**: Can have layers (with different stones)
- **Mandatory Pricing**: ✅ Yes (for riser/landing)
- **Current Visualization**: ❌ Disabled (temporarily)

**Key Data Structure:**
```typescript
{
  productType: 'stair',
  stairSystemId: string,
  stairPartType: 'tread' | 'riser' | 'landing',
  treadWidth?: number,
  treadDepth?: number,
  riserHeight?: number,
  landingWidth?: number,
  landingDepth?: number,
  nosingType?: string,
  nosingCuttingCost?: number
}
```

**CAD Tool Use Case:**
- **Primary**: ⭐ Low priority - Complex shapes, less common
- **Secondary**: Visualization of stair parts
- **Complexity**: Very High (complex shapes, multiple parts)

---

### Remaining Stone System

**How It Works:**
1. When a stone is cut, remaining pieces are calculated
2. Remaining stones are stored in `remainingStones[]`
3. Users can click on remaining stones in StoneCanvas
4. Modal opens to create new product from remaining stone
5. New product inherits properties from source

**Remaining Stone Structure:**
```typescript
interface RemainingStone {
  id: string;
  width: number;        // cm
  length: number;       // meters
  squareMeters: number;
  isAvailable: boolean;
  sourceCutId: string;
  position?: {          // For canvas visualization
    startWidth: number;  // cm
    startLength: number; // meters
  };
}
```

**CAD Tool Use Case:**
- **Primary**: ⭐⭐ HIGH - Visual planning on remaining pieces
- **Secondary**: Optimization of remaining stone usage
- **Complexity**: Medium (irregular shapes from cuts)

---

## Product Types & Use Cases

### Use Case Matrix

| Product Type | CAD Priority | Complexity | Use Frequency | ROI |
|--------------|--------------|------------|---------------|-----|
| **Slab** | ⭐⭐⭐ Critical | High | Very High | Very High |
| **Longitudinal** | ⭐⭐ High | Low | High | High |
| **Remaining Stones** | ⭐⭐ High | Medium | High | High |
| **Stair** | ⭐ Low | Very High | Medium | Medium |

### Detailed Use Cases

#### Use Case 1: Slab Stone Design (CRITICAL)
**Scenario:**
- User has 3 standard slabs: 240×178cm (qty:1), 250×190cm (qty:2)
- Wants to cut to: 200×150cm (qty:3)
- Needs to visualize cuts and remaining pieces

**CAD Tool Requirements:**
1. Show all 3 standard slabs
2. Draw desired cut dimensions on each
3. Show remaining pieces after cuts
4. Calculate cutting costs automatically
5. Optimize layout to minimize waste

**Integration Points:**
- Product configuration modal (slab section)
- Standard dimensions table
- Cutting cost calculation
- Remaining stones generation

---

#### Use Case 2: Longitudinal Stone Planning
**Scenario:**
- User has stone: 300cm width
- Wants multiple pieces: 100cm, 80cm, 60cm
- Needs to plan optimal cutting sequence

**CAD Tool Requirements:**
1. Show original stone (300cm width)
2. Draw multiple desired pieces
3. Show optimal cutting layout
4. Calculate waste
5. Generate remaining pieces

**Integration Points:**
- Product configuration modal
- Cutting cost calculation
- Remaining stone creation

---

#### Use Case 3: Remaining Stone Utilization
**Scenario:**
- User has remaining piece: 50cm × 2m
- Wants to create new product from it
- Needs to plan cuts on remaining piece

**CAD Tool Requirements:**
1. Show remaining stone dimensions
2. Draw desired cuts
3. Validate cuts fit in remaining piece
4. Calculate new remaining pieces
5. Update parent product's remaining stones

**Integration Points:**
- Remaining stone modal
- Parent-child product relationship
- Remaining stone updates

---

## Library Decision

### Analysis Based on System Requirements

**Key Requirements:**
1. ✅ React integration (we use React)
2. ✅ Performance with multiple objects (slab has multiple standard dimensions)
3. ✅ Mobile support (users may use tablets)
4. ✅ Measurement tools (critical for stone cutting)
5. ✅ Export capabilities (for documentation)
6. ✅ Integration with existing StoneCanvas

### Decision: **Konva.js + React (react-konva)**

**Why Konva.js:**

1. **React Integration** ⭐⭐⭐
   - `react-konva` provides excellent React integration
   - Declarative API matches React patterns
   - Easy state management with React hooks

2. **Performance** ⭐⭐⭐
   - Better performance with multiple objects (critical for slab)
   - Selective rendering (only redraws changed layers)
   - Handles 1000+ objects smoothly

3. **Scene Graph Architecture** ⭐⭐⭐
   - Perfect for hierarchical structures (slab → standard dimensions → cuts)
   - Easy to group related objects
   - Better for complex layouts

4. **Mobile Support** ⭐⭐⭐
   - Optimized for touch devices
   - Better gesture handling
   - Tablet-friendly

5. **Measurement Tools** ⭐⭐
   - Can be built (not built-in, but flexible)
   - Custom tools easier to implement
   - Better control over measurement display

6. **Integration** ⭐⭐
   - Can coexist with existing StoneCanvas
   - Gradual migration possible
   - No breaking changes

**Comparison:**

| Requirement | Fabric.js | Konva.js | Winner |
|-------------|-----------|----------|--------|
| React Integration | ⚠️ Manual | ✅✅ react-konva | Konva.js |
| Performance (many objects) | ✅ | ✅✅ | Konva.js |
| Slab Multi-Stone Support | ✅ | ✅✅ | Konva.js |
| Mobile Support | ✅ | ✅✅ | Konva.js |
| Measurement Tools | ⚠️ Custom | ⚠️ Custom | Tie |
| Learning Curve | ✅✅ | ✅ | Fabric.js |
| Bundle Size | ⚠️ 85KB | ✅ 68KB | Konva.js |

**Final Decision: Konva.js + react-konva**

---

## Integration Points

### 1. Product Configuration Modal

**Location:** `frontend/src/app/dashboard/sales/contracts/create/page.tsx`

**Current Structure:**
```typescript
// Line ~12610: Product Info Section
{selectedProduct && (productConfig.productType === 'longitudinal' || productConfig.productType === 'slab') && (
  // Product info display
)}

// Line ~13818: Configuration Form
{(productConfig.productType === 'longitudinal' || productConfig.productType === 'slab') && (
  // Configuration inputs
)}
```

**CAD Integration Point:**
- Add CAD tool button/tab in product modal
- Show CAD designer when enabled
- Sync CAD design with product config
- Auto-calculate dimensions from CAD

---

### 2. Slab Standard Dimensions Section

**Location:** Line ~14320-14600

**Current Structure:**
- Standard dimensions table
- Add/remove dimensions
- Validation

**CAD Integration Point:**
- Visual representation of each standard dimension
- Draw cuts on each standard slab
- Show remaining pieces visually
- Validate cuts against standard dimensions

---

### 3. Remaining Stone Modal

**Location:** Line ~15471

**Current Structure:**
- Partition creation from remaining stone
- Dimension inputs
- Validation

**CAD Integration Point:**
- Visual representation of remaining stone
- Draw partitions on remaining stone
- Validate partitions fit
- Show remaining pieces after partition cuts

---

### 4. StoneCanvas Component

**Location:** `frontend/src/components/StoneCanvas.tsx`

**Current Functionality:**
- Visualization of stone utilization
- Click interactions for remaining stones
- Used/remaining area display

**CAD Integration Strategy:**
- **Option A**: Enhance existing StoneCanvas
- **Option B**: Create new StoneCADDesigner component
- **Option C**: Hybrid (StoneCanvas for view, CAD for edit)

**Recommended: Option C (Hybrid)**
- Keep StoneCanvas for visualization
- Add CAD mode toggle
- Switch between view/edit modes

---

### 5. Cost Calculation Integration

**Location:** Multiple calculation functions

**Current Functions:**
- `calculateStoneCutting()` - Line ~640
- `calculateSlabCutting()` - Line ~692
- `calculateSlabVerticalCutCost()` - Line ~1658
- `handleAddProductToContract()` - Line ~5890

**CAD Integration Point:**
- Extract dimensions from CAD design
- Pass to existing calculation functions
- Display costs in CAD tool
- Update product config with calculated costs

---

## Next Steps

**Part 2 will cover:**
- Detailed implementation architecture
- Component structure
- Data flow diagrams
- Integration patterns

**Part 3 will cover:**
- Phase-by-phase implementation plan
- Code examples
- Testing strategy
- Migration plan

---

*Last Updated: January 2025*
*Document Version: 1.0 - Part 1*

