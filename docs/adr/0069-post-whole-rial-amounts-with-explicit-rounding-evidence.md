---
status: accepted
---

# Post whole-rial amounts with explicit rounding evidence

Every posted base-currency debit and credit is an integer number of Iranian rials even when stone quantities, unit prices, tax calculations, or source amounts require greater decimal precision. SabalanERP preserves the unrounded source calculation, commercial precision, rounding rule and version, and any explicit rounding-difference journal line; binary floating-point and hidden fractional rial are forbidden from ledger truth. This keeps statutory balances exact without discarding the evidence needed to reproduce commercial calculations.
