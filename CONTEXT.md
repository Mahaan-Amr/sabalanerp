# Sabalan ERP

Sabalan ERP manages stone inventory, sales contracts, and related pricing data for Sabalan Stone. This glossary defines project-specific business terms so the product and code use the same language.

**Product Search**:
A product lookup in the price inquiry surface that matches product identity and price-facing product details, regardless of Persian or Arabic character variants.
_Avoid_: treating search as only an exact prefix lookup

## Language

**ابزار**:
A paid stone edge operation applied during contract pricing, calculated by length or square meter depending on the item.
_Avoid_: ساب as a category, sub-service, tool, پرداخت سنگ

**پرداخت سنگ**:
A stone finishing or treatment option applied during contract pricing, separate from ابزار, calculated by متر طول or متر مربع depending on the item.
_Avoid_: ابزار, خدمات, فرآوری سنگ

**متر طول**:
The canonical unit label for length-based پرداخت سنگ pricing.
_Avoid_: متر when it can be confused with متر مربع

**ساب**:
A specific kind of ابزار, not a separate top-level category.
_Avoid_: using ساب‌ها to mean all ابزارها

**خدمات**:
A non-tool service offered by the business. خدمات is separate from ابزار and should not be used for contract edge or finishing operations.
_Avoid_: using خدمات as a catch-all for ابزار

**جزئیات محصول قرارداد**:
The price-bearing details attached to a contract product for customer-facing contract output, including cuts, services, tools, and stone finishing when they exist.
_Avoid_: printing empty detail groups or using خدمات as the umbrella label for every add-on

**توضیحات سنگ پله**:
The per-part note attached to a stair contract product row, such as کف پله, خیز, or پاگرد. Each selected stair part carries its own توضیحات so contract output can show the note beside the exact row it describes.
_Avoid_: using one shared stair-system note for all stair parts

**وضعیت هنگام چاپ**:
The contract status shown on customer-facing printed or PDF contract output at the moment the document is generated.
_Avoid_: labeling printed status as the general contract status when the timing matters

**شماره تماس فروشنده**:
The seller phone number printed on customer-facing contracts, taken from the contract creator's personal profile phone when available.
_Avoid_: using the current printer's phone or a later approver's phone

**جدول اصلی محصولات**:
The customer-facing contract table that lists product rows and their price-bearing product details as flat invoice rows.
_Avoid_: rendering nested product detail blocks outside the main product table

**حکمی**:
An explicit percentage-based price increase applied to a contract product when the product is marked as mandatory.
_Avoid_: printing or charging حکمی from a default percentage when the product is not explicitly marked mandatory

**تخفیف قرارداد**:
A percentage reduction applied only to the sum of base stone product subtotals in a sales contract, before payments are compared to the payable total. It does not reduce ابزار, لایه، پرداخت سنگ, cutting, or حکمی add-on amounts.
_Avoid_: applying تخفیف to the full contract total including add-ons, or selecting discount limits per individual product row

**خروجی تخفیف قرارداد**:
The saved contract discount snapshot shown in PDF and print output, including the applied percentage and amount. Existing contracts keep their saved discount details even when discount ranges change later.
_Avoid_: recalculating old contract discounts from current بازه تخفیف rules

**بازه تخفیف**:
A manager-defined تومان range over the contract base stone subtotal that caps the allowed تخفیف قرارداد percentage. Ranges are non-overlapping, include their lower bound, exclude their upper bound, and allow no discount when no range matches.
_Avoid_: overlapping ranges or fallback discount caps when no range matches

**سقف تخفیف**:
The maximum تخفیف قرارداد percentage configured by managers or admins for a matching بازه تخفیف. Sales users may apply a discount up to this cap during contract creation.
_Avoid_: requiring manager approval for every discount that is already within the configured cap

**تاریخ تحویل چاپی**:
The delivery date shown on printed or PDF contracts, normalized to Persian calendar `YYYY/MM/DD` when valid.
_Avoid_: passing through malformed or partially converted date strings

**وضعیت تایید دیجیتال**:
The customer-facing confirmation state shown after OTP verification. Once verified, it should read as a completed state such as `تایید شده در تاریخ ...`, not as a duplicate-action warning.
_Avoid_: wording like `قرارداد قبلا تایید شده است` when the customer has successfully reached the final confirmation state

**خروجی جاری قرارداد**:
The customer-facing contract output in PDF, print, and confirmation views should reflect the current saved contract details, including edited delivery plans and payment plans.
_Avoid_: generating customer-facing output from an older creation snapshot when the contract has since been edited

**ویرایش جزئیات محصول قرارداد**:
Editing a saved contract product should preserve previously selected ابزار and پرداخت سنگ details from the contract snapshot, even when the current catalog record is missing or inactive. Saved labels, units, prices, and amounts should remain visible instead of being silently dropped.
_Avoid_: resetting selected contract product details only because catalog lookup fails

**شماره چک ناقص**:
A check payment saved during sales contract creation without a check number. It remains valid for contract creation and output, while preserving the missing value for later accounting follow-up.
_Avoid_: blocking contract creation only because a check number is empty

**برنامه تحویل چاپی**:
The delivery schedule shown in customer-facing PDF and print output. It should prioritize readable delivered item names and a separate delivered amount/metrage column over operational fields that make the table wrap.
_Avoid_: combining item name and delivered amount in one cramped cell when several delivery rows are present

**سربرگ چاپی قرارداد**:
The repeated customer-facing header on every PDF/print page, containing the Sabalan logo, contract number, contract date, print-time status, and page number.
_Avoid_: showing the contract header only on the first page of a multi-page contract output, or letting page content overlap the repeated header
