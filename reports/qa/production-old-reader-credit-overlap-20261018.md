# Old production financial reader incompatibility

The exact production schema models from commit
`a2c75f1027a069e91837ff433e1c91cdc7746798` were regenerated with Prisma 5.22.0
for a private Windows diagnostic. Only generator output and native binary target
changed; this was not execution of the production image or its installed engine.

Against an isolated 434-migration database in the existing local PostgreSQL
service, actual customer-domain commands created a 100-rial debit, 100-rial
credit and 100-rial credit-funded allocation. The current client read the exact
allocation line and zero customer balance. The old client read its ID, but its
ordinary full allocation read failed with **P2032**, specifically expecting a
non-null string in `treasuryTransactionId` and finding null.

[Diagnostic result](production-old-reader-credit-overlap-20261018.json) and
[one-use public probe source](production-old-reader-credit-overlap-20261018.ts.txt)
retain provenance and limitations. Temporary clients closed before the isolated
database was removed. No production data or image was modified.

Consequently, additive SQL alone cannot admit this financial overlap. Before
enabling credit-funded allocation writes, all old readers must retire under
native closure and a reader-compatible release must be available for rollback.
Open older browser forms require an explicitly compatible API adapter or durable
draft preservation before refresh. The seven accounting migrations remain
outside the generic online expansion compiler. A populated 425-to-434 migration,
actual old application behavior and the complete release gate remain pending.
