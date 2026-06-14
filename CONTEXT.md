# Sabalan ERP

Sabalan ERP manages stone inventory, sales contracts, and related pricing data for Sabalan Stone. This glossary defines project-specific business terms so the product and code use the same language.

**Product Search**:
A product lookup in the price inquiry surface that matches product identity and price-facing product details, regardless of Persian or Arabic character variants.
_Avoid_: treating search as only an exact prefix lookup

## Language

**ابزار**:
A paid stone edge or finishing operation applied during contract pricing, calculated by length or square meter depending on the item.
_Avoid_: ساب as a category, sub-service, tool

**ساب**:
A specific kind of ابزار, not a separate top-level category.
_Avoid_: using ساب‌ها to mean all ابزارها

**خدمات**:
A non-tool service offered by the business. خدمات is separate from ابزار and should not be used for contract edge or finishing operations.
_Avoid_: using خدمات as a catch-all for ابزار
