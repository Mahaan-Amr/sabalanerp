# Contract Creation Refactoring Notes

## 📊 Refactoring Progress Summary

### Completed Work (January 2026)

**Original File Size**: 12,309 lines
**Current File Size**: 9,705 lines
**Total Lines Removed**: **2,604 lines (21.2% reduction)**
**TypeScript Errors**: 0 ✅

---

## ✅ Completed Extractions

### Phase 1-4: Initial Extractions (~2,366 lines)
These phases were completed in previous refactoring sessions and included:
- Hook extractions (useContractWizard, useProductModal, etc.)
- Utility functions
- Service layer separations
- Type definitions

### Phase 5: Stair System Helpers (51 lines)
**File Created**: [`utils/stairSystemHelpers.ts`](./utils/stairSystemHelpers.ts)

**Extracted Functions**:
- `hasLayerEdgeSelection()` - Check if draft has layer edge selection
- `deriveLayerEdgesFromTools()` - Aggregate edge selections from tools (41 lines)
- `getPartDisplayLabel()` - Get Persian labels for stair parts
- `getProductCuttingCost()` - Calculate total cutting cost for product
- `getProductServiceCost()` - Calculate total service cost (tools + cutting)

**Impact**: Removed pure utility functions, improved code organization

---

### Phase 6: Validation Utilities (172 lines)
**File Used**: [`services/stairValidationService.ts`](./services/stairValidationService.ts) *(already existed)*

**Imported Functions**:
- `validateDraftNumericFields()` - Comprehensive numeric validation (119 lines)
- `validateDraftRequiredFields()` - Required fields validation (55 lines)
- `clearDraftFieldError()` - Clear specific field error (pure function)

**Implementation Details**:
- Created `clearDraftFieldErrorWrapper()` in main component to bridge pure validation functions with component state
- Updated all 24 callsites to use wrapper function
- Passed `stairSystemV2.layerTypes` as parameter to validation functions

**Impact**: Eliminated duplicate validation logic, improved maintainability

---

### Phase 7.1: Import Optimization & Verification Handlers (Net: +65 lines)
**Changes**:
- Removed 31 lines of redundant comments from import section
- Added `handleSendVerificationCode()` (48 lines) - restored from backup
- Added `handleVerifyCode()` (42 lines) - restored from backup
- Integrated with `useDigitalSignature` hook state

**Impact**: Fixed TypeScript errors, improved import organization

---

### Phase 7.2: HTML Generator Extraction (80 lines)
**File Created**: [`utils/contractHTMLGenerator.ts`](./utils/contractHTMLGenerator.ts)

**Extracted Function**:
- `generateContractHTML()` - Generate printable HTML contract (81 lines)

**Impact**: Pure function extraction, no state dependencies

---

## 🔄 Remaining Large Functions (Future Refactoring Candidates)

### Critical Priority: Product Management Functions (~1,510 lines)

These functions are tightly coupled to wizard state and require careful extraction:

#### 1. `handleAddProductToContract` (925 lines)
**Location**: Lines 2447-3372
**Complexity**: Very High
**Dependencies**: 50+ variables and functions

**What it does**:
- Validates product configuration based on product type
- Handles 3 product types: `stair`, `slab`, `stone`
- Supports both V1 and V2 stair system flows
- Creates or updates contract products
- Calculates metrics, costs, and totals
- Manages remaining stones and partitions

**Extraction Strategy** (for future):
1. Create `useProductManagement` hook
2. Map all dependencies (state, functions, calculations)
3. Extract validation logic first
4. Extract product creation logic by type
5. Test each product type thoroughly
6. Maintain backward compatibility

**Dependencies**:
```typescript
// State dependencies
- wizardData, updateWizardData
- selectedProduct, productConfig
- stairSystemConfig, useStairFlowV2
- stairSystemV2 (entire hook state)
- isEditMode, editingProductIndex
- errors, setErrors

// Function dependencies
- calculateTreadMetrics, calculateRiserMetrics, calculateLandingMetrics
- calculateSlabMetrics, generateFullProductName
- determineSlabLineCutPlan, getSlabStandardDimensions
- computeTotalsV2, getActualLengthMeters, getPricingLengthMeters
- computeToolMetersForTool, computeToolsMetersV2
- And 20+ more utility functions...
```

---

#### 2. `handleEditProduct` (374 lines)
**Location**: Lines 1888-2262
**Complexity**: High
**Dependencies**: 30+ variables

**What it does**:
- Loads existing product for editing
- Reconstructs stair system state from saved data
- Converts ContractProduct to StairPartDraftV2
- Handles layer products and tool selections
- Supports both V1 and V2 flows

**Extraction Strategy** (for future):
1. Part of same `useProductManagement` hook
2. Shares dependencies with handleAddProductToContract
3. Extract conversion helpers first (`productToDraft`, `mergeLayerInfo`)
4. Extract V2 reconstruction logic
5. Test editing for each product type

---

#### 3. `handleProductSelection` (211 lines)
**Location**: Lines 1562-1773
**Complexity**: Medium-High
**Dependencies**: 25+ variables

**What it does**:
- Handles product selection from product list
- Initializes configuration based on product type
- Pre-fills stair system drafts (V2 flow)
- Sets up modal state for product configuration
- Handles slab and stone product initialization

**Extraction Strategy** (for future):
1. Part of same `useProductManagement` hook
2. Extract initialization logic by product type
3. Create helper functions for each flow
4. Consolidate V1/V2 flow handling

---

### Medium Priority: Render & Validation Functions

#### 4. `renderStepContent` (133 lines)
**Location**: Lines 3527-3660
**Complexity**: Low
**Type**: Render logic

**What it does**: Large switch statement rendering step components

**Extraction Strategy**: Keep as-is (already uses step components)

---

#### 5. `validateCurrentStep` (129 lines)
**Location**: Lines 3377-3506
**Complexity**: Medium
**Type**: Validation logic

**What it does**: Validates wizard step data before progression

**Extraction Strategy**:
- Could extract to `utils/wizardValidation.ts`
- Pure function taking `wizardData` and `currentStep`
- Low priority (already well-organized)

---

### Low Priority: Smaller Functions

#### 6. `handleCreateFromRemainingStone` (84 lines)
**Location**: Lines 2265-2349
**Extraction**: Could move to `useRemainingStoneModal` hook

#### 7. `handleWidthUnitChange` (66 lines)
**Location**: Lines 1818-1884
**Extraction**: Could consolidate with `handleLengthUnitChange` into unit conversion hook

#### 8. `initializeStairSystemConfig` (63 lines)
**Location**: Lines 1009-1072
**Extraction**: Could move to `utils/stairSystemHelpers.ts`

---

## 📐 Architecture Recommendations

### For Future Product Management Extraction

When ready to tackle the remaining 1,510 lines, use this approach:

```typescript
// hooks/useProductManagement.ts
export const useProductManagement = (options: {
  wizardData: ContractWizardData;
  updateWizardData: (updates: Partial<ContractWizardData>) => void;
  // ... all required dependencies
}) => {

  // Internal state management
  const [validationErrors, setValidationErrors] = useState({});

  // Product selection logic
  const handleProductSelection = useCallback((product: Product) => {
    // Full implementation from original function
  }, [dependencies]);

  // Product editing logic
  const handleEditProduct = useCallback((index: number) => {
    // Full implementation from original function
  }, [dependencies]);

  // Product addition logic
  const handleAddProductToContract = useCallback(() => {
    // Break into smaller functions:
    // - validateProductConfig()
    // - createStairSystemProducts()
    // - createSlabProduct()
    // - createStoneProduct()
    // - addProductsToWizard()
  }, [dependencies]);

  return {
    handleProductSelection,
    handleEditProduct,
    handleAddProductToContract,
    validationErrors
  };
};
```

### Key Principles for Future Refactoring

1. **Incremental Extraction**: Extract one function at a time, test thoroughly
2. **Maintain API**: Keep the same function signatures for handlers
3. **Type Safety**: Ensure full TypeScript coverage
4. **Zero Breaking Changes**: All existing functionality must work
5. **Test Coverage**: Add tests for extracted logic
6. **Documentation**: Document complex business logic

---

## 🎯 Current State Analysis

### File Structure (9,705 lines)
```
Lines 1-135:    Imports and setup (135 lines)
Lines 136-3375: Component body - hooks, state, handlers (3,240 lines)
Lines 3376-9705: Render section - JSX and modals (6,330 lines)
```

### Largest Remaining Inline Code Blocks
1. Product management handlers: ~1,510 lines
2. Render/JSX section: ~6,330 lines
3. Helper functions: ~800 lines
4. State initialization & effects: ~600 lines

---

## 📝 Lessons Learned

### What Worked Well
✅ **Pure function extraction** - Easy wins (stair helpers, HTML generator)
✅ **Using existing services** - Validation functions already existed
✅ **Wrapper pattern** - Bridge pure functions with component state
✅ **Careful reading** - Avoided breaking changes through thorough analysis
✅ **Incremental approach** - Small, tested changes maintain stability

### What Requires More Effort
⚠️ **Highly coupled handlers** - Product management functions have 50+ dependencies
⚠️ **Dual system support** - V1/V2 flows complicate extraction
⚠️ **Complex validation** - Product type-specific logic deeply nested
⚠️ **State interdependencies** - Many functions share and mutate common state

---

## 🚀 Next Steps (When Ready)

### Recommended Sequence for Future Work

1. **Phase 8: Extract Unit Conversion Logic** (~100 lines)
   - Consolidate `handleLengthUnitChange` and `handleWidthUnitChange`
   - Create `useUnitConversion` hook
   - Estimated impact: 100-120 lines

2. **Phase 9: Extract Stair System Initialization** (~80 lines)
   - Move `initializeStairSystemConfig` to utils
   - Move `handleCreateFromRemainingStone` to hook
   - Estimated impact: 80-100 lines

3. **Phase 10: Product Management Extraction** (~1,510 lines) ⭐
   - **High complexity** - requires dedicated refactoring sprint
   - Break into sub-phases by product type
   - Extensive testing required
   - Estimated effort: 8-12 hours of careful work

4. **Phase 11: Modal Render Optimization** (~200 lines)
   - Extract modal prop preparation
   - Reduce duplication in modal rendering
   - Create helper functions for prop mapping

---

## 📈 Impact Metrics

### Code Quality Improvements
- **Modularity**: ⬆️ Improved (hooks and utils well-separated)
- **Reusability**: ⬆️ Improved (validation and helpers now reusable)
- **Testability**: ⬆️ Improved (pure functions easier to test)
- **Maintainability**: ⬆️ Significantly improved (21.2% reduction)
- **Type Safety**: ✅ Maintained (0 TypeScript errors)

### Performance Impact
- **Bundle Size**: No change (same functionality)
- **Runtime Performance**: No change (same logic)
- **Developer Experience**: ⬆️ Improved (easier to navigate)

---

## 🔍 Technical Debt Notes

### Known Issues to Address
1. **V1/V2 Dual Support**: Eventually remove V1 stair system flow
2. **Large Product Handlers**: Still too complex, need extraction
3. **Modal Prop Drilling**: 78 props to ProductConfigurationModal
4. **State Fragmentation**: Some state in hooks, some local

### Future Cleanup Opportunities
- Remove `useStairFlowV2` feature flag once V2 is stable
- Consolidate product type handling into strategy pattern
- Extract validation into dedicated service layer
- Consider state management library for complex wizard state

---

## 📚 Related Documentation

- Original refactoring plan: `/docs/refactoring-plan.md` *(if exists)*
- Hook documentation: See individual hook files for usage
- Type definitions: `types/contract.types.ts`
- Validation service: `services/stairValidationService.ts`

---

**Last Updated**: January 2026
**Refactored By**: AI Assistant (Claude Sonnet 4.5)
**Status**: ✅ Phase 1-7 Complete | ⏸️ Phase 8+ Deferred
