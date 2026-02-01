# Recent Project Overview - Sabalan ERP

## 📋 Executive Summary

This document provides a comprehensive overview of the latest features and improvements implemented in the Sabalan ERP system, focusing on the Sales Contract Creation Wizard and CAD Design System.

---

## 🎯 Major Feature Areas

### 1. **Contract Creation Wizard Enhancements**

#### 1.1 User-Specific Contract Numbering System
**Location**: `backend/src/routes/sales.ts`, `frontend/src/app/dashboard/sales/contracts/create/page.tsx`

**Changes**:
- **User-Prefixed Contract Numbers**: Changed from fixed `SAL-000001` format to user-specific prefix based on user's name
  - Format: `[First 3 letters of user's name]-000001`
  - Example: `MAH-000001` for user "Mahaan Amirian"
- **Uniqueness per User**: Contract numbers are now unique per user, allowing different users to have their own sequential numbering
- **Backend Implementation**:
  - Added `getUserPrefix(firstName: string, lastName: string): string` function
  - Modified `/api/sales/contracts/next-number` endpoint to generate user-specific contract numbers
  - Includes gap-filling logic for deleted contracts

**User Interface**:
- Displays full English name of the current user creating the contract
- Shows user-prefixed contract number in Step 1 (Contract Date)

---

#### 1.2 Product Display Logic Improvements
**Location**: `frontend/src/app/dashboard/sales/contracts/create/page.tsx`

**Changes**:

**A. "حکمی" (Mandatory) Option Display**:
- When a product has `isMandatory: true` and `mandatoryPercentage > 0`
- The "بخش / نوع" (Section / Type) column now displays format: `[Type]/حکمی`
- Example: "طولی/حکمی" instead of just "طولی"

**B. "برش کله بر" (Head Cut) Display**:
- If a product uses only 1 cross cut (`cut.type === 'cross'`) with no other cuts
- Displays as "برش کله بر" instead of "برش عرضی"
- Applied consistently across:
  - Stone Price Details table
  - Slab cutting descriptions
  - Product cut descriptions
  - Stair tool meta-tools

**Implementation Details**:
- Updated `productPriceEntries` useMemo hook
- Updated `serviceEntries` useMemo hook with cutting service logic
- Consistent application across all product display areas

---

#### 1.3 Delivery Schedule Complete Rewrite
**Location**: `frontend/src/app/dashboard/sales/contracts/create/page.tsx` (Step 6)

**Major Changes**:

**Removed Fields**:
- ❌ "آدرس تحویل" (Delivery Address)
- ❌ "راننده" (Driver)
- ❌ "وسیله نقلیه" (Vehicle)

**Added Fields**:
- ✅ "نام مدیر پروژه" (Project Manager Name) - Auto-filled from customer/project data
- ✅ "نام تحویل‌گیرنده" (Receiver Name) - For double-checking

**New Features**:

1. **Complete Product Table**:
   - Displays all selected products with:
     - Product name
     - Section/Type (with حکمی indicator)
     - Total quantity
     - Remaining quantity (visual indicators)
     - Related services (tools, finishing, layers, cuts) with color-coded badges

2. **Multiple Delivery Dates**:
   - Can create multiple delivery schedules
   - Each delivery can have different products and quantities
   - Enables partial shipments (e.g., ship order in 3 times instead of all at once)

3. **Bulk Selection & Operations**:
   - Checkbox for each product
   - "انتخاب همه" (Select All) checkbox
   - Bulk action buttons:
     - "افزودن به تحویل جدید" (Add to New Delivery)
     - "افزودن انتخاب شده" (Add Selected) / "حذف انتخاب شده" (Remove Selected)

4. **Quantity Management**:
   - `getRemainingQuantity(productIndex)` calculates undistributed quantity
   - Visual indicators:
     - 🟡 Amber highlight if `remainingQuantity > 0`
     - 🟢 Green "✓ تمام شده" if `remainingQuantity === 0`
   - Editable quantity inputs with min/max validation

5. **Comprehensive Validation**:
   - Ensures at least one delivery exists
   - Validates delivery date, project manager name, receiver name
   - Ensures each delivery has at least one product
   - Prevents over-delivery (total delivered ≤ total quantity)
   - Ensures all products are fully distributed
   - Displays specific error messages for each validation failure
   - Warning banner for undistributed products
   - Success banner when all products are fully distributed

**Data Structure**:
```typescript
interface DeliveryProductItem {
  productIndex: number; // Index of the product in wizardData.products
  productId: string;
  quantity: number; // Quantity for this specific delivery
}

interface DeliverySchedule {
  deliveryDate: string;
  projectManagerName: string;
  receiverName: string;
  products: DeliveryProductItem[];
  notes?: string;
}
```

---

### 2. **Tool/Sub-Service Management Enhancements**

**Location**: `frontend/src/app/dashboard/sales/contracts/create/page.tsx`

#### 2.1 Unit Toggle System
**Feature**: Ability to switch between "متر" (meter) and "متر مربع" (square meter) for each sub-service

**Implementation**:
- Added `subServiceCalculationBases` state: `Record<string, 'length' | 'squareMeters'>`
- Toggle buttons for each selected sub-service
- Users can override the default calculation base from the sub-service definition
- Visual feedback shows selected unit

#### 2.2 Default Value Calculation
**Feature**: Automatically defaults to complete available amount

**Implementation**:
- When meter value is 0, automatically uses maximum available amount
- Calculates based on:
  - Available length (for meter-based tools)
  - Available square meters (for square meter-based tools)
- Shows "✓ مقدار کامل" (Complete Amount) indicator when using full amount

#### 2.3 Editable Amount/Measure
**Feature**: Users can edit the amount/measure for each sub-service

**Implementation**:
- `FormattedNumberInput` component for amount input
- Real-time validation prevents exceeding available amounts
- Shows maximum available amount as reference
- Allows partial usage (e.g., 20 meters of 35 meters available)

#### 2.4 Dynamic Price Calculation
**Feature**: Price calculation updates based on selected unit and amount

**Formula**: `cost = meterValue * subService.pricePerMeter`

**Display**:
- Total cost for the sub-service
- Price per unit (shows selected unit: متر or متر مربع)
- Updates in real-time as user changes amount or unit

**State Management**:
- Selected calculation base stored in `AppliedSubService.calculationBase`
- Proper state initialization when opening modal with existing sub-services
- State cleanup on modal close

---

### 3. **CAD Design System Enhancements**

#### 3.1 Additional Drawing Tools
**Location**: `frontend/src/components/stone-cad/tools/`

**New Tools Implemented**:
1. **Circle Tool** (`CircleTool.ts`)
   - Draw circles by clicking center and dragging to set radius
   - Real-time preview during drawing
   - Supports grid snapping

2. **Line Tool** (`LineTool.ts`)
   - Draw straight lines between two points
   - Visual feedback during drawing
   - Supports grid snapping

3. **Freehand Tool** (`FreehandTool.ts`)
   - Draw freehand strokes with mouse/touch
   - Smooth curve rendering with tension
   - Stroke width and color customization

4. **Text Tool** (`TextTool.ts`)
   - Add text annotations to designs
   - Customizable font size
   - Text positioning and editing

**Bug Fixes**:
- Fixed `TypeError: Konva.Line is not a constructor` and similar errors
- Changed from `const Konva = require('konva')` to `import Konva from 'konva'` in all tool files

---

#### 3.2 Export Functionality
**Location**: `frontend/src/components/stone-cad/utils/exportUtils.ts`

**Export Formats**:
1. **PNG Export**
   - High-resolution image export
   - Customizable pixel ratio
   - Quality settings

2. **SVG Export**
   - Vector format for scalable graphics
   - Supports all shape types (rectangle, circle, line, freehand, text, measurements)
   - Preserves design structure

3. **JSON Export**
   - Complete design data export
   - Includes metadata (product type, stone dimensions)
   - Allows for design import/restoration

**UI Integration**:
- Export dropdown in `CADToolbar`
- Easy access to all export formats
- Automatic filename generation with timestamp

---

#### 3.3 Layer Management System
**Location**: `frontend/src/components/stone-cad/hooks/useCADState.ts`

**Features**:
- Add new layers with custom names
- Update layer properties (name, visibility, lock status)
- Delete layers (with protection for last layer)
- Set active layer for drawing
- Layer ordering system

**Safety Features**:
- Cannot delete the last layer
- Shapes from deleted layer moved to default layer
- Default layer name generation when name is empty

---

#### 3.4 Undo/Redo Reactivity Fix
**Location**: `frontend/src/components/stone-cad/hooks/useCADState.ts`

**Issue Fixed**:
- Undo/redo operations were not properly triggering UI updates

**Solution**:
- Implemented `historyState` and `setHistoryState` for proper state management
- Ensures React reactivity for undo/redo operations

---

## 📊 Technical Implementation Details

### State Management
- All new features use React hooks (`useState`, `useMemo`, `useCallback`)
- Proper state initialization and cleanup
- Consistent state structure across components

### Type Safety
- All new interfaces properly typed in TypeScript
- Type consistency maintained across frontend and backend
- Proper interface definitions for all new data structures

### Validation
- Comprehensive validation for all user inputs
- Real-time validation feedback
- Clear error messages in Persian
- Prevents invalid operations (over-delivery, invalid amounts, etc.)

### User Experience
- Visual indicators for status (remaining quantity, complete amount, etc.)
- Color-coded badges for services
- Intuitive UI controls (toggles, checkboxes, bulk actions)
- Consistent Persian language labels and messages

---

## 🔄 Data Flow

### Contract Creation Flow
1. **Step 1**: Contract Date & Number Generation (User-specific)
2. **Step 2**: Customer Selection
3. **Step 3**: Project Management
4. **Step 4**: Product Type Selection
5. **Step 5**: Product Selection & Configuration
   - Sub-service management with unit toggle
   - Product display with حکمی and برش کله بر indicators
6. **Step 6**: Delivery Schedule (Complete rewrite)
   - Multiple deliveries
   - Product distribution
   - Bulk operations
7. **Step 7**: Payment Method
8. **Step 8**: Digital Signature (Future)

### Sub-Service Application Flow
1. User selects product
2. Opens "مدیریت ابزار" (Tool Management) modal
3. Selects sub-services (tools)
4. For each sub-service:
   - Chooses unit (meter or square meter)
   - Edits amount (defaults to complete amount)
   - Sees real-time price calculation
5. Validates all inputs
6. Applies sub-services to product
7. Updates product total price

---

## 📁 Key Files Modified

### Backend
- `backend/src/routes/sales.ts`
  - Contract number generation logic
  - User prefix generation
  - Gap-filling for contract numbers

### Frontend
- `frontend/src/app/dashboard/sales/contracts/create/page.tsx`
  - Contract wizard main component (16,996 lines)
  - All contract creation logic
  - Product management
  - Delivery schedule
  - Sub-service management

### CAD System
- `frontend/src/components/stone-cad/`
  - `hooks/useCADState.ts` - State management
  - `tools/*.ts` - Drawing tools
  - `utils/exportUtils.ts` - Export functionality
  - `StoneCADDesigner.tsx` - Main CAD component
  - `CADToolbar.tsx` - Toolbar component

---

## ✅ Quality Assurance

### Code Quality
- ✅ No linter errors
- ✅ TypeScript type safety maintained
- ✅ Consistent code style
- ✅ Proper error handling
- ✅ State management best practices

### Feature Completeness
- ✅ All requested features implemented
- ✅ Consistent behavior across the application
- ✅ Proper validation and error messages
- ✅ User-friendly UI/UX
- ✅ Persian language support

---

## 🚀 Future Improvements

Based on the CAD comparison document (`docs/CAD_PROFESSIONAL_COMPARISON.md`), potential future enhancements include:

1. **Copy/Paste Functionality**
2. **Transform Tools** (move, rotate, scale)
3. **Multi-Select** capabilities
4. **Cut Optimization** for stone cutting
5. **Precision Input** dialogs
6. **Properties Panel** for selected objects
7. **Alignment Tools**
8. **Nesting Algorithms** for material efficiency
9. **CNC Export** format support

---

## 📝 Notes

- All changes maintain backward compatibility where possible
- User-specific contract numbering includes backward compatibility with `SAL-` prefix
- Delivery schedule completely rewritten but maintains data structure compatibility
- CAD tools use consistent Konva.js integration pattern
- All Persian text properly formatted and consistent

---

**Document Version**: 1.0  
**Last Updated**: Based on latest project changes  
**Status**: ✅ All features implemented and tested

