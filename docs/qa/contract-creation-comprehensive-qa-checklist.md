# Contract Creation — Comprehensive QA Checklist

## Document control

| Field | Value |
|---|---|
| Area | Sales → Contract Creation |
| Primary focus | Step 5: Product selection, product configuration, product graph, pricing, persistence, and downstream projections |
| Applies to | New contracts, explicitly edited contracts, recovered drafts, legacy contracts opened for authorized editing |
| Product families | Longitudinal stone, stairs, stair layers, slabs, prepared products, products created from paid remainders |
| Required test level | UI, API, database/persistence, PDF, accounting, workshop, delivery, logistics |
| Result values | Pass / Fail / Blocked / Not applicable |
| Evidence required | Screenshot or video, request/response, relevant persisted snapshot, calculated expected values, defect ID |

## How to use this checklist

- Run every `P0` case before release.
- Run all applicable `P1` cases for a full regression release.
- Record the exact catalog IDs, contract ID, product row IDs, source IDs, policy versions, browser, and build commit.
- Do not accept a visually correct result without checking the saved contract after reload.
- For pricing scenarios, independently calculate the expected amount using exact decimal arithmetic.
- For atomicity scenarios, capture the graph before the action and compare it with the graph after a rejected action.
- Never identify rows by their visual position. Capture and compare stable row identities.
- Any silent change to seller-entered values is a release blocker.
- Any mismatch between Step 5, saved contract, PDF, accounting, workshop, delivery, or logistics is a release blocker.

## Severity guide

| Priority | Meaning |
|---|---|
| P0 | Data loss, wrong charge, wrong material allocation, broken dependency, partial save, unrecoverable draft, or historical-contract corruption |
| P1 | Primary seller flow broken, invalid validation, incorrect workshop instruction, major performance/accessibility failure |
| P2 | Visual inconsistency, minor interaction defect, non-blocking copy/layout issue |

---

# 1. Release prerequisites and test data

## 1.1 Environment

- [ ] `P0` Record frontend, backend, and canonical-engine commit/version.
- [ ] `P0` Confirm all database migrations are applied successfully.
- [ ] `P0` Confirm a verified database backup exists before migration or production-like testing.
- [ ] `P0` Run the product-graph migration dry-run and record:
  - scanned contracts
  - migratable contracts
  - ambiguous relationships
  - financial differences
  - broken relationships
  - missing rates/snapshots
- [ ] `P0` Confirm unexplained financial differences and broken relationships are zero.
- [ ] `P1` Test in Chromium and Firefox.
- [ ] `P1` Test normal motion and `prefers-reduced-motion`.
- [ ] `P1` Test desktop at 1920×1080, 1440×900, and 1366×768.
- [ ] `P1` Test at 125% and 150% browser zoom.
- [ ] `P1` Test a stable connection, slow connection, temporary offline state, and a failed API request.

## 1.2 Roles

Prepare these users:

- [ ] Sales user with normal contract permissions.
- [ ] Sales user without inventory-management permission.
- [ ] Inventory manager who can create/edit catalog rates and mother dimensions.
- [ ] Accounting user.
- [ ] Workshop/production user.
- [ ] Delivery/logistics user.
- [ ] Administrator.

## 1.3 Required catalog fixtures

Create stable, uniquely named fixtures:

| Fixture | Required data |
|---|---|
| `LONG-40-300` | Longitudinal stone, mother width 40cm, mother length 3m, thickness 2cm |
| `LONG-40-NOLENGTH` | Longitudinal stone, mother width 40cm, missing mother length |
| `STAIR-40-300` | Stair-capable stone, mother 3m × 40cm, thickness 2cm |
| `SLAB-A` | Slab product |
| `PREP-CUBIC` | Existing cubic prepared product |
| `PREP-READY` | Existing ready-piece prepared product |
| `TOOL-M` | Meter-based tool with a positive inventory rate |
| `TOOL-M2` | Square-meter-based tool with a positive inventory rate |
| `TOOL-ZERO` | Tool with an explicit inventory rate of zero |
| `TOOL-INACTIVE` | Tool selected in an old contract, then made inactive |
| `FIN-M` | Meter-based stone finishing with a positive inventory rate |
| `FIN-M2` | Square-meter-based stone finishing with a positive inventory rate |
| `FIN-ZERO` | Finishing with an explicit inventory rate of zero |
| `FIN-A` / `FIN-B` | Two compatible finishings |
| `FIN-X` / `FIN-Y` | Explicitly incompatible finishings |
| `LAYER-SET` | Layer type priced per set; seller rate entered manually |
| Cutting rates | Longitudinal, cross, and slab vertical cutting rates |

## 1.4 Numeric fixtures

- [ ] Use Latin digits: `12.5`.
- [ ] Use Persian digits: `۱۲٫۵`.
- [ ] Use Arabic digits: `١٢٫٥`.
- [ ] Use thousands separators: `1,250,000` and `۱٬۲۵۰٬۰۰۰`.
- [ ] Use exact kerf-sensitive values: `0.3cm`, `20cm`, `19.7cm`, `0.003m`.
- [ ] Use very small positive decimals and large but realistic quantities.

---

# 2. Global invariants — mandatory on every scenario

- [ ] `P0` Every top-level product row has a stable identity.
- [ ] `P0` Duplicated rows receive new identities.
- [ ] `P0` A remainder child references exactly one source row by stable identity.
- [ ] `P0` A stair layer references its exact parent by stable identity.
- [ ] `P0` Reordering, inserting, or deleting another row never changes an existing relationship.
- [ ] `P0` Seller-entered values are never silently replaced, rounded, clamped, or normalized while typing.
- [ ] `P0` Calculated values remain editable where the seller is allowed to change them.
- [ ] `P0` Physical geometry is separate from billable pricing.
- [ ] `P0` Customer-requested geometry is separate from internal source-consumption geometry.
- [ ] `P0` Stone, cutting, mandatory pricing, tools, finishing, and layer pricing each have one canonical owner.
- [ ] `P0` Product total equals the sum of the stored, individually rounded payable lines.
- [ ] `P0` Contract total equals the sum of canonical saved product/service totals.
- [ ] `P0` No downstream consumer independently produces a different total.
- [ ] `P0` A rejected save changes nothing.
- [ ] `P0` A successful save survives refresh and reopening exactly.
- [ ] `P0` Finalized historical contracts are not rewritten without explicit authorized editing and saving.

---

# 3. Wizard entry, navigation, and draft behavior

- [ ] `P0` Contract date accepts and preserves a valid Persian-calendar selection.
- [ ] `P0` Date validation rejects values outside the currently permitted business rules without clearing other steps.
- [ ] `P0` Customer search returns the correct customer and does not confuse similar names/phone numbers.
- [ ] `P0` Selecting a customer snapshots the intended stable customer identity.
- [ ] `P0` Changing customer explicitly updates/clears dependent project data according to the existing rule; no old project remains attached silently.
- [ ] `P0` Normal contract requires the currently required project/address data.
- [ ] `P0` Collaboration contract does not manufacture a normal project/address.
- [ ] `P0` Customer and project data survive back/forward navigation, refresh, and recovery.
- [ ] `P0` Start a normal sales contract and reach Product Selection without a separate product-type wizard step.
- [ ] `P0` Start a collaboration contract and verify its required earlier-step behavior remains correct.
- [ ] `P1` Navigate backward and forward through all wizard steps; entered Step 5 data remains intact.
- [ ] `P1` Validation in another wizard step does not clear products.
- [ ] `P0` Refresh on every wizard step and verify the latest semantic changes recover.
- [ ] `P0` Crash/close the tab after editing a product draft; reopen the same session and verify recovery.
- [ ] `P0` Close a product modal without saving; unsaved product-modal changes are discarded while the contract draft remains.
- [ ] `P0` Successful product save updates only that row and contract totals; the complete contract list does not refetch or reorder.
- [ ] `P1` Returning from a cancelled product modal restores search text, type filter, highlighted row, and list scroll position.

## 3.1 Delivery, payment, and confirmation integration

- [ ] `P0` Delivery rows target stable product-row identities, including duplicate catalog products.
- [ ] `P0` Dependent stair layers are not offered as unrelated delivery targets.
- [ ] `P0` A remainder child is delivered only according to its intended commercial-row behavior.
- [ ] `P0` Delivered quantity cannot exceed the saved deliverable amount.
- [ ] `P0` Inserting/deleting/reordering products does not transfer a delivery allocation.
- [ ] `P0` An ambiguous legacy delivery reference blocks final save rather than guessing.
- [ ] `P0` Removing an invalid legacy delivery assignment removes only that assignment and leaves quantity unallocated.
- [ ] `P0` Delivery dates, receiver/project-manager data, quantities, units, and notes survive save/reload.
- [ ] `P0` Payment entries preserve method, amount, date, and existing method-specific details.
- [ ] `P0` Payment total and remaining balance use the canonical saved contract total.
- [ ] `P0` Product edits immediately update payment/contract summary without independently recalculating product formulas.
- [ ] `P0` Invalid payment totals/dates follow existing validation and do not clear product data.
- [ ] `P0` Digital signature/confirmation uses the final saved canonical contract facts.
- [ ] `P0` Double-clicking final submit creates one contract only.
- [ ] `P0` Failed final submission leaves the complete recovered draft available.

---

# 4. Unified product search

## 4.1 Basic behavior

- [ ] `P0` One visible label reads `جستجوی محصول`; the search input has no placeholder.
- [ ] `P0` One flat list contains all product types.
- [ ] `P0` No catalog price is shown.
- [ ] `P0` The type filter is: `همه | طولی | پله | اسلب | آماده`.
- [ ] `P0` Default filter is `همه`.
- [ ] `P1` Filtering narrows the same list without secondary navigation.
- [ ] `P1` Rows contain only product name, compact facts, inferred type, and `انتخاب`.
- [ ] `P1` No carousel, promotion, recommendation panel, large cards, or decorative icons appear.

## 4.2 Ranking and normalization

- [ ] `P0` Exact catalog-code match ranks first.
- [ ] `P0` Exact normalized Persian name match ranks before prefix/fuzzy matches.
- [ ] `P1` Prefix matches rank before token/fuzzy matches.
- [ ] `P1` Seller history is used only as a tie-breaker during search.
- [ ] `P1` Before search, the current seller’s recent/frequent products rank first inside the same list.
- [ ] `P0` History from seller A does not affect seller B.
- [ ] `P0` `ی` and `ي` return equivalent results.
- [ ] `P0` `ک` and `ك` return equivalent results.
- [ ] `P1` Search matches code, stone name, product type, width, thickness, and relevant specifications.
- [ ] `P1` Stable catalog order is preserved after personalized items.

## 4.3 Keyboard and performance

- [ ] `P1` Arrow keys change only the highlighted row.
- [ ] `P0` Enter selects only the highlighted row.
- [ ] `P0` Enter with no highlighted row selects nothing.
- [ ] `P1` Focus remains visible and predictable.
- [ ] `P1` Local search response is ≤50ms on the agreed realistic catalog dataset.
- [ ] `P1` Opening Step 5 from cached data is ≤200ms.

---

# 5. Central product modal and shared UI rules

- [ ] `P0` Selecting a product opens the central modal immediately.
- [ ] `P1` Modal shell opens in ≤150ms.
- [ ] `P1` Core facts/inputs become editable in ≤250ms.
- [ ] `P0` Header and sticky footer remain visible while the body scrolls.
- [ ] `P0` Header reads `تنظیمات محصول` for new rows and the edit equivalent for saved rows.
- [ ] `P0` Internal back action appears only in an internal source/remainder selection view.
- [ ] `P0` No nested modal opens from tools, finishing, layers, source selection, or remainders.
- [ ] `P1` Modal open/close and internal-view transitions are short and smooth.
- [ ] `P1` Reduced-motion removes nonessential motion without breaking state changes.
- [ ] `P1` Cached sections do not show skeletons again.
- [ ] `P1` Each network-dependent section has a correctly sized local skeleton.
- [ ] `P1` No full-modal spinner appears.
- [ ] `P1` Loaded content does not cause layout shift.
- [ ] `P1` Failed network data shows a local section error while other sections remain usable.
- [ ] `P0` Save pending disables only the modal primary button and prevents double submission.
- [ ] `P1` Button text changes to `در حال ذخیره…`.
- [ ] `P1` Successful save closes the modal and briefly emphasizes the affected Step 5 row.
- [ ] `P0` Validation scrolls/focuses the exact invalid field or section.
- [ ] `P1` Validation scrolling respects reduced motion.

## 5.1 Product type and catalog identity

- [ ] `P0` New-row type is inferred and selected automatically.
- [ ] `P0` New-row compact selector remains editable where allowed.
- [ ] `P0` Truly incompatible types remain visible but unavailable.
- [ ] `P0` Edit shows the saved type as plain text; it cannot mutate the row structure.
- [ ] `P0` Catalog identity remains unchanged when contractual title changes.
- [ ] `P0` Compact fact line shows available mother length, mother width, thickness, and stone identity without disabled inputs.
- [ ] `P0` Missing catalog facts are not guessed.

## 5.2 Contractual title and description

- [ ] `P0` `عنوان محصول` initially uses the full catalog name.
- [ ] `P0` Seller can edit the title for the contract row.
- [ ] `P0` Edited title appears in Step 5, saved contract, delivery, workshop, and outputs.
- [ ] `P0` Edited title does not alter catalog ID, type, mother dimensions, thickness, or calculations.
- [ ] `P0` Edit preserves the saved contractual title even if catalog name changed.
- [ ] `P1` Description is always visible, has no placeholder, and starts at one line.
- [ ] `P1` Description grows to four lines, then uses internal scrolling.
- [ ] `P0` Description saves and reloads exactly, including line breaks and Persian text.
- [ ] `P0` Changing catalog product does not overwrite a saved row description.

## 5.3 Calculation summary

- [ ] `P0` Summary is always present for applicable configurable products.
- [ ] `P0` It uses flat rows and subtle separators, not colored cards, icons, accordion, or hidden details.
- [ ] `P0` Stable rows show `—` when a value does not yet exist.
- [ ] `P0` Applicable rows include geometry/layout, requested and consumed stone, longitudinal/cross operations, cutting, and remainders.
- [ ] `P0` Source/remainder products clearly show zero material charge and new operation charges.
- [ ] `P0` Every semantic input change updates the affected value immediately.
- [ ] `P1` Only the changed value receives a short subtle emphasis.
- [ ] `P1` Summary dimensions do not jump when worker/network results arrive.

---

# 6. Numeric parsing, decimal precision, and units

- [ ] `P0` Latin, Persian, and Arabic digits produce identical canonical values.
- [ ] `P0` `.` and `٫` decimal separators are accepted.
- [ ] `P0` `,` and `٬` thousands separators are ignored for calculation.
- [ ] `P0` Input text is not rewritten while typing.
- [ ] `P0` Normalization occurs only after editing completes.
- [ ] `P0` `1.5m → 150cm → 1.5m` loses no precision.
- [ ] `P0` `0.3cm` remains exactly `0.003m` internally.
- [ ] `P0` Repeated unit switching does not accumulate floating-point drift.
- [ ] `P0` Intermediate length, width, area, kerf, cutting, tool, and finishing values are not rounded.
- [ ] `P0` Display may trim unnecessary zeros while canonical value remains exact.
- [ ] `P0` Physical piece quantities reject fractions.
- [ ] `P0` Line amounts round only at the final line to the nearest toman.
- [ ] `P0` Product total sums rounded stored lines, not re-rounded display values.
- [ ] `P0` Displayed area is not used as the pricing input when a more precise canonical area exists.
- [ ] `P0` Unit selections save and reopen exactly.

---

# 7. Longitudinal products

## 7.1 Input interpretation matrix

Run every row with width defaulted from a 40cm mother:

| Case | Seller input | Expected interpretation |
|---|---|---|
| L-01 | Length 25m, no quantity | 25m total length |
| L-02 | Area 10m², width 40cm, no quantity | Length becomes 25m |
| L-03 | Length 1.5m, quantity 20 | 1.5m per piece |
| L-04 | Area 3.6m², width 12cm, quantity 20 | Length becomes 1.5m per piece |
| L-05 | Length 500m, width 40cm, no quantity | 500m total length |
| L-06 | Length 250m, width 20cm, no quantity | 50m² |

For each case:

- [ ] `P0` Calculated value appears directly in its normal field.
- [ ] `P0` Calculated field remains editable.
- [ ] `P0` No “calculated” badge, lock, special color, warning, or calculation-method chooser appears.
- [ ] `P0` Last manually edited field remains authoritative.
- [ ] `P0` Editing length recalculates area.
- [ ] `P0` Editing area recalculates length.
- [ ] `P0` Adding a positive quantity changes length meaning to per-piece without creating a second length field.
- [ ] `P0` Clearing quantity changes length back to total-length meaning.

## 7.2 Empty and invalid inputs

- [ ] `P0` Width is populated with the actual mother width.
- [ ] `P0` Length, area, and quantity start visually empty.
- [ ] `P0` Empty quantity means “without quantity,” not an error.
- [ ] `P0` At least one of length or area must be positive.
- [ ] `P0` Quantity alone cannot save.
- [ ] `P0` With both length and area empty, save focuses length and shows only `طول یا مترمربع را وارد کنید`.
- [ ] `P0` Zero/negative length or area cannot save.
- [ ] `P0` Width equal to mother width is valid.
- [ ] `P0` Width below mother width is valid.
- [ ] `P0` Width above mother width is preserved, focuses the width field, and shows only the maximum-width message.
- [ ] `P0` Correcting width removes the message immediately.
- [ ] `P0` Price starts empty.
- [ ] `P0` Blank, zero, or negative base price cannot save.
- [ ] `P0` Invalid price focuses itself and shows only `قیمت را وارد کنید`.
- [ ] `P0` Edit preserves the saved price.

## 7.3 Quantity and mandatory pricing

- [ ] `P0` Entering quantity automatically enables `حکمی`.
- [ ] `P0` Seller can turn `حکمی` off.
- [ ] `P0` Turning it off removes only the percentage price increase.
- [ ] `P0` Geometry, quantity, cutting, packing, and remainders remain unchanged.
- [ ] `P0` Clearing quantity automatically turns `حکمی` off.
- [ ] `P0` The last percentage remains in the current draft.
- [ ] `P0` Re-entering quantity restores `حکمی` using the retained percentage.
- [ ] `P0` A completely new row uses the configured default percentage.
- [ ] `P0` Longitudinal physical cutting remains billable for mandatory products.
- [ ] `P0` Cross cutting for mandatory products remains physical but non-billable.

## 7.4 Packing, kerf, cutting, and calibration

Use mother width 40cm:

- [ ] `P0` 20 pieces × 1.5m × 12cm uses seven source bands.
- [ ] `P0` Exactly 20 requested pieces are produced; no 21st piece is invented.
- [ ] `P0` The last source produces a positive 16cm × 1.5m remainder.
- [ ] `P0` 21 requested pieces consumes the additional available strip intentionally.
- [ ] `P0` Width equal to 40cm creates no longitudinal cut.
- [ ] `P0` Width below 40cm creates automatic longitudinal physical cutting.
- [ ] `P0` Seller cannot zero a missing/nonzero cutting charge from the product modal.
- [ ] `P0` Missing longitudinal cutting rate blocks save locally and does not fall back to zero.
- [ ] `P0` Explicit inventory rate zero is accepted as a real rate and the physical cut remains recorded.
- [ ] `P0` Kerf is manually switchable and fixed at the snapshotted 0.3cm.
- [ ] `P0` Kerf affects only actual cut axes.
- [ ] `P0` Turning kerf off does not remove the physical cut or its normal rate.
- [ ] `P0` `2 × 20cm` in 40cm without kerf uses one band.
- [ ] `P0` `2 × 20cm` in 40cm with 0.3cm kerf cannot use one band.
- [ ] `P0` With kerf, two source bands are consumed and each retains the correct 19.7cm remainder.
- [ ] `P0` Every positive remainder is retained; no minimum usable dimension is applied.

Calibration defaults:

- [ ] `P0` Full-width 40cm: calibration off and unavailable.
- [ ] `P0` Two 20cm strips without kerf, no width remainder: default on.
- [ ] `P0` Four 10cm strips without kerf, no width remainder: default on.
- [ ] `P0` One 20cm strip: default off.
- [ ] `P0` Three 12cm strips: default off.
- [ ] `P0` Two 20cm strips with 0.3cm kerf: default off.
- [ ] `P0` A purely longitudinal remainder does not turn calibration off.
- [ ] `P0` Any positive width remainder turns the automatic default off.
- [ ] `P0` After seller manually changes calibration, later geometry/quantity/kerf changes never overwrite it.
- [ ] `P0` Edit always preserves the saved calibration value.

---

# 8. Two-dimensional source packing

Use mother stone 3m × 40cm and requested pieces 1.2m × 20cm:

- [ ] `P0` Quantity 4 packs two across width and two along length into one mother stone.
- [ ] `P0` A 0.6m × 40cm longitudinal remainder is created.
- [ ] `P0` Quantity 3 does not invent the fourth product.
- [ ] `P0` All positive unused rectangles from quantity 3 are saved as reusable remainders.
- [ ] `P0` 90-degree rotation is never used.
- [ ] `P0` Kerf is included in every real cut line in both axes.
- [ ] `P0` Source-piece count is minimized first.
- [ ] `P0` Among equal source counts, actual total cut meters are minimized.
- [ ] `P0` Among equal cutting results, remainder rectangle count is minimized.
- [ ] `P0` If remainder count is equal, the larger rectangle is preserved.
- [ ] `P0` Stable tie-break fills from the fixed corner, width first, then length.
- [ ] `P0` Identical inputs produce identical placement, cut, and remainder identities after reload.
- [ ] `P0` Changing pricing method does not change physical packing.
- [ ] `P0` Calculation summary reports the selected result, not rejected alternatives.

---

# 9. Contract remainders and products made from remainders

## 9.1 Remainder list

- [ ] `P0` Remainders appear before requested dimensions only for applicable physical-stone types.
- [ ] `P0` Rows are flat and show source title, width × length = area, available count, and `استفاده`.
- [ ] `P0` Same-catalog-stone remainders appear first without hiding other remainders.
- [ ] `P0` Stable creation order is preserved.
- [ ] `P0` Nothing is auto-selected or auto-consumed.
- [ ] `P0` Empty state shows only `باقی‌مانده‌ای وجود ندارد`.
- [ ] `P0` Selecting `استفاده` targets the exact stable remainder identity, not its name or list position.

## 9.2 Same-modal remainder flow

- [ ] `P0` `استفاده` transitions the same central modal; no overlay/modal is stacked.
- [ ] `P0` Header identifies source stone and exact remainder dimensions.
- [ ] `P0` Back returns without consuming anything.
- [ ] `P0` Material/base stone price is not editable.
- [ ] `P0` Summary shows stone price zero and explains it was charged on the source.
- [ ] `P0` Tools, finishing, cutting, and other new operations remain independently chargeable.
- [ ] `P0` Source mandatory percentage and base-stone discount are not inherited.
- [ ] `P0` Child has independent title, geometry, units, description, tools, finishing, cuts, and stable identity.
- [ ] `P0` Child stores the stable source/allocation relationship.
- [ ] `P0` Remainder is consumed only after successful atomic save.

## 9.3 Minimum source consumption and secondary remainders

Use three available 16cm × 1.5m pieces; request two 12cm × 1.5m pieces:

- [ ] `P0` Exactly two of three source pieces are consumed.
- [ ] `P0` One complete 16cm × 1.5m piece remains.
- [ ] `P0` Two secondary 4cm × 1.5m remainders are created.
- [ ] `P0` Summary shows source consumed `2 of 3`.
- [ ] `P0` Reusing a secondary remainder recalculates and stores any new positive remainder.
- [ ] `P0` Insufficient source preserves seller input and shows a local shortage.
- [ ] `P0` Equal-size sources are consumed in stable creation order.

## 9.4 Source edit and allocation replay

Create one source with at least three remainder children:

- [ ] `P0` Edit source so all children still fit; all allocations replay in original order.
- [ ] `P0` Edit source so only the last child fails; save rejects completely.
- [ ] `P0` Edit source so the first child fails but later children could fit alone; save rejects completely.
- [ ] `P0` Confirm rejected edit leaves source, every child, all operations, descriptions, totals, and remainders byte-for-byte unchanged.
- [ ] `P0` Conflict section lists each incompatible child and shortage.
- [ ] `P0` `مشاهده محصول` targets the correct child.
- [ ] `P0` No child is silently moved to another remainder or new stone.

## 9.5 Deletion, source change, and duplication

- [ ] `P0` Source deletion is blocked while it has remainder-product children.
- [ ] `P0` Dependency list shows each exact child with `مشاهده` and `حذف`.
- [ ] `P0` Child deletion uses inline confirmation, not an alert/modal.
- [ ] `P0` Deleting one child removes only that child and its owned snapshots.
- [ ] `P0` Source inventory rebuilds and later allocations replay deterministically.
- [ ] `P0` Failed rebuild deletes nothing.
- [ ] `P0` Deleting the last child removes the source-deletion block but does not auto-delete the source.
- [ ] `P0` Explicit source deletion removes its unconsumed remainders only after dependencies are gone.
- [ ] `P0` Changing a child’s source is explicit and uses the same modal.
- [ ] `P0` New source compatibility includes child geometry and all operations.
- [ ] `P0` Source change atomically frees/rebuilds old source and consumes/rebuilds new source.
- [ ] `P0` Cancelled or failed source change changes neither source.
- [ ] `P0` Duplicate child creates a draft, not an immediate row.
- [ ] `P0` Duplicate copies commercial/operation settings but not allocation, delivery, production status, or relationship IDs.
- [ ] `P0` Duplicate requires explicit source selection and receives independent identities.

---

# 10. Shared operation groups

## 10.1 Group fundamentals

- [ ] `P0` Tools and finishing use one shared operation-group system.
- [ ] `P0` Positive product quantity makes group scope piece-count based.
- [ ] `P0` Empty quantity makes group scope total-length based.
- [ ] `P0` First operation defaults to the complete product without asking for a group.
- [ ] `P0` Group controls stay hidden while the whole product has identical operations.
- [ ] `P0` `اعمال روی` can choose all, an existing group, or part of a group inline.
- [ ] `P0` Splitting a group preserves all prior operations on both resulting scopes.
- [ ] `P0` New group receives a stable independent identity.
- [ ] `P0` Groups are never silently merged in stored data.
- [ ] `P0` Uncovered scope automatically appears as `بدون عملیات` only in summary/workshop output.
- [ ] `P0` Uncovered scope is valid and generates no warning.
- [ ] `P0` Total assigned group scope cannot exceed product scope.
- [ ] `P0` Invalid scope preserves the entered value, shows local remaining capacity, and blocks save.

## 10.2 Quantity ↔ length basis conversion

- [ ] `P0` With 25m divided into 10m and 15m groups, adding quantity 10 and per-piece length 2.5m converts groups to 4 and 6 pieces.
- [ ] `P0` Tools, finishings, edges, rates, and valid overrides survive exact conversion.
- [ ] `P0` A non-integral conversion is not rounded or guessed.
- [ ] `P0` Non-integral conversion shows each group’s old scope and an inline piece-count input.
- [ ] `P0` Save remains blocked until every group is resolved.
- [ ] `P0` Clearing quantity converts piece groups to exact length using piece count × per-piece length.
- [ ] `P0` `بدون عملیات` scope rebuilds after either direction.

---

# 11. Tools

- [ ] `P0` No separate enable switch exists.
- [ ] `P0` Empty state shows `ابزاری انتخاب نشده`.
- [ ] `P0` `افزودن ابزار` opens inline search only.
- [ ] `P1` Tool catalog loads only when inline add is opened.
- [ ] `P1` Loading uses row-sized skeletons.
- [ ] `P0` Search results show tool name, catalog rate, and catalog unit.
- [ ] `P0` Seller cannot edit tool rate.
- [ ] `P0` Selecting a tool snapshots current inventory rate.
- [ ] `P0` Later inventory rate change does not rewrite a saved row.
- [ ] `P0` Remove/reselect uses the current inventory rate as a new selection.
- [ ] `P0` Explicit inventory rate zero is valid and operation remains visible.
- [ ] `P0` Null/deleted/missing rate blocks new selection/save without zero fallback.
- [ ] `P0` Inactive/missing old catalog tool remains visible as outside current catalog with its snapshot.
- [ ] `P0` Duplicate selections of the same tool are allowed and remain independent.
- [ ] `P0` Deleting one duplicate deletes only that selection.
- [ ] `P0` Same tool may appear multiple times on the same edge.
- [ ] `P0` No maximum number of tools per edge is imposed.

## 11.1 Meter-based tools

- [ ] `P0` A new meter-based tool has no default edge.
- [ ] `P0` Saving with no edge highlights only that row and shows `حداقل یک لبه را انتخاب کنید`.
- [ ] `P0` Valid edge choices are front, back, left, and right.
- [ ] `P0` `دو طول` selects both longitudinal edges.
- [ ] `P0` `محیط کامل` selects all valid edges.
- [ ] `P0` Seller can modify individual edges after a shortcut.
- [ ] `P0` Each tool owns independent edges.
- [ ] `P0` Quantity equals the real selected edge length across its operation group.

## 11.2 Square-meter tools

- [ ] `P0` A square-meter tool has no edge selector.
- [ ] `P0` Quantity equals length × width × group piece count.
- [ ] `P0` Without product quantity, area equals group length × product width.

## 11.3 Tool quantity override

- [ ] `P0` Automatic amount initially appears as plain text.
- [ ] `P0` `تغییر مقدار` opens a small inline input and retains the automatic amount beside it.
- [ ] `P0` Manual override saves with the exact tool selection.
- [ ] `P0` Geometry changes never silently overwrite the manual value.
- [ ] `P0` Changed automatic value shows the new computed value and requires `حفظ مقدار دستی` or `استفاده از محاسبه`.
- [ ] `P0` Save is blocked until the stale override is resolved.
- [ ] `P0` Changing the tool does not carry the previous tool’s override.
- [ ] `P0` Final amount = final tool quantity × snapshotted inventory rate.

## 11.4 Multiple operations by subset

Use a 25-piece product:

- [ ] `P0` Group 1: 10 pieces with front spoon tool and left half-round tool.
- [ ] `P0` Group 2: 15 pieces with front half-round tool.
- [ ] `P0` Workshop output clearly associates both Group 1 tools with the same 10 pieces.
- [ ] `P0` No artificial product row or duplicate stone price is created.
- [ ] `P0` If only 20 pieces receive operations, 5 pieces appear as `بدون عملیات`.
- [ ] `P0` Adding an operation to those 5 removes the automatic uncovered group.

---

# 12. Stone finishing

- [ ] `P0` No separate enable switch exists.
- [ ] `P0` Empty state shows `پرداختی انتخاب نشده`.
- [ ] `P0` Adding/removing finishing changes the existence of finishing truth; no separate boolean state is saved.
- [ ] `P0` `افزودن پرداخت` opens inline selection with local skeleton.
- [ ] `P0` Multiple finishings are allowed.
- [ ] `P0` Duplicate finishing selections remain independent.
- [ ] `P0` Finishing has no edge selector.
- [ ] `P0` Finishing applies through the shared operation group only.
- [ ] `P0` Meter finishing quantity is per-piece length × group count, or group length when quantity is empty.
- [ ] `P0` Square-meter finishing quantity is length × width × group count, or group length × width without quantity.
- [ ] `P0` Inventory owns unit and rate; seller cannot edit either.
- [ ] `P0` Current rate snapshots on selection.
- [ ] `P0` Inventory rate zero is valid and finishing remains visible.
- [ ] `P0` Missing rate blocks only the affected operation locally.
- [ ] `P0` Old inactive/missing catalog finishing remains displayable from snapshot.
- [ ] `P0` Manual quantity override follows the same stale-resolution behavior as tools.
- [ ] `P0` Manual quantity must be positive; free finishing uses inventory rate zero, not zero quantity.
- [ ] `P0` Compatible finishings can coexist in the same group.
- [ ] `P0` No compatibility is inferred from finishing names.
- [ ] `P0` Explicitly incompatible finishings in the same group show a local conflict and block save.
- [ ] `P0` The same incompatible finishings in different groups are allowed.
- [ ] `P0` Existing values are never silently removed to resolve incompatibility.

---

# 13. Stair systems and stair parts

## 13.1 Stair quantity mode

- [ ] `P0` Compact selector shows `تعداد پله | پله‌کان کامل`.
- [ ] `P0` New draft defaults to `تعداد پله`.
- [ ] `P0` Direct mode accepts total step count.
- [ ] `P0` Complete-staircase mode accepts staircase count and steps per staircase.
- [ ] `P0` Computed total is displayed as plain text.
- [ ] `P0` Total initializes tread and riser quantities only.
- [ ] `P0` Landing quantity remains independent.
- [ ] `P0` Before manual section edits, changing overall quantity updates initialized tread/riser values.
- [ ] `P0` After manual section quantity edit, overall changes do not overwrite that section.
- [ ] `P0` Editing one saved stair row does not expose or mutate the whole stair-system control.

## 13.2 Independent stair sections

For tread, riser, and landing:

- [ ] `P0` Catalog stone identity and stable stair-system ID may be shared.
- [ ] `P0` Contractual title, geometry, units, quantity, area, price, mandatory, kerf, calibration, tools, finishing, cuts, description, and layers are independently owned.
- [ ] `P0` Editing tread does not live-update riser or landing.
- [ ] `P0` `کپی از کف پله` performs a one-time copy only.
- [ ] `P0` Copied tools/finishings get independent selection IDs and recalculate using destination geometry.
- [ ] `P0` Destination title and description are not incorrectly copied.
- [ ] `P0` Copy into a populated destination requires an explicit action and does not occur silently.

## 13.3 Geometry and defaults

- [ ] `P0` Tread dimensions are length and depth.
- [ ] `P0` Riser dimensions are length and height.
- [ ] `P0` Landing dimensions are length and width.
- [ ] `P0` Every dimension has its own cm/m switch.
- [ ] `P0` Length defaults to meters; depth/height/width defaults to centimeters.
- [ ] `P0` New tread depth is an editable real value of 30cm.
- [ ] `P0` New riser height is an editable real value of 17cm.
- [ ] `P0` Clearing either default keeps it empty; it is not reinserted.
- [ ] `P0` Tread/riser length and both landing dimensions start empty.
- [ ] `P0` Invalid/empty dimension focuses the exact field with a short local message.
- [ ] `P0` Selecting riser after a valid tread performs only a one-time initial length copy.
- [ ] `P0` Later tread length changes do not alter riser length.
- [ ] `P0` A riser selected without tread starts with empty length.
- [ ] `P0` Each section’s area is calculated only from its own geometry and quantity.

## 13.4 Mother geometry and cutting

- [ ] `P0` Mother length/width come from catalog and are not editable.
- [ ] `P0` Missing mother length blocks the affected section with `طول مادر در موجودی ثبت نشده است`.
- [ ] `P0` No 300cm fallback is used.
- [ ] `P0` Final length above mother length remains unchanged, shows the maximum, and blocks save.
- [ ] `P0` Final cross dimension above mother width behaves equivalently.
- [ ] `P0` Equal final/mother length creates no cross cut or longitudinal remainder.
- [ ] `P0` Shorter final length creates real cross cutting and a positive full-width longitudinal remainder.
- [ ] `P0` Equal cross dimension creates no longitudinal cut.
- [ ] `P0` Smaller cross dimension creates longitudinal cutting.
- [ ] `P0` Tread uses depth as source-width demand.
- [ ] `P0` Riser uses height as source-width demand.
- [ ] `P0` Landing uses width as source-width demand.
- [ ] `P0` Exact requested count is produced—never an extra stair part to fill capacity.
- [ ] `P0` Every positive remainder is saved.

Use mother width 40cm, riser height 17cm, quantity 5, kerf off:

- [ ] `P0` Two risers fit per source width.
- [ ] `P0` Three source pieces are consumed.
- [ ] `P0` Exactly five risers are produced.
- [ ] `P0` The third source creates the correct positive width remainder.

## 13.5 Stair prices and nosing migration

- [ ] `P0` Tread, riser, and landing base prices start empty and remain independent.
- [ ] `P0` Catalog price does not auto-fill them.
- [ ] `P0` One-time copy from tread can copy current price.
- [ ] `P0` Zero/negative/blank normal stair-part price blocks save at the first invalid section in tread→riser→landing order.
- [ ] `P0` Mandatory pricing affects only that section’s base price.
- [ ] `P0` No separate nosing selector or hard-coded nosing charge remains.
- [ ] `P0` Nosing/edge work is selected through the shared tool module.
- [ ] `P0` A meter tool on tread front edge uses tread length × applicable piece count.
- [ ] `P0` Legacy nosing snapshots map through the reviewed migration identity.
- [ ] `P0` Unmapped historical nosing remains visible as outside current catalog with its historical title/rate.
- [ ] `P0` Nosing cost is counted exactly once.

---

# 14. Stair layers

## 14.1 Inline structure and ownership

- [ ] `P0` Layers appear inline inside their exact tread/riser/landing subsection.
- [ ] `P0` No layer modal or separate page opens.
- [ ] `P0` Empty state shows `لایه‌ای تعریف نشده`.
- [ ] `P0` Parent may own any number of independent layer configurations.
- [ ] `P0` Adding a layer appends; it never replaces another configuration.
- [ ] `P0` Every configuration has a stable independent identity.
- [ ] `P0` Same type/sides may be selected in multiple configurations without silent merging.
- [ ] `P0` Each configuration independently owns type, positive manual rate, layers per parent, width/unit, sides, source, packing, cuts, operations, and description.
- [ ] `P0` Saving parent and all layers is one atomic transaction.
- [ ] `P0` A conflict in one layer saves nothing from the parent or any sibling layer.

## 14.2 Commercial sets vs physical strips

Use 10 parent pieces, two layers per parent, sides front and left, parent 1.2m × 0.30m:

- [ ] `P0` Commercial layer quantity is 20 sets, not 40.
- [ ] `P0` Physical demand is 20 front strips × 1.2m plus 20 left strips × 0.30m.
- [ ] `P0` Selecting more sides does not multiply commercial sets.
- [ ] `P0` Material, cutting, tools, and workshop use physical strips.
- [ ] `P0` Layer-type customer pricing uses the catalog unit and 20 commercial sets.
- [ ] `P0` Summary displays both commercial sets and physical strip breakdown.
- [ ] `P0` Front/back use parent length.
- [ ] `P0` Left/right use tread depth, riser height, or landing width as applicable.

## 14.3 Source selection and packing

- [ ] `P0` Seller explicitly chooses parent stone, contract remainder, or new stone.
- [ ] `P0` No source is auto-selected or auto-consumed.
- [ ] `P0` Parent/remainder paid material has zero new material price but charges new operations.
- [ ] `P0` New stone requires explicit catalog selection and manual positive base price.
- [ ] `P0` Parent price may be copied only by explicit one-time action.
- [ ] `P0` Changing selected new stone clears the previous base price.
- [ ] `P0` New-stone material charge uses all actually consumed mother-stone area.
- [ ] `P0` Every positive paid remainder is saved for later zero-material reuse.
- [ ] `P0` Layer type unit comes from inventory and is not editable.
- [ ] `P0` Layer-type contract rate starts empty and is entered manually.
- [ ] `P0` Layer-type rate must be greater than zero.
- [ ] `P0` Changing layer type clears the previous manual rate.
- [ ] `P0` Duplication copies manual rate only when explicitly duplicating that layer.

Combined strip packing:

- [ ] `P0` All physical strips of one layer configuration are optimized together.
- [ ] `P0` Front/left/right/back are not isolated material orders.
- [ ] `P0` Side identities and quantities remain separate in workshop output.
- [ ] `P0` Strips never rotate 90 degrees.
- [ ] `P0` No extra strip is produced.
- [ ] `P0` Every positive unused rectangle becomes a remainder.
- [ ] `P0` Cutting, kerf, and calibration come from the combined physical layout.

Multiple configurations sharing one source:

- [ ] `P0` Allocations replay in stable layer-creation order.
- [ ] `P0` First configuration consumes first.
- [ ] `P0` Later configuration receives only remaining capacity.
- [ ] `P0` A later shortage does not silently switch source.
- [ ] `P0` Parent-and-all-layers save remains atomic.
- [ ] `P0` Deleting one configuration restores its capacity and replays later configurations without altering their commercial settings.

## 14.4 Layer deletion and duplication

- [ ] `P0` Deleting a parent with layers uses inline two-step confirmation.
- [ ] `P0` Explicit `حذف والد و لایه‌ها` deletes parent/layers/owned operations atomically.
- [ ] `P0` Source allocations are freed and all affected inventories rebuild.
- [ ] `P0` Rebuild failure deletes nothing.
- [ ] `P0` Deleting one layer deletes only that layer and rebuilds sources atomically.
- [ ] `P0` Sibling stair sections remain.
- [ ] `P0` Duplicate parent defaults to `فقط بخش پله`.
- [ ] `P0` `همراه لایه‌ها` copies layer settings with new identities.
- [ ] `P0` No allocation/source identity, delivery plan, or production status is copied.
- [ ] `P0` Every copied layer requires explicit new source selection.
- [ ] `P0` Failure of one copied layer creates no part of the duplicate.

---

# 15. Slabs

## 15.1 Requested output geometry

- [ ] `P0` Length, width, area, and quantity start empty.
- [ ] `P0` Quantity is required and is a positive integer.
- [ ] `P0` Valid entry: length + width + quantity.
- [ ] `P0` Valid entry: length + area + quantity; width derives.
- [ ] `P0` Valid entry: width + area + quantity; length derives.
- [ ] `P0` Area alone is insufficient.
- [ ] `P0` Quantity alone is insufficient.
- [ ] `P0` Last manually edited field remains authoritative.
- [ ] `P0` Editing length/width recalculates area.
- [ ] `P0` Editing area recalculates the dimension not edited most recently.
- [ ] `P0` Incomplete save focuses the first unresolved field and shows only `ابعاد و تعداد را کامل کنید`.
- [ ] `P0` Packing begins only after requested geometry is resolved.
- [ ] `P0` CAD is absent from slab contract configuration.

## 15.2 Manual source batches

- [ ] `P0` Section title is `اسلب‌های منبع`.
- [ ] `P0` Each row has stable identity, length, width, quantity, unit switches, and delete.
- [ ] `P0` New source fields have no placeholders.
- [ ] `P0` Source dimensions and quantity must be positive.
- [ ] `P0` Invalid source values remain visible and show only local field messages.
- [ ] `P0` Identical source rows remain separate.
- [ ] `P0` Catalog dimensions never silently create or overwrite source rows.
- [ ] `P0` Optimizer consumes only explicitly entered sources.
- [ ] `P0` Optimizer never increases source quantity.
- [ ] `P0` Source rows are consumed in stable creation order when otherwise equivalent.
- [ ] `P0` Edit restores exact source rows and units.

Use request four 1m × 1m pieces; source two 2m × 2m slabs:

- [ ] `P0` Only one source slab is consumed.
- [ ] `P0` The second complete slab remains unconsumed.
- [ ] `P0` The unconsumed slab is not a paid contract remainder.
- [ ] `P0` Only positive rectangles from consumed sources become paid reusable remainders.
- [ ] `P0` Summary shows final product, consumed source `1 of 2`, complete unused source, and cut remainders.
- [ ] `P0` Insufficient sources preserve the requested output, show local shortage, and block save.

## 15.3 Cutting pricing methods

- [ ] `P0` Compact selector is always visible: `خطوط برش | مترمربع`.
- [ ] `P0` New slab defaults to line-based pricing.
- [ ] `P0` Edit restores the saved method.
- [ ] `P0` Switching method does not change requested geometry, sources, packing, physical cuts, or remainders.
- [ ] `P0` Line-based price uses actual 2D cut plan and snapshotted longitudinal/cross inventory rates.
- [ ] `P0` Missing applicable line rate blocks save locally; no fallback to another rate or zero.
- [ ] `P0` Per-square-meter mode shows one compact manual rate field.
- [ ] `P0` New manual square-meter rate starts empty, without placeholder/catalog suggestion.
- [ ] `P0` Blank/zero/negative square-meter rate blocks save and focuses the field.
- [ ] `P0` Switching temporarily away preserves the draft square-meter rate but does not charge it.
- [ ] `P0` Switching back restores it.
- [ ] `P0` Changing catalog slab clears it.
- [ ] `P0` Amount = exact finished requested area × manual rate.
- [ ] `P0` Physical cut plan remains in workshop output under both pricing methods.
- [ ] `P0` Selected pricing method and applicable rates are snapshotted.
- [ ] `P0` Vertical cuts charge only selected sides and use consumed source dimensions.

---

# 16. Prepared products

- [ ] `P0` Existing subtype behavior remains unchanged.
- [ ] `P0` Compact subtype selector shows current choices `کیوبیک | قطعات آماده`.
- [ ] `P0` Existing allowed-unit behavior remains unchanged.
- [ ] `P0` Units use compact segmented controls.
- [ ] `P0` Amount and unit price appear in one compact row.
- [ ] `P0` All existing defaults, validation, calculations, state transitions, save payloads, and downstream meanings remain unchanged.
- [ ] `P0` Description uses the shared one-to-four-line field.
- [ ] `P0` Summary shows `جمع — مقدار × قیمت واحد = مبلغ`.
- [ ] `P0` No large green card, decorative header, helper paragraph, disabled informational input, or new functional behavior appears.
- [ ] `P0` Compare saved payload before/after refactor using the same prepared-product inputs.

---

# 17. Step 5 contract rows

- [ ] `P0` Top-level rows are flat, compact, and remain in explicit creation order.
- [ ] `P0` Main line shows contractual title, type, geometry/quantity, contractual unit/area, total, edit, duplicate, and delete.
- [ ] `P0` Existing details remain visible without accordions or “show more”.
- [ ] `P0` Missing detail categories are omitted.
- [ ] `P0` Mandatory, cutting, tools by group, finishing by group, description, source consumption, and remainders show when present.
- [ ] `P0` Stair layers remain nested under the exact parent.
- [ ] `P0` Remainder products remain nested/linked to the exact source.
- [ ] `P0` Children never appear as unrelated top-level products.
- [ ] `P0` Edit/duplicate/delete target stable identity.
- [ ] `P0` Delete confirmation is inline in the exact row.
- [ ] `P0` Pending state disables only the affected row.
- [ ] `P0` Editing does not reorder rows.
- [ ] `P0` Duplicate appends according to explicit creation order.
- [ ] `P1` At least 200 rows with nested children scroll smoothly and preserve keyboard focus.

## 17.1 Identity stress test

Create two visually identical products from the same catalog item:

- [ ] `P0` They have different row identities.
- [ ] `P0` Editing the second changes only the second.
- [ ] `P0` Deleting the first does not change the second.
- [ ] `P0` Duplicate creates a third identity.
- [ ] `P0` Delivery assignment remains attached to the intended row after insert/delete/reorder.
- [ ] `P0` Remainder and layer relationships remain attached to their exact rows.

---

# 18. Recovery, edit leases, revision conflicts, and offline behavior

## 18.1 Recovery journal

- [ ] `P0` Every semantic change queues local recovery immediately.
- [ ] `P0` Server checkpoint does not block typing or interactions.
- [ ] `P0` Refresh restores wizard step, customer/project, products, modal draft, units, descriptions, operation groups, sources, and prices.
- [ ] `P0` Browser crash restores the latest valid recovery.
- [ ] `P0` Reopening the same session retains edit ownership.
- [ ] `P0` Temporary network loss does not clear ownership or draft.
- [ ] `P0` Recovery never silently applies an invalid/partial graph.

## 18.2 Concurrent editing

- [ ] `P0` Open the same contract/draft in session A and session B.
- [ ] `P0` Session B can view but cannot begin a second edit automatically.
- [ ] `P0` Session B shows only `این قرارداد در محل دیگری در حال ویرایش است`.
- [ ] `P0` `ادامه ویرایش در اینجا` first fetches the latest valid recovery.
- [ ] `P0` Ownership transfers explicitly to B.
- [ ] `P0` A immediately loses save authority but its visible data is not cleared.
- [ ] `P0` No field-by-field auto-merge occurs.
- [ ] `P0` A save from the old lease token is rejected.

## 18.3 Revision conflicts

- [ ] `P0` Every save uses `baseRevision`.
- [ ] `P0` Modify canonical data externally after the draft opens.
- [ ] `P0` Stale save rejects completely.
- [ ] `P0` No product, payment, delivery, remainder, or operation partially commits.
- [ ] `P0` Seller-entered draft values remain available after rejection.
- [ ] `P0` Correct reload/retry uses the new revision.

---

# 19. Persistence and backend authority

- [ ] `P0` Client submits seller intent and snapshots, not trusted totals/remainders as sole authority.
- [ ] `P0` Backend reruns the same policy/version and persists authoritative canonical facts.
- [ ] `P0` Client/server calculation hashes match for valid saves.
- [ ] `P0` Force a mismatched client total; backend ignores/rejects it rather than storing it.
- [ ] `P0` Force a mismatched remainder/allocation; backend rejects the complete command.
- [ ] `P0` Engine-version mismatch shows only `محاسبات نیاز به به‌روزرسانی دارد`.
- [ ] `P0` Draft input remains after the correct engine version is loaded.
- [ ] `P0` Product graph, relational contract rows, deliveries, and audit history commit in one transaction.
- [ ] `P0` Database failure after graph calculation rolls back every write.
- [ ] `P0` Reloaded graph equals the graph returned by the successful save.
- [ ] `P0` Input hash, result hash, calculation policy, pricing policy, packing policy, and rounding policy are recorded.
- [ ] `P0` Audit history identifies actor, revision, command, and before/after state as designed.

---

# 20. Legacy data and migration

- [ ] `P0` Open an untouched finalized legacy contract; no write occurs.
- [ ] `P0` Its historical amount, product meaning, and output remain unchanged.
- [ ] `P0` Legacy read adapter produces a usable in-memory canonical representation.
- [ ] `P0` Opening a legacy draft/modal does not persist migration.
- [ ] `P0` Explicit authorized save writes only the new structure.
- [ ] `P0` Migration save is atomic across products, tools, finishing, layers, remainders, prices, and contract total.
- [ ] `P0` Expected pre/post financial total is equal.
- [ ] `P0` Unexpected financial difference blocks migration.
- [ ] `P0` Unambiguous stable relationships migrate.
- [ ] `P0` Ambiguous source, layer parent, operation group, or delivery relationship is not guessed.
- [ ] `P0` Ambiguous contract is marked for explicit review and cannot silently save.
- [ ] `P0` Old inactive catalog operations remain visible from snapshot.
- [ ] `P0` Old contracts remain readable during the transition while new writes use only canonical structure.
- [ ] `P0` Read-only contingency mode blocks contract-product writes with no data loss while reads/PDF remain available.

---

# 21. Downstream projection parity

For every complex product created above, compare the same saved facts across:

- Step 5
- reopened product modal
- contract detail
- customer/public confirmation
- PDF/print
- accounting
- workshop/production
- delivery
- logistics

Check:

- [ ] `P0` Contractual title is identical.
- [ ] `P0` Catalog identity remains stable internally.
- [ ] `P0` Customer-requested dimensions and units are identical.
- [ ] `P0` Internal packing does not replace customer intent.
- [ ] `P0` Workshop receives physical cut plan and operation groups.
- [ ] `P0` Physical cuts remain visible even when rate/charge is zero.
- [ ] `P0` Material, mandatory, cutting, tools, finishing, layer, and total amounts reconcile exactly.
- [ ] `P0` Free operations with inventory rate zero remain visible.
- [ ] `P0` Remaining-material child shows zero material charge and its own operation charges.
- [ ] `P0` Tools show group, piece/length scope, edges where applicable, quantity, unit, rate, and amount.
- [ ] `P0` Finishing shows group, quantity, unit, rate, and amount without edges.
- [ ] `P0` Stair layers nest under the correct parent.
- [ ] `P0` Remainder children link to the correct source.
- [ ] `P0` Delivery uses stable product-row identity after insert/delete/duplicate/reorder.
- [ ] `P0` Logistics resolves the same product row.
- [ ] `P0` PDF/accounting/workshop/delivery/logistics consume stored canonical facts rather than recalculating a different result.

---

# 22. Performance, resilience, and accessibility

## 22.1 Performance budgets

- [ ] `P1` Cached Step 5 display ≤200ms.
- [ ] `P1` Search response ≤50ms.
- [ ] `P1` Modal shell ≤150ms.
- [ ] `P1` Core editability ≤250ms.
- [ ] `P1` Simple calculations target <16ms.
- [ ] `P1` Typical 2D packing ≤150ms in worker.
- [ ] `P1` Large packing preferably ≤500ms while UI remains responsive.
- [ ] `P1` Typing, unit changes, and dimension changes never wait for network.
- [ ] `P1` Large optimizer work shows only a same-size summary skeleton.
- [ ] `P1` Other modal controls remain usable during worker calculation.
- [ ] `P1` 200+ rows and children retain smooth scrolling and keyboard navigation.
- [ ] `P1` Normal internal-network save target is <2s.
- [ ] `P1` Long save keeps the full draft visible.
- [ ] `P1` One-row mutation does not refetch/recalculate the entire contract.

## 22.2 Accessibility and interaction

- [ ] `P1` All inputs have visible labels.
- [ ] `P1` Segmented controls expose selected state to assistive technology.
- [ ] `P1` Switches expose name and state.
- [ ] `P1` Keyboard can reach search, filters, list rows, modal fields, inline selectors, and footer.
- [ ] `P1` Focus is trapped inside the open modal and returns to the initiating control.
- [ ] `P1` Escape/close follows the intended cancellation behavior without data mutation.
- [ ] `P1` Validation focus is visible.
- [ ] `P1` Text and subtle separators meet contrast requirements in light and dark themes.
- [ ] `P1` Persian RTL layout remains readable while numbers/units render correctly.
- [ ] `P1` Reduced-motion users receive no forced smooth scrolling or distracting transitions.

---

# 23. High-complexity end-to-end release scenarios

## E2E-01 — Longitudinal source with operations and remainder children

1. Create 20 × 1.5m × 12cm from 40cm mother stone.
2. Set manual base price, enable mandatory pricing, kerf as required, and explicitly choose calibration.
3. Create two operation groups:
   - 10 pieces: two meter tools on different edges plus square-meter finishing.
   - 5 pieces: another tool and meter finishing.
   - 5 pieces remain without operations.
4. Save.
5. Create two products from different remainders.
6. Give each child independent tools, finishing, and descriptions.
7. Edit the source once compatibly and once incompatibly.
8. Delete one child inline.
9. Duplicate the other child and select a different source.
10. Save, reload, and compare every downstream projection.

Expected:

- [ ] `P0` Exact row/source relationships and deterministic replay.
- [ ] `P0` No extra material or child is produced.
- [ ] `P0` No parent operation is inherited accidentally.
- [ ] `P0` All totals reconcile.
- [ ] `P0` Rejected source edit changes nothing.

## E2E-02 — Multi-part stair with independent layers

1. Create a complete-staircase quantity of 2 × 15 steps.
2. Configure tread, riser, and landing independently.
3. Use one-time copy from tread, then modify riser and confirm independence.
4. Add multiple operation groups to tread and riser.
5. Add two independent layer configurations to tread:
   - one from paid parent/remainder material
   - one from explicitly selected new stone with manual base price
6. Select multiple sides and verify combined strip packing.
7. Duplicate the tread with `همراه لایه‌ها`; select new sources.
8. Delete one layer, then delete the duplicate parent with layers.
9. Save/reload and compare workshop, PDF, accounting, delivery, and logistics.

Expected:

- [ ] `P0` Stair parts remain independent.
- [ ] `P0` Commercial sets and physical strips remain distinct.
- [ ] `P0` Layer allocations are deterministic and atomic.
- [ ] `P0` No double material charge.
- [ ] `P0` Parent/layer deletion rebuilds source inventory correctly.

## E2E-03 — Slab with mixed sources and pricing-method switching

1. Request four 1m × 1m pieces.
2. Add two separate 2m × 2m source rows.
3. Enable kerf and selected vertical sides.
4. Save in line-based mode.
5. Edit and switch to square-meter mode with a manual positive rate.
6. Switch back and forth, then save in square-meter mode.
7. Change catalog slab and confirm manual square-meter rate clears in a new draft.
8. Create an insufficient-source case and confirm rejection.
9. Reload and compare physical workshop cuts with customer/accounting charge method.

Expected:

- [ ] `P0` One source consumed and one complete source unused where geometrically possible.
- [ ] `P0` Physical plan does not change with charge method.
- [ ] `P0` No invented source.
- [ ] `P0` Exact saved method/rates survive reload.

## E2E-04 — Crash, takeover, and stale revision

1. Create a complex contract with all product families.
2. Leave one product modal open with unsaved operations.
3. Simulate crash and recover.
4. Open the same contract in another browser session.
5. Explicitly take over.
6. Attempt save from the old session.
7. Modify canonical data through the authorized second session and attempt a stale save.

Expected:

- [ ] `P0` Recovery restores every semantic draft value.
- [ ] `P0` Takeover is explicit.
- [ ] `P0` Old lease cannot save.
- [ ] `P0` Stale revision cannot partially save.
- [ ] `P0` Neither session loses its visible draft data silently.

## E2E-05 — Legacy contract migration

1. Clone production-like legacy contracts containing:
   - old tools/sub-services
   - old finishing fields
   - old nosing
   - stair layers
   - remainder children
   - delivery assignments
2. Open finalized contracts read-only and compare historical output.
3. Open one draft without saving.
4. Explicitly edit/save one unambiguous contract.
5. Attempt an ambiguous relationship migration.

Expected:

- [ ] `P0` Read/open performs no write.
- [ ] `P0` Authorized unambiguous save migrates atomically with equal financial total.
- [ ] `P0` Ambiguous migration is blocked and identified.
- [ ] `P0` Historical contracts not explicitly edited remain untouched.

---

# 24. Release exit criteria

Release is approved only when:

- [ ] All applicable P0 cases pass.
- [ ] No unresolved defect can cause silent data change, incorrect charge, wrong material allocation, broken relationship, partial save, or recovery loss.
- [ ] All product families pass save/reload equality.
- [ ] Migration dry-run has no unexplained financial drift or broken relationships.
- [ ] Step 5, PDF, accounting, workshop, delivery, and logistics reconcile to canonical saved facts.
- [ ] Performance budgets pass on realistic complex data.
- [ ] Backup and read-only contingency procedures are verified.
- [ ] QA evidence is attached to the release record.

## Defect report template

```md
### Defect title

- Build/commit:
- Environment/browser:
- Contract ID:
- Product row ID:
- Source/remainder/layer IDs:
- Policy versions:
- Priority: P0 / P1 / P2

#### Preconditions

#### Exact steps

#### Seller inputs

#### Expected canonical result

#### Actual UI result

#### Saved/API/database result

#### Downstream differences
- Step 5:
- PDF:
- Accounting:
- Workshop:
- Delivery:
- Logistics:

#### Atomicity/recovery impact

#### Evidence

#### Smallest reproducible transition
```
