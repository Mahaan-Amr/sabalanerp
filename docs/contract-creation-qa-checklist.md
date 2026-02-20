# Contract Creation Flow — QA Checklist

This checklist is for manually testing the **Sales Contract Creation** wizard from start to finish. Use it with **accurate test data** and verify each expectation. If any item fails, note the step and result for fixing.

---

## Prerequisites

- [✅] Backend is running and database is migrated (including `Payment.handoverDate`, `Payment.checkOwnerName`).
- [✅] Frontend is running; you are logged in with a user that has **Sales** workspace access and **EDIT** permission.
- [✅] At least one **Department** exists (for contract creation).
- [✅] CRM has at least one **Customer** with at least one **Project Address** (for Steps 2 and 3).
- [✅] Products exist and are available for at least one of: Longitudinal, Stair, Slab (for Step 5).

---

## Step 1 — Contract Date (تاریخ قرارداد)

| # | Check | Expected result | Your result (✓/✗ + note) |
|---|--------|------------------|---------------------------|
| 1.1 | Page load | Wizard shows Step 1. "تاریخ قرارداد" is selected in progress bar. |✅|
| 1.2 | Contract date | Persian calendar shows; default is today (Persian). Changing date updates the value. |✅|
| 1.3 | Contract number | "شماره قرارداد" field is **read-only** and shows a value (e.g. `MAH-000001` or `SAL-000001`). Value comes from `GET /api/sales/contracts/next-number`. |✅|
| 1.4 | Creator display | "کاربر ایجاد کننده" shows current user's full name (e.g. first + last). |✅|
| 1.5 | Next (بدون انتخاب تاریخ) | Leaving contract date empty and clicking Next: validation error "تاریخ قرارداد باید انتخاب شود". |✅|
| 1.6 | Next (با تاریخ) | Select a valid date (e.g. 1403/11/15). Click Next. Step 2 is shown; no error. |✅|

**Sample data for Step 1**

- Contract date: `1403/11/15`
- Contract number: (auto from API; e.g. `MAH-000001`)

---

## Step 2 — Customer Selection (انتخاب مشتری)

| # | Check | Expected result | Your result (✓/✗ + note) |
|---|--------|------------------|---------------------------|
| 2.1 | Customer list | List shows CRM customers (or "هیچ مشتری‌ای موجود نیست" if empty). |✅|
| 2.2 | Search | Typing in search filters by name, company, national code, phone. Results update. |✅|
| 2.3 | Select customer | Clicking a customer selects it (highlight + checkmark). `customerId` and `customer` (with `projectAddresses`, `phoneNumbers`) are set. |✅|
| 2.4 | Full customer fetch | After selection, app calls `crmAPI.getCustomer(id)` and updates wizard with full customer (including phone numbers). |✅|
| 2.5 | Next without customer | No customer selected → Next: error "مشتری باید انتخاب شود". |✅|
| 2.6 | Next with customer | Customer selected → Next. Step 3 is shown. | |
| 2.7 | "ایجاد مشتری جدید" | Button saves wizard state to localStorage and redirects to CRM customer create with `returnTo=contract&step=2`. After creating customer, returning should restore step 2 (if return flow is implemented). |✅|

**Sample data for Step 2**

- Choose a customer that has at least one **Project Address** (for Step 3).

---

## Step 3 — Project Management (مدیریت پروژه)

| # | Check | Expected result | Your result (✓/✗ + note) |
|---|--------|------------------|---------------------------|
| 3.1 | Project list | Only selected customer's projects are shown ("پروژه‌های [نام مشتری]"). |✅|
| 3.2 | Project selection | Clicking a project selects it; `projectId` and `project` (address, city, projectName, projectManagerName, projectManagerNumber) are set. |✅|
| 3.3 | Next without project | No project selected → Next: error "پروژه باید انتخاب یا ایجاد شود". |✅|
| 3.4 | Next with project | Project selected → Next. Step 4 is shown. |✅|
| 3.5 | Customer with no projects | If customer has no project addresses, list is empty; user must use "ایجاد پروژه جدید" (if implemented) or choose another customer. |❌| -> it only goes to customer information and it is not on add project only shows the customer information while it should immidietly load the modal of adding a new project for that customer not show all the information! it goes to http://localhost:3000/dashboard/crm/customers/cmjymxoxk00017nrh1ukm40ra?returnTo=contract&step=3&action=addProject . this needs to be fixed
also when i go to افزودن آدرس پروژه modal manually after redirecting to customer information the issue is the drop down for نوع پروژه is not in sync with the styles and ui of project which needs fix
also after i do create the project it automatically goes back to the customer project lists in contract creation مدیریت پروژه step but the list is not updated and i have to refresh the page so it gets update and load the new project i have added

**Sample data for Step 3**

- Select a project that has: address, city, projectName (optional), projectManagerName/Number (optional).

---

## Step 4 — Product Type Selection (انتخاب نوع محصول)

| # | Check | Expected result | Your result (✓/✗ + note) |
|---|--------|------------------|---------------------------|
| 4.1 | Three types | Three selectable types: سنگ طولی (longitudinal), سنگ پله (stair), سنگ اسلب (slab). Volumetric is "به‌زودی" and disabled. |✅|
| 4.2 | Select type | Clicking a type selects it (visual highlight). `selectedProductTypeForAddition` is set. |✅|
| 4.3 | Next | No strict validation; Next goes to Step 5. If no type selected, Step 5 shows "لطفاً ابتدا نوع محصول را انتخاب کنید". |✅|

**Sample data for Step 4**

- Select **سنگ طولی** (or سنگ پله / سنگ اسلب) for the next step.

---

## Step 5 — Product Selection (انتخاب محصولات)

| # | Check | Expected result | Your result (✓/✗ + note) |
|---|--------|------------------|---------------------------|
| 5.1 | Product list | Table shows products **filtered by selected type** (longitudinal/stair/slab) via `availableIn*Contracts`. |✅|
| 5.2 | Search | Search filters products by code, name, dimensions, mine, finish, color, etc. |⚠️| it shows the search results but the thing is when i start to write down my search it starts to update the drop down of search letter by letter which is correct but the issue is the drop down search style which when i hover my mouse on it to select a product from the searched the whole div of the product search or i dont know exactly what goes on top something like transform or translate which it should not be like that
| 5.3 | Add product | Clicking a row opens **Product Configuration Modal** (longitudinal/slab) or **Stair** flow. After saving, product appears in "محصولات قرارداد" with correct quantity, m², price, total. |✅|
| 5.4 | Summary | Totals (قیمت کل، متر مربع، تعداد) update as products are added/removed. |✅|
| 5.5 | Edit product | Edit (ویرایش) reopens modal with existing data; saving updates the line. |✅|
| 5.6 | Remove product | Remove (حذف) removes the product from the list; totals update. |✅|
| 5.7 | Next with no products | No products → Next: error "حداقل یک محصول باید به قرارداد اضافه شود". |✅|
| 5.8 | Next with products | At least one product added → Next. Step 6 is shown. |✅|
| 5.9 | Mandatory (حکمی) | If product has mandatory pricing, percentage and calculated amounts are correct (e.g. 20% mandatory). |✅|
| 5.10 | Longitudinal: dimensions & cut | For longitudinal: length, width, quantity, cutting (if any), price per m² and total are correct. |✅|

| 5.11 | Slab: standard dimensions | For slab: standard dimensions (single or multiple entries), cutting mode, and totals are correct. |⚠️| -> i need a comprehensive and complex scenario to test it
| 5.12 | Stair: tread/riser/landing | For stair: parts (کف پله، خیز پله، پاگرد) and quantities are correct; stair system ID links items. |⚠️| -> i need a comprehensive and complex scenario to test it

**Sample data for Step 5**

Use one longitudinal product so the **total contract amount** is exactly **50,000,000 تومان** for Step 7:

- **Longitudinal example:** length **2** m, width **60** cm, quantity **10**.
  - Area: 2 × (60/100) = **1.2 m²** per piece → **12 m²** total.
  - **Price per m² (فی هر متر مربع):** **4,166,667** تومان (or round to **4,000,000** → total **48,000,000**).
  - To get exactly **50,000,000** total: use **4,166,667** تومان per m², or adjust quantity/length so total = 50M.
- **Alternative (simpler):** price per m² **5,000,000** تومان, 10 m² total → **50,000,000** تومان (e.g. length 2 m, width 50 cm, quantity 10 → 10 m²).
- Note the **total contract amount** shown in the summary; use that same value in Step 7 for payment sum.

---

## Step 6 — Delivery Schedule (برنامه تحویل)

| # | Check | Expected result | Your result (✓/✗ + note) |
|---|--------|------------------|---------------------------|
| 6.1 | Initial state | If no deliveries, empty state with "افزودن اولین تحویل". |✅|
| 6.2 | Add delivery | "افزودن تحویل جدید" adds a row. Default آدرس تحویل = project address. |✅|
| 6.3 | Required fields | Each delivery: **تاریخ تحویل**, **نام تحویل‌گیرنده** (receiverName). نام مدیر پروژه and آدرس optional in UI but may be required for backend. |✅| -> ok the thing is that if the project selected has a project manager so we should automatically load the name but we also should let our user to be able to change or edit it, its just for better exprience!
| 6.4 | Product quantities | For each delivery, user assigns quantities per product. Sum of quantities for a product across all deliveries must **equal** that product's total quantity in the contract. |✅|
| 6.5 | Over-allocation | If sum of delivered quantities for a product > contract quantity: validation error (e.g. "تعداد تحویل برای محصول ... بیش از تعداد موجود است"). |✅|
| 6.6 | Under-allocation | If sum of delivered quantities for a product < contract quantity: Step validation fails with "همه محصولات باید به طور کامل در برنامه تحویل توزیع شوند". |✅|
| 6.7 | Remove delivery | Remove (حذف) removes that delivery; quantities are freed for re-assignment. |✅|
| 6.8 | Next with valid schedule | All products fully distributed, all deliveries valid → Next. Step 7 is shown. |✅|

**Note (backend):** Delivery API sends `deliveryDate` as stored in UI (Persian format). Backend uses `new Date(data.deliveryDate)`. If backend expects ISO, conversion may be needed; verify date is stored correctly in DB.

**Sample data for Step 6**

- One delivery: date 1403/11/20, نام تحویل‌گیرنده "علی احمدی", نام مدیر پروژه "محمد رضایی", آدرس = project address.
- Assign **all** contract product quantities to this delivery (or split across two deliveries so totals match).

---

## Step 7 — Payment Method (روش پرداخت)

| # | Check | Expected result | Your result (✓/✗ + note) |
|---|--------|------------------|---------------------------|
| 7.1 | Contract total | "مبلغ کل قرارداد" equals sum of product totals from Step 5. |❌| -> it shows 0 for all the 3 fields مبلغ کل قرارداد:
۰ تومان(۰ ریال)
مجموع پرداخت‌ها:
۰ تومان(۰ ریال)
مبلغ باقیمانده:
۰ تومان(۰ ریال)

| 7.2 | Add payment — نقدی (کارتخوان) | Add payment → choose "نقدی (کارتخوان)". Enter **مبلغ** and **تاریخ پرداخت** (Persian). Save. Entry appears with method "نقدی (کارتخوان)". | |
| 7.3 | Add payment — نقدی (شبا) | Add payment → "نقدی (شبا)". Enter amount and payment date. Save. Entry shows "نقدی (شبا)". |❌| -> when i click on this button the modal comes but the style hass issues because some of it is outside the window and i can not select anything which needs enhancments or change please fix this too. for now i can not go any further!
| 7.4 | Add payment — چک | Add payment → "چک". Fill: **شماره چک**, **نام صاحب چک**, **مبلغ**, **تاریخ تحویل چک**, **تاریخ سررسید چک**. Save. Entry shows "چک" with all fields. | |
| 7.5 | Validation — cash | Cash (کارتخوان/شبا) without payment date: error "تاریخ پرداخت الزامی است". | |
| 7.6 | Validation — check | Check without check number: "شماره چک الزامی است". Without check owner: "نام صاحب چک الزامی است". Without handover date: "تاریخ تحویل چک الزامی است". Without due date: "تاریخ سررسید چک الزامی است". | |
| 7.7 | Sum match | "مجموع پرداخت‌ها" must equal "مبلغ کل قرارداد" (within 0.01). Otherwise warning and step validation fails: "مجموع مبالغ پرداخت ... باید برابر با مبلغ کل قرارداد ... باشد". | |
| 7.8 | Multiple payments | Add e.g. one cash + one check so total = contract amount. Both entries listed; sum matches. | |
| 7.9 | Edit payment | Edit existing entry; change amount/date/check fields. Save. List and sum update. | |
| 7.10 | Delete payment | Delete an entry. Sum updates; if sum ≠ contract total, warning appears. | |
| 7.11 | Next with invalid sum | Sum ≠ contract total → Next: payment validation error. | |
| 7.12 | Next with valid sum | Sum = contract total → Next. Step 8 is shown. | |

**Sample data for Step 7**

- Contract total e.g. 50,000,000 تومان.
- Option A: One payment "نقدی (کارتخوان)", amount 50,000,000, date 1403/11/15.
- Option B: Two payments: نقدی (شبا) 20,000,000 (date 1403/11/15) + چک 30,000,000 (شماره چک 123456, نام صاحب چک "بانک ملی", تاریخ تحویل 1403/11/10, تاریخ سررسید 1404/02/01).

---

## Step 8 — Digital Signature (امضای دیجیتال) & Contract Creation

| # | Check | Expected result | Your result (✓/✗ + note) |
|---|--------|------------------|---------------------------|
| 8.1 | Summary | Contract summary shows: contract number, date, customer, total amount, payment sum. | |
| 8.2 | Create contract (Step 7 submit) | On Step 7, button "ثبت قرارداد" (or equivalent) **creates** the contract: `POST /api/sales/contracts` with title, customerId, departmentId, content (HTML), contractData, totalAmount, currency. Then creates items, deliveries, payments; then moves to Step 8. | |
| 8.3 | Phone number | Step 8: user enters phone number for SMS verification. | |
| 8.4 | Send code | "ارسال کد" calls `POST /api/sales/contracts/:id/send-verification` with phoneNumber. Success message; in sandbox, code may be returned in response. | |
| 8.5 | Verify code | User enters code; "تایید و امضا" calls `POST /api/sales/contracts/:id/verify-code`. On success, contract is verified/signed (per backend flow). | |
| 8.6 | Validation | Without phone: error. Without verified code: "کد تایید باید تایید شود". | |

**Backend expectations (after "ثبت قرارداد")**

| # | Check | Expected result | Your result (✓/✗ + note) |
|---|--------|------------------|---------------------------|
| B.1 | Contract record | One `SalesContract` with correct contractNumber, customerId, departmentId, totalAmount, content, contractData (JSON). | |
| B.2 | Contract items | One `ContractItem` per product (productId, productType, quantity, unitPrice, totalPrice, isMandatory, mandatoryPercentage, originalTotalPrice, stairSystemId, stairPartType where applicable). | |
| B.3 | Deliveries | One `Delivery` per schedule row; deliveryDate, deliveryAddress, driver (= projectManagerName), vehicle (= receiverName); DeliveryProduct rows with productId and quantity. | |
| B.4 | Payments | One `Payment` per payment entry. CASH: paymentMethod CASH, cashType "کارتخوان" or "شبا", paymentDate set. CHECK: paymentMethod CHECK, checkNumber, checkOwnerName, handoverDate, paymentDate (due date). Amounts and currency match. | |
| B.5 | Payment dates | Persian dates (e.g. 1403/11/15) converted to ISO for paymentDate and handoverDate before sending to API. | |

---

## Edge Cases & Regression

| # | Scenario | Expected result | Your result (✓/✗ + note) |
|---|----------|------------------|---------------------------|
| E.1 | Go back from Step 3 to Step 2, change customer | Step 3 project list updates to new customer; previous project selection cleared or still valid if it belongs to new customer. | |
| E.2 | Go back from Step 5 to Step 4, change product type | Step 5 product list and filters reflect new type; existing contract products of other types (if any) remain until user removes them. | |
| E.3 | Add product, go to Step 6, go back to Step 5, remove product | Step 6 delivery quantities must be re-checked; if delivery had assigned quantity for removed product, validation should fail or quantities auto-adjusted. | |
| E.4 | Step 6: two deliveries, split quantity 50/50 | Sum per product = contract quantity; Next succeeds. | |
| E.5 | Step 7: one check with all required fields | Check number, owner, handover date, due date; save and submit; backend receives CHECK with checkOwnerName and handoverDate. | |
| E.6 | Step 7: two cash (کارتخوان + شبا) summing to total | Both saved; backend has two CASH payments with correct cashTypes. | |
| E.7 | Refresh on Step 1 | Contract number may reload (new number). No crash. | |
| E.8 | Refresh on Step 5 (with products in list) | If state is restored from localStorage, products and step are restored; otherwise may reset. | |
| E.9 | Customer with no projects | Step 3 shows empty list; user cannot proceed without selecting/creating a project. | |
| E.10 | Product type with no products | Step 5 shows empty or "هیچ محصولی با این جستجو یافت نشد"; user cannot add product until products exist for that type. | |

---

## Quick Reference — Expected Data by Step

| Step | Stored / Sent | Example |
|------|----------------|--------|
| 1 | contractDate, contractNumber | 1403/11/15, MAH-000001 |
| 2 | customerId, customer (with projectAddresses, phoneNumbers) | id, full object |
| 3 | projectId, project (address, city, projectName, projectManagerName/Number) | id, full object |
| 4 | selectedProductTypeForAddition | 'longitudinal' \| 'stair' \| 'slab' |
| 5 | products[] (productId, productType, quantity, dimensions, prices, ...) | At least one item |
| 6 | deliveries[] (deliveryDate, receiverName, projectManagerName, deliveryAddress, products: [{ productIndex, productId, quantity }]) | Sum(quantity) per product = contract quantity |
| 7 | payment.payments[] (method CASH_CARD \| CASH_SHIBA \| CHECK, amount, paymentDate; for CHECK: checkNumber, checkOwnerName, handoverDate) | Sum(amount) = totalContractAmount |
| 8 | signature (phoneNumber, codeVerified, contractId after create) | After create: contractId set |

---

## After Testing

- Note any failed items with: **Step**, **Check ID**, **Expected vs actual**, and **screenshot/console error** if useful.
- Share the list of failures so we can fix them in code or adjust the checklist.

---

*Checklist version: 1.0 — Contract creation flow (8 steps, backend: sales contracts, items, deliveries, payments, verification).*
