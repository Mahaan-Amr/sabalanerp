# Partner product PDF parity — local acceptance

Date: 2026-10-12. Scope: product detail presentation in the internal Sabalan-to-Partner PDF and the Partner-to-Customer PDF. The agreed vocabulary is recorded in root `CONTEXT.md`.

Both outputs use the ordinary sales columns and a shared product-row builder. Final product geometry, consumed source geometry, mandatory charges, cuts, tools, finishing and layer details remain separate. Prepared weight retains its weight unit. Catalog enrichment reads identities/codes only and prefers recorded codes.

Print-only projections do not change the customer-output wire schema, hashes, signed snapshots, confirmation evidence or stored amounts. Internal print money comes from approved wholesale evidence; customer print money comes from its matching retail revision. Missing or inconsistent component witnesses are never replaced by catalog rates or allocated by guesswork. Historical operation witnesses are recovered only when their exact sum matches the approved wholesale component amount. The aggregate service PDF row is removed. If a historical breakdown cannot be proven, its charge remains in the product-and-services amount and unknown operation money remains `—`, without inventing rates.

Case reprints render the current layout from the graph matching the requested snapshot revision and integrity hash. `DOWNLOAD_EXISTING` retains the verified original bytes. Reprinting an already-issued Case does not replace its artifact or repeat publication. The ordinary sales PDF cache fingerprint changes only for Partner customer contracts so their subsequent print can use the new layout without overwriting old files.

## Verification

- Focused parity, internal document, customer print and Case PDF suites: 19 tests passed, including source versus finished area, exact total reconciliation, private price exclusion, historical aggregate fallback, zero prices, rial conversion, mixed slab sources, prepared weight and code-only lookup.
- Ordinary contract print regression command passed: longitudinal optimizer, project names, stair/layer detail, operation lookup, accounting currency, remaining recovery and Tehran timestamps.
- Backend TypeScript/build and database client ownership checked; no new Prisma client or migration is introduced.
- Three synthetic QA PDFs generated through Chromium and the existing PDF buffer utility in the existing `sabalanerp-local` backend; all six pages rendered with Poppler and visually inspected for readable Persian text, table columns, row separation and clipping.

Generated fixtures and images remain under `tmp/qa/partner-product-pdf-parity/`, outside deployable source. They are test examples, not regenerated versions of the user's actual contracts. Contract 100708 was not present in the local database; no production access was used to obtain it.

Initial source verification did not replace the running local application image; its PDF QA used the updated local HTML with the existing container's Chromium/PDF utility.

## Authorized local activation and requested contract

On 2026-10-12 the user authorized rebuilding only the existing `sabalanerp-local` backend and testing both PDFs through the application. A local PostgreSQL custom-format backup was taken before `docker compose -f docker-compose.local.yml up -d --build --no-deps --wait backend`. The backend became healthy, startup reported no pending migrations, and the SHA-256 of its compiled `dist/utils/partnerProductPrint.js` matched the local build. PostgreSQL and its data volumes were not recreated.

An initial application check downloaded the internal PDF for local contract 100347. The user then explicitly selected 100708, so 100347 is not acceptance evidence for the requested contract. Live read-only queries found neither sales contract 100708 nor internal record PI-100708 in the local database; its numeric sales-contract range is 100001–100352. Testing both application PDFs for 100708 remains pending its availability locally. The attached PDF is insufficient to recreate its authoritative pricing and version evidence.

No push or remote server action was performed. Existing local business data and issued files were retained; normal local login/authorization evidence and the initial internal PDF download may add operational records/files.

## Contract 100708 read-only extraction

The user subsequently authorized read-only production extraction and selected actual contract 100708 for local application verification. Its revision 3 contains 14 product rows. The selected contract, immutable revisions/events, payment plans, output snapshots/artifact and necessary identity/catalog dependencies were exported through a `REPEATABLE READ READ ONLY` transaction; no server files were created and no production writes were issued. Authentication passwords, OTP sessions and outbox work were excluded.

The additive local import first passed a rollback preflight, then committed with all database guards/constraints enabled. Retained Case events were replayed through the normal version CAS; existing rows in every touched table were checked by their JSON digest before commit and were unchanged. New technical user identities use disabled login, isolated local email/username and no production password; unrelated personnel records were not imported. Immutable commercial graph, pricing, customer-output hashes and existing issued artifact bytes were preserved. Local SMS is sandbox with no API key and web push is unconfigured. A fresh local database backup precedes import.

All 14 rows have a provable operation breakdown and no missing operation rate. The internal payable remains 503690000 IRT; the customer payable remains 601444100 IRT.

## Actual application acceptance for 100708

Following the targeted backend rebuild, both PDFs were downloaded by clicking the application's download button in a real Chrome session, without route mocks. The internal accounting endpoint returned HTTP 200 (713966 bytes); the customer sales endpoint returned HTTP 200 (390366 bytes). The internal output was tested with the local administrator and the customer output with the imported contract owner's temporary local QA identity. Existing administrator access to the Partner sales view returned 403; existing grants and authorization code were not changed. The temporary owner login was disabled again in a `finally` block.

Both PDFs have five pages. All ten pages were rendered with Poppler and visually inspected: product/source geometry is separated, service rates are numeric, the aggregate service row is absent, Persian text is readable, and table content is not clipped. The customer output does not show wholesale material prices or the internal payable. Both agreed totals match the source revision. Before/after proof files confirm that the Case state, all immutable revision hashes and the original issued artifact bytes/hash remained unchanged after the downloads.

Actual outputs, screenshots and HTTP results remain in `tmp/qa/partner-product-pdf-parity/app/`. The earlier pending/fixture notes above describe the initial phase only; acceptance for the requested contract is now complete. Production was accessed only for read-only extraction, and nothing was pushed.

## Independent arithmetic audit of the actual PDFs

The actual PDF table cells were extracted with pdfplumber, excluding repeated table headers, geometry-only rows, payment schedules and footer summaries. For each of the 14 products, the multiset of printed monetary components and their sum matched the frozen revision projection; operation identities were unique. Finished product geometry carries no repeated material charge. Internal PDF: 37 monetary rows, material 4540860000 IRR + cuts 58620000 IRR + tools 160895000 IRR + finishing 276525000 IRR = 5036900000 IRR. Customer PDF: 49 monetary rows, material 496744500 IRT + mandatory 55095600 IRT + cuts 5862000 IRT + tools 16089500 IRT + finishing 27652500 IRT = 601444100 IRT. Discount, tax and additional footer charges are zero. Both differences against the printed final amounts are exactly zero. No double-counted component was found. SHA-256 file identities and per-product results are saved in the local `app/monetary-reconciliation.json` evidence file. This audit did not access production or change database data.
