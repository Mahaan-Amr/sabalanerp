---
status: accepted
---

# Use typed identities with extensible accounting dimensions

Customer, Contract, Branch, Warehouse, and other authoritative operational concepts remain first-class typed identities, while journal lines receive analytical context through extensible governed Dimension Assignments instead of a growing collection of nullable columns or opaque EAV metadata. Every Subsidiary Account declares each applicable dimension type Required, Optional, or Forbidden. This hybrid preserves referential integrity and business meaning while allowing future dimensions, dimension-aware authorization, and reporting without redesigning every journal-line table.
