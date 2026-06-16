# Sabalan ERP

Sabalan ERP manages stone inventory, sales contracts, and related pricing data for Sabalan Stone. This glossary defines project-specific business terms so the product and code use the same language.

**Product Search**:
A product lookup in the price inquiry surface that matches product identity and price-facing product details, regardless of Persian or Arabic character variants.
_Avoid_: treating search as only an exact prefix lookup

## Language

**ابزار**:
A paid stone edge operation applied during contract pricing, calculated by length or square meter depending on the item.
_Avoid_: ساب as a category, sub-service, tool, فرآوری سنگ

**فرآوری سنگ**:
A stone finishing or treatment option applied during contract pricing, separate from ابزار, calculated by متر طول or متر مربع depending on the item.
_Avoid_: ابزار, خدمات, پرداخت as the canonical catalog name

**متر طول**:
The canonical unit label for length-based فرآوری سنگ pricing.
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

**تاریخ تحویل چاپی**:
The delivery date shown on printed or PDF contracts, normalized to Persian calendar `YYYY/MM/DD` when valid.
_Avoid_: passing through malformed or partially converted date strings

**وضعیت تایید دیجیتال**:
The customer-facing confirmation state shown after OTP verification. Once verified, it should read as a completed state such as `تایید شده در تاریخ ...`, not as a duplicate-action warning.
_Avoid_: wording like `قرارداد قبلا تایید شده است` when the customer has successfully reached the final confirmation state

**خروجی جاری قرارداد**:
The customer-facing contract output in PDF, print, and confirmation views should reflect the current saved contract details, including edited delivery plans and payment plans.
_Avoid_: generating customer-facing output from an older creation snapshot when the contract has since been edited

**برنامه تحویل چاپی**:
The delivery schedule shown in customer-facing PDF and print output. It should prioritize readable delivered item names and a separate delivered amount/metrage column over operational fields that make the table wrap.
_Avoid_: combining item name and delivered amount in one cramped cell when several delivery rows are present

**سربرگ چاپی قرارداد**:
The repeated customer-facing header on every PDF/print page, containing the Sabalan logo, contract number, contract date, print-time status, and page number.
_Avoid_: showing the contract header only on the first page of a multi-page contract output, or letting page content overlap the repeated header
