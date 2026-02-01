# Stair System Testing Scenario - Complete Guide

This guide will walk you through testing all the stair system implementations step by step.

---

## 🎯 Test Objectives

This scenario will verify:
1. ✅ **Riser Calculation Dependency Validation** (High Priority)
2. ✅ **Modal Close Validation** (Medium Priority)
3. ✅ **Stair System Grouping in Wizard** (Medium Priority)
4. ✅ **Stair-Specific Fields Display in Wizard** (Medium Priority)
5. ✅ **Stair System Grouping in Contract Detail Page** (High Priority)
6. ✅ **Stair-Specific Fields Display in Contract Detail Page** (Medium Priority)

---

## 📋 Prerequisites

- ✅ Application running at `http://localhost:3000`
- ✅ Logged in as a user with Sales permissions
- ✅ At least one customer exists in the system
- ✅ At least one product exists in the system (for stair parts)
- ✅ Master data (Cut Types, Stone Materials, etc.) is available

---

## 🚀 Step-by-Step Testing Guide

### **Phase 1: Contract Creation Setup**

#### **Step 1: Navigate to Contract Creation**
1. Go to: `http://localhost:3000/dashboard/sales`
2. Click on **"ثبت سفارش جدید"** (Create New Order)
   - OR navigate directly to: `http://localhost:3000/dashboard/sales/contracts/create`
3. You should see the contract creation wizard with **"مرحله 1 از 7"** (Step 1 of 7)

---

#### **Step 2: Select Contract Date (Step 1)**
1. **Select a date** using the Persian calendar (default: today's date)
2. Verify the **contract number** is displayed (should auto-generate, e.g., starting from 1000)
3. Click **"بعدی"** (Next)
4. ✅ **Expected**: Progress to Step 2

---

#### **Step 3: Select Customer (Step 2)**
1. **Search for a customer** or select from the list
2. If needed, click **"+ ایجاد سریع"** (Quick Create) to create a new customer
3. Select a customer
4. Click **"بعدی"** (Next)
5. ✅ **Expected**: Progress to Step 3

---

#### **Step 4: Select Project (Step 3)**
1. **Select a project** for the customer or create a new one
2. Click **"بعدی"** (Next)
3. ✅ **Expected**: Progress to Step 4

---

#### **Step 5: Select Product Type (Step 4)**
1. You should see **"انتخاب نوع محصول"** (Select Product Type)
2. **Select "سنگ پله"** (Stair Stone) - NOT "سنگ طولی"
3. Click **"بعدی"** (Next)
4. ✅ **Expected**: Progress to Step 5 (Product Selection)

---

### **Phase 2: Stair System Configuration**

#### **Step 6: Initial Stair Configuration Setup**
1. You should see the **main stair system configuration** interface
2. **Common Configuration:**
   - **"نوع تعداد" (Quantity Type):** Select **"تعداد پله"** (Number of steps)
   - **"تعداد پله" (Number of Steps):** Enter **`15`**
3. You should see **three collapsible sections:**
   - ✅ **"کف پله (Tread)"** - with checkbox
   - ✅ **"خیز پله (Riser)"** - with checkbox
   - ✅ **"پاگرد (Landing)"** - with checkbox

---

#### **Step 7: Configure "کف پله" (Tread) Part**

1. **In the "کف پله (Tread)" section:**
   - ✅ **Check the checkbox** to enable this part
   - Click **"افزودن"** (Add) button OR click inside the section to expand it

2. **Product Settings Modal Opens:**
   - You should see **"تنظیمات محصول"** (Product Settings) modal
   - Modal title should show product configuration

3. **Select Product:**
   - Click **"انتخاب محصول"** (Select Product) or use the search field
   - **Search for and select** a suitable stone product (e.g., "تایل کریستال" or any available product)
   - Product should appear in the modal

4. **Configure Tread Dimensions:**
   - **"طول پله (عرض پله‌کان)" (Step Length):**
     - Enter **`120`**
     - Select unit: **"سانتی‌متر (cm)"** or **"متر (m)"** (let's use **"سانتی‌متر (cm)"**)
   - **"عرض پله (عمق پله) (cm)" (Step Width):**
     - Enter **`35`** (should show hint: "معمولاً 28-32 سانتی‌متر")

5. **Quantity:**
   - The **"تعداد"** field should show **`15`** (default from main config)
   - ✅ **Expected**: Quantity matches the "تعداد پله" from main config

6. **Nosing Configuration (Optional):**
   - **"نوع پیشانی" (Nosing Type):** Select one (e.g., "پیشانی گرد (Bullnose)")
   - ✅ **Expected**: Nosing cost should be calculated and displayed

7. **Price per Square Meter:**
   - **"فی هر متر مربع (تومان)":** Enter a price (e.g., `500000`)

8. **Mandatory Pricing (Optional):**
   - Leave **"حکمی (افزایش قیمت)"** unchecked for now

9. **Verify Calculations:**
   - ✅ Check that **"متر مربع"** is calculated correctly
   - ✅ Check that **"قیمت کل کف پله"** is calculated correctly
   - ✅ If nosing is selected, check that nosing cost is included in total

10. **Add to Contract:**
    - Click **"افزودن به قرارداد"** (Add to Contract)
    - ✅ **Expected**: Modal closes
    - ✅ **Expected**: "کف پله" section shows the selected product with calculated values
    - ✅ **Expected**: A checkmark or visual indicator shows the part is configured

---

#### **Step 8: Configure "خیز پله" (Riser) Part - Testing Validation**

1. **In the "خیز پله (Riser)" section:**
   - ✅ **Check the checkbox** to enable this part
   - Click **"افزودن"** (Add) button

2. **Product Settings Modal Opens**

3. **Select Product:**
   - Click **"انتخاب محصول"** (Select Product)
   - Select a stone product (can be same as tread or different)
   - Product should appear

4. **Configure Riser Dimensions:**
   - **"ارتفاع قائمه (cm)" (Riser Height):** Enter **`18`** (should show hint: "معمولاً 15-19 سانتی‌متر")

5. **Quantity:**
   - Should default to **`15`** (from main config)

6. **Price per Square Meter:**
   - Enter a price (e.g., `450000`)

7. **🔍 TEST: Riser Calculation Dependency Validation (HIGH PRIORITY)**
   
   **Test Scenario A: Normal Flow (Tread Already Added)**
   - Since you already added tread in Step 7, this should work normally
   - Click **"افزودن به قرارداد"** (Add to Contract)
   - ✅ **Expected**: Modal closes successfully
   - ✅ **Expected**: Riser metrics are calculated correctly
   - ✅ **Expected**: Riser area uses tread width from Step 7

   **Test Scenario B: Riser Without Tread (Validation Test)**
   - **Close the modal** if it's open
   - **Uncheck "کف پله"** checkbox to disable tread
   - **Try to add "خیز پله"** again
   - Fill in all required fields
   - Click **"افزودن به قرارداد"**
   - ✅ **Expected**: Error message appears: **"برای محاسبه خیز پله، ابتدا باید کف پله را انتخاب کرده و طول پله را وارد کنید"**
   - ✅ **Expected**: Modal does NOT close
   - ✅ **Expected**: Error is displayed in red text
   - **Re-check "کف پله"** and continue

---

#### **Step 9: Configure "پاگرد" (Landing) Part**

1. **In the "پاگرد (Landing)" section:**
   - ✅ **Check the checkbox** to enable this part
   - Click **"افزودن"** (Add) button

2. **Product Settings Modal Opens**

3. **Select Product:**
   - Click **"انتخاب محصول"** (Select Product)
   - Select a stone product

4. **Configure Landing Dimensions:**
   - **"عرض پاگرد (cm)" (Landing Width):** Enter **`100`**
   - **"عمق پاگرد (cm)" (Landing Depth):** Enter **`200`**
   - **"تعداد پاگرد" (Number of Landings):** Enter **`1`**

5. **Price per Square Meter:**
   - Enter a price (e.g., `480000`)

6. **Add to Contract:**
   - Click **"افزودن به قرارداد"** (Add to Contract)
   - ✅ **Expected**: Modal closes
   - ✅ **Expected**: Landing section shows configured product

---

#### **Step 10: Test Modal Close Validation (MEDIUM PRIORITY)**

1. **Open any stair part configuration again** (e.g., click "افزودن" on "کف پله")

2. **Test Scenario A: Try to Close Without Selection**
   - **Do NOT select a product**
   - **Do NOT fill any required fields**
   - Click the **"X"** button in the top-right corner of the modal
   - ✅ **Expected**: Modal does NOT close
   - ✅ **Expected**: Error message: **"لطفاً حداقل یکی از بخش‌های پله (کف پله، خیز پله، یا پاگرد) را انتخاب کنید"**
   - ✅ **Expected**: Error is displayed in the modal

3. **Test Scenario B: Try to Close with Cancel Button**
   - Click **"انصراف"** (Cancel) button at the bottom
   - ✅ **Expected**: Same validation error as above

4. **Test Scenario C: Valid Close**
   - Select a product and fill required fields
   - Click **"انصراف"** (Cancel)
   - ✅ **Expected**: Modal closes without error

---

### **Phase 3: Verify Selected Products Display**

#### **Step 11: Verify Stair System Grouping in Wizard**

1. **After adding all three stair parts**, scroll down to the **"محصولات انتخاب شده"** (Selected Products) section

2. **🔍 Verify Stair System Grouping (MEDIUM PRIORITY):**
   - ✅ **Expected**: You should see a **purple-themed header** with:
     - **"دستگاه پله"** badge/label
     - **"15 پله (تعداد پله)"** summary text
     - **Total price** for the entire stair system
   - ✅ **Expected**: Under the header, all three parts are displayed:
     - **"کف پله"** with purple badge
     - **"خیز پله"** with purple badge
     - **"پاگرد"** with purple badge
   - ✅ **Expected**: Parts are visually grouped (indented or with connecting lines)

3. **🔍 Verify Stair-Specific Fields Display (MEDIUM PRIORITY):**
   - **For "کف پله" (Tread):**
     - ✅ Should show: **"طول پله: 120cm"**, **"عرض پله: 35cm"**
     - ✅ Should show: **"تعداد"**, **"متر مربع"**, **"فی هر متر مربع"**, **"قیمت کل"**
     - ✅ If nosing was selected: Should show **"نوع پیشانی"** and **"هزینه برش پیشانی"**
   - **For "خیز پله" (Riser):**
     - ✅ Should show: **"ارتفاع قائمه: 18cm"**
     - ✅ Should show: **"تعداد"**, **"متر مربع"**, **"فی هر متر مربع"**, **"قیمت کل"**
   - **For "پاگرد" (Landing):**
     - ✅ Should show: **"عرض پاگرد: 100cm"**, **"عمق پاگرد: 200cm"**
     - ✅ Should show: **"تعداد"**, **"متر مربع"**, **"فی هر متر مربع"**, **"قیمت کل"**

4. **Verify Edit Functionality:**
   - Click the **"✏️"** (Edit) button on any stair part
   - ✅ **Expected**: Modal opens with existing values pre-filled
   - Make a change and save
   - ✅ **Expected**: Changes are reflected in the selected products section

---

### **Phase 4: Complete Contract Creation**

#### **Step 12: Add Optional Longitudinal Stone Products**

1. **Go back to Step 4** (Product Type Selection) OR add a new product
2. **Select "سنگ طولی"** (Longitudinal Stone)
3. **Add 1-2 longitudinal stone products** to see how they appear alongside stair systems
4. ✅ **Expected**: Longitudinal products appear as separate items, NOT grouped with stair system

---

#### **Step 13: Complete Remaining Steps**

1. **Click "بعدی" (Next)** to proceed
2. **Delivery Dates (Step 6):**
   - Select one or more delivery dates
   - Click **"بعدی"** (Next)
3. **Payment Method (Step 7):**
   - Select a payment method (e.g., "نقد کامل" - Cash Complete)
   - Fill in any required fields
   - Click **"ثبت قرارداد"** (Register Contract)
4. ✅ **Expected**: Success message appears (custom popup, not browser alert)
5. ✅ **Expected**: Redirected to contract detail page: `/dashboard/sales/contracts/[contractId]`

---

### **Phase 5: Verify Contract Detail Page**

#### **Step 14: Verify Stair System Grouping in Contract Detail Page**

1. **On the contract detail page**, scroll down to **"اقلام قرارداد"** (Contract Items) section

2. **🔍 Verify Stair System Grouping (HIGH PRIORITY):**
   - ✅ **Expected**: Stair system items are **grouped together** under a clear header:
     - **Purple-themed box** with **"دستگاه پله"** label
     - **"15 پله (تعداد پله)"** summary
     - **Total system price** displayed prominently
   - ✅ **Expected**: Stair parts are listed in a **table format** within the group:
     - Table has columns: **"بخش"**, **"نام محصول"**, **"ابعاد / مشخصات"**, **"تعداد"**, **"متر مربع"**, **"فی"**, **"قیمت کل"**
     - Each part has a **purple badge** showing its type (کف پله, خیز پله, پاگرد)
   - ✅ **Expected**: Regular (longitudinal) products appear in a **separate table** below the stair system

3. **🔍 Verify Stair-Specific Fields Display (MEDIUM PRIORITY):**
   - **For "کف پله" (Tread) row:**
     - ✅ **"بخش"** column: Shows **"کف پله"** badge
     - ✅ **"ابعاد / مشخصات"** column shows:
       - **"طول پله: 120cm"** (or with unit)
       - **"عرض پله: 35cm"**
       - **"پیشانی: [nosing type]"** (if nosing was selected)
       - **"هزینه برش پیشانی: [price]"** (if nosing was selected)
   - **For "خیز پله" (Riser) row:**
     - ✅ **"بخش"** column: Shows **"خیز پله"** badge
     - ✅ **"ابعاد / مشخصات"** column shows:
       - **"ارتفاع قائمه: 18cm"**
   - **For "پاگرد" (Landing) row:**
     - ✅ **"بخش"** column: Shows **"پاگرد"** badge
     - ✅ **"ابعاد / مشخصات"** column shows:
       - **"عرض پاگرد: 100cm"**
       - **"عمق پاگرد: 200cm"**
       - **"تعداد پاگرد: 1"**

4. **Verify Pricing:**
   - ✅ Check that **"قیمت کل"** for each part is correct
   - ✅ Check that **total system price** in the header matches sum of all parts
   - ✅ Check that **contract total** includes all items (stair system + other products)

---

### **Phase 6: Additional Test Scenarios**

#### **Step 15: Test with Different Quantity Types**

1. **Create a new contract** (repeat Steps 1-5)
2. **In stair configuration:**
   - Select **"تعداد پله‌کان کامل"** (Number of complete staircases)
   - Enter **"تعداد پله در هر پله‌کان":** `10`
   - Enter **"تعداد پله‌کان کامل":** `2`
3. **Add stair parts** (tread, riser, landing)
4. ✅ **Expected**: Quantities are calculated correctly (10 steps × 2 staircases = 20 total)
5. ✅ **Expected**: Contract detail page shows correct quantity type

---

#### **Step 16: Test with Only One Part Selected**

1. **Create a new contract**
2. **Select only "کف پله"** (uncheck riser and landing)
3. **Configure and add tread**
4. ✅ **Expected**: Stair system still shows in grouping (with only one part)
5. ✅ **Expected**: Contract detail page shows only the selected part

---

#### **Step 17: Test with Multiple Stair Systems**

1. **Create a new contract**
2. **Add first stair system** (e.g., 15 steps)
3. **Add second stair system** (e.g., 10 steps)
4. ✅ **Expected**: Two separate stair system groups appear
5. ✅ **Expected**: Each group has its own header and summary
6. ✅ **Expected**: Contract detail page shows both groups separately

---

## ✅ Final Checklist

After completing all steps, verify:

- [ ] ✅ Riser calculation validation works when tread is not selected
- [ ] ✅ Modal close validation prevents closing without selection
- [ ] ✅ Stair system grouping appears in wizard's selected products
- [ ] ✅ Stair-specific fields display correctly in wizard
- [ ] ✅ Stair system grouping appears in contract detail page
- [ ] ✅ Stair-specific fields display correctly in contract detail page
- [ ] ✅ All calculations are correct (quantities, areas, prices)
- [ ] ✅ Multiple stair systems are handled correctly
- [ ] ✅ Regular products appear separately from stair systems
- [ ] ✅ Edit functionality works for stair parts
- [ ] ✅ Contract creation completes successfully

---

## 🐛 Troubleshooting

If you encounter issues:

1. **Check browser console** for any errors
2. **Verify product data** is loaded correctly
3. **Check database** to ensure `stairSystemId` and `stairPartType` are stored
4. **Refresh the page** and try again
5. **Check network tab** for API errors

---

## 📝 Notes

- All stair parts must have the same `stairSystemId` to be grouped together
- Stair parts are sorted: tread → riser → landing
- Regular products will never be grouped with stair systems
- Nosing cost is only applicable to tread parts
- Riser calculation depends on tread width (must be configured first)

---

**Happy Testing! 🚀**

