# Stair System (دستگاه پله) Implementation Plan

## Overview
Refactoring the stair stone system to support 3 independent parts (کف پله, خیز پله, پاگرد) with separate product selection and configuration.

## Key Changes Required

### 1. Database Schema ✅
- Added `stairSystemId` and `stairPartType` to `ContractItem` model
- Migration needed: `npx prisma migrate dev --name add_stair_system_fields`

### 2. Data Structures ✅
- Created `StairPart` interface
- Created `StairSystemConfig` interface
- Updated `ContractProduct` to include stair system linking fields

### 3. State Management ✅
- Added `stairSystemConfig` state
- Added `initializeStairSystemConfig` helper function

### 4. Calculation Utilities ✅
- Added `calculateTreadMetrics()`
- Added `calculateRiserMetrics()`
- Added `calculateLandingMetrics()`

### 5. UI Changes (In Progress)
- Replace single stair form with 3 collapsible sections
- Each section has:
  - Checkbox to include/exclude the part
  - Product selector (defaults to main product, can be changed)
  - Part-specific dimensions
  - Quantity (default syncs with numberOfSteps, but can be changed independently)
  - Price calculation per part
  - Mandatory pricing per part

### 6. Handler Functions (Pending)
- Update `handleAddProductToContract()` to:
  - Generate unique `stairSystemId` (UUID or timestamp-based)
  - Create up to 3 `ContractProduct` items (one per selected part)
  - Set `stairPartType` for each item
- Update `handleCreateContract()` to:
  - Send `stairSystemId` and `stairPartType` to API
- Update backend API to accept these fields

### 7. Display Logic (Pending)
- Update product listing to group stair system items by `stairSystemId`
- Show as expandable/collapsible group

## Implementation Steps

1. ✅ Database schema update
2. ✅ Data structure updates
3. ✅ State management setup
4. ✅ Calculation utilities
5. 🔄 UI refactor (modal with 3 sections)
6. ⏳ Handler function updates
7. ⏳ Backend API updates
8. ⏳ Display logic updates

## Notes
- By default, tread and riser quantities sync with numberOfSteps
- User can change quantities independently (no auto-sync)
- Each part can have different product (manual selection)
- Landing is always separate from steps
- Mandatory pricing is per part, not per system

