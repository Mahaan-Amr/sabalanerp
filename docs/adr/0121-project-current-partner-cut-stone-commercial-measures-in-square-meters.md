---
status: accepted
---

# Project current Partner cut-stone commercial measures in square meters

The product owner confirmed that longitudinal, stair, and slab material is priced in square meters using the same billable mother-stone consumption as ordinary Seller Sales. Finished order area and physical piece count remain distinct technical facts. Prepared and volumetric products retain their configured commercial unit; tools, cutting, finishing, and independent services retain their own units.

ADR-0111 already owns the current `ordinary-sale-v1` material amount calculation. Its technical save projection must also carry the canonical consumed material quantity with `squareMeter` into editable Partner commercial rows. Projecting meters or piece counts and an effective rolled-up rate obscures the confirmed material basis even when the exact line amount is correct. The measure comes from the canonical base-material pricing line, never from dividing a total by a rate or from finished geometry.

Historical graphs without the current pricing-basis marker retain their original unit semantics. Saving an editable successor recompiles obsolete calculations and projects the current commercial unit without rewriting predecessor snapshots. Approved and financially recorded agreements require the existing authorized correction workflow. Exact canonical line totals remain authoritative; a displayed effective unit rate must not replace them.

Wholesale and retail remain separate agreements. A current main-stone square-meter approval can remain usable when only quantity changes; a changed pricing identity needs fresh affected-row inquiry evidence. A changed commercial revision must pass its existing customer, Sales, Accounting and finalization guards. Physical geometry, immutable row identity, ordered remainder allocations, independent layer materials, tools and production evidence remain owned by the canonical graph.
