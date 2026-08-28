# Private technical graph compiler

Approved canonical technical/priced graph seam for issues 320/330/334; review
baseline `1c93b47f`. This is a server-side prerequisite, not validated-save or Case
acceptance. No route, runtime registration, migration or activation is included.

`compilePartnerTechnicalGraph` takes strict public technical intent plus trusted,
owner-resolved frozen catalog/calculation evidence. It invokes the real technical
preview and canonical graph commands, never a replacement packing/pricing model.
The whole candidate fails when any row, dependency, pending field or selected
operation is invalid. The private graph is **not** a browser response. Only the
separate allowlisted preview may cross a Partner-facing interface.

The context's rates are calculation evidence, not an approved wholesale price.
Prepared/legacy volumetric rates bind the explicit subtype and unit. Other families
use their existing canonical policy inputs. An inquiry decision remains the sole
authority for Sabalan's approved all-in unit price; neither catalog price nor this
compiler can grant approval or mint an inquiry-ready reference.

Longitudinal/slab/stair rows preserve catalog and source identities, exact units,
manual geometry, system-vs-manual stair quantity and independent mother lengths.
Prepared rows preserve historical family, subtype and selected measure. Remainder
children use the canonical paid-source-zero policy and actual source allocation;
their own operations never inherit parent operations. Layers replay against the
same parent inventory and retain paid/fresh supply, explicit different material,
strip geometry and independent side collections. New-material dimensions must
match the frozen inventory snapshot at the canonical writer.

Two additive graph-command capabilities preserve these inputs:

- Optional `RemainderChildPolicyInput.allocationOrder` retains a recovered draft's
  original deterministic order on import. An existing allocation cannot reorder.
  Omission retains the existing next-order behavior; malformed order is rejected.
- Optional `ProductOperationsInput.operationScopeId` gives independent layer-side
  automatic no-operation groups distinct identities. Omission retains the prior
  row-based identity and priced behavior.

## Verification and remaining work

Focused backend graph tests cover all five product families, prepared unit pricing,
real packing, independent operation quantities, explicit mother lengths, source
ownership, paid remainder material, exact allocation order, paid/fresh layers,
different-stone snapshots, and whole-candidate rejection without private errors.
Canonical graph/operation regressions cover import order, immutable existing order,
malformed order and default-vs-independent operation scope.

Run the focused `partnerCaseDraftGraph.test.ts` through backend `tsx`, both package
suites/typechecks, ordinary graph persistence/migration/print regressions, full
backend/frontend typechecks and architecture checks. The existing read-only
comparison harness checks 62 complete priced results and hashes against the
released remaining-stone package; it is diagnostic evidence, not runtime authority.

The subsequent [validated-save module](technical-validated-save.md) adds the
transactional storage and safe historical-reference interface, plus allowlisted
canonical requested measures from this compiler. Real owner approval-impact
evidence excluding quantity and Delivery remains required, along with durable
pending inquiry/Case commands, complete safe field
validation and user-authored presentation content, bind 330 UI, then 334 integration
and 335 comprehensive acceptance. No issue is closed on compiler-only evidence.
