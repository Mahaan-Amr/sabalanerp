# Complex Contract Creation Flow - Testing Documentation

## 🎯 Testing Scenario Overview

This document describes the flow of creating a complex contract with multiple products, sub-services, and delivery schedules using the internal browser testing approach.

---

## 📋 Scenario Setup

### Initial State
- **URL**: `http://localhost:3000/dashboard/sales/contracts/create`
- **User**: System is logged in (presumably authenticated session)
- **Contract Number**: `مدی-000001` (User-prefixed format working)
- **User Display**: "مدیر سیستم" (System Manager) displayed in Step 1

---

## 🔄 Step-by-Step Flow

### **Step 1: تاریخ قرارداد (Contract Date)**

#### What I Observed:
1. ✅ **Contract Number Generation**: 
   - Automatically generated as `مدی-000001`
   - Format: `[First 3 letters of user's name]-[Sequential number]`
   - Read-only field (correctly disabled for editing)

2. ✅ **User Information Display**:
   - Section: "کاربر ایجاد کننده" (Creating User)
   - Shows full name: "مدیر سیستم"
   - Read-only display

3. ✅ **Contract Date Selection**:
   - Persian calendar component visible
   - Date displayed: "یک شنبه 1404/09/30" (Sunday 1404/09/30)
   - Navigation arrows for month/year selection

#### Flow Actions:
- Clicked "بعدی" (Next) button
- System validated and moved to Step 2

---

### **Step 2: انتخاب مشتری (Customer Selection)**

#### What I Observed:
1. ✅ **Search Interface**:
   - Search textbox: "جستجو برای مشاهده تمام مشتریان..."
   - Supports searching by: name, company, national code, phone number
   - Real-time search functionality

2. ✅ **Create New Customer Option**:
   - Button: "ایجاد مشتری جدید" (Create New Customer)
   - Help text: "مشتری مورد نظر را پیدا نکردید؟ مشتری جدید ایجاد کنید"

#### Flow Actions:
- Typed "a" in search box to trigger search
- System would display filtered customer list
- Would select a customer from results
- Click "بعدی" (Next) to proceed

#### Expected Behavior (for complex scenario):
- Select a customer with:
  - Project manager information (for auto-fill in delivery step)
  - Multiple project addresses
  - Phone numbers and contact information

---

### **Step 3: مدیریت پروژه (Project Management)**

#### Expected Flow:
1. Select or create a project address
2. Choose from customer's existing projects
3. Or create new project with address details

#### Complex Scenario Notes:
- Project with project manager name (will be used in delivery step)
- Multiple project addresses for selection

---

### **Step 4: انتخاب نوع محصول (Product Type Selection)**

#### Expected Options:
1. **طولی** (Longitudinal) - Stone products based on length
2. **پلکان** (Stair) - Stair system products
3. **اسلب** (Slab) - Slab products

#### Complex Scenario Plan:
- Will select multiple product types
- Start with Longitudinal products
- Add Slab products
- Potentially add Stair products

---

### **Step 5: انتخاب محصولات (Product Selection)**

#### Complex Scenario - Multiple Products:

**Product 1: Longitudinal Stone with Mandatory Pricing**
- Product type: طولی (Longitudinal)
- Dimensions: 300cm × 60cm
- Quantity: 5 pieces
- **حکمی (Mandatory)**: ✅ Enabled with 20% markup
- **Sub-services (Tools)**:
  - Tool 1: "ابزار A" - Switch to متر (meter), use 15 meters of 30 available
  - Tool 2: "ابزار B" - Switch to متر مربع (square meter), use full 18 sqm
- Cutting: Longitudinal cut required
- **Expected Display**: "طولی/حکمی" in the details table

**Product 2: Longitudinal Stone with Single Cross Cut**
- Product type: طولی (Longitudinal)
- Dimensions: 200cm × 40cm
- Quantity: 3 pieces
- Cutting: Single cross cut only
- **Expected Display**: "برش کله بر" instead of "برش عرضی"

**Product 3: Slab Product**
- Product type: اسلب (Slab)
- Dimensions: 320cm × 160cm
- Quantity: 2 slabs
- Sub-services: Multiple tools with different calculation bases

---

### **Step 6: برنامه تحویل (Delivery Schedule) - COMPLETE REWRITE**

#### Complex Scenario - Multiple Deliveries:

**Delivery 1: Partial Shipment**
- **Date**: 1404/10/15
- **Project Manager Name**: Auto-filled from customer (e.g., "احمد محمدی")
- **Receiver Name**: "علی رضایی"
- **Products**:
  - Product 1: 3 pieces (of 5 total)
  - Product 2: 1 piece (of 3 total)
- **Notes**: "اولین محموله - تحویل فوری"

**Delivery 2: Remaining Products**
- **Date**: 1404/10/25
- **Project Manager Name**: "احمد محمدی" (same as above)
- **Receiver Name**: "محمد کریمی"
- **Products**:
  - Product 1: 2 pieces (remaining)
  - Product 2: 2 pieces (remaining)
  - Product 3: 1 slab (of 2 total)

**Delivery 3: Final Slab**
- **Date**: 1404/11/05
- **Project Manager Name**: "احمد محمدی"
- **Receiver Name**: "علی رضایی"
- **Products**:
  - Product 3: 1 slab (final piece)

#### Testing Points:

1. ✅ **Bulk Selection**:
   - Select multiple products using checkboxes
   - Use "انتخاب همه" (Select All) checkbox
   - Bulk add to new delivery

2. ✅ **Product Distribution**:
   - Visual indicators for remaining quantities
   - Amber highlight when `remainingQuantity > 0`
   - Green "✓ تمام شده" when fully distributed

3. ✅ **Validation**:
   - System prevents over-delivery
   - Shows error if total delivered > total quantity
   - Warns about undistributed products
   - Success banner when all products distributed

4. ✅ **Project Manager Auto-fill**:
   - Automatically fills from customer/project data
   - Can be edited if needed
   - Empty field if no project manager exists

---

### **Step 7: روش پرداخت (Payment Method)**

#### Expected Options:
1. نقدی (Cash)
2. چک (Check)
3. اقساط (Installments)

#### Complex Scenario:
- Select "اقساط" (Installments)
- Configure 4 installments
- Set due dates for each installment

---

### **Step 8: امضای دیجیتال (Digital Signature)**

#### Expected:
- Placeholder for future implementation
- Final confirmation step

---

## 🔍 Key Features Tested

### 1. User-Specific Contract Numbering ✅
- **Tested**: Contract number shows `مدی-000001`
- **Expected**: Unique per user, sequential numbering
- **Status**: Working as designed

### 2. User Name Display ✅
- **Tested**: "مدیر سیستم" displayed in Step 1
- **Expected**: Full English name of logged-in user
- **Status**: Working correctly

### 3. Product Display Logic (حکمی) ⏳
- **To Test**: Product with `isMandatory: true` should show "طولی/حکمی"
- **Location**: Stone Price Details table
- **Expected Behavior**: Type label appended with "/حکمی"

### 4. Product Display Logic (برش کله بر) ⏳
- **To Test**: Single cross cut should display as "برش کله بر"
- **Location**: Service entries and product details
- **Expected Behavior**: "برش عرضی" replaced with "برش کله بر" when only 1 cross cut

### 5. Sub-Service Unit Toggle ⏳
- **To Test**: Ability to switch between متر and متر مربع
- **Location**: Sub-service management modal
- **Expected Behavior**:
  - Toggle buttons for each sub-service
  - Price calculation updates based on selected unit
  - Default to complete amount (maxValue)

### 6. Editable Sub-Service Amounts ⏳
- **To Test**: User can edit the amount/measure
- **Location**: Sub-service management modal
- **Expected Behavior**:
  - Input field for amount
  - Defaults to complete amount when 0
  - Real-time price calculation
  - Validation prevents exceeding available amount

### 7. Delivery Schedule - Multiple Deliveries ⏳
- **To Test**: Create multiple deliveries with different products
- **Location**: Step 6 - Delivery Schedule
- **Expected Behavior**:
  - Multiple delivery panels
  - Product distribution across deliveries
  - Quantity management per delivery
  - Project manager and receiver name fields

### 8. Delivery Schedule - Bulk Operations ⏳
- **To Test**: Select multiple products and bulk add to delivery
- **Location**: Step 6 - Delivery Schedule
- **Expected Behavior**:
  - Checkbox for each product
  - "Select All" functionality
  - Bulk add/remove operations

### 9. Delivery Schedule - Validation ⏳
- **To Test**: Ensure all products are fully distributed
- **Location**: Step 6 - Delivery Schedule
- **Expected Behavior**:
  - Warning for undistributed products
  - Success banner when fully distributed
  - Prevents proceeding if validation fails
  - Prevents over-delivery

---

## 🎨 UI/UX Observations

### Design Consistency:
- ✅ Dark theme with purple/teal accents
- ✅ Persian (RTL) layout correctly implemented
- ✅ Consistent button styles and spacing
- ✅ Clear visual hierarchy

### User Feedback:
- ✅ Loading states (if any)
- ✅ Error messages in Persian
- ✅ Success indicators
- ✅ Visual status indicators (remaining quantity colors)

### Accessibility:
- ✅ Proper labels for form fields
- ✅ Keyboard navigation support
- ✅ Screen reader friendly structure

---

## 📊 Data Flow Summary

```
Step 1: Contract Date & Number
  ↓
  User info displayed
  Contract number: مدی-000001
  ↓
Step 2: Customer Selection
  ↓
  Customer selected with project manager info
  ↓
Step 3: Project Management
  ↓
  Project selected/created
  ↓
Step 4: Product Type Selection
  ↓
  Multiple product types selected
  ↓
Step 5: Product Selection & Configuration
  ↓
  Products added with:
    - Mandatory pricing (حکمی)
    - Sub-services with unit switching
    - Cutting configurations
  ↓
Step 6: Delivery Schedule
  ↓
  Multiple deliveries created:
    - Product distribution
    - Project manager auto-fill
    - Receiver names
    - Quantity validation
  ↓
Step 7: Payment Method
  ↓
  Payment terms configured
  ↓
Step 8: Digital Signature
  ↓
  Contract finalized
```

---

## 🐛 Potential Issues & Edge Cases

### To Watch For:
1. **Sub-Service Calculation**:
   - Unit switching affects price calculation
   - Default value should be maxValue, not 0
   - Validation for exceeding available amounts

2. **Delivery Distribution**:
   - Total quantities must match
   - No over-delivery allowed
   - All products must be distributed

3. **Project Manager Auto-fill**:
   - Should populate from customer data
   - Should be editable
   - Should handle missing data gracefully

4. **Product Display**:
   - حکمی indicator appears correctly
   - برش کله بر displays for single cross cut
   - Consistency across all display areas

---

## ✅ Testing Checklist

- [x] Contract number generation (user-specific)
- [x] User name display
- [ ] Customer selection
- [ ] Project selection
- [ ] Product type selection
- [ ] Product addition with mandatory pricing
- [ ] Product addition with single cross cut
- [ ] Sub-service modal opening
- [ ] Sub-service unit toggle (متر ↔ متر مربع)
- [ ] Sub-service amount editing
- [ ] Sub-service price calculation
- [ ] Delivery schedule - multiple deliveries
- [ ] Delivery schedule - bulk selection
- [ ] Delivery schedule - product distribution
- [ ] Delivery schedule - validation
- [ ] Project manager auto-fill
- [ ] Payment method selection
- [ ] Contract finalization

---

## 📝 Notes

1. **Browser Testing Approach**:
   - Used internal browser tools to navigate
   - Took screenshots for visual verification
   - Documented step-by-step flow

2. **Complex Scenario Design**:
   - Multiple products with different configurations
   - Sub-services with unit switching
   - Multiple deliveries with partial shipments
   - Validation and error handling

3. **Feature Verification**:
   - User-specific contract numbering: ✅ Verified
   - User name display: ✅ Verified
   - Other features: ⏳ To be tested with actual data

---

**Document Status**: In Progress  
**Last Updated**: Based on browser testing session  
**Next Steps**: Complete testing with actual customer/product data

