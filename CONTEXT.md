# Sabalan ERP

Sabalan ERP manages stone inventory, sales contracts, and related pricing data for Sabalan Stone. This glossary defines project-specific business terms so the product and code use the same language.

**Contract Hard Deletion**:
The irreversible removal of a Draft or Voided sales Contract after Admin approval, permitted only when the Contract has no financial document and no conclusive physical operation. An Accountant or Manager may request deletion, while an Admin may either decide that request or initiate and approve deletion directly; the reason, actors, dependency check, and outcome remain in the audit history after the Contract is removed. Any blocking dependency prevents deletion and is identified explicitly to the Admin.
_Avoid_: deleting an active Contract, treating disappearance from ordinary lists as deletion, cascading through financial or conclusive physical evidence, requiring a second actor for an Admin-initiated deletion, allowing Manager approval alone, losing the deletion audit record, or reporting an unexplained deletion failure

**Inactive Contract**:
A sales Contract preserved with all of its history but removed from ordinary Sales and Accounting lists and blocked from new financial records, edits, delivery planning, and loading operations. It remains available in an explicit inactive view, and existing finalized operations, debts, and receivables remain visible and may be settled. Deactivation is blocked until every in-progress physical operation and unfinished mutable financial workflow is resolved, with each blocker identified explicitly; a settled financial record or an outstanding debt or receivable is not itself a blocker. An Accountant may request deactivation with a reason; a Manager or Admin may approve or reject that request and may also deactivate directly without a second actor, with a mandatory reason and audit record. Only an Admin may reactivate it, while a Manager or Accountant may request reactivation.
_Avoid_: Voided Contract, deleted Contract, hiding existing obligations, allowing new commercial or physical work, stranding an in-progress operation, treating an outstanding settled obligation as a deactivation blocker, erasing history, requiring a second actor for direct Manager or Admin deactivation, deactivation without a reason and audit record, or allowing non-Admin reactivation

**Contract Creation Draft**:
The creator-private recoverable unfinished state of one sales Contract creation attempt, beginning only after the user's first meaningful committed business change from the blank wizard, such as an explicitly changed Contract date, selected Customer or Project, or saved Product, Delivery, or Payment entry. Wizard navigation, search or filter text, opening a modal, and editing an uncommitted modal are transient interaction state rather than meaningful Draft progress; merely opening or transiently exploring an untouched creation page creates neither a durable Draft nor recovery ownership. Only its creating User may discover, resume, discard, or take over the Draft across that User's own tabs or devices; every other User starts an independent Contract attempt. Opening Contract creation normally starts empty; when an unfinished Draft exists, the user explicitly chooses either to resume it or, after confirmation, discard it and start a new Contract. Returning from the same editing location preserves recovery ownership and must not be presented as concurrent editing elsewhere. Another editing location counts as the current owner only while it has demonstrated activity within the preceding 60–90 seconds; after that inactivity window the Draft remains recoverable but is no longer described as being edited elsewhere. A meaningful Draft remains recoverable for one consistent seven-day period from its last meaningful change across browser and server recovery; after expiration all of its recovery and ownership state is cleared and creation starts empty without a warning. When another editing location genuinely owns the Draft, takeover is the single recovery decision and the protected Draft is its recovery content rather than a second independent resume choice. Confirmed takeover immediately makes the new location the sole writer, restores the newest committed recovery state there, and makes the previous location read-only before it can save again. Confirmed discard is authoritative across every location immediately: no older location may restore or resave the Draft, its recoverable contents are erased, and only a minimal audit fact that discard occurred is retained. Successful Contract creation clears every browser and server recovery state for that Draft and opens the new Contract detail with visible success feedback; a temporary detail-load failure preserves committed-success truth and offers an explicit retry without returning to the completed wizard.
_Avoid_: treating transient interaction state as meaningful Draft progress, exposing or transferring a creation Draft to another User, creating a Draft or durable edit session from page entry alone, silently restoring a prior Draft in a new location, using conflicting browser and server retention periods, retaining expired recovery or ownership, letting abandoned ownership persist indefinitely, describing an inactive location as a concurrent editor, treating same-location re-entry as a competing editor, showing concurrent-editing and Draft-recovery choices for the same entry state, treating takeover and Draft recovery as independent decisions, allowing two writers after takeover, losing the newest committed recovery during takeover, allowing an older location to resurrect a discarded Draft, retaining discarded contract contents as audit data, treating a successfully created Contract as recoverable Draft state, starting over without confirming Draft discard, leaving the user on the completed wizard, returning a successful creation to an editable state after detail-load failure, or carrying one Draft's state into another Contract

**Contract Customer Snapshot Boundary**:
The contract-owned customer evidence frozen with a Sales Contract contains the stable identity and the customer facts needed to reproduce that contract, including applicable name, legal, contact, address, and selected-project evidence. Live CRM navigation data—including other Sales Contracts, Leads, Communications, Potential Projects, ownership projections, counters, and operational timelines—never enters the Contract snapshot or a Financial Record source snapshot. Existing historical snapshots remain immutable; a new Accounting snapshot preserves the Contract's commercial, Product, Delivery, Payment, and customer-identity evidence without recursively copying unrelated CRM history.
_Avoid_: copying a complete CRM Customer response into `contractData.customer`, embedding prior Contracts inside a new Contract, removing customer identity or contract-relevant contact/project evidence, rewriting existing historical snapshots, treating a longer transaction timeout as the correction for recursive data growth, or dropping Product, Delivery, Payment, pricing, and approval evidence from an Accounting source snapshot

**تاریخ قرارداد فروش**:
The seller-selected Persian-calendar date of the commercial agreement, distinct from system creation time and Delivery or Payment dates. Recovery preserves an explicitly selected date; when it is older than today, final review warns without silently changing or blocking it.
_Avoid_: resetting a recovered date to today, equating Delivery today with Contract today, changing an existing Contract on read, or blocking an intentional past agreement date

**برنامه پرداخت قرارداد**:
The current saved relational Payment rows are the authoritative Sales plan for method, subtype, amount, dates, check details, status, and notes; an embedded creation snapshot is historical read-only fallback only when those rows do not exist.
_Avoid_: treating planned Payment as an Accounting receipt, preferring an older snapshot over saved Payment rows, calling a valid compound method missing, or creating relational rows while viewing historical fallback

**Contract Party Identity**:
The indivisible identity of a sales Contract's relational Customer, embedded Customer snapshot, rendered Contract text, and selected Project. Changing the Customer in an editable Contract immediately clears only the Draft's Project selection, reloads that Customer's Projects, and persists the new Customer and newly selected Project atomically; it never deletes or merges CRM records. A financially locked Contract changes party identity only through the formal audited Contract correction workflow. Search normalization may help users find Persian-name variants, while CRM record IDs, phone numbers, and Responsible Seller remain the disambiguating evidence and name equality never merges Customers.
_Avoid_: retaining the previous Customer's Project, accepting a late Customer response for an older selection, silently repairing a mismatched submission, updating only the embedded snapshot or only the relational Customer, selecting by normalized name, merging duplicate names, deleting CRM records when a selection changes, or bypassing the formal correction workflow for financially locked Contracts

**Contract Financial Record Eligibility**:
The ability to create and manage Accounting records for an otherwise eligible sales Contract regardless of how long ago the Contract was created. A System Invoice may use any valid past issue date without an age-based or ten-day backdating restriction.
_Avoid_: expiring Accounting access because a Contract is old, applying a hidden fifteen-day Contract limit, or rejecting a System Invoice solely because its issue date is more than ten days in the past

**Optimizer-Derived Contracted Quantity**:
The positive total linear meters of a longitudinal Contract Item whose raw zero quantity records that the optimizer derived the piece count rather than that nothing was contracted. Each Product family and unit owns a versioned commercial-precision policy—discrete Piece Count is integral while a measured unit such as meters may use scale three—and every finalized Contract retains the policy version effective when its evidence was created. Accounting automatically reconciles the frozen optimizer plan, canonical Product Graph, and every persisted frozen Delivery/Product quantity for the same stable Product row under that historical policy, without exposing technical compatibility work to the initiating User. Raw witnesses first become exact decimal values under their recorded producer, schema, and calculation-policy version; values such as `50` and `50.00000000000001` are equivalent when they normalize to the same declared commercial quantity, while no global tolerance, current policy, or guessed precision may substitute for missing provenance. Accounting may then seal the converted scale-three quantity while preserving the unmodified raw witnesses, declared precision, producer and policy versions, conversion rule, difference, initiating actor, and system action as audit evidence; this compatibility path never edits the original Contract or its snapshots. Missing or ambiguous provenance that permits more than one commercial result is a genuine conflict. A wizard-era Delivery copy is corroborating evidence when present; its absence does not invalidate complete persisted evidence. A genuine witness disagreement blocks approval and creates an explicit quantity-review case in clear Persian business language instead of surfacing an internal validation error. A zero invoice-item quantity shares the sentinel meaning only after that full reconciliation succeeds, while any positive invoice quantity must equal the sealed meters exactly; every operational view and document then displays canonical meters, and raw zero remains visible only as audit evidence.
_Avoid_: involving Users in resolvable technical compatibility, comparing binary floating-point residues as commercial quantities, discarding or rewriting higher-precision raw witnesses, accepting an undocumented tolerance or precision, guessing a conversion rule when provenance is absent or ambiguous, treating a raw Contract Item or invoice-item zero sentinel as a financial or delivery quantity, normalizing an invoice sentinel before full reconciliation, accepting a positive invoice quantity that differs from sealed meters, deriving meters from current product rules, accepting agreement by catalog identity instead of stable Product row identity, treating the wizard-era Delivery copy as authoritative, requiring an absent redundant wizard copy when persisted evidence is complete, ignoring a conflicting wizard copy, modifying the original Contract or its snapshots, displaying zero operationally when canonical witnesses agree, hiding the raw witnesses or conversion audit evidence, displaying an invented quantity while reconciliation is unresolved, accepting a partial Delivery sum, mixing units, double-counting a duplicate Delivery row, hiding over-allocation, silently choosing one witness when quantities conflict, or displaying an internal validation message to an operational User

**Contract Quantity Roles**:
A Contract Product row keeps Piece Count, Measured Quantity, and Billable Quantity as distinct facts: Piece Count is the discrete number of physical pieces, Measured Quantity is the exact unit-bearing geometry or aggregate measure requested and produced, and Billable Quantity is the declared commercial measure used for pricing and Accounting reconciliation. Each Product family declares which fact owns its Billable Quantity, and automated reconciliation never asks an operational User to translate between these roles.
_Avoid_: calling all three facts quantity without qualification, deriving Piece Count from money, treating optimizer output as the customer's requested measure, combining different units, or asking Sales or Accounting Users to resolve a deterministic conversion

**Automated Quantity Evidence Recovery**:
The audited system recovery of missing Accounting quantity evidence from the immutable signed Contract Product row and its versioned frozen provenance. New writes reconcile at the Contract create/edit boundary, historical records are processed by an idempotent background migration, and every financial action performs the same final idempotent guard. A single deterministic result is reconstructed, sealed, and any corresponding technical review is system-closed silently without changing the signed commercial evidence or showing operational notifications; the raw comparison and applied policy remain in technical audit history. Operational Users see no retry control for recoverable compatibility. Absent or ambiguous source evidence remains a technical historical-evidence failure and never falls back to `total amount ÷ unit price`; only such an unrecoverable case exposes a tracked support path, while a genuine commercial disagreement requires a formal Contract amendment and User involvement.
_Avoid_: silently rewriting a signed Contract, deriving quantity from price, prompting operational Users for deterministic compatibility work, exposing a retry button for a recoverable case, announcing a successful background repair, inventing evidence, choosing among ambiguous sources, leaving a deterministically recoverable historical case open, or treating successful evidence recovery as a Contract amendment

**پیام عملیاتی کاربر**:
پیام فارسی، دقیق و قابل‌اقدامی که یک رخداد ناموفق، هشدار، مانع کسب‌وکاری یا اقدام بعدی را برای کاربر توضیح می‌دهد، بدون نمایش نام فیلد داخلی، شناسه‌ی پیاده‌سازی، stack trace، متن exception یا جزئیات سازگاری فنی. سامانه ابتدا ناسازگاری فنیِ قابل‌حل را خودکار و بی‌صدا رفع می‌کند؛ فقط وقتی دخالت انسانی واقعاً لازم است، پیام عملیاتی می‌گوید چه چیزی متوقف شده، دلیل کسب‌وکاری چیست، چه کسی یا چه نقشی باید چه اقدامی انجام دهد، و یک شناسه‌ی پیگیری امن برای پشتیبانی ارائه می‌کند. جزئیات تشخیصی متناظر با همان شناسه در لاگ و ممیزی مجاز نگهداری می‌شود.
_Avoid_: پیام انگلیسی برای کاربر عملیاتی، نمایش مستقیم exception، اصطلاحات برنامه‌نویسی، افشای شناسه یا داده‌ی حساس، پیام مبهمی مانند «خطایی رخ داد»، درخواست از کاربر برای حل ناسازگاری داخلی، موفق‌نمایی عملیات ناموفق، هشدار بدون اقدام بعدی، یا ترجمه‌ای که معنای کسب‌وکاری خطا را تغییر دهد

**پرونده بررسی شواهد مالی**:
پرونده‌ی ساختاریافته و قابل‌ممیزی برای یک تعارض واقعی یا شواهد ناکافی که سامانه نتوانسته است با قواعد قطعی سازگاری به‌صورت خودکار حل کند، با دسته‌هایی مانند تعارض کمیت، اجزای قیمت، تخفیف، هویت ردیف محصول، مبلغ قرارداد و فاکتور، یا snapshot تاریخی. هر پرونده هویت و لینک مستقیم خود را دارد، شواهد خام را با بیان کسب‌وکاری و بدون افشای سازوکار فنی نشان می‌دهد، علت و مالک اصلاح را تعیین می‌کند و فقط مسیر معتبر بعدی—اصلاح مبدأ به‌دست فروشنده مسئول، بازیابی شواهد تاریخی، یا رسیدگی فنی—را ارائه می‌دهد. مقدار کمیت هرگز دستی override نمی‌شود و پرونده با بستن یا لغو عمومی خاتمه نمی‌یابد؛ پس از اصلاح مبدأ، بازآزمایی قطعی همان زنجیره تنها راه رفع مسدودسازی است و موفقیت آن کاربر را به ادامه تأیید مالی برمی‌گرداند، درحالی‌که تعارض باقی‌مانده پرونده را باز نگه می‌دارد.
_Avoid_: ساختن گردش‌کار جداگانه برای هر نوع ناسازگاری، استفاده از exception به‌جای پرونده، پرونده‌ی بدون مالک مشخص یا اقدام بعدی، واداشتن حسابدار آغازگر به تشخیص فنی، نمایش سازگاری فنی یا شناسه داخلی به کاربر عملیاتی، لینک به داشبورد یا بخش عمومی به‌جای پرونده دقیق، بن‌بست ناوبری، گم‌کردن زمینه‌ی قرارداد هنگام رفت‌وبرگشت، override دستی مقدار، بستن یا لغو عمومی پرونده، رفع مسدودسازی بدون بازآزمایی موفق، یا ایجاد درخواست اصلاح فروش بدون ارتباط قابل‌ردیابی با تعارض مبدأ

**مرز ثبت canonical قرارداد مالی**:
مرز اتمیک و نسخه‌دار ثبت هر قرارداد فروش جدید یا ویرایش‌شده که پیش از commit، Product Graph، هویت پایدار ردیف‌ها، کمیت‌ها، Deliveryها، اجزای قیمت و snapshotهای مالی را با یک engine و policy مشترک میان frontend و backend سازگار می‌کند؛ backend نتیجه را به‌صورت authoritative دوباره اجرا و اعتبارسنجی می‌کند. هر حقیقت یک مالک canonical دارد و snapshotهای مشتق‌شده از همان حقیقت بازتولید می‌شوند. ناسازگاری قابل‌اصلاح پیش از ذخیره با پیام عملیاتی فارسی و در محل مرتبط به فروشنده برگردانده می‌شود و داده‌ی ناسازگار هرگز به حسابداری منتقل نمی‌شود. قرارداد تاریخی با مشاهده، چاپ یا خواندن بازنویسی نمی‌شود و فقط از مسیر سازگاری یا migration صریح نسخه‌محور عبور می‌کند.
_Avoid_: اعتبارسنجی نخستین‌بار در حسابداری، engine یا policy متفاوت میان frontend و backend، چند مالک برای یک حقیقت، merge کردن snapshotهای مشتق‌شده به‌عنوان حقایق رقیب، commit ناقص بخشی از گراف، write-on-read، نمایش موفقیت پیش از commit کامل، یا اتکا به تست frontend برای حفاظت از persistence

**ممیزی سراسری شواهد قرارداد**:
اسکن read-only و پیشگیرانه‌ی همه‌ی قراردادها و ردیف‌های مرتبط پیش از آنکه کاربران در حسابداری با خرابی روبه‌رو شوند، با طبقه‌بندی حداقل به سالم و canonical، سازگاری فنیِ قابل‌حل خودکار، نیازمند migration نسخه‌محور، تعارض واقعی، provenance ناکافی یا مبهم، و خطر مبلغ، کمیت، هویت یا خروجی پایین‌دستی. گزارش، تعداد و هویت موارد متأثر، شدت، علت، شواهد و dry-run نتیجه‌ی اصلاح را ارائه می‌کند. فقط موارد قطعی از migration اتمیک، idempotent، قابل‌ممیزی و قابل‌بازگشت عبور می‌کنند؛ موارد مبهم بدون حدس به پرونده بررسی شواهد مالی تبدیل می‌شوند.
_Avoid_: بررسی صرفاً هنگام برخورد کاربر، محدودکردن ممیزی به یک قرارداد گزارش‌شده، تغییر داده در مرحله‌ی اسکن، migration بدون dry-run، اصلاح غیراتمیک، اجرای دوباره با نتیجه‌ی متفاوت، از دست‌دادن شواهد خام، یا تبدیل ابهام به مقدار حدسی

**زنجیره شواهد قرارداد تا تسویه و ارسال**:
مرز کامل مالکیت و تطبیق داده از ایجاد یا ویرایش فروش، Product Graph، persistence قرارداد و Delivery، پیش‌فاکتور و تأیید مالی، دریافت‌ها و چک‌ها، مالیات و سامانه مودیان، چاپ و PDF، کارگاه، تا لجستیک و مانده بارگیری. ممیزی و پذیرش هر تغییر مرتبط، همه‌ی writerهای فروش و حسابداری و همه‌ی consumerهای وابسته در این زنجیره را پوشش می‌دهد، حتی وقتی نشانه‌ی خرابی در فضایی متفاوت از منشأ آن ظاهر می‌شود. فضای نامرتبطی مانند منابع انسانی خارج از این مرز است.
_Avoid_: نسبت‌دادن مالکیت خطا به صفحه‌ای که آن را نمایش داده، اصلاح یک projection بدون بررسی writer مبدأ، تست‌کردن حسابداری بدون فروش و Delivery، نادیده‌گرفتن چاپ یا کارگاه، یا تأیید مقدار مالی بدون تطبیق اثر آن بر مالیات، دریافت و بارگیری

**اصلاح سازگاری سابقه مالی نهایی**:
افزودن append-only evidence، seal، projection یا version سازگار به یک سابقه‌ی نهایی، با پیوند صریح به شواهد خام و بدون بازنویسی قرارداد یا snapshot تأییدشده، رکورد مالی تأییدشده، دریافت، چک، ثبت مالیاتی یا واقعیت ارسال. پیش‌نویس و داده‌ی تأییدنشده فقط با نتیجه‌ی قطعی، migration اتمیک و ممیزی‌شده تغییر می‌کند؛ اصلاح تجاری سابقه‌ی نهایی از گردش‌کار رسمی اصلاح، ابطال، reversal یا replacement عبور می‌کند و ابهام بدون mutation به پرونده بررسی شواهد مالی تبدیل می‌شود.
_Avoid_: update-in-place سابقه‌ی نهایی، تغییر snapshot برای عبور از اعتبارسنجی جدید، حذف یا پنهان‌کردن مقدار خام، migration پیش‌نویس مبهم، بازسازی تاریخ با policy فعلی، یا اصلاح مستقیم اثرهای مالیاتی، دریافت و ارسال

**Shipment Quantity Reconciliation**:
The event-derived, scale-three reconciliation for one financially approved stable Contract Item row and its snapshotted unit: Contracted Quantity equals Finalized/Reserved Quantity plus Physically Dispatched Quantity plus Available-to-Load Quantity. Identical-looking rows remain separate, incompatible units are never combined, and negative availability remains visible.
_Avoid_: using catalog identity as row identity, binary floating-point arithmetic, mixing units, clamping negative balances, or treating a Logistics finalization as physical dispatch

**Finalized/Reserved Quantity**:
The quantity of an active, immutable finalized Logistics Allocation Revision that has not physically exited. It remains reserved through Accounting review, waybill issuance, driver confirmation, authorization expiry or revocation, and document-only waybill voiding or reissue. It leaves the bucket only by moving to Physically Dispatched Quantity at Guard-recorded exit or when the allocation receives an explicit rejection, withdrawal, cancellation, unloading, or supersession disposition.
_Avoid_: releasing a reservation because a document changed, counting the same allocation as both reserved and dispatched, retaining a disposed allocation in available-load calculations, or deriving this bucket from scheduled Delivery records

**Physically Dispatched Quantity**:
The quantity proven to have crossed the gate by a Guard Physical Exit Record or honestly registered Manual Outage Exit, adjusted only by posted append-only Dispatch Corrections. A verified return changes this quantity only after Accounting posts its linked negative correction.
_Avoid_: calling Logistics finalization dispatch, treating a waybill or driver confirmation as physical exit, applying draft corrections, or deleting prior exit evidence

**Available-to-Load Quantity**:
The signed result of Contracted Quantity minus Finalized/Reserved Quantity minus Physically Dispatched Quantity for one stable Contract Item row and unit. It is authoritative for display only when projection health is current; Logistics finalization must still recompute and lock source evidence transactionally.
_Avoid_: using a cached value to authorize loading, presenting an uncertain row as zero, or hiding over-allocation by clamping the result

**Shipment Projection Health**:
The evidence condition attached to each Shipment Quantity Reconciliation: `CURRENT`, `STALE`, `LEGACY_UNRECONCILED`, or `EVIDENCE_CONFLICT`. Non-current rows retain their last verified truth when available and block new loading authorization; aggregates label known subtotals and affected-row counts instead of claiming completeness.
_Avoid_: converting missing or conflicting evidence to zero, presenting a partial subtotal as complete, or allowing stale projection cache to authorize a reservation

**Displayed Monetary Amount**:
A monetary value presented to a user in Sabalan ERP, including interactive screens, print/PDF output, and Excel exports, rounded to the nearest whole unit of its stated currency. Storage and intermediate calculations retain their full precision so display rounding never changes business results. Each authoritative total is rounded directly for presentation and is never recomputed from already rounded display rows, even when the visible line-item arithmetic differs by a minor rounding residue.
_Avoid_: displaying fractional currency units, rounding persisted values or intermediate calculations, rebuilding authoritative totals from rounded rows, or allowing different user-facing outputs to disagree

**Personnel List Context**:
The restorable logical state of the Human Resources Personnel collection: active or archived view, committed search and filters, server page, expanded Personnel, and return scroll position. Shareable state lives in the URL and replaces the current history entry as it changes; scroll remains session-scoped. In-app return uses the recorded logical origin rather than replaying intermediate list-state changes, while refresh and direct links reconstruct the URL-owned portion.
_Avoid_: keeping committed list state only in component memory, adding each filter or page change as a browser-history destination, treating scroll as shareable URL state, or returning every user to the Human Resources root regardless of origin

**Sabalan Design System**:
The platform-wide visual, interaction, accessibility, and user-experience language for Sabalan ERP. The Guard workspace and the contract Product Selection flow are reference implementations that inform the shared system without contributing Guard- or contract-specific domain assumptions to generic components.
_Avoid_: calling the platform system the Guard design system, copying reference-page styling without reusable behavior, or leaking workspace terminology and permissions into shared primitives

**Confirmed Access Change**:
A User access administration change whose success confirmation means every selected direct access has been durably recorded and is immediately represented consistently when the administrator returns to an access summary. No manual refresh, repeated grant, or waiting period is part of successful completion.
_Avoid_: confirming success while one access source remains stale, treating eventual badge appearance as completion, requiring the administrator to reconcile access sources, or making repeated submission the recovery path

**داشبورد اصلی**:
The role-authorized operational overview that prioritizes current business state, items needing attention, and the user's next useful actions; workspace and administration navigation remains available with secondary emphasis.
_Avoid_: treating the main dashboard as a flat application menu, giving every destination equal visual weight, or hiding operational truth behind decorative presentation

**Position Capacity Coverage**:
The share of total capacity across active Positions that is allocated either to current capacity-consuming assignments or to planned hires with a Position Start Reservation. Acting assignments do not consume capacity, and when active Positions provide no capacity the coverage has no percentage rather than zero or complete coverage.
_Avoid_: presenting a fictional workflow-completion percentage, counting only active headcount or only planned hires, counting Acting assignments, or presenting an undefined zero-capacity ratio as zero or complete

**Position Capacity Coverage Summary**:
The compact interactive presentation of Position Capacity Coverage with a 96px ring on two-column desktop or laptop layouts and an 80px ring in its non-sticky single-column mobile summary, accompanied by separate In Use, Start Reservation, and Vacancy counts. It remains sticky below the page header only within the Position section on two-column layouts, never fixed or overlapping, and shows `—` with an explicit no-active-capacity explanation when the ratio is undefined.
_Avoid_: a large decorative chart, sticky behavior at mobile or 200% zoom, hiding the capacity breakdown, covering list content, or showing a misleading zero-percent ring

**Human Resources Metric Drilldown**:
The filtered record collection represented by an operational Human Resources count or percentage, opened from every corresponding metric card, verification item, or progress ring even when its value is zero. The destination owns its filter in the URL so browser return restores the prior dashboard or list context, while the empty filtered result remains explicit rather than disabling navigation.
_Avoid_: decorative non-navigable operational counts, linking a metric to an unfiltered list, disabling zero-value drilldown, or losing filter and return context

**Position Capacity In Use**:
Capacity consumed by a currently effective Primary or Secondary Employment Assignment whose Employment Relationship is Active or Suspended. Suspension retains the person's place until the assignment or relationship ends.
_Avoid_: treating suspension as a vacancy, counting Acting assignments, or counting ended assignments

**Position Start Reservation**:
Capacity reserved by a Planned Employment Relationship's Primary or Secondary Employment Assignment for a confirmed future start. A Recruitment Request or open hiring Application alone does not reserve capacity; reservation begins only when Hire Conversion creates the planned relationship and assignment.
_Avoid_: calling every recruitment intention committed capacity, reserving capacity for an unconverted Applicant, or counting Acting assignments

**Position Vacancy**:
The remaining capacity of an active Position after subtracting Position Capacity In Use and Position Start Reservations for the relevant effective period.
_Avoid_: subtracting only active headcount, treating an inactive Position as currently vacant, or ignoring confirmed future starts

**Position Capacity Change**:
An audited, non-retroactive change to a Position's positive-integer capacity with an effective date of today or later; increases record their before/after values, while decreases additionally require a reason and impact preview and cannot fall below capacity-consuming assignments from their effective date forward or invalidate an active Recruitment Request's approved remaining hires. Zero capacity is represented by deactivating the Position, and no assignment, planned hire, or Recruitment Request is created, cancelled, or moved automatically.
_Avoid_: reducing capacity from a point-in-time count alone, using zero as an active capacity, silently invalidating future staffing, automatically creating recruitment demand after an increase, or rewriting historical capacity

**Position Assignment History Detail**:
The permission-scoped focused view opened by every active or inactive Position card, combining current capacity breakdown, current and planned Primary or Secondary assignees, separately identified non-capacity-consuming Acting assignees, ended assignment periods, and effective-dated capacity and structural changes. It shows only necessary organizational identity and effective dates, preserves the originating list's filter and scroll context, and keeps embedded card actions independent from opening the detail.
_Avoid_: showing only the current occupant, mixing Acting into consumed capacity, exposing confidential Personnel evidence, navigating away without return context, or letting an embedded action trigger the detail accidentally

**Applicant Case Overview**:
The always-visible, permission-scoped summary of an Applicant's hiring case, combining the application context, current lifecycle state, next accountable action, and a concise decision-relevant profile without reproducing the full Candidate Profile or Application Form.
_Avoid_: calling it the first hiring-case level, exposing protected evidence in the summary, or treating the summary as the complete Applicant record

**Full Applicant Information**:
The permission-scoped Applicant case view that groups the complete Candidate Profile, experience and qualifications, submitted Application Form answers, and the case's single document/evidence index while preserving each source revision and its access boundary. Every indexed file independently authorizes viewing or downloading, and lifecycle steps do not repeat the index.
_Avoid_: presenting the complete record in an overlay, flattening protected evidence into the Applicant Case Overview, repeating the file index in every lifecycle step, granting every section merely because a user can open the case, or treating index visibility as permission to download every file

**Closure Summary**:
The permission-scoped explanation opened from a completed Applicant case label, identifying the closure outcome, prior lifecycle phase, accountable closure event, and any authorized reason or reopening state without embedding protected evidence.
_Avoid_: exposing the free-text closure reason to every case reader, attaching protected files to the summary, or making a closed label look non-interactive when authorized detail exists

**Closed Applicant Portal State**:
The read-only, Candidate-safe `/apply` state shown to an already authenticated Applicant after their Application closes, confirming only a safe terminal outcome and contact guidance while disabling every mutation and withholding internal reasons, evidence, and case history.
_Avoid_: presenting closure as an authentication failure during an existing session, allowing a closed Application to change, or reusing an expired invitation without formal reopening

**Hiring Rial Amount**:
A non-negative whole-Rial monetary value used for requested salary, compensation rows, collateral requirements, collateral receipt, and reusable collateral templates. Entry accepts Persian or English digits and displays live three-digit comma grouping such as `20,000,000`, while persistence uses a canonical separator-free integer and keeps an empty value distinct from zero.
_Avoid_: implicit Toman conversion, storing formatted separators, accepting fractional Rials, or treating narrative benefits as part of the numeric amount

**HR Work Item**:
A concrete Human Resources duty with a due date, lifecycle status, destination, and preserved completion history, created manually for a named User or derived automatically from an actionable HR condition. A derived approval or workflow action is one shared item visible and notified to every User with its required action permission; the first valid decision completes the source and closes the item for every other eligible viewer, while an ADMIN or MANAGER with the Human Resources Broad-Manager Override may also act. Its task-scoped view reveals only the case information and actions required for that duty, and completion records the actual actor and structured result before advancing the source workflow.
_Avoid_: creating independent competing copies of one source decision, keeping the item open after another permitted User resolves it, attributing the result to every notified User, granting workspace access merely because a manual duty was assigned, exposing unrelated case evidence through the task view, or requiring Human Resources to copy the result back manually

**Human Resources Authorization Layers**:
The permission controls for Human Resources work: workspace permission admits a User to the workspace at its granted level, and feature permission adds a named view or action capability. Human Resources uses no separately assigned processor, manager, business-authority, or named-responsibility roles; task-scoped duty access remains minimum-necessary and never grants general workspace access.
_Avoid_: requiring an HR role or responsibility assignment in addition to the permission controls, hiding action authorization in organizational titles, treating task assignment as workspace access, or expanding a duty into general case access

**Human Resources Full-Access Baseline**:
The explicit grant of complete Human Resources workspace access to each active User whose internal system role is ADMIN (shown as `مدیر`). An active ADMIN or MANAGER who independently has complete Human Resources workspace access qualifies for the Human Resources Broad-Manager Override without any separate HR role or responsibility assignment.
_Avoid_: treating every MANAGER (`مدیر فروش`) as full-access without the complete Human Resources workspace grant, requiring a duplicate HR authority assignment, or extending the override to a manager from another workspace

**Human Resources Broad-Manager Override**:
The exceptional ability of an active internal ADMIN or MANAGER with complete Human Resources workspace access to perform every Human Resources action, including preparing and approving the same work, without separate action grants. Override use automatically audits the real actor, internal role, self-approval state, and time without requiring a manually entered explanation.
_Avoid_: requiring an HR authority or responsibility assignment, blocking self-approval, granting the override from system role alone without complete Human Resources workspace access, omitting the override audit marker, or exposing Human Resources information to managers of unrelated workspaces

**Human Resources Feature Catalog**:
The stable Human Resources capability groups for Dashboard, Organizational Structure, Personnel, Recruitment Cases, HR Work Management, Permission Administration, Data Migration and Reconciliation, and User Administration, each granted at view, edit, or administration level. These permissions govern navigation and ordinary maintenance, while sensitive governed decisions use the Human Resources Action Permission Catalog and User Administration retains its separate system-role boundary.
_Avoid_: one unrestricted Human Resources permission for ordinary Users, a technical permission for every UI control, hiding governed actions behind assigned HR roles, or weakening User Administration rules because its interface appears inside Human Resources

**Human Resources Operational Reference Projection**:
The minimum read-only organizational reference needed to use one permitted Human Resources feature, limited to the safe labels, identifiers, and current availability required by that feature without admitting the User to Organizational Structure. Failure of this supporting projection does not erase an otherwise authorized Personnel or Recruitment Cases result.
_Avoid_: granting Organizational Structure implicitly, returning the complete HR foundation, exposing unrelated Users or lifecycle history, treating supporting-data failure as denial of the primary feature, or reproducing authorization precedence in the client

**Human Resources Action Permission Catalog**:
The stable feature permissions granted through `افزودن مجوز جدید` for individual Human Resources capabilities such as recording an interview, reading its report, recording preliminary approval, managing an evaluation plan, recording an evaluation result, verifying identity, recording compensation, or approving compensation. Selecting an action automatically selects and previews its minimum prerequisite read permissions; that explicit action permission authorizes its operation without a duplicate edit-level feature gate, the interface presents it only when the backend reports it currently effective, and these permissions replace HR Processor, HR Manager, Company Manager, payroll, finance, and named-responsibility grants as authorization concepts.
_Avoid_: assigning organizational titles as permissions, requiring a second authority record, requiring an edit-level base feature in addition to an explicit action, granting an action without the evidence access needed to use it, hiding automatically included prerequisites, showing an operation that the backend will deny, bundling unrelated sensitive actions under one vague feature, deriving action permission from a person's job title, or reproducing permission precedence in the client

**Company Compensation Proposal**:
The initial itemized whole-Rial offer created through the company-compensation proposal action permission, verified once by a User with the payroll-management action permission, and finally accepted or rejected by the Applicant. It contains exactly one positive Base Salary row; each predefined optional category appears at most once with a positive amount, while multiple distinct uncatalogued benefits use separately titled Other rows. Proposal ownership remains with Company Management, payroll verification is one explicit shared decision completed by the first eligible verifier, and Finance does not separately approve the offer; every completed action records its actual actor. A verifier returns an incorrect package with a structured category and explanation instead of editing management-owned amounts or components, and management resubmission creates a new version while preserving the returned version and reason.
_Avoid_: a position-bound Hiring Manager role, deriving proposal or verification rights from a title, requiring separate payroll-preparation, payroll-manager-approval, and Finance-approval gates, granting offer verification to a Finance collateral actor, zero-valued or duplicate predefined rows, an untitled Other row, letting the verifier rewrite the proposal, overwriting a returned version, hiding the actual actor, or presenting an unverified offer to the Applicant

**Cross-Workspace Duty Envelope**:
The code-registered, versioned, minimum-necessary contract that carries common duty metadata, a safe source reference and summary, explicitly permitted fields or evidence, allowed action codes, and a structured response between any source-workspace action and its assigned destination-workspace task view. Its assignment-time snapshot remains auditable while every action revalidates current source state; an incompatible source change cancels the old duty and creates a linked replacement without granting search or general access to the source workspace.
_Avoid_: arbitrary payloads, a generic source-record link, unrestricted evidence access, client-defined actions, trusting a stale snapshot for completion, granting source-workspace access through a duty, or mutating an assigned envelope without version history

**Cross-Workspace Duty Lifecycle**:
The append-only progression of a Cross-Workspace Duty through Open, Completed, Waived, or Cancelled, with assignment and derived overdue state kept separate and every approval, rejection, return, or clarification represented as a structured business result rather than a task failure. Completion atomically records the validated result, audit event, and source-workflow transition; renewed work creates a linked successor that normally inherits the original deadline instead of rewriting the prior response.
_Avoid_: storing overdue as an independent lifecycle, treating a valid rejection as a technical failure, reopening or editing completed evidence, resetting a deadline silently during reassignment, or advancing the source when task completion was not committed

**Cross-Workspace Duty Accountability Model**:
The explicit registered classification of every duty type as either a Shared Decision or Individual Execution, paired with an explicit prohibition when that duty must not permit Workspace Administration Duty Override. Presentation, eligibility, concurrency, history, assignment, and response authorization all consume this same classification rather than inferring it from labels or action names.
_Avoid_: frontend-only classification, guessing from an approve or verify label, treating physical custody as a shared decision, enabling a protected override because one surface omitted its prohibition, or letting queue presentation and backend authority disagree

**Cross-Workspace Duty Queue**:
The destination-workspace collection shared by every active User with the duty type's required action permission. A Shared Cross-Workspace Decision Duty appears in each eligible User's My Duties until the first valid decision completes it for everyone; a duty requiring individual accountability instead remains Available until claimed or deliberately assigned, and an authorized destination manager may explicitly reassign an assigned duty. The source actor chooses the required action and workspace, never a named recipient or organizational title.
_Avoid_: source-selected recipients, title-derived authority, duplicating one shared duty per eligible User, allowing a second result after the first committed decision, presenting individually accountable work as jointly owned, silently taking another User's assigned duty, or making personnel absence block the workflow

**Shared Cross-Workspace Decision Duty**:
One unassigned approval, rejection, or verification record projected into My Duties for every currently active User with effective edit-capable access to its required feature; its source actor is included only when they also qualify for the Workspace Administration Duty Override or are a global ADMIN. The first valid result atomically records its actual actor, advances the source, and closes the duty for every other viewer without creating per-User copies or requiring a separate claim; a competing actor sees a business completion message and the result moves to bounded History for every currently authorized participant, while permission loss removes future access. Physical, editing, recording, investigation, and other execution duties remain individually assigned or claimable.
_Avoid_: duplicating the decision, assigning it simultaneously to multiple Users, sharing an execution or custody duty, admitting an ordinary source actor, requiring receipt before a shared decision, attributing the result to every eligible viewer, accepting competing results, surfacing a losing race as a technical failure, preserving History access after permission loss, or leaving stale actionable copies after completion

**Workspace Administration Duty Override**:
The workspace-scoped ability of an active User whose centralized effective access currently includes both administration-level authority in a duty's destination workspace and edit-capable authority for that duty's required feature to allocate, take over, or decide the duty even when they created its source request. The eligible User performs their own action immediately without a separate override dialog or explanation, while taking an individually assigned duty from another assignee is an explicit confirmed reassignment with its normal business reason; both self-decision and takeover remain distinctly and immutably audited. The override is available by default unless the duty type explicitly prohibits it, and it never crosses workspace boundaries, survives permission expiry, revocation, or narrowing, removes the business reason normally required by the chosen result, or bypasses an explicit two-person or data-integrity control.
_Avoid_: treating a global MANAGER role as workspace authority, checking only direct grants instead of effective access, granting the override from workspace administration alone without the required edit-capable feature permission, granting system-wide ADMIN access, silently taking another User's assigned duty, suppressing self-decision or takeover evidence, presenting a separate override confirmation or explanation, removing a rejection, return, or reassignment reason, enabling an explicitly prohibited override, preserving authority after access ends, or weakening a two-person or data-integrity invariant

**Cross-Workspace Duty Attention Count**:
The positive count displayed for each duty-queue view when that view contains work requiring attention. My Duties counts the User's current individually assigned work plus Shared Cross-Workspace Decision Duties they may act on; Available and Unassigned show their complete current record counts regardless of acknowledgment, while History counts only closed duties the User has not yet seen. Opening Available or History advances only that User's corresponding workspace-scoped receipt through the newest visible record without changing any duty, result, assignment, or audit evidence.
_Avoid_: displaying a zero badge, hiding acknowledged but still available work from its tab count, using the entire permanent History size as an alert, treating a view as a duty status, acknowledging records the User could not see, or changing duty evidence when recording that a queue was seen

**Sales Contract Correction Request**:
The Accounting-originated, contract-scoped request for a controlled correction of a locked sales Contract. A User with the explicit Accounting creation permission opens it, a User with the Accounting decision permission approves or rejects it, and approval assigns one Sales correction opportunity to the Responsible Seller; a qualifying Accounting workspace administrator or global ADMIN may decide their own request through the distinctly audited Workspace Administration Duty Override without a separate override explanation, while every stage remains independently permissioned.
_Avoid_: relying on a verbal handoff, requiring the Responsible Seller to originate an Accounting finding, letting ordinary Accounting viewers create requests, deriving decision authority from a global MANAGER role, granting self-decision without both workspace administration and the decision permission, collapsing creation and manager decision into one event, removing the business reason required for rejection, bypassing the controlled correction chain, or losing rejected, approved, and self-decided request evidence

**Active Sales Contract Correction Chain**:
The single unresolved sequence of correction request, Accounting decisions, Sales opportunities, and Accounting verifications permitted for one Contract. A newly discovered issue may join the request before its manager decision; after an opportunity or verification begins, it waits as a linked successor until the active chain closes rather than creating parallel editable truth.
_Avoid_: parallel active correction requests for one Contract, concurrent edit opportunities, merging a late issue into an already approved scope, discarding a queued successor, or allowing two Contract versions to compete

**Sales Contract Correction Opportunity**:
The Accounting-manager-approved, three-working-day assignment allowing the Responsible Seller exactly one successful save through the full-step Contract editor, with the approved category and reason visible and the complete before/after difference recorded; an authorized Sales manager may reassign it only to another edit-authorized Seller, while ADMIN may perform the edit through an audited Admin Override. Expiry relocks the Contract without erasing history, while a successful save immediately relocks it and creates an Accounting Correction Verification; an extension requires a new Accounting request and manager decision, and locked financial evidence remains unchanged.
_Avoid_: opening correction to every Seller, requiring the Seller to originate the Accounting finding, reassigning to a User without Sales edit authority, editing through an untracked administrator bypass, field-locking a coupled Contract graph, permitting multiple correction saves, leaving the Contract editable after save, silently extending an expired opportunity, editing an approved financial record in place, or losing expired and completed opportunity evidence

**Accounting Correction Verification**:
The required Shared Cross-Workspace Decision Duty for Accounting review of the complete before/after difference after a Seller or authorized administrator uses a Sales Contract Correction Opportunity. The first eligible verifier accepts the corrected Contract or returns it for a new Accounting manager decision and distinct three-working-day opportunity; a qualifying Accounting workspace administrator or global ADMIN may verify a correction chain they initiated through the distinctly audited Workspace Administration Duty Override.
_Avoid_: completing the request automatically on Sales save, assigning verification permanently to one preferred User, reviewing without the recorded difference, treating a competing decision as a technical failure, reopening Sales from return alone, silently reusing a prior opportunity, omitting self-verification evidence, or leaving the Contract unlocked during Accounting review

**Accounting-Ready Sales Contract**:
An active Sales Contract that has reached Approved, Signed, or Printed status and therefore requires accountable Accounting processing. Reaching this eligibility creates the Accounting duty exactly once for the current eligible version; Draft creation and visibility alone create no duty, and later ineligibility cancels stale open work rather than leaving it actionable.
_Avoid_: creating an Accounting duty for every Draft, using the contract-created notification as duty truth, duplicating the duty for repeated reads, processing an inactive Contract, or retaining an actionable duty after eligibility is lost

**Accounting Contract Registration Duties**:
The two sequential one-working-day duties created from an Accounting-Ready Sales Contract: an invoice-candidate preparation duty for Users with candidate-management permission, followed only after successful preparation by a financial-approval duty for Users with record approval/void permission. One User may perform both when independently granted both permissions, but each action remains an explicit, separately timed and audited result rather than automatic approval; a return ends the prior version's deadline and a corrected version starts a fresh preparation deadline, while priority changes require a reason and audit history.
_Avoid_: one ambiguous duty spanning preparation and approval, creating approval before a candidate exists, requiring different actors without a workflow-specific rule, inferring approval authority from preparation permission, automatically approving after preparation, silently carrying a stale deadline across versions, or changing priority without evidence

**Pre-Financial Accounting Return**:
The Accounting processor's structured return of an Accounting-Ready Sales Contract to its Responsible Seller with a required category and reason before locked financial evidence exists. It needs no Accounting manager approval, creates no financial-approval duty, and a successful Seller correction creates a new version-scoped preparation duty; manager approval remains mandatory only for reopening a Contract after financial evidence is locked.
_Avoid_: treating pre-financial return as a manager-approved locked correction, returning without a reason, assigning every Seller, approving an unrevised version, or creating parallel preparation duties

**Cross-Workspace Duty Notification Policy**:
The mandatory, privacy-safe Unified Notification Center record for assignment, near-due reminder, overdue state, unassigned triage, reassignment, and structured result, with one escalation to the destination manager after twenty-four overdue hours and optional safe Web Push delivery. Event identity combines duty, event kind, and envelope or response-attempt version so delivery retries never duplicate the durable notification.
_Avoid_: sensitive lock-screen content, treating Web Push as the source of truth, allowing accountability notifications to be muted, daily default escalation spam, notifying every authority holder, or duplicating one lifecycle event during delivery retries

**Destination Workspace Duty Surface**:
The Persian-first unified `وظایف بین‌واحدی` list and detail experience that projects duties from every registered source only into their operational destination workspace, with My Duties containing both personal assignments and Shared Cross-Workspace Decision Duties, plus Available execution work, authorized manager triage, source and action filters, and preserved history separate from notifications and support work. Each row identifies its source workspace, required action, deadline, state, and applicable accountability model; a direct link reauthorizes current eligibility, feature permission, envelope version, and source state, while managers see only bounded destination-scope information rather than the complete source record.
_Avoid_: an HR-specific page title, separate pages per source workspace, duplicating one duty across every workspace or eligible User, redirecting a destination actor into the source workspace, presenting a shared decision as a personal assignment, combining task and notification lifecycles, exposing the complete source record to a destination manager, or relying on a stale deep link for authorization

**Cross-Workspace Duty Attention Badge**:
The red numeric marker on the current workspace's Cross-Workspace Duty navigation control, visible beside the expanded label and on the collapsed icon, equal to the signed-in User's current My Duties count plus Available duties added or materially changed after that User last opened Available in that workspace, and displaying `99+` above ninety-nine. Opening Available acknowledges only the currently visible available records through their newest visible change; new or later-changed work raises the badge again, while the full Available tab count remains unchanged and the receipt persists across the User's devices.
_Avoid_: unread-notification count, clearing available attention by opening My Duties or the general page, hiding acknowledged available work from its tab, counting another workspace or User, counting unassigned manager triage separately, acknowledging invisible records, separate expanded and collapsed counts, or displaying an unbounded large number

**Operational Queue Exclusion**:
The rule that ordinary Guard admission, driver availability, Logistics reservation, loading finalization, driver confirmation, authorization readiness, and Guard physical exit remain states of their authoritative operational queues rather than Cross-Workspace Duties or badge counts. Only an exception that waits for a structured action from another workspace, such as Manual Outage Exit approval or returned-goods Accounting reconciliation, creates a duty.
_Avoid_: duplicating queue rows as duties, counting routine physical operations in the duty badge, assigning normal exit to a person through the duty engine, or hiding a genuine cross-workspace exception inside queue state

**Cross-Workspace Duty Creation Boundary**:
The rule that a duty exists only when a source transition leaves a concrete, structured action waiting for an authorized actor in another operational destination. Shared data, read-only visibility, notifications, reports, automatic state propagation, and work completed atomically by the initiating actor create no redundant duty. Inventory-to-Sales catalog visibility is data unless a specific correction is requested; BI remains read-only and refers discrepancies to the authoritative source; Support and System Recovery retain their own lifecycles and queues rather than becoming Cross-Workspace Duties.
_Avoid_: converting every event or notification into a task, creating a duty after the required action already completed in the initiating transaction, letting BI mutate source workflows, duplicating Inventory data as Sales work, or absorbing Support and Recovery queues into the duty engine

**Organizational Responsibility Destination**:
The explicit operational workspace configured for a task source or manually assigned duty and used as the sole destination for its task-scoped presentation. Human Resources actions and the Company Compensation Proposal target Human Resources, Finance actions target Accounting, and position-bound supervisor duties use their recorded organizational assignment; a missing or unauthorized destination blocks routing rather than being inferred from names or broad roles.
_Avoid_: requiring a named HR responsibility assignment to route a permission-scoped action, guessing a workspace from a username or job title, granting ordinary destination-workspace access through a duty, or duplicating a duty into multiple workspaces

**System Administration Duty Destination**:
The first-class, permission-scoped operational destination for Cross-Workspace Duties that require User provisioning, access activation, access revocation, or another governed system-administration action. It need not be exposed as a complete commercial workspace: only Users with the required administration permission see its queue and task-scoped evidence. Hiring and Offboarding route their distinct owner approvals and administrative fulfillment here without automatically creating access from employment state or delaying the truthful employment end until every administrative obligation completes.
_Avoid_: treating Administration as an unrouteable side channel, exposing its queue to ordinary Users, creating default access from a Position, combining workspace-owner approval with fulfillment implicitly, deleting a User during Offboarding, or keeping Employment active because access revocation is overdue

**Personal HR Work Progress**:
The signed-in user's completion rate for assigned HR Work Items, calculated as items completed during the current Persian month divided by those completed during that month plus every currently open assigned item, including older overdue work. Waived or cancelled items do not count as completed, and an empty workload has no percentage.
_Avoid_: reporting organization-wide findings as personal progress, dropping overdue work at a month boundary, showing an empty workload as one hundred percent complete, or mixing Position Capacity Coverage into this measure

**Product Search**:
A product lookup in the price inquiry surface that matches product identity and price-facing product details, regardless of Persian or Arabic character variants.
_Avoid_: treating search as only an exact prefix lookup

**Canonical OPC Product Name**:
The saved catalog product name generated from the product's coded stone attributes in the order cut type, stone material, width label, thickness label, mine, and finish; when attributes are missing, the name is generated from the available attributes without placeholder text.
_Avoid_: saving a manually shortened family label such as only cut type plus stone material when the full coded attributes are available

**Incomplete Product Attribute Set**:
A product catalog row missing one or more attributes normally used to form the Canonical OPC Product Name, while still being allowed as a deliberate catalog exception after the missing attributes are made visible.
_Avoid_: silently accepting incomplete product identity, or blocking every partial product row as invalid

**Catalog Code**:
A text business identifier whose characters and leading zeros are meaningful for product catalog identity and coded product attributes.
_Avoid_: treating catalog codes as numbers, trimming leading zeros, or comparing only their numeric value

**Canonical OPC Product Code**:
The product catalog code generated from the product's coded attributes when the required component codes are available; if required component codes are missing, the current product code remains the best available identity for that partial row.
_Avoid_: leaving a stale generated product code after the coded attributes change

**Product Code Conflict**:
An Excel import row where the uploaded product code and the generated Canonical OPC Product Code identify two different existing products; the row cannot be applied until the conflict is corrected.
_Avoid_: silently merging product identities, overwriting the uploaded-code product, or overwriting the generated-code product

**خروجی/ورودی اکسل کاتالوگ**:
A catalog maintenance workflow where each catalog exports, imports, and updates its own records through an Excel file shaped for that catalog's business fields.
_Avoid_: mixing unrelated product, service, tool, stair, layer, and finishing catalogs into one shared Excel file

**قالب اکسل اختصاصی کاتالوگ**:
An Excel format dedicated to one catalog type and based on the fields that catalog already uses in Sabalan ERP.
_Avoid_: reusing an OPC product or service-code workbook for unrelated inventory service catalogs

**کد پایدار کاتالوگ**:
A business identifier used by catalog Excel sync to recognize the same catalog record across imports, even when display names or descriptions change.
_Avoid_: using editable display names as identity when a catalog can be renamed

**ستون‌های مالک اکسل**:
The catalog fields that a specific Excel template is allowed to create or update during import; fields outside that template remain owned by the application or manual editing.
_Avoid_: treating every import as a full replacement of the catalog record

**همگام‌سازی کامل کاتالوگ با اکسل**:
A catalog import mode where the Excel file is the current source of truth for that catalog: rows in the file are created or updated, and existing catalog records missing from the file are removed from active use.
_Avoid_: assuming a full catalog sync is only an additive import

**پیش‌نمایش حذف کاتالوگ**:
A required confirmation step before a full Excel catalog sync removes missing records, showing users which records will be deleted or deactivated before changes are applied.
_Avoid_: silently removing catalog records during import

**خوراک اره**:
A per-contract-product material-consumption adjustment for physical cuttable stone. The seller manually turns it on or off for each row; the system never activates it merely because a cut is detected. When enabled, the saved row carries `sawKerfEnabled: true` and `sawKerfCm: 0.3`; each actually cut axis consumes the finished requested dimension plus 3mm for source-material charge, smart packing, and remaining-stone geometry. Stair layers cut from the parent row's stone inherit that row's active saw kerf for packing, so a 35cm source fits seven finished 5cm strips without kerf but only six with 0.3cm kerf. Finished dimensions, delivery, standalone services, tools, and finishing calculations stay based on the customer-requested size.
For example, `3 × 20cm` pieces fit exactly across one `60cm` source band without kerf, but with `0.3cm` kerf they require two source bands and preserve the resulting positive width remainders—approximately `19.4cm` and `39.7cm`. The customer-requested area and finished dimensions remain unchanged, while automatic calibration stays off because those width remainders exist.
_Avoid_: activating or disabling kerf automatically from detected geometry, applying kerf to service rows, applying it to a full-width/full-length axis with no cut, or changing printed finished dimensions.

**برش کالیبر**:
A cutting-charge modifier for طولی and stair product rows that adds one paid side-edge longitudinal cut for each consumed source band while leaving material area, delivery dimensions, and remaining-stone geometry unchanged. It is included inside the normal برش total and printed cutting details rather than shown as a separate add-on. A newly configured row begins off before sufficient packing inputs exist, may receive the approved geometry-based default until the seller first changes it, and always remains explicitly switchable; an existing or restored row preserves its saved choice, and a legacy missing choice retains the historical enabled meaning until an authorized edit and save.
For a newly configured longitudinal row, calibration begins off and becomes the automatic default only after the real packing plan contains a longitudinal cut and consumes the full source width without producing a usable width remainder. The decision uses actual requested quantity and active saw kerf rather than simple width divisibility: `40cm → 2 × 20cm` without kerf defaults on, while one `20cm` piece, three `12cm` pieces, or `2 × 20cm` with `0.3cm` kerf default off. A full-width request has no longitudinal cut, so calibration remains off and disabled. Width, quantity, or saw-kerf changes may recompute this default only until the seller first changes the calibration switch; after that, the seller's explicit choice wins. Editing an existing row always preserves its saved choice and never reruns default detection.
For example, `60cm → 3 × 20cm` without saw kerf consumes one source band with no remainder, derives the requested area from the seller's entered length and quantity, charges `2 × length` as ordinary separating cuts, and charges only `1 × length` as the single calibration side cut for that consumed source band. With `0.3cm` saw kerf the same request consumes two source bands and automatic calibration stays off; if the seller manually enables it, calibration is `2 × length`, one side cut for each consumed source band, regardless of the ordinary separator meterage. Both cut amounts use the same snapshotted longitudinal inventory rate.
_Avoid_: treating برش کالیبر as extra consumed material, a separate service row, or a separate printed line item; enabling it from nominal divisibility instead of actual packing, enabling it for a full-width request, overwriting the seller's explicit switch choice, recomputing the default while editing a saved row, or interpreting a missing legacy value as a silent price reduction

**برش قائم اسلب**:
A paid edge-preparation cut applied to selected sides of each standard/source slab before the slab is cut to the customer's requested finished dimensions.
_Avoid_: charging برش قائم from the finished requested piece dimensions, or applying it to unselected slab sides.

**جزئیات برش اسلب**:
The per-source-slab cutting detail rows for a slab contract product, separated by standard/source dimensions and cut type so accounting and workshop output can see which source slab produced each cutting charge.
_Avoid_: summarizing slab cutting details so early that different source slab sizes or cut types become indistinguishable.

## Language

**پایپ‌لاین فعال BI**:
The point-in-time exposure of every currently PENDING_APPROVAL or APPROVED Sales Contract in the manager's authorized scope, regardless of when the contract was created. Period-created pipeline remains a separate trend measure.
_Avoid_: dropping older open contracts at a period boundary, or presenting period-created pipeline as the current active exposure

**پیشنهاد هوش تجاری**:
A deterministic, read-only signal derived live from an authoritative business condition, prioritized as breached obligation, imminent risk, material comparable-period deterioration, or reconciliation issue. It links to evidence or the owning workspace and disappears when the source condition is resolved; it is not a persisted task.
_Avoid_: adding completion, assignment, or manual-resolution controls in BI; persisting stale recommendations; implying target performance without an authoritative target model; or using an unexplained composite score

**سلامت منبع هوش تجاری**:
The independently reported freshness, availability, authorization, and coverage of Sales, CRM, Accounting, Logistics, or Guard evidence in a BI snapshot. Sales remains a usable core when another layer is unavailable, and missing evidence is shown as unavailable, not linked, out of date, or unauthorized—never as zero or confirmed failure.
_Avoid_: failing the full BI snapshot because one evidence layer fails, turning missing data into zero, or issuing cross-workspace conclusions without sufficient evidence

**تطبیق هوش تجاری**:
The read-only evidence view for missing links or contradictory states between authoritative workspaces, such as a delivery promise without a Logistics record, a finalized loading without a Guard exit, or a won CRM project without its linked Sales Contract. BI may deep-link or refer the discrepancy to its authoritative source but never creates, owns, completes, or mutates Cross-Workspace Duties.
_Avoid_: treating an unavailable source as a mismatch, blaming a seller for Accounting or delivery ownership without an explicit Sales responsibility, inventing a BI-side correction workflow, or turning a BI finding into a second source of duty truth

**فروش همکاری**:
A sales contract kind for selling products or services to a collaborative individual or group, reusing contract pricing and payment behavior while not requiring a normal project/address selection.
_Avoid_: treating it as a normal customer contract with an empty project

**ورود فروش همکاری**:
A dedicated contract-creation entry path that opens the shared sales contract wizard in collaboration mode. The mode is chosen before the wizard starts rather than switched inside a normal contract draft.
_Avoid_: adding a normal-vs-collaboration choice as a required step in every contract

**مشتری همکاری**:
A CRM customer whose relationship to a sales contract is collaborative rather than a normal project customer. A مشتری همکاری can be selected for فروش همکاری without requiring project-address selection.
_Avoid_: creating a separate non-CRM buyer record for collaborators

**فضای کاری CRM**:
The workspace for both customer registry management and pre-contract sales pipeline management, covering customer profiles, project addresses, contacts, ownership, leads, opportunities, follow-up tasks, and handoff into sales contracts.
_Avoid_: limiting CRM to customer CRUD only, or moving pre-contract sales pipeline work into the sales contract workspace.

**مخاطب در حال پیگیری**:
A person or organization recorded in CRM because Sabalan sellers are pursuing possible work with them, even when they have not made a final purchase or signed a sales contract.
_Avoid_: treating every CRM person as a finalized buyer, or requiring a sales contract before seller follow-up can be recorded.

**هشدار تکراری CRM**:
When a seller tries to create a CRM person/customer that matches an existing record, the system warns them and shows a limited summary such as name, matched phone, active potential-project count, and responsible seller or managed-by-CRM-team indicator. Creating a duplicate despite the match requires CRM manager or admin approval.
_Avoid_: silently creating duplicate CRM people, or exposing detailed follow-up history during duplicate checking.

**افزودن پروژه احتمالی به مخاطب موجود**:
When a seller finds an existing CRM person/customer but has a genuinely new potential project for them, the seller should add or request a new potential project under the existing CRM record instead of creating a duplicate person. If permitted, the seller can create the project directly and become responsible for it; otherwise they submit a CRM manager/admin request to attach it.
_Avoid_: duplicating the person/customer record just because a new seller or new project appears.

**پروژه احتمالی**:
A potential customer project being pursued by sellers before it becomes a priced sales contract. It belongs in CRM while the work is still being discovered, followed up, or negotiated.
_Avoid_: creating a sales contract just to track an unconfirmed project, or losing the project context inside generic customer notes.

**فیلدهای پروژه احتمالی**:
A potential project requires project title, CRM person/customer, responsible seller, project status, and work/deal type. Address or location, including city, estimated value, probability, expected close date, description, source or referrer, and next follow-up are optional at creation; an unknown city remains unspecified.
_Avoid_: blocking early project capture with forecasting or location details that the seller may not know yet, or inferring a city such as Tehran when none was provided.

**برآورد پروژه احتمالی**:
Optional CRM forecasting fields on a potential project, such as estimated value, probability, and expected close date or month. They help managers forecast pipeline value but should not block sellers when early project details are unknown.
_Avoid_: requiring estimated value or probability before a seller can start tracking a real potential project.

**وضعیت پروژه احتمالی**:
The Persian-first lifecycle status of a potential project in CRM before or during conversion to sales work: جدید, در حال پیگیری, نیازمند پیشنهاد, آماده قرارداد, برنده شده, از دست رفته, and راکد.
_Avoid_: exposing English status labels to operators, or treating every paused project as permanently lost.

**قوانین پایان پروژه احتمالی**:
A potential project becomes برنده شده only when a Sales Contract is created from it or explicitly linked as the winning contract. It becomes از دست رفته when a seller or CRM manager marks it lost with a required reason. It becomes راکد when there is no active follow-up for now but the project is not truly lost; راکد requires a reason and may include a revisit date. برنده شده and از دست رفته do not require a next action; راکد makes next action optional while a revisit date is recommended.
_Avoid_: marking projects as won without a linked sales contract, marking projects lost without a reason, or treating راکد as the same as از دست رفته.

**تبدیل پروژه احتمالی به قرارداد فروش**:
When a potential project reaches آماده قرارداد, the responsible seller may create a draft Sales Contract from it. If another actor records readiness and conversion remains outstanding, one structured Sales duty is created for the responsible seller; if that seller converts the project atomically in the same action, no redundant duty is created. Approval remains in the existing Sales and Accounting contract workflow rather than adding a separate CRM approval gate.
_Avoid_: requiring CRM-manager approval just to start a draft contract, creating a duty after conversion already completed, duplicating one conversion duty, or bypassing the normal Sales and Accounting approval controls after the draft exists.

**فروشنده مسئول پروژه احتمالی**:
The seller responsible for following up one specific potential project. The same CRM contact can have multiple potential projects with different responsible sellers, and one seller can follow multiple projects for the same contact.
_Avoid_: assuming customer ownership and project ownership are always the same, or forcing all of a contact's potential projects to belong to one seller.

**تغییر مسئول پروژه احتمالی**:
CRM managers and admins can reassign a potential project to another seller with a required reason. The current responsible seller can request or suggest reassignment but cannot silently transfer ownership without manager-level permission.
_Avoid_: quiet seller-to-seller handoffs without accountability, or blocking legitimate manager-driven reassignment when workloads or relationships change.

**تاریخچه پروژه احتمالی پس از تغییر مسئول**:
Potential-project follow-up history stays attached to the project after reassignment. The new responsible seller can see prior project-level reports for context, each report keeps its author and timestamp, and the reassignment reason appears in the project timeline.
_Avoid_: hiding prior project context from the new seller, rewriting authorship, or treating reassignment as an invisible metadata change.

**گزارش پیگیری CRM**:
A dated record of a seller's follow-up activity for a CRM contact, customer, or possible project, such as a call, office visit, message, meeting, or other communication attempt and its outcome.
_Avoid_: storing follow-up history only as free-text customer fields, or mixing pre-contract follow-up reports with approved sales contract events.

**فیلدهای گزارش پیگیری CRM**:
A CRM follow-up report requires the related customer/person, seller/reporter, communication type, work/deal type, follow-up date/time, summary of what happened, and outcome. A related potential project is optional when the follow-up is a general customer-level follow-up rather than project-specific.
_Avoid_: recording follow-up reports without a clear event summary, outcome, author, date/time, communication type, or business context.

**نوع ارتباط پیگیری CRM**:
The Persian-first communication type recorded on a CRM follow-up report or next action. V1 types are تماس تلفنی, پیامک / پیام‌رسان, مراجعه حضوری به دفتر سبلان, بازدید از پروژه, جلسه حضوری, ارسال پیش‌فاکتور / پیشنهاد, پیگیری مالی, and سایر.
_Avoid_: using only free-text communication types, or exposing English activity labels to operators.

**نوع کار/معامله پیگیری CRM**:
The Persian-first business opportunity type recorded separately from communication type on a CRM follow-up report or next action. V1 types are فروش سنگ پروژه ساختمانی, فروش همکاری, خدمات / ابزار / فرآوری, بارگیری یا تحویل مرتبط با فروش قبلی, استعلام قیمت, and سایر.
_Avoid_: mixing how the seller contacted the person with what business opportunity is being pursued.

**اقدام بعدی پیگیری CRM**:
The next required action created from a CRM follow-up report, including a due date, communication type, intended deal/work type, and clear Persian instructions for what the seller should do next. A follow-up report should normally have a next action unless there is no next follow-up or the tracked customer/project work is finished.
_Avoid_: recording follow-up history without an actionable next step when the pursuit is still active, or leaving the next step as vague free text without date and action type.

**فیلدهای اقدام بعدی پیگیری CRM**:
When a CRM follow-up report needs a next action, the next action requires title or action type, due date, next communication type, and clear Persian instructions.
_Avoid_: creating vague reminders that only say follow up without explaining what the seller should do next.

**نمای پیگیری‌های سررسیدشده CRM**:
Sellers see their own overdue and upcoming CRM next actions, while CRM managers and admins see team-level overdue and upcoming follow-ups for oversight.
_Avoid_: relying only on individual seller memory for follow-up discipline, or exposing team-level task oversight to sellers without management responsibility.

**یادآوری پیگیری CRM در نسخه اول**:
V1 CRM reminders appear on the CRM dashboard and as in-app notification badges or counts. Due and overdue items are calculated automatically from the next-action due date/time, and the manager dashboard highlights overdue follow-ups by seller. V1 does not send SMS, email, WhatsApp, or repeated noisy alerts.
_Avoid_: launching external-message reminders before the in-app follow-up discipline is stable.

**داشبورد فروشنده CRM**:
The seller CRM dashboard shows today's follow-ups, overdue follow-ups, upcoming follow-ups, the seller's active potential projects by status, recently updated customers or projects, and quick actions to add a follow-up, add a potential project, or create a customer.
_Avoid_: making sellers search through manager-level analytics before seeing their own next work.

**داشبورد مدیر CRM**:
The CRM manager/admin dashboard shows team overdue follow-ups, follow-ups due today, active projects by seller and status, dormant projects, won/lost counts, estimated pipeline value, recent reassignment/activity timeline, and quick filters by seller, status, and work/deal type.
_Avoid_: giving managers only individual task lists without team-level pipeline and follow-up oversight.

**دسترسی گزارش پیگیری CRM**:
Project-level CRM follow-up reports are visible by default to the responsible seller, CRM manager, and admins. Other sellers can see enough customer and potential-project summary to avoid duplicate pursuit, but not detailed follow-up reports unless assigned to that project or explicitly granted access.
_Avoid_: making all seller follow-up details globally visible, or hiding potential project existence so completely that sellers unknowingly pursue the same work twice.

**راهنمای بخش CRM**:
A Persian user-facing guide attached to each CRM section so operators can open it from that section and understand the purpose, fields, workflow, permissions, and expected usage of the section.
_Avoid_: relying only on training outside the application, or placing one generic CRM manual that does not explain each section in its own context.

**راهنمای متمرکز CRM**:
A contextual CRM guide mode where the rest of the page is visually de-emphasized while the relevant field, table, action, or section stays clear and the Persian explanation appears beside or near it.
_Avoid_: showing detached help text that is not visually connected to the part of the page being explained.

**محتوای راهنمای CRM**:
CRM guide text is static product content shipped with the codebase for V1, so each UI change can update the matching Persian guide in the same code change.
_Avoid_: making guide content admin-editable before the guided UI patterns and section workflows are stable.

**ساختار راهنمای CRM**:
Each CRM guide section should explain what the section is for, who should use it, required fields, optional fields, what happens after saving, who can see or edit it, common mistakes, and mobile usage notes when relevant.
_Avoid_: inconsistent guide content where some sections explain workflow and others only define fields.

**طراحی CRM موبایل‌پسند**:
All CRM section implementations must work on mobile and follow Sabalan ERP's existing design system, shared components, RTL layout behavior, and Persian-first visual language.
_Avoid_: building desktop-only CRM tables, introducing a separate visual style, or bypassing existing ERP components without a concrete reason.

**خارج از محدوده CRM نسخه اول**:
CRM V1 excludes external reminders such as SMS, email, or WhatsApp; admin-editable guide content; AI lead scoring; marketing campaigns; complex sales forecasting; commission management; a separate mobile app; and Excel import for CRM data.
_Avoid_: expanding CRM V1 beyond customer/person records, potential projects, follow-up reports, next actions, dashboards, permissions, guided help, and Sales Contract conversion.

**معرف مشتری**:
A person who referred or introduced a CRM customer. The referrer belongs to the customer profile, not to one specific project address or contract.
_Avoid_: storing the same referrer separately on every project address

**بازاریاب پروژه**:
The marketer associated with a specific project address for a customer. Different project addresses for the same customer may have different marketers.
_Avoid_: treating the project marketer as a customer-wide referrer or as the project manager

**ردیف خدمات قرارداد**:
A standalone price-bearing contract row for services such as ابزار, برش, پرداخت سنگ, or فرآوری when no stone product is being sold.
_Avoid_: representing a service-only sale as a hidden or fake product

**ردیف کیوبیک و قطعات آماده قرارداد**:
A price-bearing contract product row for cubic stone or ready-made stone pieces selected from the product catalog and sold by the row's chosen unit, such as متر مربع, تن, or تعداد. The row carries a subtype of کیوبیک or قطعات آماده while remaining one product-row family in contract selection, delivery, payment, and output.
_Avoid_: modeling کیوبیک and قطعات آماده as unrelated contract product families, or forcing them through طولی, پله, or اسلب configuration

**زیرنوع ردیف کیوبیک و قطعات آماده**:
The per-contract-row classification that says whether a prepared-product row is کیوبیک or قطعات آماده. It may be inferred from the catalog product's cutting-dimension label when selected, but the saved contract row remains explicit so old contracts do not depend on later catalog wording.
_Avoid_: relying only on a product name search term to decide how a saved contract row behaves

**قیمت واحد ردیف کیوبیک و قطعات آماده**:
The contract-row price for the selected unit of a کیوبیک و قطعات آماده row. The catalog product's base price may prefill it, but the saved contract row owns the selected unit, quantity, unit price, and total price snapshot.
_Avoid_: recalculating an old prepared-product row from later catalog prices, or assuming one catalog price always means متر مربع

**مقدار زمان‌بندی کیوبیک و قطعات آماده**:
The amount of a کیوبیک و قطعات آماده row assigned to delivery dates, using the same unit and total quantity selected on that contract row.
_Avoid_: scheduling a ton-based or count-based prepared-product row as متر مربع, or allowing scheduled amounts to exceed the selected row quantity

**مرز ردیف کیوبیک و قطعات آماده**:
کیوبیک و قطعات آماده rows are main catalog stone product rows for pricing, delivery, discount, and output, but they are not cutting-workflow rows.
_Avoid_: applying smart cutting, saw kerf, remaining-stone usage, stair grouping, slab cutting modes, tools, or stone finishing to prepared-product rows

**خروجی ردیف کیوبیک و قطعات آماده**:
کیوبیک و قطعات آماده rows appear in the main customer-facing product table with their product name, subtype, selected unit, quantity, unit price, total price, and row note when present.
_Avoid_: hiding prepared-product rows in a separate shadow section, or printing row images in PDF/print output

**تکثیر ردیف کیوبیک و قطعات آماده**:
Creating a new editable کیوبیک و قطعات آماده row from an existing row by copying its catalog product, subtype, selected unit, quantity, unit price, total price snapshot, note, and internal row images while giving it independent row identity.
_Avoid_: copying delivery assignments, internal row IDs, or links that make the duplicate depend on the original row

**منبع خدمات قرارداد**:
The catalog a standalone service row is selected from, such as ابزار, برش, or پرداخت سنگ. These catalogs remain separate for management and search, but once selected they become the same ردیف خدمات قرارداد shape for pricing, payment, and print output.
_Avoid_: merging the source catalogs just because contract rows share one shape

**تفکیک جمع محصولات و خدمات وابسته قرارداد**:
The customer-facing confirmation and print summary show the non-service product subtotal separately from billable cutting, tools, finishing, and standalone service rows, while the persisted product `totalPrice` remains the canonical all-in product amount. The final payable total counts every billable fact exactly once.
_Avoid_: omitting a priced operation from the final payable amount, adding a displayed dependent service on top of an already all-in product total, presenting non-billable حکمی cross-cutting as a customer charge, or silently rewriting a finalized historical contract

**شواهد اجزای قیمت برای تأیید مالی**:
The accounting projection carries the saved canonical base material, mandatory, cutting, calibration, tool, and finishing price components exactly once. Financial approval verifies those persisted components against the unchanged all-in product amount; it never re-runs product configuration or lets accounting repair the amount. A graphless historical contract may proceed only through the reviewed and audited legacy seal path that preserves its stored final amount.
_Avoid_: projecting only attached tools and finishing while dropping intrinsic cutting lines, changing a seller's saved price during financial approval, blocking a valid graphless legacy contract forever, allowing an accountant to edit a mismatch away, or accepting a genuine component-versus-total conflict

**توضیحات ردیف خدمات قرارداد**:
A per-contract note attached to a selected standalone service row, prefilled from the catalog description when available but editable without changing the catalog.
_Avoid_: editing the catalog service description when the user only means the current contract row

**توضیحات خروجی محصول قرارداد**:
A product-level description printed inside the product's own output group as the last row for that product, after related explanatory, mandatory, cutting, tool, service, and finishing rows.
_Avoid_: printing the product description before the product's related detail rows, or moving standalone service notes into a product group

**ابعاد خروجی محصول قرارداد**:
Every customer, accounting, workshop, delivery, and logistics output presents the contract row's customer-requested finished length and width with an explicit matching unit. A column labeled in meters receives meter values converted exactly once, regardless of the units used while entering the row. Source-material dimensions remain a separate consumption fact and follow the same value-and-unit coherence rule.
_Avoid_: pairing a meter value with a centimeter label, converting an already-meter value again, printing source width as finished width, allowing output variants to disagree, or deriving customer dimensions from an internal optimizer layout

**بازسازی خروجی تاریخی قرارداد**:
Correcting an output projection does not rewrite the persisted commercial facts of an existing contract. When a cached output was generated with an incorrect projection, its template version is invalidated and the output is regenerated from the same canonical contract-product graph on the next request.
_Avoid_: mutating historical contract rows merely to repair presentation, continuing to serve a known-invalid cached PDF, or rebuilding from stale legacy fields when the canonical graph exists

**جستجوی عددی محصول**:
A product catalog search that treats Persian, Arabic, and Latin digits as the same value when matching numeric product details such as عرض, ضخامت, کد, and قیمت.
_Avoid_: making users switch keyboard language to find numeric product values

**سنگ مصرفی**:
The customer-facing material-charge presentation row for the full base stone consumed to create a sold cut product, including a quantity-zero longitudinal product. It shows actual source width, consumed source length, source quantity, consumed area, material unit rate, and base material total, but is not a second charged product row or a workshop cutting instruction; internal production-piece and remainder breakdowns stay outside customer PDF/print.
_Avoid_: adding سنگ مصرفی to contract totals, delivery quantities, or inventory as a separate sale row, or treating its displayed material price as an additional charge

**نمایش قیمت سنگ مصرفی در خروجی قرارداد**:
When a detailed customer, accounting, or custom output visibly includes a cut product's سنگ مصرفی row, its material unit rate and base material total are shown on that row and the corresponding price cells on the customer-requested product row stay blank. Cutting, tools, finishing, and other services keep their own priced rows; summarized outputs, custom outputs that hide explanatory rows, and products without a visible سنگ مصرفی row keep prices on their normal product row, while workshop output remains price-free. Regenerated historical output follows the current presentation rule without changing persisted calculations or the invoice total.
For a stair layer with multiple source rows, only the physical newly charged `سنگ جدید مصرفی لایه` row shows the material unit rate and base material total. Previously paid material and intermediate allocation rows remain unpriced so the same charge is never presented twice.
Newly generated digital-confirmation documents use the same placement for consistency. Stored or signed historical confirmation content remains immutable evidence, while historical PDFs may adopt the current placement when regenerated.
When a product is made entirely from already-paid remaining stone, its physical سنگ مصرفی row explicitly shows a zero material unit rate and zero material total with the existing meaning that the stone was calculated in its source product; the customer-requested row remains unpriced. This visible zero is an authoritative zero charge, not a missing price.
_Avoid_: showing the same material charge on both rows, pricing previously paid material again, hiding an authoritative zero as a blank value, putting the charge on an intermediate allocation row, moving dependent-operation prices onto سنگ مصرفی, hiding a material charge when its presentation row is suppressed, rewriting historical confirmation evidence, changing persisted financial facts for presentation, or making visible مبلغ کل values fail to reconcile with جمع کل فاکتور

**قیمت صفر در خروجی قرارداد**:
A zero price is printed as ۰ تومان only for a real price-bearing contract row that participates in invoice calculation with a zero amount.
_Avoid_: using a blank price for zero-charged invoice work, or using ۰ تومان for non-price explanatory rows

**واحد پول در جدول اصلی محصولات**:
Normal price cells in نرخ - تومان and مبلغ کل - تومان show numeric تومان values without repeating تومان in every row. The ریال equivalent is shown only on the final جمع کل فاکتور row, as secondary text beside or under the تومان total.
_Avoid_: repeating تومان inside every normal price cell, showing ریال equivalents on every product/payment row, or hiding ریال from the final invoice total

**تقسیم طول در برش هوشمند طولی**:
وقتی کاربر عرض و طول محصول طولی را صریحاً وارد می‌کند، هر دو بعد قید قطعه فیزیکی هستند و برش هوشمند باید هر قطعه را یکپارچه نگه دارد. تقسیم یک طول صریح به چند قطعه کوتاه‌تر فقط با انتخاب روشن «تقسیم فیزیکی مجاز» انجام می‌شود.
_Avoid_: فهمیدن طول صریح به عنوان تقاضای کل قابل تقسیم، تبدیل خودکار یک قطعه به چند قطعه کوتاه‌تر، یا پنهان‌کردن مجوز تقسیم در تنظیمات فنی

**بعد مشتق‌شده در برش هوشمند**:
وقتی یکی از ابعاد محصول صفر یا خالی است و عرض، متراژ کل، تعداد یا اطلاعات دیگر برای محاسبه کافی هستند، برش هوشمند می‌تواند بعد نامشخص را برای چیدمان بهینه محاسبه کند. بعدی که کاربر صریحاً وارد کرده قید باقی می‌ماند و نتیجه محاسبه‌شده پیش از ذخیره به کاربر نشان داده می‌شود.
برای سنگ طولی، همان فیلدهای طول، عرض، تعداد و مترمربع بدون انتخاب «روش محاسبه» ورودی دوطرفه‌اند: طول بدون تعداد مجموع متر طول است؛ مترمربع بدون تعداد مجموع متر طول را مشتق می‌کند؛ طول با تعداد مثبت طول هر قطعه است؛ و مترمربع با تعداد مثبت طول هر قطعه را مشتق می‌کند. عرض مؤثر همیشه مقدار همان فیلد عرض است که برای ردیف جدید با عرض کامل منبع پر می‌شود. هر مقدار مشتق‌شده مستقیم در فیلد موجود ظاهر می‌شود و قابل ویرایش است؛ آخرین فیلدی که فروشنده ویرایش می‌کند ورودی صریح تازه است و مقادیر وابسته را بدون هشدار بازحساب می‌کند.
A valid longitudinal request requires a positive طول or مترمربع; تعداد and عرض alone are insufficient. If both demand fields are absent, zero, or negative, attempting to add the row focuses طول and shows only `طول یا مترمربع را وارد کنید` beneath the existing field row, without an alert. Entering either valid value immediately clears the message and derives the other value.
_Avoid_: ساختن حالت‌ها یا فرم‌های جدا برای روش‌های محاسبه، treating تعداد or عرض alone as a complete request, accepting zero or negative demand, changing the last explicit input silently, locking a derived value, guessing with insufficient information, or interrupting correction with an alert

**تعداد صفر در برش هوشمند طولی**:
فقط برای محصول سنگ طولی، تعداد خالی یا صفر اجازه یک برآورد داخلی برای جلوگیری از بیش‌برآورد هزینه است؛ محصول طولی که تازه از کاتالوگ برای یک ردیف جدید انتخاب می‌شود تعداد را در UI خالی نشان می‌دهد و همان معنای واقعی صفر/بدون تعداد را برای این برآورد حفظ می‌کند. تعداد، طول و عرض واردشده همچنان عین درخواست مشتری باقی می‌مانند. برای نمونه درخواست `40cm` منبع، `7cm` عرض، `50m` طول و تعداد صفر در همه ردیف‌ها و خروجی‌ها همان `0 / 50m / 7cm` می‌ماند و نتیجه بهینه‌ساز جایگزین آن نمی‌شود. در مقابل، تعداد مثبت صریح است و طول را به طول هر قطعه تبدیل می‌کند؛ `2 / 50m` یعنی دو قطعه 50 متری و مجموع 100 متر. ردیف و پیش‌نویس موجود و ردیف تکثیرشده مقدار خود را حفظ می‌کنند. ردیف قدیمی که مقادیر صفر را با خروجی بهینه‌ساز جایگزین کرده، هنگام خواندن از provenance بازسازی می‌شود و فقط با ذخیره صریح قرارداد اصلاح پایدار می‌گردد.
اگر فروشنده در یک ردیف موجود یا تکثیرشده با تعداد صفر، تعداد مثبت وارد کند، همان ویرایش صریحاً ردیف را به معنای «تعداد قطعه با طول هر قطعه» منتقل می‌کند؛ provenance و برنامه بهینه‌سازی تعداد صفر دیگر مالک طول، تعداد، مترمربع یا قیمت نیستند و همه واقعیت‌های مشتق‌شده از ورودی‌های جدید بازحساب می‌شوند.
_Avoid_: تبدیل تعداد خالی یا صفر به یک یا تعداد محاسبه‌شده، تبدیل طول کل مشتری به طول قطعه محاسبه‌شده، تعمیم این معنا به انواع دیگر محصول، نمایش برآورد داخلی به‌عنوان خواسته مشتری، یا مهاجرت بی‌صدای قراردادهای نهایی‌شده

**چیدمان عرضی قطعات صریح سنگ طولی**:
تعداد مثبت، تعداد قطعات مشتری و طول واردشده، طول هر قطعه است؛ بهینه‌ساز این مقادیر را تغییر نمی‌دهد اما هر تعداد قطعه هم‌طول که با عرض و خوراک اره فعال در سنگ منبع جا شود کنار هم می‌چیند. برای نمونه دو قطعه `20cm × 10m` از سنگ `40cm` بدون خوراک اره، یک منبع `40cm × 10m` مصرف می‌کنند، نه `40cm × 20m`؛ برش جداسازی `10m` است و کالیبراسیون فعال فقط `10m` دیگر به هزینه برش اضافه می‌کند، نه به طول سنگ مصرفی. با خوراک اره `0.3cm`، این دو قطعه دیگر در یک عرض `40cm` جا نمی‌شوند و دو منبع `40cm × 10m` مصرف می‌شود؛ ردیف «سنگ مصرفی» همین مصرف واقعی و خوراک اره را به مشتری نشان می‌دهد، در حالی که ردیف محصول همچنان `2 × 20cm × 10m` است.
چیدمان فقط تعداد دقیق قطعات درخواستی را تولید می‌کند. اگر آخرین سنگ منبع ظرفیت بیشتری از تعداد باقی‌مانده سفارش داشته باشد، سیستم قطعه فروخته‌نشده اضافه تولید نمی‌کند و بخش استفاده‌نشده همان سنگ را با هندسه واقعی بزرگ‌تر نگه می‌دارد؛ برای نمونه سفارش `20` قطعه `12cm × 1.5m` از منبع `40cm` بدون خوراک اره، شش منبع را به سه قطعه و منبع هفتم را فقط به دو قطعه تقسیم می‌کند، بنابراین باقی‌مانده منبع هفتم `16cm × 1.5m` است. تولید قطعه بیست‌ویکم فقط با درخواست صریح تعداد `21` مجاز است.
چیدمان عرضی چند قطعه صریح همیشه خودکار است و به مجوز تقسیم فیزیکی نیاز ندارد؛ آن مجوز فقط برای تبدیل یک قطعه صریح به چند قطعه کوتاه‌تر است.
_Avoid_: جمع‌کردن طول قطعاتی که در یک ردیف عرضی منبع جا می‌شوند، تغییر تعداد یا طول هر قطعه مشتری، تولید قطعه اضافه برای پرکردن ظرفیت آخرین منبع، نادیده‌گرفتن خوراک اره فعال، استفاده از مجوز تقسیم برای چیدمان قطعات مستقل، یا ترکیب بی‌صدای ردیف‌های محصول جداگانه؛ استفاده بین ردیف‌ها فقط از مسیر انتخاب صریح باقی‌مانده انجام می‌شود

**ردیف تجاری و خروجی فیزیکی برش هوشمند**:
ردیف قرارداد در فروش، حسابداری، تحویل و کارگاه همان خواسته ثبت‌شده مشتری است. نتیجه بهینه‌ساز دستور تولید نیست، اما حقیقت داخلی هندسی برای برآورد مصرف ماده، موجودی باقی‌مانده و قیمت عملیات وابسته به هندسه است؛ برای نمونه `5 × 10m × 7cm` یک لبه طولی را `50m` و یک لبه کوتاه را `0.35m` محاسبه می‌کند، بدون تغییر ردیف `0 / 50m / 7cm` مشتری. برش طولی همین چیدمان را مبنا می‌گیرد و فقط در صورت فعال‌بودن کالیبراسیون، طول کالیبراسیون را جداگانه اضافه می‌کند؛ بنابراین نمونه می‌تواند `50m` یا با کالیبراسیون `60m` باشد. breakdown چیدمان فقط در پنجره ساخت/ویرایش فروش با عنوان «مبنای محاسبات داخلی» دیده می‌شود، اما ردیف اعتمادساز «سنگ مصرفی» در چاپ/PDF همچنان ابعاد و مقدار واقعی سنگ منبع مصرف‌شده را نشان می‌دهد.
_Avoid_: جایگزین‌کردن خواسته مشتری با قطعات برآوردشده، قیمت‌گذاری عملیات از ردیف صفر به‌جای هندسه داخلی، نمایش breakdown قطعات در PDF مشتری، حسابداری، تحویل یا کارگاه، پنهان‌کردن سنگ مصرفی واقعی، معرفی برآورد به‌عنوان دستور کارگاه، یا ساختن چند حقیقت متناقض از یک ردیف قرارداد

**باقی‌مانده برش هوشمند طولی**:
باقی‌مانده سنگ طولی بر اساس چیدمان داخلی بهینه‌ساز محاسبه می‌شود، حتی وقتی آن چیدمان دستور کارگاه نیست و ردیف قرارداد عین درخواست مشتری می‌ماند. این باقی‌مانده یک موجودی معتبر، قابل‌نمایش و بلافاصله قابل‌انتخاب برای ساخت محصول دیگر است؛ برای نمونه برآورد `5 × 10m × 7cm` می‌تواند باقی‌مانده `5cm × 10m` بسازد.
Every physically positive remainder is usable regardless of how small its width, length, or area is. There is no minimum-usable threshold, waste classification based on size, seller control, or administrative setting; any positive remainder is preserved and available for later selection, and it prevents packing from being classified as full-width consumption for the automatic calibration default.
Longitudinal material pricing uses the complete area of every mother band actually consumed by deterministic packing, not only the finished requested area. The positive unused portion is therefore already-paid reusable material, while ordinary and calibration cutting remain separate operation charges. Canonical replay and migration must use this same consumed-material basis so a valid row with a paid remainder cannot be rejected as financial drift.
_Avoid_: پنهان‌کردن باقی‌مانده بهینه‌ساز، وابسته‌کردن قابلیت استفاده آن به تأیید کارگاه، defining a minimum usable size, discarding a small positive remainder as waste, excluding it from calibration-default decisions, or recalculating it from the customer row's display quantity and length

**عرض درخواستی ردیف قرارداد**:
The customer-requested finished width of a contract product row, shown when delivery scheduling needs to distinguish the requested piece from the source stone consumed to make it.
When a seller selects a longitudinal catalog product, the existing عرض field is automatically populated with the source stone's full catalog width. The seller can overwrite that same field with a narrower requested width; no separate full-width state, explanatory control, or suggestion is added to the UI. Clearing a narrowed width restores the full catalog width as the effective field value.
An entered width greater than the source width is preserved as typed but cannot be added as a product row. The existing field alone shows `حداکثر عرض این سنگ <عرض> سانتی‌متر است`; attempting to add focuses that field without an alert, and the message disappears immediately when corrected. Equal width is valid with no longitudinal cut; narrower width is valid and automatically creates the longitudinal cut.
_Avoid_: using this value as the source-material width when the row is cut from a wider stone, silently clamping an oversized request, adding an impossible row, or interrupting correction with an alert or dialog

**عرض مصرفی ردیف قرارداد**:
The width of the source stone consumed to create a contract product row. It explains material usage and should align with سنگ مصرفی rather than replacing the customer-requested width.
_Avoid_: treating عرض مصرفی as the finished customer-requested width

**ردیف زمان‌بندی تحویل/اجرا**:
A contract row that can be assigned to the delivery schedule because it represents either a physical stone product to deliver or a standalone service row to execute for the customer.
_Avoid_: representing service execution as a fake stone product, or assuming every scheduled row is physical inventory

**هویت پایدار تخصیص تحویل**:
A delivery quantity belongs to one exact contract product row through `productRowId`; `productIndex` and catalog `productId` are compatibility snapshots, not canonical identity. A legacy assignment is migrated automatically only when its saved index still points to a row with the same catalog product ID. A missing, duplicated, or contradictory identity blocks save and remains visibly invalid until the operator explicitly chooses «حذف تخصیص نامعتبر»; the removed quantity becomes unallocated and must be assigned manually.
Commercial product rows remain independent even when their catalog stone, dimensions, description, unit price, or total price are identical. If independent rows accidentally share an internal `productRowId`, every row in that collision receives a new unique identity without changing commercial data; any assignment carrying the old ambiguous identity remains invalid and must be removed and entered manually. If the duplicated identity is referenced by a layer or remaining-stone child as its parent/source, automatic repair is forbidden and the relationship must be reviewed explicitly.
_Avoid_: treating similar commercial rows as duplicates, merging or deleting them, preserving one ambiguous row as the presumed delivery target, or guessing which duplicate parent owns a dependent child
_Avoid_: matching deliveries by array position after products change, guessing from a similar stone, silently transferring quantity to another row, deleting an invalid assignment without confirmation, or allowing an unresolved/unallocated quantity through final save

**مقدار زمان‌بندی خدمات قرارداد**:
The amount of a standalone service row assigned to delivery/execution dates, using the same unit and total quantity as the selected service row.
_Avoid_: scheduling a service in a different unit than its contract row, or allowing scheduled service amounts to exceed the selected service quantity

**ابزار**:
A paid stone edge operation applied during contract pricing, calculated by length or square meter depending on the item.
Tools are configured inside the same central product-configuration module before a row is added or while its stable identity is edited. Catalog-sourced, remaining-stone, stair, stair-layer, and slab drafts use the same tool collection interface; selections, geometry, cutting, finishing, pricing, and the row itself commit atomically, while cancellation mutates nothing. Saved snapshot tools remain editable and visible when their current catalog records are missing or inactive. Tool configuration never targets a row by array index.
_Avoid_: ساب as a category, sub-service, tool, پرداخت سنگ, a separate nested tool modal, mutating `wizardData.products` before product save, maintaining family-specific tool shapes, dropping missing-catalog snapshots, or identifying the target product by `productIndex`

**لبه‌های ابزار در خروجی قرارداد**:
When an ابزار is applied to selected product edges, the chosen edges are part of the contract product detail and should be visible anywhere the contract product details are printed or exported, including customer-facing contracts, accounting copies, and workshop copies. محیط کامل means all relevant edges for that product part; otherwise the exact selected edges such as جلو، عقب، چپ، and راست should be shown with the ابزار name.
Each selected edge operation should appear once per contract product detail, even if older saved snapshots contain the same ابزار in more than one technical source.
_Avoid_: printing only the ابزار name or price when the selected edges explain what work was ordered, or printing the same ابزار-edge combination twice from duplicate saved sources

**انتخاب لبه‌های ابزار محصول قرارداد**:
A newly selected متر طول ابزار starts with no assumed edge and cannot be committed until the seller explicitly selects at least one valid edge. Each length-based tool owns its own independent selection among جلو، عقب، چپ، and راست. The compact shortcut دو طول selects the two corresponding longitudinal edges, while محیط کامل selects every edge valid for that product; either shortcut only changes the current selection and the seller may then toggle individual edges. Geometry, physical piece count, and the selected edges determine its automatic tool quantity. A geometry change recalculates that quantity without changing the saved edge selection. An edge-less length tool blocks the atomic product save only on its own row with the inline message `حداقل یک لبه را انتخاب کنید`, without an alert. There is no limit or catalog incompatibility rule on how many selected tools may target the same edge: different tools may freely share any edge in the same operation group, while retaining independent coverage, edge selection, quantity, rate, and amount. The exact selected edges are snapshotted with each length tool and remain visible in contract, accounting, and workshop outputs.
An متر مربع ابزار has no edge selector at all. Its automatic quantity is the finished area of the physical pieces covered by that operation: `finished length × finished width × covered piece count`; edge count never multiplies this area.
_Avoid_: asking for edges on a square-meter tool, guessing a default edge for a length tool, sharing edge state between tools, replacing the seller's edge selection after a geometry change, calculating quantity from display-only dimensions, saving an edge-less length tool, limiting one tool per edge, inventing tool-edge incompatibility rules, or validating through a modal or global alert

**تعداد قطعات تحت ابزار و گروه عملیات**:
The contract product quantity remains the commercial stone quantity, while each selected ابزار independently records the physical share receiving that operation. With a positive product quantity, coverage and non-overlapping operation groups use physical piece count. A new tool defaults to all pieces and shows `روی همه … قطعه`; `تغییر تعداد` opens only a small inline count editor. Without product quantity, coverage and groups use the order's total linear length instead, defaulting to `روی همه …m`; `تغییر مقدار تحت عملیات` edits that covered length without inventing pieces. For example a quantity-less `25m × 40cm` order may own `گروه ۱ — ۱۰m: جلو نیم‌لول` and `گروه ۲ — ۱۵m: جلو قاشقی`. Length-based tools derive from group length and selected edges, while square-meter tools derive from group length × finished width, such as `10m × 0.4m = 4m²`.
Coverage is distinct from `تغییر مقدار`, which overrides the final geometry-derived tool quantity rather than the group's physical scope. Every physical piece or linear portion belongs to exactly one group; multiple tools on the same subset live inside that one group. Any currently unallocated scope forms an automatic internal group such as `۵ قطعه بدون ابزار` or `۵m بدون ابزار`, visible only in the compact tool summary and workshop output, requiring no seller action or warning. It recalculates immediately and disappears at zero. An empty stored group with no tool, finishing, or manual override has no deliberate commercial meaning and follows the current authoritative product quantity automatically; changing quantity must never leave its stale scope behind. A single unsplit group that covered the complete prior row also represents whole-row intent even when it contains tools or finishing, so a geometry or quantity change resizes that group to the complete new row and recalculates its geometry-derived operation quantities. Once the seller explicitly splits coverage into multiple groups, each split scope remains explicit; manual quantity overrides also remain explicit and require their existing review or conflict resolution when geometry changes. Assignments above the product quantity or total length preserve the entered value and report the remaining allocatable scope. Group UI stays absent when the complete order shares one operation set. Contract and workshop outputs state the coverage basis and grouped operations so production can distinguish the subsets.
_Avoid_: duplicating the stone product or material price to express operation variants, inventing a piece count for a quantity-less order, treating final tool meterage as group coverage, leaving an ordinary unsplit whole-row group at stale geometry, resizing explicitly split scopes or manual quantity overrides without review, allowing coverage beyond the order, assuming independently entered tool scopes describe the same physical subset, overlapping physical membership between groups, forcing the seller to create or confirm a no-tool group, warning merely because some scope needs no tool, or showing operation-group controls for the ordinary all-order case

**تبدیل مبنای گروه‌های ابزار**:
Entering a positive product quantity changes operation-group coverage from aggregate linear length to physical piece count only through an exact geometry mapping. When every prior group length divided by the new per-piece length is a whole number and the totals reconcile, the system converts automatically while preserving group membership, tools, edges, rates, and overrides. It never rounds or guesses a fractional mapping. An ambiguous conversion keeps every existing group and snapshot intact, renders a flat inline `گروه‌های ابزار با تعداد جدید نیاز به تنظیم دارند` section with each previous length and a compact piece-count input, and blocks only the atomic product save until all groups are resolved. Clearing quantity converts piece groups back to linear coverage exactly through `group piece count × per-piece length`; the automatic no-tool group is rebuilt immediately for the new basis. No alert, nested modal, silent reset, tool deletion, edge change, or rate change occurs in either direction.
_Avoid_: interpreting meters as pieces, rounding fractional group coverage, discarding groups when quantity mode changes, silently resetting coverage to the whole order, changing tool snapshots during conversion, or allowing an unresolved mapping through final save

**اعمال ابزار روی گروه عملیات**:
With only one operation group, a newly selected tool applies to that complete group without an extra prompt. The compact tool row exposes `اعمال روی`; opening it inline offers the complete order, each existing stable group, and `بخشی از یک گروه`. Choosing a subset requires only the source group and a physical piece count or linear length matching the product's current coverage basis. The system deterministically splits that source group: the selected subset inherits all prior operations and adds the new tool, while the remainder keeps the prior operation set unchanged. The split groups own stable independent identities and snapshots. The same behavior applies in quantity-less mode through linear length. The default remains the complete product, and no selector is expanded unless the seller changes scope. Display summaries may visually consolidate equivalent operation groups, but stored identities and history are never silently merged.
_Avoid_: asking for group scope during the ordinary single-group path, replacing the source group's prior operations, losing tool snapshots during a split, allocating a subset without a named stable source group, opening a modal or card flow, or destructively merging stored groups merely because their current summaries look equal

**گروه عملیات مشترک ابزار و پرداخت**:
Tools and stone finishing never maintain separate product subdivisions. They attach to the same stable, non-overlapping operation groups and share the same `اعمال روی` choices: complete order, an existing group, or an exact subset of a source group. Splitting for a new finishing or tool preserves every prior operation on the selected subset and remainder, then adds only the new selection to the selected subset. A group may contain multiple tools and multiple finishings. Square-meter finishing uses that group's real finished area; in quantity-less mode the group uses linear coverage and derives area through group length × finished width. The automatic unallocated group is `بدون عملیات` only when it has neither tools nor finishings. Ordinary whole-order operation sets render no group controls, while contract and workshop outputs show the complete tool-and-finishing combination of every meaningful group.
_Avoid_: maintaining tool groups and finishing groups independently, splitting a group while dropping inherited operations, calculating finishing from whole-product geometry when it targets a subset, calling a scope `بدون عملیات` when it still owns either a tool or finishing, or exposing group mechanics in the ordinary uniform-operation path

**محاسبه قابل مشاهده عملیات نامعتبر**:
When one ابزار or پرداخت selection is invalid, every independently valid selection still shows its calculated unit quantity, rate, and amount, while only the conflicting row shows its precise inline error. The section marks its aggregate as incomplete and blocks the complete atomic product save until all conflicts are resolved.
_Avoid_: replacing every operation quantity and amount with an em dash because one row failed, presenting an incomplete aggregate as final, hiding the conflicting selection, or partially saving valid operation rows

**انتخاب تکراری ابزار**:
The same catalog tool may be selected more than once because each selection can target different groups or edges and can own a different quantity override or historical inventory-rate snapshot. Every occurrence has stable independent identity, coverage, edges, quantity, non-editable rate snapshot, and amount. Search results remain selectable after an occurrence is added, without a duplicate warning, and deleting one draft occurrence affects only that occurrence. Stored occurrences are never automatically merged or deduplicated. A summary or workshop output may visually aggregate occurrences only when catalog identity, operation group, selected edges, calculation unit, and rate are all identical, while preserving their underlying identities and snapshots.
_Avoid_: disabling an already selected catalog result, treating the catalog tool ID as the selection-row identity, silently merging same-name tools, deleting every occurrence through one action, warning merely because a catalog item is selected twice, or destructively aggregating stored selections for output convenience

**پرداخت سنگ**:
A stone finishing or treatment option applied during contract pricing, separate from ابزار, calculated by متر طول or متر مربع depending on the item.
_Avoid_: ابزار, خدمات, فرآوری سنگ

**کد فرآوری سنگ**:
The stable catalog code for a پرداخت سنگ / فرآوری سنگ record. Catalog managers provide it during manual create/edit and Excel sync uses it as the record identity, while historical records may still carry generated fallback codes.
_Avoid_: using the display name as the stable identity for پرداخت سنگ, hiding the code from catalog management, or rewriting historical generated codes during unrelated print changes

**فعال‌سازی پرداخت سنگ**:
وجود حداقل یک پرداخت سنگ انتخاب‌شده تنها معیار وجود پرداخت روی ردیف قرارداد است؛ سوییچر فعال‌سازی و boolean موازی وجود ندارند. حالت خالی فقط `پرداختی انتخاب نشده` و اقدام همیشه‌دردسترس `افزودن پرداخت` را نشان می‌دهد. انتخاب اولین پرداخت مجموعه را ایجاد و حذف آخرین پرداخت آن را به حالت خالی برمی‌گرداند. داده قدیمی با سوییچر روشن ولی بدون پرداخت واقعی، بدون ساخت عملیات یا مبلغ به همین حالت خالی خوانده می‌شود.
_Avoid_: نگهداری وضعیت «فعال ولی بدون انتخاب»، ذخیره boolean جدا از مجموعه پرداخت‌ها، انتخاب خودکار اولین آیتم کاتالوگ، ساخت هزینه از flag قدیمی، یا نیازمندکردن فروشنده به یک کلیک فعال‌سازی پیش از افزودن پرداخت

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

**عنوان محصول قرارداد**:
The seller-editable display title snapshotted on one selected contract product row. A new row starts from the catalog product's generated full name, while the compact catalog facts remain separately visible; editing the title changes only the row label used by contract summaries, delivery, and downstream outputs. It never changes catalog identity, product type, source width, thickness, geometry, or calculation inputs, and reopening a saved contract preserves the saved title even when the current catalog name has changed.
_Avoid_: using the editable title as catalog or row identity, regenerating a saved title from the current catalog, or letting a title edit mutate technical product facts

**قیمت پایه سنگ قرارداد**:
The seller's manually entered positive unit price for the selected stone on one contract row. A new row starts without an automatically populated catalog price and cannot be added to the contract until the seller enters a value greater than zero. Attempting to add it focuses the existing price field and shows only the short inline message `قیمت را وارد کنید`, without an alert or large notice. The entered value is snapshotted with the row, drives immediate recalculation, and remains the source of truth when the saved contract is reopened even if catalog prices later change.
_Avoid_: automatically copying a catalog price into a new stone row, treating zero as a valid price, adding an unpriced stone row, interrupting the flow with an alert or large validation panel, updating the catalog from a contract-row price, or repricing a saved row from the current catalog

**تصویر کاتالوگ**:
An image attached to a product, tool, cutting, finishing, or standalone service catalog item so future contracts can reuse the same visual reference.
_Avoid_: treating catalog images as immutable evidence of what a past contract meant

**تصویر ردیف قرارداد**:
An internal image snapshot attached to a selected contract row so other workspaces can see the exact product or service reference intended for that contract, even if the catalog image changes later. A new row starts with the catalog image URLs and can then be changed independently for that contract.
_Avoid_: relying only on the current catalog image for saved contract interpretation, or showing row images in customer-facing PDF/print output unless explicitly requested

**توضیحات سنگ پله**:
The per-part note attached to a stair contract product row, such as کف پله, خیز, or پاگرد. Each selected stair part carries its own توضیحات so contract output can show the note beside the exact row it describes.
_Avoid_: using one shared stair-system note for all stair parts

**ردیف‌های هم‌نوع سنگ پله**:
A stair contract may contain multiple independent rows of the same stair part type, such as several کف پله rows or several خیز rows, within the same stair session or contract.
_Avoid_: treating stairPartType as a unique key, or overwriting an existing stair part row only because a new row has the same part type

**پیکربندی مستقل پله**:
One independently identified set of stair products, geometry, quantities, layers, material sources, tools, finishing, pricing, and descriptions. It may represent one staircase or several identical staircases through its quantity intent, and one contract may contain any number of independent stair configurations without merging, replacing, or limiting them.
_Avoid_: treating a configuration as one physical stair only, using its position or settings as identity, applying an arbitrary per-contract limit, or allowing finish/reset/edit of one configuration to affect another

**پیش‌نویس فعال بخش پله**:
The currently visible uncommitted کف پله, خیز, or پاگرد configuration in a stair session. `افزودن این بخش` validates and stages it while keeping the session open for another section; `اتمام و افزودن به قرارداد` validates and includes it automatically, then atomically commits the complete session, while any error keeps the modal and every draft unchanged and focuses the exact conflict.
_Avoid_: requiring `افزودن این بخش` before finish, closing an empty or invalid session, committing an older staged snapshot instead of visible edits, partially saving a session, resetting unrelated sections, or discarding input on validation failure

**ذخیره ویرایش ردیف پله**:
Editing one saved stair parent loads only that exact parent and its attached layers and exposes one primary `ذخیره تغییرات` action that validates the visible draft and atomically replaces the same stable parent-and-layer graph. Adding another کف پله، خیز, or پاگرد belongs to a new/create session rather than expanding an existing configuration from edit mode.
_Avoid_: showing `افزودن این بخش` or `اتمام و افزودن به قرارداد` during edit, requiring a staging click before save, loading unrelated stair siblings, changing row identity, or silently adding a new part while editing

**جلسه تازه تنظیم سنگ پله**:
Opening a new stair configuration after a successful finish or explicit cancel starts with completely fresh کف پله، خیز, and پاگرد drafts, active part کف پله, and default quantity mode. No geometry, display unit, quantity, price, layer, material source, tool, finishing, override, description, search, validation, staged row, or other modal state carries from the prior session; only application-wide preferences such as display theme remain.
_Avoid_: reusing a prior unit switch, active part, selected catalog stone, operation group, layer source, error, or staged snapshot as a convenience default for a separate stair configuration

**دور ریختن پیش‌نویس پیکربندی پله**:
Cancel or close exits a pristine stair modal immediately, but a session with any meaningful draft change or staged section first renders the inline choice `تغییرات این پیکربندی پله ذخیره نشده است — ادامه ویرایش | دور ریختن کل پیش‌نویس`. Only explicit discard closes and completely resets the session; refresh and crash recovery continue preserving the recoverable draft independently.
_Avoid_: discarding a dirty session on the first cancel or close action, using a browser alert or nested confirmation modal, treating ordinary typing as saved work, or clearing recovery state because the browser refreshed or crashed

**مجموعه لایه پله**:
The customer-facing/commercial quantity of a stair layer row is `parent stair quantity × تعداد لایه برای هر پله`, independent of selected side count. Each selected side produces that many physical strips at its own real length: جلو and عقب use parent طول, while چپ and راست use the parent cross-dimension—کف عمق، خیز ارتفاع، پاگرد عرض. Thus ten parent pieces with two layers and جلو + چپ yield twenty commercial layer sets but forty workshop strips: twenty per side. `محیط کامل` selects all four valid sides without multiplying the commercial set count. Layer-type pricing and customer output use commercial sets or the catalog-defined unit; source consumption, cuts, tools, and workshop instructions use the physical strip breakdown. Both truths are stored separately in the layer snapshot and shown compactly as `لایه — ۲۰ مجموعه` and per-side production rows.
_Avoid_: multiplying layer-set quantity by selected sides, hiding physical strip demand from workshop calculations, pricing source consumption from commercial sets alone, using one length for every side, or treating physical strips as complete source stones

**چیدمان مشترک نوارهای لایه**:
All physical strip demands belonging to one layer configuration are optimized together against its explicitly selected source, even when different target sides have different lengths. Front, back, left, and right are not purchased or packed as isolated material orders. The shared two-dimensional versioned policy still requires exact demand, no 90-degree rotation, minimum source count, minimum real cut meterage, minimum positive-remainder fragmentation, and deterministic ties. Side identity and quantity remain distinct throughout packing and workshop output; no extra strip is produced to fill space, and every positive unused rectangle becomes a reusable stable remainder. Ordinary cuts, kerf, and calibration derive from the combined layout. The summary lists per-side demand such as `جلو — ۲۰ × ۱٫۲m × ۴cm` and `چپ — ۲۰ × ۰٫۳۰m × ۴cm`, followed by shared source consumption and remainder results.
_Avoid_: optimizing each side independently, merging side identity because rectangles share dimensions, rotating short-side strips, overproducing strips, discarding mixed-layout remainder, summing approximate per-side cuts, or using a different optimizer policy for layers

**سنگ پرداخت‌شده و سنگ جدید لایه پله**:
Layer pieces explicitly allocated from parent or paid remainder add no second material charge; only their cutting, layer type, tools, and finishing remain billable. Selecting `سنگ جدید` requires an explicit catalog product; the parent catalog stone is suggested first but never auto-selected. One activation of a catalog search result commits that stone to the active layer configuration and replaces the search results with the selected-stone card. The selection preserves the rest of the layer draft and its operations, but clears any base material price that belonged to the previously selected stone. Mother length, width, and thickness are non-editable inventory facts. New-stone base price starts blank and is manually entered as a positive value; `کپی قیمت والد` may copy once without a live link, while changing the selected catalog stone clears the old price. Material quantity and charge use complete mother stones actually consumed by deterministic packing, including unavoidable unused area, never just finished-strip area. Every positive new-stone remainder is persisted as already-paid material and later carries zero base price while new operations remain billable. Edit preserves material price and source-dimension snapshots. The flat summary separates finished stone, consumed mother area, paid remainder, and material amount.
_Avoid_: auto-selecting the parent catalog stone, auto-seeding a catalog price, allowing non-positive new-material price, transferring price to a replacement stone, charging only finished output area, double-charging paid remainder, discarding positive new-stone remainder, mixing operation charges into material price, or hiding requested/consumed/paid-remainder quantities

**نرخ نوع لایه پله**:
Layer type is selected from inventory and carries one inventory-owned calculation unit and active price that sales cannot change. Every sales user has default read-only access to the active layer-type contract catalog—stable identity, display name, price, calculation unit, and active status—without receiving inventory-management access. A genuinely empty active catalog renders the local blocking state `هیچ نوع لایه فعالی ثبت نشده است؛ با مدیر انبار تماس بگیرید`; a network or server failure renders `دریافت انواع لایه ناموفق بود` with local `تلاش مجدد`. Both preserve the layer draft and block its atomic save without creating an anonymous or zero-rate layer. Selecting a layer type copies its current positive inventory price and calculation unit into the contract layer snapshot; amount is the catalog-unit quantity × that snapshotted price. Sales sees the price as read-only and cannot negotiate or override it. Edit and explicit layer duplication preserve the saved snapshot, while changing layer type replaces both price and unit from the newly selected active inventory item. If that saved catalog item later becomes inactive or unavailable, edit still renders its saved name, unit, and price with `غیرفعال در کاتالوگ فعلی`; unrelated edits preserve and may resave that historical snapshot. The unit and formatted price render as compact plain facts, never editable or disabled form controls.
_Avoid_: requiring an inventory-management permission merely to configure a sales layer, exposing inactive or administrative catalog fields to sales, collapsing empty, forbidden, and failed catalog states into one silent empty list, discarding the draft on catalog failure, creating an anonymous or zero-rate layer, dropping or blocking a saved inactive historical type, silently replacing it with an active type, repricing a historical snapshot merely because the catalog changed, letting sales enter or override the layer-type price or calculation unit, mutating inventory from a contract, transferring a stale rate to a different layer type, losing the saved price on edit, or rendering read-only price/unit as disabled inputs

**طول منبع لایه پله**:
The charged and packed length of stone supplying stair layers. Automatically procured new stone uses the catalog standard/source length, while parent or remaining stone uses its exact saved available length and manually selected warehouse stone uses the explicitly entered available length; finished layer-piece lengths remain based on the stair's actual geometry.
_Avoid_: charging automatic new stone at only the finished strip length, replacing exact remainder or warehouse dimensions with a catalog default, or printing the source length as the finished layer length

**تخصیص منبع لایه پله**:
A deterministic allocation from one explicitly seller-selected source policy for one layer row: `سنگ والد`, one exact `باقی‌مانده قرارداد`, or `سنگ جدید`. `سنگ والد` explicitly authorizes a deterministic mixed allocation: consume every compatible already-paid remainder belonging to that exact parent first, then procure and material-price fresh stone of the parent's catalog identity only for the unmet layer demand. The summary exposes both portions and their independent material and cutting costs. Contract-remainder selection stays inside the same central modal with same-parent/same-catalog candidates suggested first but never selected; an insufficient explicitly selected contract remainder remains a local shortage and never falls through to another remainder or new stone. `سنگ جدید` is explicitly selected and material-priced. Preview may calculate fit without mutating inventory; only the atomic parent-and-layer save commits stable physical allocations. Cancel/back consumes nothing. Edit/delete atomically rebuilds the exact allocations. Parent/paid remainder material carries zero second material charge while every newly performed operation remains billable.
_Avoid_: auto-selecting a source policy, using remainder from a different parent under `سنگ والد`, hiding the paid-versus-fresh split, falling through from an explicitly selected contract remainder, mutating inventory during preview, identifying a source by stair type/name/index, partially saving an insufficient allocation, double-charging already-paid material, or silently replacing an invalidated source with new stone

**چرخه عمر لایه پله وابسته**:
An attached layer belongs to one exact parent stair row through stable row identity. Parent edits atomically preview and recalculate attached layers, source allocations, remainders, cuts, add-ons, and totals while preserving independent layer selections and requiring renewed confirmation for affected manual overrides; any allocation conflict rejects the whole edit. Adding a new parent with attached layers also commits as one graph: if any parent or layer calculation, source, rate, tool, finishing, or override is invalid, nothing is added and the complete modal draft remains unchanged while the still-clickable action focuses the first specific inline conflict. Parent deletion opens no alert/modal and performs nothing on first click: its row becomes an inline `این ردیف … لایه وابسته دارد` confirmation with compact layer summaries and `انصراف | حذف والد و لایه‌ها`. Explicit confirmation atomically deletes only that parent and all structural layers, releases/replays their source allocations and remainders, and removes each deleted layer's owned tools, finishing, cuts, and snapshots. Any rebuild failure rolls back everything and pending state stays local to that row. A layer may instead be viewed or deleted independently, restoring/replaying only its allocations; sibling stair parts remain untouched. Finalized contracts require explicit edit flow.
Duplicating a stair parent never creates a row immediately; it opens a new draft in the same modal with a compact `فقط بخش پله | همراه لایه‌ها` choice defaulting to parent only. Parent-editable title, geometry/units, quantity, base price, حکمی, kerf/calibration, tools/finishings, and description are copied with new stable identities. When layers are explicitly included, each layer configuration, manual layer-type rate, and operation-rate snapshots copy into independently identified drafts, but no material-source choice, allocation, remainder identity, delivery plan, production state, or prior relationship is copied. Every copied layer source starts blank and must be explicitly selected; packing and remainders recalculate from scratch. Cancel creates nothing, and any source failure rejects the complete atomic new parent-and-layers save.
_Avoid_: linking a layer by stair type or position, partially saving a parent edit, leaving orphan layers, deleting attached layers on first click or through a browser alert, losing restored remainder after deletion, deleting sibling stair parts, partially committing a failed rebuild, changing finalized history outside edit, creating a duplicate immediately, defaulting duplication to include layers, copying source allocations or downstream state, reusing parent/layer/operation identities, or partially creating a duplicate with an invalid layer source

**ویرایش inline لایه پله**:
Layers are configured inside the flat subsection of their exact کف، خیز, or پاگرد parent, never in a modal, page, or separate wizard step. Empty state is only `لایه‌ای تعریف نشده` with `افزودن لایه`, which appends a new draft configuration rather than replacing an existing one. A parent may own any number of independent layer configurations and the same target side may appear in multiple configurations without name-inferred compatibility or duplicate restrictions. Each configuration independently owns stable identity, layer type with its inventory price/unit snapshot, layers per parent piece, width/display unit, target sides, explicit material source, packing/allocations, cuts, tools/finishings, and description. Identical-looking configurations are never silently merged.
All changes remain in the parent's draft and mutate no `wizardData.products` entry before one atomic parent-and-layers save; any layer failure rejects the whole save, and close/cancel discards every unsaved layer edit. Allocations replay in stable layer-creation order. When configurations explicitly share a remainder source, earlier allocations consume first and a later shortage never falls through to another source. Deleting one configuration restores its allocation and replays later configurations without changing their commercial settings. Editing a stair row loads only that exact parent and its attached layers, not sibling stair parts. Contract and workshop outputs nest every configuration separately beneath the parent. Shared tool/finishing modules are reused and no relationship or calculation targets `productIndex`.
Opening stair edit selects and fully loads the first attached layer configuration into the inline editor. With one layer, that layer opens immediately; with several layers, the first opens initially and every configuration remains visibly selectable by stable identity. Selecting a configuration changes only which complete saved snapshot is shown—type, quantity, width, sides, source, allocations, tools, finishing, prices, overrides, and description—and never removes, reorders, stages, or silently rewrites any configuration in the draft collection.
_Avoid_: opening a nested layer modal, replacing a prior layer when adding another, limiting one configuration per side, merging duplicate-looking configurations, changing allocation order, silently moving a short later layer to another source, mutating saved products while editing a layer draft, committing parent and layers separately, loading unrelated stair siblings, hiding saved layer settings behind a second edit action, removing the selected configuration from the collection, duplicating operation modules, or identifying the parent/child by array position

**تحویل لایه پله وابسته**:
A stair layer is a non-independent child manufactured and delivered as part of its exact parent stair row. Customer output nests its layer-set quantity and auditable material, cutting, tooling, finishing, and price details beneath the parent; accounting retains the linked pricing breakdown, workshop retains the physical strip plan, and logistics includes layer details in the parent loading identity without creating a separate delivery or loading balance.
_Avoid_: scheduling or loading layer strips as independent cargo, printing physical strip count as layer-set quantity, hiding the child price breakdown, omitting production geometry from workshop output, or allowing parent delivery or deletion to leave an independent layer balance

**دروازه تطبیق گراف محصول قرارداد**:
A product-configuration change is complete only when one canonical recalculation produces a valid atomic parent/child graph and screen totals, saved contract data, reload state, customer and accounting output, workshop truth, delivery, and logistics reconcile exactly. Saving is blocked by orphan or unstable relationships, invalid source allocations, incompatible processing, unconfirmed stale overrides, or pricing mismatches; finalized history remains unchanged until authorized explicit edit and save.
_Avoid_: accepting a UI-only correction, partially saving a graph mutation, duplicating formulas across consumers, treating passing legacy tests as sufficient evidence, or releasing without deterministic complex-scenario and rendered-output verification

**تشخیص خطای تنظیم محصول قرارداد**:
Every rejected or unexpected product-configuration action preserves the complete draft and presents a Persian seller-facing explanation; raw English, backend, exception, or transport text never appears in the modal. A field- or row-specific validation or backend conflict focuses and scrolls to the first correctable control in stable visual order and renders its precise Persian message inline. A network or backend failure without a correctable local target keeps the modal open, preserves every input, and renders one persistent Persian message beside the sticky save action. Stable diagnostic codes and structured technical evidence contain the action phase, mode, stable graph identities, conflict codes, calculation hashes, and row counts. Diagnostics exclude customer information, descriptions, image URLs, and other sensitive content; warnings are reserved for actionable risks rather than ordinary incomplete typing.
_Avoid_: silent failure, closing on error, exposing raw English or technical messages, showing only a generic error when a local cause exists, using an alert, losing or rewriting seller input, unstructured console messages, logging sensitive draft content, warning on every keystroke, or introducing external monitoring as an implicit part of a product-flow repair

**ساختار canonical پنجره تنظیمات محصول**:
Every product family uses one central modal shell with the same overlay, width, radius, border, shadow, light/dark surface tokens, spacing, sticky header/body/footer, and teal interaction accent, plus this stable order: header with close and internal back only for source/remainder subviews; plain fixed product-family value selected before the modal opens in Step 5; one catalog-fact line; editable contractual title; flat contract remainders only where physically applicable; type-specific core dimensions/quantity/area/sources/base price; shared auto-growing description; compact editable direct settings such as حکمی، خوراک اره، and calibration; shared inline tools; shared inline stone finishing on the same operation groups; dependent structures such as stair layers inside their exact parent; always-visible flat calculation summary; and one sticky cancel/back plus primary add/save action with pending protection. Product-family color may not redefine the shell or its dark surface. Non-applicable sections are omitted rather than disabled. Exact-sized skeletons prevent order/layout shift. Validation focuses and scrolls to the local field while respecting reduced motion. Scroll position persists only within the current open session. No type module may open a nested modal.
_Avoid_: switching product family inside an open modal, clearing an in-progress family draft through a type switch, family-specific modal shells, moving sections after network completion, disabled informational controls, duplicated catalog/title cards, hidden calculation details, non-sticky actions in a long form, global validation alerts, restoring stale scroll across separate opens, or introducing overlays for internal subflows

**فهرست یکپارچه انتخاب محصول**:
Step 5 removes the separate product-type wizard step and presents one labeled no-placeholder `جستجوی محصول` field, compact `همه | طولی | پله | اسلب | آماده` filter defaulting to all, and one flat result list. Rows contain only catalog name, compact technical facts, short inferred type label, and `انتخاب`; manual contract pricing means no catalog price appears. Before search, each seller's own recent/frequent selections rank inside the same list with no suggestion/recent surface, followed by stable catalog order. Search ranking is exact code, exact normalized name, prefix, token/fuzzy, then seller history, with Persian/Arabic ی/ي and ک/ك normalization and matching across code, name, type, width, thickness, and relevant facts. Cached core facts open the central modal immediately while dependent sections load locally. Keyboard arrows highlight rows and Enter selects only the explicit highlight. Cancel restores search/filter/list scroll. After the atomic creation of any longitudinal, stair, slab, prepared, or remaining-stone child product succeeds, the modal closes, Step 5 stays open, the row is inserted with a short reduced-motion-aware transition, and the exact Persian confirmation `ثبت محصول با موفقیت انجام شد` appears as an accessible in-page Design System status above the catalog. The status is announced without taking focus, is replaced by a later successful action, and fades after five seconds. The catalog start plus `جستجوی محصول` field scroll into view before the search field receives focus for the next selection. No creation confirmation appears before authoritative save succeeds. A successful edit instead shows `تغییرات محصول با موفقیت ذخیره شد` and preserves the edited row's list position and context rather than returning to search. No cards, carousel, badges, promotions, icons, or secondary navigation are added.
_Avoid_: retaining product type as a separate step, splitting personalized results into another component, showing catalog prices, selecting an implicit first search result on Enter, waiting for all dependent requests before modal open, losing list state on cancel, leaving Step 5 after each add, showing success before the atomic save commits, returning an edit to search, losing the edited row context, or adding recommendation chrome

**ردیف‌های تخت محصولات قرارداد در مرحله انتخاب**:
Added products render as flat creation-ordered contract rows rather than large/nested cards. A top-level line shows contractual title, short type, finished geometry/quantity, requested area or contractual unit, total amount, and short `ویرایش | تکثیر | حذف` actions. Existing details render beneath only when present: حکمی, cutting totals, tools and finishings grouped by shared operation group, description, source consumption, and remainders. Stair layers stay visibly nested under their exact parent and remaining-stone products stay nested/linked to their source; no child becomes an unrelated top-level row. There are no colors cards, icons, accordions, or show-more controls. Missing categories are omitted here, while fixed em-dash summary rows remain modal-only. Every action uses stable row identity, delete confirms inline, and pending disables only its row. Save reconciles/highlights only the affected row without full-list reload or automatic reorder; totals derive immediately from the canonical saved graph. Optional large-list virtualization must preserve focus and nested positioning.
_Avoid_: targeting array indexes, flattening children into unrelated rows, hiding important details behind expansion, reordering on edit, reloading the full Step 5 list after one save, disabling unrelated rows, or virtualizing in a way that breaks keyboard focus or parent-child adjacency

**مهاجرت تدریجی گراف محصولات قرارداد**:
Existing finalized contracts are never bulk-rewritten. During the transition, a legacy read adapter may normalize old product data into the canonical in-memory graph without persisting anything; permanent conversion happens only as part of an authorized explicit edit-and-save of that exact contract. Drafts follow the same rule: opening or viewing never writes migration data. A recovered draft may conservatively repair one stale compatibility field in memory only when independent evidence such as the seller-visible request, optimizer provenance, canonical geometry, and saved financial snapshots agree on one exact value and the stale field is the lone contradiction. The repair must be deterministic, retain evidence for technical diagnostics, and preserve the seller-visible row and exact financial total. A financially neutral repair proceeds without seller confirmation and its evidence remains technical rather than adding guidance to the product row. If the recalculated amount differs from the displayed saved amount by even one toman, or if evidence disagrees, is incomplete, or permits more than one interpretation, no value is guessed: only the affected product row is blocked and its exact field-level conflict is shown. Migration saves products, parent/child relationships, tools, finishing, layers, remainders, allocations, price snapshots, and totals as one atomic transaction, and an unexplained financial difference between the legacy and canonical result blocks the entire save. Stable identities are backfilled only where relationships are unambiguous; uncertain source, layer-parent, or operation-group relationships are reported for review rather than guessed. Before release, a repeatable dry run against a production-data copy reports migratable contracts, ambiguous records, financial differences, broken relationships, and missing rate/snapshot data, and a recoverable backup is mandatory. The transition is dual-read and new-schema-only-write. Historical contracts retain their exact saved financial and output meaning until explicit authorized edit.
_Avoid_: write-on-read migration, bulk mutation of finalized history, partial graph conversion, treating one stale compatibility field as authoritative over several agreeing facts, silently applying a repair that changes money, repairing ambiguous drafts, guessed parent/source/group links, reporting only a contract-wide error when one row is known, zero fallbacks for missing snapshots, accepting unexplained total drift, deploying without dry-run reconciliation and rollback backup, or continuing to write both legacy and canonical structures

**بازیابی بی‌وقفه پیش‌نویس قرارداد**:
The entire contract-creation flow, including the current step, central product-modal view, field values and display units, contractual titles, descriptions, operation groups, tools, finishing, manual overrides, stair layers, slab source rows, selected remainder/source candidates, and uncommitted product drafts, is protected by a recovery state separate from canonical contract data. Every meaningful interaction is journaled locally immediately and checkpointed durably to the server with short non-blocking coalescing. After refresh, renderer/browser crash, or reconnection in the same editing location, the exact latest valid draft is restored silently at the same step and internal view; a new location or application restart follows the canonical explicit resume/discard or takeover decision. Local recovery provides immediate same-location startup; the durable checkpoint covers loss of local process or device state. Recovery never commits a product, consumes a source, changes inventory, or mutates `wizardData.products`; those effects still occur only through the approved atomic save. A successful product/contract save clears only the recovery scope it supersedes, while an explicit cancel/discard clears the corresponding recovery state. Recovery is scoped by authenticated user, stable contract-draft identity, schema version, and base revision, and must never leak or apply state across contracts or users.
_Avoid_: modal-only recovery, debouncing that can lose the last typed value, treating recovery as a commercial save, replaying allocation side effects, restoring into another contract, showing a recovery wizard after ordinary refresh, losing the current subview or units, clearing unrelated drafts, or allowing stale recovery to overwrite a newer canonical revision

**اجاره ویرایش یکتای قرارداد**:
One contract has at most one active editing session. Refresh, crash, reconnection, and reopening the same session preserve its lease and immediately resume its recovery state; an explicit cancel or exit releases it. Opening that contract from another tab, process, or device is view-only and shows one flat `این قرارداد در محل دیگری در حال ویرایش است` message with the explicit `ادامه ویرایش در اینجا` action. `ایجاد قرارداد جدید` beside that action opens a completely blank, independent contract and transfers no customer, product, price, delivery, payment, modal, or recovery data from the locked contract; the locked contract remains unchanged. A takeover action is sufficient confirmation: it first obtains the latest recovery checkpoint valid for the same canonical revision and then atomically transfers ownership, preserves the current wizard step and scroll position, and reports `اختیار ویرایش به این صفحه منتقل شد`. The old session retains its visible local values but immediately loses save authority and reports `اختیار ویرایش این قرارداد به محل دیگری منتقل شده است` on its next protected action. Sessions are never field-by-field merged because graph allocations and pricing cannot be reconciled safely that way. Every mutation supplies the server-verified canonical `baseRevision`; a genuinely stale client reports `نسخه قرارداد تغییر کرده است؛ برای دریافت آخرین اطلاعات، قرارداد را دوباره بارگذاری کنید` and requires an explicit latest-version reload rather than silently replacing visible values. A successful contract create or edit releases its lease; cleanup failure is logged but never reverses or misreports the successful business commit. Any leftover lease from an older canonical revision expires on the next authorized edit acquisition, and its incompatible recovery is discarded. Temporary connectivity loss preserves the lease and local journal within the defined lease/reconnect policy. A finalized contract creates an editing lease only after an authorized user explicitly enters its edit flow.
_Avoid_: simultaneous writers, last-write-wins contract saves, silent cross-session merge, applying recovery across canonical revisions, letting an old session save after takeover, turning cleanup failure into a false save failure, losing a lease on brief network interruption, trusting a client-invented base revision, or acquiring an edit lease merely by viewing finalized history

**مرز تکمیل مرحله انتخاب محصولات**:
Step 5 is complete only when its canonical saved graph contains at least one valid top-level contract product. Structural stair layers and remaining-stone children do not qualify independently of their valid parent/source, and an open or recovered product draft does not count until its atomic add succeeds. An uncommitted recovery draft does not block navigation; it remains available for exact continuation when the seller returns. Advancing validates the saved graph rather than repricing every row from current inventory: valid historical snapshots remain valid, while actual graph failures such as orphan relationships, broken allocations, overconsumed remainder sources, inconsistent totals, or unresolved row-local decisions block progress. The first invalid row in stable creation order is focused and scrolled into view without an alert or large global error. An unavailable nonessential network section does not block progress when the saved graph is already complete. Returning within the same editing session restores Step 5 search, filter, row order, list scroll, and preserved product drafts.
_Avoid_: counting an unsaved modal draft as a contract product, requiring a child to masquerade as top-level content, discarding drafts on navigation, repricing valid snapshots merely to advance, blocking on unrelated network failures, reporting only a global error, or losing Step 5 working context on return

**دقت عددی و گردکردن قرارداد**:
Every numeric input accepts Persian, Arabic, and Latin digits plus their decimal marks; `,` and `٬` grouping separators are ignored during parsing. Geometry, quantities, and percentages preserve valid in-progress states such as a trailing decimal mark and normalize only without destroying the seller's intended value. Editable requested-length inputs in the longitudinal and contract-remainder product flows, and every monetary input across every product family, display live Latin three-digit grouping on the integer portion while typing (for example `12,500.75` or `1,000,000`) with stable caret behavior; their canonical draft and persisted value remain separator-free decimals. Requested length accepts positive multi-digit and decimal values without an artificial digit-count or precision limit. A temporary incomplete value may remain while editing, but atomic product save requires a value greater than zero. All canonical geometry, unit conversion, kerf, area, cutting, tool, and finishing calculations use decimal arithmetic rather than binary floating point and retain full intermediate precision. `cm / m` conversion is exact, including `0.3cm = 0.003m` and `1.25m = 125cm`. Display may remove insignificant trailing zeros, but display rounding never becomes a pricing input. Physical piece counts are positive integers wherever the domain means discrete pieces. Prices and rates are stored in toman. Each independent billable material, cut, tool, or finishing line is rounded once to the nearest toman after its final exact calculation; product total is the sum of those canonical rounded lines, and contract total is the sum of canonical saved product/service totals. Modal, Step 5, PDF, accounting, workshop-facing monetary output, and every other consumer render those same saved facts rather than recomputing formulas. Rounding mode and calculation-policy version are snapshotted for historical reproducibility.
_Avoid_: destroying valid intermediate text while applying grouping, moving the caret unpredictably, rejecting Persian/Arabic numerals, imposing an arbitrary requested-length digit or decimal limit, binary-float geometry, rounding converted dimensions or intermediate areas, pricing from displayed area, rounding the total through a second independent path, recomputing totals in output components, or applying a future rounding rule to finalized history

**موتور مشترک قطعی محاسبات محصول**:
One pure deterministic versioned domain engine owns product geometry, two-dimensional packing, allocations, remainders, cuts, tools, finishing, and pricing. Product families provide type-specific policy inputs instead of copying formulas into React components. The frontend runs the same engine for network-independent immediate preview, moving expensive packing into a worker so typing, scrolling, and modal animation remain responsive. On every add/save, the backend reruns the engine with the submitted seller decisions, exact snapshots, policy version, and `baseRevision`; client-supplied totals, layouts, and remainders are never authoritative by themselves. A canonical input/result hash is retained for audit and reproducibility. A revision, snapshot, engine-version, or result mismatch rejects the whole save without rewriting seller input and renders only the local `محاسبات نیاز به به‌روزرسانی دارد` state; after the correct engine version is available, the intact draft recalculates. PDF, accounting, workshop, delivery, and other downstream consumers render persisted canonical facts rather than maintaining independent calculators.
_Avoid_: formulas in UI components, divergent frontend/backend engines, blocking the UI thread with complex packing, trusting client totals, partial persistence after a mismatch, silently replacing seller decisions with a server result, unversioned calculation changes, or output-specific recomputation

**بودجه عملکرد مرحله انتخاب و تنظیم محصول**:
Performance is an acceptance constraint measured on representative sales-office hardware, internal-network conditions, and complex production-like contracts. Cached Step 5 renders within 200ms; local search reacts within 50ms; the central modal shell appears within 150ms and cached core facts become editable within 250ms. Simple dimension, area, and amount changes target the same frame and remain below 16ms. Typical two-dimensional packing completes in a worker within 150ms; very large layouts keep the UI responsive and target 500ms. Network work never blocks typing, unit conversion, or geometry editing. Recovery journals every semantic change immediately and server checkpointing remains non-blocking. A list of at least 200 rows including nested children retains smooth scrolling, correct focus, and keyboard navigation. Add/save pending state is row-local, normal internal-network save targets two seconds, and a slower request leaves the draft visible. Changing one row never refetches or recalculates the whole contract. If optimization exceeds its budget, only the exact calculation-summary region retains a size-stable skeleton while the rest of the modal remains usable. Automated performance tests include complex scenarios rather than only trivial rows.
_Avoid_: measuring only developer hardware or simple products, main-thread packing, network-coupled fields, whole-modal loading for a slow optimizer, full-list reconciliation, global pending state, losing the draft during a slow save, focus-breaking virtualization, or treating performance budgets as optional after release

**انتشار یکپارچه بازطراحی انتخاب محصول**:
The refactor is implemented and accepted end-to-end before any production seller receives it. The production unit includes the shared UI and design-system primitives, canonical calculation engine, legacy migration/read path, crash recovery and edit lease, every supported product family, tools, finishing, remainders, stair parts and layers, slab behavior, prepared-product compatibility, persistence, PDF, accounting, workshop, delivery, and the complete automated/manual test suite. Dry runs and shadow comparisons occur only in controlled test environments or against a read-only production-data copy, never as a partially available seller workflow. After full acceptance and a recoverable backup, one coordinated cutover enables the new editor for every user; there is no seller-by-seller feature flag and no old editor remains available. Legacy contracts continue through the read adapter and migrate only on explicit authorized save. Canonical data is never downgraded. A critical post-cutover issue may place affected editing flows temporarily into read-only mode until a corrected release is deployed; rollback to any application version unable to read the canonical schema is prohibited.
_Avoid_: partial production implementation, family-by-family availability, separate seller cohorts, leaving the old editor as an alternate writer, downgrading canonical graphs, rolling back to schema-incompatible code, skipping the backup because migration is lazy, or treating downstream output work as post-release follow-up

**ممیزی تغییرات گراف محصولات قرارداد**:
Commercial audit history records only successful canonical commits, never keystrokes, previews, recovery checkpoints, cancelled drafts, or failed attempts. Each event identifies actor, timestamp, contract and revision, mutation kind, all affected stable product/parent/child/layer/source/allocation/operation-group identities, financial totals before and after, source-consumption and remainder changes, calculation and rounding policy versions, canonical input/result hashes, and whether legacy migration occurred. An atomic graph mutation emits one parent audit event with its nested affected entities instead of misleading independent events. Deleted rows retain immutable audit snapshots even after leaving the active graph. Failed saves and recovery/edit-lease activity belong only to technical or security diagnostics. The product modal gains no persistent audit chrome; authorized users inspect history through the existing contract-history surface. Historical audit facts are rendered from their saved snapshots and are never recalculated by newer engine versions.
_Avoid_: auditing transient typing as commercial change, losing deleted-row evidence, fragmenting one transaction into unrelated audit events, mixing failed attempts with committed history, cluttering the seller modal, omitting source or financial deltas, or recalculating historical events

**ماتریس پذیرش انتشار گراف محصول**:
Production cutover is blocked until the complete acceptance matrix passes. Golden tests use anonymized real contracts across longitudinal, stair, slab, prepared, remaining-child, and layered products and reconcile exact monetary truth across modal, Step 5, persistence, PDF, accounting, workshop, delivery, logistics, confirmation, and final totals. Property-based packing tests prove exact demand, no overproduction or rotation, minimum source use, preservation of every positive remainder, no overconsumption, and deterministic layouts/identities. Calculation coverage includes units, decimal parsing, kerf, calibration, mandatory pricing, cuts, tools, finishing, operation groups, overrides, and rounding. Failure injection proves atomic graph/source mutations; migration covers valid, ambiguous, missing-rate, historical-nosing, and untouched-finalized cases; crash recovery covers every meaningful nested-draft interaction; edit-lease takeover and prepared-product behavioral/payload parity are verified. Accessibility, keyboard focus, inline validation, reduced motion, Persian RTL visual regression, and approved performance budgets are tested on representative hardware and contracts of at least 200 visible/nested rows. The production-data dry run must show zero unexplained financial differences, zero guessed relationships, explicit reporting of every ambiguity, and no orphan graph entity. Experienced sellers execute real paper-contract scenarios and compare completion speed. Any open critical correctness, data-loss, pricing, allocation, migration, or downstream-output defect blocks release.
_Avoid_: treating unit tests alone as acceptance, using only synthetic/simple rows, overlooking downstream projections, approving unexplained financial drift, skipping failure injection or recovery tests, accepting prepared-product payload changes, ignoring real seller speed, or cutting over with a critical defect

**ساخت تدریجی داخلی با انتشار یکپارچه**:
Engineering proceeds through small reviewable dependency-ordered modules and commits while production remains on the current editor. The sequence establishes canonical schema and identities; decimal invariants and the deterministic engine; atomic persistence, revisions, audit, and legacy reading; recovery and edit leasing; shared design-system and modal state machinery; longitudinal behavior; shared operation groups/tools/finishing; remaining-stone allocation; stair parts and layers; slab behavior; prepared-product UI parity; flat Step 5 selection and saved rows; all downstream projections; and finally migration, performance, seller acceptance, and cutover preparation. Obsolete components and duplicated calculators are removed only after parity and caller migration are proven. Internal incremental construction never implies partial production availability: the complete accepted system is released in one coordinated cutover.
_Avoid_: equating one production release with one giant component or commit, deleting the old path before parity, landing unreviewable cross-layer changes, exposing internal construction stages to sellers, postponing downstream consumers, or allowing temporary duplicate calculators to become permanent

**سیاست قیمت‌گذاری برش اسلب**:
Slab retains two real cutting-charge policies through one always-visible compact `خطوط برش | مترمربع` segmented selector, defaulting new rows to line pricing and preserving saved edit state. Changing policy recalculates only the monetary cutting charge; requested dimensions, quantity, source slabs, deterministic packing, physical cut rows, and remainders remain identical. `خطوط برش` charges the actual two-dimensional longitudinal/cross plan with the applicable rate snapshots. `مترمربع` charges finished requested area with its square-meter cutting rate. Workshop output always retains the physical cut plan even when customer pricing uses area. The selected policy and applicable rates are snapshotted, with no large cards, icons, explanatory blocks, confirmation, or historical rewrite.
_Avoid_: removing either commercial method, letting a pricing-policy switch mutate geometry or inventory, hiding physical cuts from workshop in area mode, defaulting edit back to line pricing, rendering large pricing cards, or recomputing finalized rows from a new default

**حذف موقت CAD اسلب**:
The slab contract-configuration flow currently has no CAD action, expandable designer, lazy CAD state, manual layout override, or CAD snapshot. The canonical deterministic packing engine is the sole slab layout authority. Shared CAD infrastructure used elsewhere is not coupled to or deleted merely for this removal, leaving a clean future reintroduction seam.
_Avoid_: leaving a hidden or disabled slab CAD control, retaining dead slab CAD draft state, allowing old CAD callbacks to mutate dimensions/cost, deleting unrelated shared CAD capabilities, or designing the canonical slab engine around a future optional CAD dependency

**مرز بازطراحی محصول آماده**:
Prepared products keep their current working subtype inference/override, allowed-unit rules, defaults, quantity/price behavior, calculations, validation, persistence, edit semantics, save payload, and downstream meaning unchanged. Their UI-only refactor removes the large green card, decorative header, icons, and explanatory copy; reuses the common compact catalog fact line and editable contractual title; renders existing subtype and allowed-unit choices through the shared compact segmented control; places مقدار and قیمت واحد in one compact row; uses the shared one-to-four-line description textarea; and moves total into the flat calculation summary as `جمع — مقدار × قیمت واحد = مبلغ`. Every existing field/capability remains visible without placeholder, icon, help card, nested panel, or disabled informational input. Shared skeleton, pending-button, transition, and reduced-motion primitives apply. Regression tests must prove calculations and saved payload are behaviorally identical.
_Avoid_: treating the broader product-configuration refactor as permission to redesign prepared-product behavior, adding explicit catalog subtype/unit migrations, changing defaults or validation, altering saved shape or downstream semantics, removing a working choice under the label of minimalism, or accepting the UI refactor without parity tests

**نرخ دستی برش مترمربعی اسلب**:
The slab `مترمربع` cutting policy is an intentional sales-priced exception: its per-square-meter cutting rate is entered manually on the contract draft rather than read from inventory. New slabs default to line pricing and therefore render no area-rate field. Switching to area pricing reveals one compact blank input with no placeholder or suggestion. The rate must be strictly positive; blank, zero, or negative blocks only that field on add/save, focuses it, and shows `نرخ برش را وارد کنید` without a modal or global error. Switching temporarily to line pricing preserves the draft value without charging it; switching back restores it. Edit and explicit duplication preserve/copy the saved rate, while changing catalog slab clears it. Amount is finished requested area × manual rate and never changes physical cuts or workshop instructions. The snapshot affects only that slab row and never mutates inventory. Longitudinal and cross line rates remain inventory-owned.
_Avoid_: removing the fast manual slab-area cutting price, showing it in line mode, accepting a non-positive rate, seeding it from inventory, losing it during a temporary mode switch, carrying it to a different catalog slab, writing it back to inventory, applying it to line-mode cuts, or treating it as the policy for other automatic cutting categories

**اسلب‌های منبع دستی**:
Until real per-slab inventory exists, sales explicitly defines quote-time source batches in a compact flat `اسلب‌های منبع` section. `افزودن منبع` opens one inline no-placeholder row for positive length, width, and quantity, using the shared independent `cm/m` switches. Saved rows render compactly such as `۳m × ۲m · ۲ عدد · حذف`, each with stable draft identity and snapshotted display units. Invalid values remain untouched and validate only beneath their exact field. Packing may consume only these explicitly entered quantities, in stable creation order when candidates are otherwise equivalent; it never invents sources, increases quantity, or silently merges identical dimensions. Edit restores exact rows. Catalog dimensions may appear as product facts but never create or overwrite source batches. These rows are source snapshots, not a false claim of live inventory reservation, and may later be replaced by stable physical inventory IDs.
_Avoid_: retaining large source cards/status tables, using placeholders, treating catalog dimensions as actual source stock, auto-populating or increasing source quantities, merging same-size rows, identifying rows by array position, losing units on edit, or presenting manual quote batches as live warehouse inventory

**ظرفیت منبع و تعداد خروجی اسلب**:
Requested slab output is finished length, finished width, and requested piece quantity. Manual source-batch quantity is available quote-time source capacity and never needs to equal output quantity. Deterministic packing consumes the minimum subset, while complete unused source pieces remain unconsumed and are reported separately—not converted into contract remainders or charged material. Only positive rectangles left from consumed sources become reusable paid remainders. For four `1m × 1m` outputs and two `2m × 2m` sources, one source may be consumed and one remain wholly unused. Insufficient entered capacity preserves the requested output, invents nothing, shows only local shortage, and blocks the still-clickable save. The current equal-source-count/output-count validation and colored sufficient/extra cards are removed. Stable source-row identity and creation-order ties make edit/replay select the same consumed subset.
_Avoid_: equating source count with output count, consuming every entered source, turning untouched sources into paid remainders, inventing capacity, changing requested demand to fit sources, or choosing a different equivalent source subset during replay

**ورودی تقاضای اسلب**:
A valid slab request resolves finished length, finished width, and a positive integer requested quantity. Sales may enter length + width + quantity, length + square meters + quantity to derive width, or width + square meters + quantity to derive length; area alone and quantity alone are insufficient. With all values present, the last manually edited field is authoritative: length/width edits recalculate area, while an area edit recalculates the dimension not edited most recently. Calculated values render directly in ordinary editable fields without badge, lock, color, or explanation. Length, width, area, and quantity start blank with no placeholders; dimensions use shared compact snapshotted unit switches. Non-positive values are invalid. Incomplete add/save preserves input, focuses the first unresolved field, and shows only `ابعاد و تعداد را کامل کنید` beneath the dimension row. Source packing waits for complete geometry, and source shortage remains a separate validation state.
_Avoid_: accepting area without a resolvable rectangle, defaulting quantity, treating quantity alone as demand, hiding calculated values in read-only controls, adding calculation badges, overwriting the last seller-edited field, starting packing from incomplete geometry, or conflating missing dimensions with insufficient sources

**برش مستقل لایه پله**:
The physical and billable cutting plan owned by a stair layer row. It records actual longitudinal saw passes that create layer strips and cross cuts that shorten them from source length to finished edge-piece length, uses the applicable cutting catalog rates, and keeps saw kerf as source-consumption geometry rather than a separate service; layer cuts remain separate from parent cuts and ابزار.
_Avoid_: returning zero or empty cutting details for physically cut layers, copying parent cutting totals, storing automatic layer cuts as ابزار, charging saw kerf as a service, or printing one cut in more than one category

**ابزار و پرداخت مستقل لایه پله**:
Tooling and stone finishing selected specifically for a stair layer row and calculated from that layer's finished physical pieces. A new layer starts without parent add-ons; copying selections from the parent stair row is an explicit user action and creates independently editable layer selections. Each layer ابزار or پرداخت explicitly targets one or more existing layer sides, such as جلو or چپ. ابزار meterage includes only targeted physical pieces; پرداخت quantity follows its catalog unit using the targeted finished geometry: area for متر مربع, length for متر طول, or physical-piece count for تعداد. A layer may carry multiple cumulative پرداخت selections, each with independent targets, quantity, unit price, and total; catalog-defined incompatibility prevents combinations that cannot coexist.
_Avoid_: automatically inheriting parent ابزار or پرداخت, charging layer add-ons from full source-stone area, keeping copied add-ons linked to later parent changes, applying an add-on to untargeted layer sides, ignoring the پرداخت catalog unit, or collapsing cumulative processing into one finishing field

**پرداخت‌های چندگانه محصول قرارداد**:
A shared inline collection of independently priced stone-finishing selections available to طولی, main پله, لایه پله, اسلب, and remaining-stone child rows. `افزودن پرداخت` opens catalog search inside the same section without a modal or page; its catalog loads only when opened and uses stable row-sized skeletons. Multiple cumulative selections and repeated occurrences of the same catalog finishing are allowed, each with stable independent identity, applicable scope, calculation unit, automatic quantity, optional explicit override, non-editable inventory-rate snapshot, amount, and draft-only remove action. The compact row renders `نام | محدوده اجرا | مقدار | واحد | نرخ | مبلغ | حذف`. Repeated selections are never silently merged. Draft changes mutate no saved product before atomic product save, and a missing/inactive historical catalog item remains visible from its snapshot with `خارج از کاتالوگ فعلی`.
No stone finishing has an edge selector; edges belong only to length-based tools. Finishing scope is solely an operation group or an exact subset split from one. A متر طول finishing uses `per-piece length × covered group piece count` in quantity mode or the group's aggregate linear length without quantity. A متر مربع finishing uses `finished length × finished width × covered group piece count` or `group length × finished width` without quantity. Its inventory-owned unit is display-only and never seller-selectable. Non-overridden quantities render as plain text with a compact `تغییر مقدار` action rather than a permanent input. Activating it edits a strictly positive value inline while retaining `محاسبه: …`; zero or negative is invalid because a free operation is represented by a zero inventory rate, while an unwanted operation is removed. The explicit quantity override is snapshotted and drives amount against the non-editable rate. A later geometry or group-scope change never silently replaces it: the row shows the new automatic comparison and blocks atomic product save until the seller explicitly chooses `حفظ مقدار دستی` or `استفاده از محاسبه`. Replacing the finishing creates a new selection without the previous override. Summaries and workshop output show finishing group and quantity rather than edges.
Legacy rows with one finishing are read as a one-entry collection without rewriting saved data; finalized historical contracts change shape only through an authorized explicit edit and save while retaining financially identical pre-save outputs. کیوبیک and قطعات آماده remain outside this processing workflow.
_Avoid_: asking for finishing edges, multiplying finishing quantity by side count, showing a permanent quantity input for normal automatic values, accepting a non-positive quantity override, using zero quantity to mean a free operation, implementing a different finishing shape for each supported product family, opening a nested finishing modal, eagerly loading its catalog with the entire product form, replacing cumulative operations with one finishing field, deduplicating repeated selections, editing an inventory-owned unit or rate in the contract, mutating the saved row before atomic product save, dropping missing-catalog snapshots, calculating a remaining-stone child's finishing from its parent, enabling cutting-workflow finishing on کیوبیک and قطعات آماده, silently replacing an explicit override, allowing a stale override through final save without confirmation, carrying an override to a different catalog item, silently migrating stored contracts, or changing historical totals merely by opening or printing a contract

**سازگاری پرداخت‌های محصول قرارداد**:
All stone-finishing combinations are compatible by default. Only an explicit inventory/catalog incompatibility rule may prevent two finishings from coexisting, and that rule is evaluated only within the same operation group; the same pair may validly exist in different groups. No incompatibility is inferred from names. Search keeps every result visible. Selecting a conflicting finishing preserves the seller's selection and all prior values, shows only the inline row message `این پرداخت با … در همین گروه سازگار نیست`, and blocks atomic product save until the seller removes one finishing or moves its scope to another group; no alert, modal, or silent mutation occurs. A later catalog-rule change never rewrites finalized history. An explicitly edited historical contract exposes any current same-group conflict and requires resolution before save.
_Avoid_: treating compatibility as opt-in, inferring incompatibility from names, applying a rule across different operation groups, hiding incompatible search results, deleting or moving an operation automatically, hard-coding different compatibility rules in each product UI, rewriting finalized historical processing after a catalog change, or saving an explicitly edited row with an unresolved current conflict

**ترتیب نمایش پرداخت‌های سنگ**:
Stone-finishing order has no pricing or workshop execution meaning. Selections retain a deterministic stable display order, normally their selection order, without inventory execution-priority fields, drag-and-drop, sequence numbers, seller controls, or workflow snapshots that imply a technical process.
_Avoid_: spending catalog or contract complexity on finishing execution stages, presenting selection order as a production instruction, or allowing incidental collection reordering to make output unstable

**مقدار دستی ابزار محصول قرارداد**:
An explicit user quantity that replaces geometry-derived ابزار meterage for طولی, main پله, لایه پله, اسلب, or a remaining-stone child. The normal compact tool row shows the automatic quantity as plain text and exposes a short `تغییر مقدار` action instead of a permanent input. Activating it edits the value inline while keeping `محاسبه: …` visible. The override is snapshotted with the tool and drives its amount. After relevant geometry or edge changes, the override is never silently replaced: the row shows the new automatic comparison and requires an explicit `حفظ مقدار دستی` or `استفاده از محاسبه` decision before the atomic product save can continue. Replacing the catalog tool clears the old override instead of transferring it.
_Avoid_: showing a permanent quantity input in every normal tool row, silently recalculating an explicit tool override, accepting it after geometry changes without renewed confirmation, transferring it to another tool, or interrupting resolution with an alert or nested modal

**نرخ قراردادی ابزار**:
Selecting an ابزار or پرداخت سنگ copies its current inventory/catalog rate into the product draft as a non-editable contract snapshot. The seller may change the operation, target edges or group, coverage, and an allowed final-quantity override, but never its rate. The compact row renders rate as plain text rather than an input or disabled control, and amount recalculates immediately from final operation quantity × snapshotted inventory rate. Reopening an existing contract preserves its saved rate despite later catalog changes; explicitly duplicating a remaining-stone child copies its stored operation-rate snapshots, while removing and reselecting an operation starts from that catalog item's current rate and carries nothing from the removed selection. A catalog-owned zero rate is valid: it keeps the physical operation, targets, coverage, and workshop/accounting visibility while making only its monetary amount zero, without warning or confirmation. Tool and finishing selections share this pricing-snapshot policy.
_Avoid_: allowing a seller to edit an operation rate, rendering a non-editable rate as a disabled input, repricing a saved operation from the live catalog, mutating the catalog from contract entry, transferring a rate between different catalog selections, treating zero as deletion or absence of physical work, dropping zero-rated operations from summaries or outputs, or implementing different rate policies for tools and stone finishing

**ویرایش ردیف سنگ پله**:
Editing from the contract list opens the clicked stair product row as an individual row edit, preserving its exact stair part type and details without loading sibling rows from the same stair system.
_Avoid_: opening کف پله when the clicked row is خیز پله, or rebuilding every row that shares the same stairSystemId when the user edits one row

**پیش‌نویس چندبخشی سنگ پله**:
New stair entry retains the fast ability to configure one or more of کف پله، خیز پله، and پاگرد in one central product modal. The three large activation cards and accordions are replaced by a compact multi-select segment `کف پله | خیز | پاگرد`; it makes no guessed default selection, preserves the current draft's choices during navigation, and renders every selected part simultaneously as a flat always-visible section in the fixed کف، خیز، پاگرد order. One `افزودن بخش‌های پله` commit creates stable independent contract rows linked by their shared stair-system identity. Geometry, price, tools, finishing, cuts, and description remain independently owned by each part. Validation or persistence failure in any selected part rejects the complete atomic batch; no partial rows are added. Editing an existing stair row still opens only that exact part and does not load or rewrite its siblings.
_Avoid_: forcing a seller through three separate add flows for one stair system, rendering large nested cards or accordions, guessing a selected stair part, hiding information for selected parts, storing one combined commercial row, partially committing a multi-part draft, or loading siblings during single-row edit

**اشتراک و کپی میان بخش‌های سنگ پله**:
Within a multi-part stair draft, only the stable stair-system identity and explicit system-level quantity inputs are intrinsically shared. Every کف پله، خیز, or پاگرد row independently owns its catalog stone identity and immutable catalog snapshot as well as its contractual title, dimensions, display units, quantity, square meters, base price, حکمی state, saw kerf, calibration, operation groups, tools, stone finishings, cuts, and description. Rows in one stair system may therefore use different inventory products, such as a 35 cm tread stone and a 40 cm riser stone, whether they were added together, added one by one, duplicated, edited, restored, or migrated. No later change propagates between siblings. خیز and پاگرد expose an optional compact `کپی از کف پله` action that copies editable values once into their drafts without creating a live link. Copied tools and finishings receive new stable selection identities, retain their inventory-rate snapshots, and recalculate quantities against the destination geometry. The destination keeps its own part-appropriate generated title and does not copy the source description. Existing destination data is never overwritten without an explicit seller action.
_Avoid_: making a stair system own one catalog product or snapshot, requiring sibling rows to share catalog identity, sharing mutable commercial state between siblings, propagating later tread edits, copying row or operation identities, reusing source operation quantities against destination geometry, copying the tread title or description by default, or silently overwriting a populated destination section

**مبنای تعداد سیستم راه‌پله**:
A new multi-part stair draft defaults to a compact `تعداد پله | پله‌کان کامل` segmented control with `تعداد پله` selected. The first mode asks only for total step count. The complete-staircase mode asks for staircase count and steps per staircase and renders their product as plain `جمع: … پله`. These values belong to the shared stair-system draft rather than serving as commercial row identity. The resulting total initializes کف پله and خیز quantities and continues to synchronize only while each target remains untouched; the first manual quantity edit makes that part independent and later system-total changes never silently overwrite it. پاگرد always owns an independent quantity and receives no step-count default. Editing one saved stair row hides the shared system-count controls and exposes only that row's preserved quantity snapshot, so siblings remain untouched.
_Avoid_: removing complete-staircase entry, showing a large quantity-type card, multiplying or identifying rows by system totals, overwriting manually edited part quantities, deriving landing count from step count, or exposing shared-system controls during single-row edit

**هندسه مستقل بخش‌های سنگ پله**:
Each stair part owns two independent finished dimensions: کف پله owns طول and عمق, خیز owns طول and ارتفاع, and پاگرد owns طول and عرض. No riser calculation reads live tread state. When a valid tread length already exists and خیز is newly selected in the same multi-part draft, that length may initialize the riser once; it is immediately independent, never follows later tread edits, and can be copied again only through the explicit `کپی از کف پله` action. A riser selected without a tread starts with blank length. Finished area is row-local: `طول × عمق × تعداد` for tread, `طول × ارتفاع × تعداد` for riser, and `طول × عرض × تعداد` for landing. Tools, finishing, cuts, consumption, and remainder calculations use only that row's geometry. A legacy riser lacking an explicit independent length is migrated from its saved/historically used calculation length, never linked to current sibling state.
_Avoid_: deriving riser length from live tread state, propagating later tread changes, leaving riser length implicit, calculating one part from another part's dimensions, sharing geometry-dependent add-on totals, or migrating legacy rows by reading a mutable sibling value

**چیدمان سنگ مادر برای بخش‌های پله**:
کف پله، خیز, and پاگرد use the same canonical source-packing and remainder engine as longitudinal products through part-specific geometry policies, never copied component formulas. Finished طول is the piece run for every part; the source-width demand is tread عمق, riser ارتفاع, or landing عرض. Part quantity is the exact requested finished-piece count. The engine consumes the minimum required source pieces, never overproduces to fill a source width, and persists every physically positive remainder with stable identity owned by that exact part row. Saw kerf remains a manual independent setting per part. A requested cross-dimension below mother width creates automatic longitudinal cutting; equality creates no longitudinal cut; a larger value is preserved, blocks save at that field, and shows only its short maximum-width message.
Calibration follows actual packing independently per part: a real longitudinal cut with no positive width remainder may default it on; any positive remainder defaults it off; full-width/no-cut keeps it off and disabled; after seller intervention automation never overwrites it. Tools and finishing derive from finished-piece geometry, while material consumption, cuts, and remainders derive from source packing. Each part's flat summary shows its own request, source consumption, cuts, and remainders. For example mother width `40cm`, riser height `17cm`, quantity `5`, and zero kerf consumes three source pieces, produces exactly five risers, and persists the third piece's positive remainder without producing a sixth riser.
_Avoid_: implementing separate stair packing formulas, producing extra stair pieces to fill mother width, discarding a positive remainder, sharing kerf or calibration state between parts, pricing tools from source geometry, deriving source cuts from finished-area shortcuts, or identifying remainders by stair type or array position

**طول مادر دستی بخش پله**:
Each tread, riser, and landing independently owns a seller-editable source length positioned immediately after that section's finished length. It starts empty, has its own compact `cm / m` display unit, and is snapshotted with that exact section. When the seller leaves it empty but enters a valid finished length, the section records `derived-from-finished` intent together with the effective mother length and calculation-policy version. The field remains visually empty during the draft and on later edits, while changing finished length immediately changes effective mother length. This derived mode creates neither a cross cut nor a longitudinal remainder because effective mother length equals finished length. Entering a manual value switches the section to `explicit` mode; subsequent finished-length changes never overwrite it. Clearing that explicit value returns to derived mode. An explicit mother length may be greater than or equal to the finished length. A greater value establishes the source-material length used for two-dimensional packing, material pricing, cross cutting, and positive longitudinal remainders. A smaller value remains visible, blocks only that section's save, and shows `طول مادر باید حداقل برابر طول نهایی باشد`. `کپی از کف پله` may copy the value and unit once into a destination section, after which the two values are independent. The calculation summary shows effective source dimensions without adding a badge or explanation beside the input.
_Avoid_: requiring catalog mother length for stair configuration, injecting the derived effective value into the empty seller field, losing the seller's derived-versus-explicit intent on edit, sharing one live mother length across tread/riser/landing, silently changing an explicit seller value, or adding a cross cut when mother length was omitted and therefore equals finished length.

**مساحت ماده پرداخت‌شده بخش پله**:
The material basis for each tread, riser, and landing is the exact area of the minimum number of mother stones consumed by its deterministic two-dimensional packing plan, not merely the finished requested area. The section's manual per-square-meter stone price multiplies this consumed mother area. Every positive unused rectangle from a consumed mother stone remains paid reusable material, while tools, stone finishing, cutting, and mandatory pricing remain separate charge lines. When manual mother length is omitted, effective mother length equals finished length; mother width still comes from the selected catalog stone, so positive unused width remains paid material and becomes reusable remainder.
_Avoid_: charging only finished area when wider or longer mother material was consumed, charging an unconsumed mother stone, discarding a positive paid remainder, or mixing operation charges into the material-area line.

**استفاده از محصول طولی در مسیر پله**:
The stair catalog filter is the identity-deduplicated union of products explicitly enabled for stairs and every longitudinal catalog product. Selecting a longitudinal catalog identity through the longitudinal filter creates a longitudinal contract draft; selecting that same identity through the stair filter creates a stair-system draft with tread, riser, and landing sections. The selected route supplies contractual meaning without cloning or changing the inventory record. Catalog material, mother width, thickness, and other fixed stone facts remain shared, while every stair section uses its independent manual mother length. Search ranking and seller-personalized ordering preserve this route-specific meaning.
_Avoid_: duplicating inventory rows, showing one catalog identity twice in the stair results, opening longitudinal configuration from the stair route, inferring contract type from the edited contractual title, or removing the product from its normal longitudinal route.

**عملیات نوارهای فیزیکی لایه پله**:
Each stair-layer configuration independently owns its tools and stone-finishing selections over the physical strips of its selected sides. An operation may cover all strips, one selected side, or an explicit subset count from one side. Stable operation groups are side-specific because front, back, left, and right strips can have different physical lengths. The common `all strips` path remains one compact seller-facing operation row with one stable parent identity, while canonical data creates a stable child scope for every selected side. Adding, editing, or deleting in `all strips` is an explicit bulk overwrite across every currently active side, including sides previously customized. A side-specific edit detaches only that side and leaves every other side unchanged. When active sides differ, the all-strips view shows only semantically identical operations shared by every active side and exposes the state as `عملیات نوارها یکسان نیست`; it never presents one arbitrary side as the state of all sides. The row shows a compact per-side quantity breakdown and a total; its final amount is the sum of independently auditable side amounts under one snapshotted rate. Editing or deleting the parent selection atomically affects its child scopes. Customizing one side detaches that scope into an independent visible operation without mutating the other sides. Linear-tool edge selection initially applies to all child scopes and may later diverge through the same side-detachment behavior. Square-meter operations and all finishing use the same parent/child scope model without edges. Linear tools use actual strip length multiplied by covered strip count. Square-meter tools and finishing use actual strip length multiplied by layer width and covered strip count. Linear finishing uses actual strip length and has no edge selector. Multiple tools and finishing operations may coexist on one strip; an uncovered strip is a valid no-operation group shown only in the calculation summary and workshop projection. Inventory operation rates are snapshotted independently from the layer type's inventory-owned price snapshot. Geometry or source changes recalculate automatic quantities without deleting operation, group, or edge intent; stale manual overrides use the shared inline conflict-resolution flow.
_Avoid_: showing one normal row per side before the seller asks for side-specific behavior, sharing layer operations with the stair parent or sibling layers, calculating physical operations from commercial layer-set count, averaging or collapsing sides with different strip lengths into one ambiguous quantity, adding edge selection to finishing, or silently discarding selections after geometry changes.

**کاتالوگ خدمات مستقل قرارداد**:
The standalone-service catalog is browsable without requiring a search term. Focusing its search field opens the complete active category. Explicitly choosing `پرداخت`, `ابزار`, or `برش` clears the previous category's query, opens the complete newly selected category, and keeps search focus. After a service is added, the catalog remains open, its query clears, and search focus is restored for rapid consecutive additions; the category changes only through an explicit category choice.
_Avoid_: hiding catalog rows behind a non-empty query, carrying a query across service categories, closing the catalog after each addition, moving focus away from search, or changing category as a side effect of selection

**حذف سمت دارای عملیات لایه**:
Removing a side from an `all strips` operation removes only that automatically derived child scope and immediately recalculates the shared row, because its seller intent continues to mean all currently existing strips. A side with dedicated operations, a manual quantity override, or divergent edge selection cannot be discarded implicitly. The layer draft retains its data and shows an inline conflict naming the side and affected operations. The seller must either restore the side or explicitly choose `حذف سمت و عملیات آن`; save remains blocked until resolution. Restoring the side before save restores its retained configuration. Explicit removal deletes only that side scope and its owned snapshots. Resolution stays inside the draft and is committed atomically with the stair parent and layers.
_Avoid_: treating a derived all-strips child scope like a dedicated seller decision, silently deleting dedicated side operations, mutating unaffected sides, opening a confirmation modal, or partially persisting the side change before the parent transaction succeeds.

**سازگاری تاریخی پله و لایه**:
Legacy stair rows are adapted in memory without automatic persistence. A stair part without saved manual mother length is read as `derived-from-finished`: its historical finished length becomes effective mother length while the seller-facing field stays empty, and the stair flow never requires catalog mother length or a fixed fallback. A legacy layer without tools or finishing remains genuinely empty; no operation or amount is invented. A historical operation is mapped to a canonical side scope only when its ownership, side, rate, and parent relation are certain, preserving its financial snapshot. Ambiguity produces an inline migration conflict rather than a guessed relationship. Permanent migration occurs only during an authorized explicit edit and save, creates stable identities, and atomically writes the parent, layers, sources, operations, cuts, remainders, and pricing. Pre/post financial totals must match unless an intentional reviewed change explains the difference. Read-only finalized contracts remain historically unchanged; after successful migration only canonical data is written and reload must equal the committed graph.
_Avoid_: migrating on read, showing the catalog mother-length error for stair parts, inventing empty legacy operations, matching historical relations by name or array index, partially migrating a graph, or rewriting finalized contracts merely because they were viewed.

_Avoid_: assuming every source is three meters, exposing source length as a seller input or disabled control, interpreting finished length as source length, calculating cross cuts without a real source length, mutating an overlong seller value, repricing historical rows from current inventory dimensions, or replacing remainder geometry with catalog defaults

**چیدمان دوبعدی قطعات پله**:
Stair source packing is a deterministic two-dimensional rectangular layout over both mother width and source length. It minimizes the number of source stones, may fit multiple finished parts across width and along length, includes enabled saw kerf in every real longitudinal and cross cut, never auto-rotates a part by 90 degrees, and produces exactly the requested quantity rather than filling unused cells with unrequested output. For example `3m × 40cm` source and four `1.2m × 20cm` treads with zero kerf packs `۲ در عرض × ۲ در طول` into one source and persists the positive `0.6m × 40cm` longitudinal remainder. With only three requested pieces, the fourth cell remains unused material represented by real positive stable-identity remainder rectangles, not an produced tread. Cut meterage derives from the actual cut lines of the chosen layout, not an approximate formula. The same engine and stable fill order serve catalog sources, remaining-stone children, edit replay, and allocation rebuild; the flat summary exposes the width × length packing count.
_Avoid_: packing only across width, overproducing to fill a grid, discarding partially unused cells, rotating parts implicitly, ignoring kerf in capacity, estimating cut length from requested area, choosing a different layout during replay, or implementing a separate remaining-stone packing engine

**اولویت‌های بهینه‌ساز چیدمان سنگ**:
The shared packing engine uses one invisible, versioned, deterministic lexicographic policy: first satisfy the exact requested output with no over/underproduction and no 90-degree rotation; then minimize consumed mother-stone count; among equal-source layouts minimize total real ordinary longitudinal and cross cut meterage; among equal-cut layouts minimize the number of positive remainder rectangles and then preserve the largest rectangle; finally break ties from one fixed origin, filling width before length with deterministic remainder identity/order. Calibration is priced after geometry selection and never distorts layout choice. Sales sees no optimization-mode control or rejected alternatives, only the selected result. Cut pricing, edit recalculation, remainder allocation replay, and reload use that same result. The policy version is snapshotted for explanation and finalized history is never recomputed merely because a future algorithm changes.
_Avoid_: optimizing area while missing exact quantity, prioritizing cut cost over mother-stone count, letting calibration change material layout, creating extra fragments when an equivalent cleaner layout exists, exposing optimizer choices to sales, using nondeterministic search order, or silently applying a new policy version to finalized contracts

**خوراک اره دوبعدی**:
Each stair part retains one manual saw-kerf switch with a non-seller-editable technical value of `۰٫۳cm`. When enabled, that kerf participates in capacity and remainder geometry for every actual longitudinal width cut and every actual cross-length cut. Full mother width does not disable the switch when a cross cut still exists, and full source length does not disable it when a longitudinal cut exists; it remains visible but disabled only when neither axis needs any physical cut. Turning kerf off calculates zero blade-width loss without removing the physical cut rows or their charges. Enabled state and the `۰٫۳cm` technical value are snapshotted per part so a future system-standard change cannot rewrite saved geometry. The compact summary reports only results and exposes no kerf-value input.
_Avoid_: applying kerf only across width, auto-disabling it for a full-width part that still needs cross cuts, deleting cut operations when kerf is off, letting sales edit blade width, reading a new global kerf into saved rows, or rendering a separate technical-value field

**پیش‌فرض کالیبر در چیدمان دوبعدی**:
Calibration remains one seller-controlled switch per stair part and concerns only real longitudinal width cutting. Full mother width keeps it off and disabled even when cross cuts exist. With a narrower finished cross-dimension, automation may default it on only when the actual two-dimensional packing creates no positive width remainder in any consumed region; any positive width remainder anywhere defaults it off. A purely longitudinal remainder never changes that recommendation. Saw kerf participates in deciding whether width is fully consumed. After the seller first changes calibration, no later length, width, quantity, or kerf change overwrites the choice, and edit always preserves the saved snapshot.
_Avoid_: disabling calibration because of a length-only remainder, enabling it when any width remainder exists, treating cross cuts as calibration eligibility, applying a separate switch per source or grid cell, ignoring kerf in full-width consumption, or overwriting seller/saved state after geometry changes

**نرخ برش کالیبر**:
Calibration keeps independent meterage and amount in the cut breakdown but uses the same non-editable inventory-rate snapshot as ordinary longitudinal cutting. Cross cutting uses its own semantic inventory role. Cut-rate lookup uses stable role identities such as `LONGITUDINAL` and `CROSS`, never localized display-name matching. The system automatically derives each direction's meterage from physical geometry and prices it only with that direction's registered rate; for example, `15m` of longitudinal cutting is `15m × LONG`, while `4m` of cross cutting is independently `4m × CROSS`, even when the two registered numeric rates happen to be equal. No separate calibration catalog or rate is created. A later inventory-rate change does not rewrite a saved row, and an explicit zero catalog rate preserves the physical cut while pricing its amount at zero.
_Avoid_: creating a separate calibration rate without a business distinction, hiding calibration inside ordinary meterage, letting sales edit cut rates, finding rates by Persian name, applying the cross rate to calibration, or repricing saved cuts from current inventory

**نرخ مفقود برش**:
An explicit zero inventory rate is valid and preserves the physical cut at zero charge; its direction and physical meterage remain visible with `۰ تومان`. Null, a missing/inactive unresolved role, or no stable semantic rate match is missing data and is never converted to zero or recovered by name matching. As soon as valid geometry requires a missing longitudinal or cross rate, the flat cut summary shows only `نرخ برش طولی در کاتالوگ تعریف نشده است` or its cross equivalent without stealing focus while the seller is typing. An attempted add/save blocks atomically, scrolls to the cut section, and focuses that error container. Geometry remains independently resolvable: derived area, requested dimensions, packing, source consumption, physical cuts, and positive remainders stay visible while only the unresolved monetary amount is withheld. A pricing conflict never clears a valid derived field or replaces the physical summary with dashes. Other form sections remain usable and a valid direction continues to show its own amount. After catalog correction or refetch, the error clears and the section recalculates without losing the draft; valid cached rates show no repeat skeleton. An existing saved stair or layer retains each snapshotted rate for a cut direction that already belonged to that row, even when geometry is edited or the current catalog rate changes. If the edit introduces a previously absent direction—such as the row's first cross cut—that new operation alone requires and snapshots the current resolvable directional rate. Historical rates are never silently replaced merely because the row was opened or another dimension changed.
_Avoid_: treating missing as free, falling back to zero or display-name lookup, discarding draft values, hiding valid cut-direction amounts because another rate is missing, blocking the whole modal UI, forcing a historical snapshot to resolve against current inventory, or showing a global alert

**واحدهای ابعاد سنگ پله**:
Every stair dimension owns the shared compact inline `cm / m` switch: tread length and depth, riser length and height, and landing length and width. Length dimensions default to meters; depth, height, and width default to centimeters. Switching units converts the numeric value rather than reinterpreting it, while the calculation engine normalizes every dimension to a canonical unit before deriving area, cuts, tools, or finishing. Each dimension's display unit is snapshotted and restored exactly during edit. `کپی از کف پله` copies both applicable value and display unit once, after which the destination remains independent. The switch lives in the field-title line and adds no large unit buttons, placeholder, or help text.
_Avoid_: fixing some stair dimensions permanently to centimeters, changing a unit label without converting value, calculating from display units, sharing unit state between fields or sibling rows, losing display units on reload, or implementing separate stair-only unit controls

**مقادیر اولیه ابعاد سنگ پله**:
Creating a new کف پله initializes its real editable depth once to `۳۰cm`; creating a new خیز initializes its real editable height once to `۱۷cm`. These are values, not placeholders, and the permanent typical-range help text is removed. Clearing either field leaves it truly blank and never reapplies the default. Blank, zero, or negative blocks only that selected part on save with `عمق را وارد کنید` or `ارتفاع را وارد کنید` beneath the exact field. Tread length, riser length, and both landing dimensions start blank. Saved snapshots and an explicit `کپی از کف پله` always take precedence over new-part defaults, which never reapply after seller interaction.
_Avoid_: implementing defaults through `value || 30` or `value || 17`, restoring a cleared value, rendering typical-range helper copy, using placeholders as data, initializing landing or horizontal lengths without a real source, or overriding copied/saved values with creation defaults

**قیمت پایه بخش‌های سنگ پله**:
کف پله، خیز, and پاگرد each own an independent seller-entered positive base price per square meter. A new part starts blank and never seeds from the catalog or another selected sibling. `کپی از کف پله` may explicitly copy the tread's current price once, after which the destination snapshot is independent. Zero, negative, or blank blocks atomic `افزودن بخش‌های پله` only at the invalid part; the button remains clickable, focuses the first invalid price in the fixed کف، خیز، پاگرد order, and shows only `قیمت را وارد کنید` beneath it, with no modal or global error. Subsequent attempts advance to the next unresolved part. Edit preserves each saved row's price. حکمی affects only its owning part's base price. A remaining-stone child retains its separate zero-material-price policy while its new operations remain billable.
_Avoid_: auto-seeding stair price from catalog, forcing sibling prices to match, treating zero as a valid ordinary stair material price, showing a global price alert, applying one sibling's حکمی to another, repricing saved stair rows, or applying ordinary stair price validation to a remaining-stone child

**لبه‌های ابزار پله**:
For stair product tools on کف پله, خیز پله, and پاگرد, جلو and عقب are the long horizontal span of the stair part, while چپ and راست are the short side edges based on the stair part's عرض/depth. The stair UI's طول field is the main horizontal span used by جلو and عقب.
_Avoid_: calculating جلو from عرض/depth, or calculating چپ and راست from the main طول span

**مرز برش و ابزار پله**:
Geometry-driven stair cuts such as برش طولی and برش عرضی are برش rows, not ابزار rows. ابزار is reserved for user-selected edge operations such as نیم لول.
_Avoid_: storing or printing automatic stair cuts as ابزار, automatically selecting a cutting catalog item as an ابزار, filtering real user-selected ابزار only because its name contains برش, or showing the same physical cut once as برش and again as ابزار

**پیشانی کف پله به‌عنوان ابزار**:
Legacy `نوع پیشانی` options such as لب گرد، لب صاف، and نیم‌گرد are edge tools, not a separate stair geometry or automatic cutting category. The standalone nosing select, card, hard-coded/mock rate, and separate cost path are removed. Sellers select the corresponding inventory tool through the shared inline tool module and explicitly target the tread's جلو edge; quantity derives from tread length × covered group pieces, rate is the non-editable inventory snapshot, multiple tools may share that edge, and no selection naturally means no nosing. Physical geometry cuts remain separate برش rows. Legacy `nosingType` values migrate during authorized edit through an explicit stable-ID mapping, never name guessing; an unmapped historical operation remains as its saved legacy snapshot marked `خارج از کاتالوگ فعلی`. Finalized history is not rewritten merely by loading or printing, and nosing cost appears exactly once under tools rather than again in cuts or base material.
_Avoid_: retaining a second nosing selector, pricing nosing from constants, treating an edge profile as an automatic cut, auto-selecting a front-edge tool, matching legacy values by display name, dropping unmapped history, or charging the same operation in multiple categories

**متراژ برش خودکار سنگ پله**:
For a stair part cut from a wider and/or longer source stone, paid برش طولی follows the actual requested stair pieces produced, while برش کالیبر remains one extra paid longitudinal side cut per consumed source stone. Paid برش عرضی follows the full source width for each consumed source stone when the standard/source length is shortened to the requested actual length.
_Avoid_: charging stair برش طولی only once per source stone when multiple requested pieces are produced from that source, charging برش عرضی only across the requested piece width, or changing material pricing/base-stone count while correcting cutting meters

**کل دور ابزار پله**:
For stair product tools, کل دور means all four stair-part edges: جلو، عقب، چپ، and راست.
_Avoid_: treating کل دور as only three edges, or excluding عقب from the perimeter

**بازمحاسبه ابزار پله**:
Existing saved or printed contracts keep their saved stair tool totals until the contract is opened for editing and saved again. New contracts and edited-resaved contracts calculate stair tool edges using the current لبه‌های ابزار پله rules.
_Avoid_: silently changing historical contract totals without an edit/save action

**باقی‌مانده عرضی سنگ پله**:
When a stair part is cut narrower than the source stone width, the usable remaining width is based on the requested pieces actually consumed from each source stone, not the maximum number of pieces that could theoretically be cut from that source width. Material pricing, base-stone count, and cutting-charge policy remain separate from this remaining-stone geometry.
_Avoid_: treating unrequested possible pieces as already consumed, hiding usable leftover width such as `20cm` from a `30cm` source when only one `10cm` stair piece was requested, or changing contract pricing just because remaining geometry is corrected

**باقی‌مانده طولی سنگ پله**:
When a stair part is shortened from a standard/source length to the actual requested length, the leftover length keeps the full source stone width for each consumed source stone. If the same row also has width cuts, the width leftovers belong only to the actual-length section, while the length leftovers remain separate full-source-width pieces.
_Avoid_: calculating the leftover-length piece only at the requested stair width, or merging width-side leftovers from the actual-length section with the full-width leftover-length section

**مصرف باقی‌مانده برای سنگ لایه**:
When سنگ لایه uses سنگ اصلی, compatible remaining pieces from the same stair part are consumed before charging any additional سنگ اصلی. Only the layer demand that cannot be supplied from those remaining pieces should count as new main-stone material. Allocation applies that commercial priority deterministically and must not run a combined paid/fresh search whose equivalent permutations can delay or change the answer; an exact solver remains the fallback only when the deterministic priority pass cannot satisfy the geometry. The layer summary shows the physical quantity and cost split between already-paid remainder and newly charged main stone; insufficient remainder never rejects the complete layer while compatible fresh main stone can satisfy the shortage. Already-paid remainder contributes zero additional material cost, but every new physical longitudinal or cross cut needed to turn it into layers remains independently calculated and chargeable at its registered directional rate. Fresh main stone used for the shortage adds both its material charge and the cutting charges required by its own packing plan.
_Avoid_: charging all same-stone لایه as fresh stone while usable same-part remaining pieces exist, treating paid material as free processing, hiding the paid-versus-new material split, or rejecting the layer merely because paid remainder covers only part of its demand

**تعداد پارتیشن باقی‌مانده**:
The number of child pieces cut from the selected remaining stone geometry. It is validated by whether those pieces fit inside the remaining stone area, not by requiring one source remaining stone per child piece.
_Avoid_: treating partition quantity as the count of source remaining stones consumed

**تقسیم ظرفیت باقی‌مانده**:
A remaining-stone demand may be fulfilled by multiple physical pieces from the same remaining stone when the requested width fits the source width and the total requested area fits the available capacity.
_Avoid_: rejecting a demand only because its logical length is longer than one source piece when it can be split into valid physical pieces

**بازپخش تخصیص باقی‌مانده پس از ویرایش محصول منبع**:
When a source contract product is edited after its remaining stone has been allocated to child rows, the edit is one atomic change: the source and its remaining inventory are recalculated, then every existing child allocation is replayed in its original order against the new geometry. The edit succeeds only when every child still fits; otherwise nothing changes and the conflicting child allocations are identified.
_Avoid_: silently deleting child rows, partially applying the source edit, preserving stale consumed geometry, changing replay order, or making the user reconstruct allocations that still fit

**چرخه تخصیص محصولات باقی‌مانده**:
Creating, editing, or deleting a remaining-stone child uses the same atomic replay rule as editing its source product. An edited allocation keeps its original order, a new allocation is appended after existing children, and deleting a child regenerates the source remainder before replaying every surviving allocation; if replay fails, nothing changes and conflicts are identified.
_Avoid_: manually adding a deleted child's geometry back into the current remainder, patching only one child or one remaining piece, partially committing a replay, or maintaining separate allocation rules for create, edit, delete, and source edit

**تغییر منبع محصول باقی‌مانده**:
Changing a remaining-stone child's source is an explicit atomic action, never an implication of title, geometry, or row-order edits. The current source is shown compactly with `تغییر منبع`; selection occurs as another view inside the same central configuration modal. The child keeps its stable row identity, title, requested geometry, quantity, description, independently owned tools and finishing selections, and saved manual rates, while every geometry-derived quantity, cut, kerf effect, calibration result, and secondary remainder is recalculated against the candidate source. Committing releases and rebuilds the old source inventory, consumes and rebuilds the new source inventory, and replays affected allocations as one transaction; incompatibility or cancellation changes nothing.
_Avoid_: deleting and recreating the child to change source, opening a nested modal, changing source implicitly, rewriting saved add-on rates, partially updating either source, or committing an incompatible transfer

**حذف منبع دارای تخصیص باقی‌مانده**:
A source product cannot be deleted while any remaining-stone child depends on it. The dependency view lists each child with `مشاهده` and `حذف`; delete uses an inline `حذف این محصول؟ انصراف | حذف` confirmation rather than a dialog, removes only that explicitly confirmed child, and atomically regenerates and replays every surviving allocation. The dependency list and remaining inventory update after each success. Removing the final child merely unlocks source deletion—the source is never deleted automatically—and deleting the source afterward also removes its now-unowned remaining inventory. Finalized contracts are unchanged until explicitly opened in the edit flow.
_Avoid_: cascade-deleting children, converting them to fresh-stone rows, deleting the source automatically after its last child, leaving child-owned snapshots orphaned, partially replaying inventory, or mutating a finalized contract outside explicit editing

**باقی‌مانده ثانویه تخصیص**:
The reusable physical pieces left after creating a child from remaining stone belong to the original source row's canonical remaining-stone inventory. The child owns its finished geometry and operations but does not become the inventory owner of those secondary remnants.
_Avoid_: hiding secondary remnants under the child row, marking them consumed because they share source lineage, or creating a separate child-owned inventory chain

**برش چندمحوره محصول باقی‌مانده**:
When a child product reduces both the width and length of its selected remaining stone, its physical cutting truth contains separate longitudinal and cross breakdown entries with their own meters and costs. Their sum owns the cutting charge; a legacy single cut-type label is not the canonical description of the operation.
_Avoid_: recording only one axis, collapsing both axes into an ambiguous "both" label, or charging a combined amount without preserving its physical breakdown

**گروه هندسی موجودی باقی‌مانده**:
Identical remaining-stone pieces are presented as one inventory group that states dimensions and area per piece, available piece count, and total group area. The seller may enter an integer desired child quantity from `1` through the group's currently displayed availability; that quantity initializes the child configuration and constrains its preview rather than combining the group into one rectangle.
The allocator deterministically consumes the minimum number of physical source pieces needed by the real packing plan, taking equal pieces in stable creation order (oldest first). Unconsumed complete pieces stay in the group, and every positive secondary remnant from consumed pieces is immediately regrouped by its new geometry and made available for another allocation. Physical identities and source lineage remain individually auditable behind an expandable group detail. The complete allocation is atomic: if any piece fails, nothing changes. Before commit, the displayed group quantity is compared with current inventory; a changed quantity rejects the stale action with both old and current counts instead of silently allocating fewer pieces. The live calculation summary shows consumed source count, finished child pieces, complete pieces left, and secondary-remnant groups.
_Avoid_: displaying total group area beside single-piece dimensions without quantity, calling an inventory group one stone, forcing one allocation per visible row, asking the seller to select physical identities individually, consuming equal pieces in unstable order, silently accepting stale availability, partially committing a multi-piece allocation, consuming more source pieces than required, hiding how many pieces an allocation consumes, discarding secondary remnants, or leaving the remaining inventory stale after an allocation

**پیش‌نمایش هندسی تخصیص باقی‌مانده**:
Before a remaining-stone allocation is committed, its preview shows the finished child pieces, consumed source-piece count, every resulting secondary-remnant geometry, and saw-kerf consumption when enabled. Consumed and remaining area totals support this physical preview but never replace it.
_Avoid_: previewing only aggregate area subtraction, using a different geometry calculation from transactional replay, or hiding the effect of saw kerf until after save

**پیکربندی محصول ساخته‌شده از باقی‌مانده**:
A remaining-stone child is an independent cut-product row with its own explicitly selected supported cuttable product family, defaulting to longitudinal, which may differ from its source row's family and is never inherited merely from that source. Remaining-stone usage is represented by the source relationship rather than a separate `remaining-cut` product family. Its mandatory stable parent/source relationship identifies the exact contract row whose already-paid remaining material it consumes; without that valid parent it is not a remaining-stone child. It uses the same product-configuration module and interaction model as a catalog-sourced cut product, with a different material source and base-pricing policy rather than a duplicated form. It retains its own editable title, dimensions, units, quantity, description, saw kerf, calibration, physical cuts, tools, stone finishing, live calculation summary, and secondary-remnant preview, all constrained by the selected remaining geometry. Its base stone price is fixed at zero because the material was charged on the source row, while every newly performed billable operation is calculated and charged normally.
_Avoid_: inventing a separate `remaining-cut` product family, inheriting the source row's product family, treating a child cut from a stair remainder as a stair row without an independent child-family choice, allowing a remaining-stone child without an exact stable parent relationship, maintaining a second shallow copy of product settings for remaining children, exposing a manual base-stone price on the child, omitting child-owned operations, or sharing mutable configuration state with the source row

**افزونه‌های محصول ساخته‌شده از باقی‌مانده**:
A contract product created from remaining stone owns its own ابزار and پرداخت سنگ selections, quantities, and charges, calculated from that child product's geometry and quantity. It starts without add-ons and never inherits them implicitly from the source product; any future explicit copy action must create independently editable add-ons recalculated for the child.
_Avoid_: copying source-product add-on metadata or charges into the child, pricing a child from the source product's dimensions, or keeping copied add-ons linked to later source-product changes

**افزونه ارث‌رسیده قدیمی محصول باقی‌مانده**:
An ابزار or پرداخت سنگ value found only in a legacy remaining-child metadata snapshot is historical ambiguous data, not an intentional child-owned selection. Finalized contracts preserve that saved history unchanged; when the contract is edited, the value must be explicitly removed or adopted as a child-owned add-on recalculated from the child's geometry.
_Avoid_: rewriting finalized historical contracts, silently deleting legacy values, or silently converting inherited source-product metadata into intentional child charges

**قیمت محصول ساخته‌شده از باقی‌مانده**:
A contract product created from remaining stone has zero base material price because its stone was already charged through the source product. No editable base-price field is rendered because no user can change this value; the flat calculation summary instead states `سنگ — ۰ تومان · محاسبه‌شده در محصول منبع`. Its total contains only its own billable operations, such as newly required cutting, ابزار, and پرداخت سنگ, without inheriting the source product's حکمی percentage or material discount behavior. The zero value and source-paid reason are snapshotted with the child for later editing and downstream explanation.
_Avoid_: rendering a disabled or editable base-price control, allowing any user to override the zero material price, charging the same stone material twice, inheriting the source product's حکمی charge, discounting the child as newly sold base stone, or omitting new operations performed on the child

**بازمحاسبه افزونه پس از تغییر هندسه محصول باقی‌مانده**:
When the geometry of a remaining-stone child changes, its selected add-on identities and saved unit prices remain unchanged while geometry-derived tool lengths are recalculated. A manually entered پرداخت سنگ quantity is preserved when it still fits the new geometry; if it no longer fits, the save is blocked and the conflicting add-on is identified.
_Avoid_: silently clamping or deleting an add-on, silently changing its saved rate, preserving a stale geometry-derived tool amount, or committing a child geometry change with an invalid finishing quantity

**وضعیت هنگام چاپ**:
The contract status shown on customer-facing printed or PDF contract output at the moment the document is generated.
_Avoid_: labeling printed status as the general contract status when the timing matters

**شماره تماس فروشنده**:
The seller phone number printed on customer-facing contracts, taken from the contract creator's personal profile phone when available.
_Avoid_: using the current printer's phone or a later approver's phone

**جدول اصلی محصولات**:
The customer-facing contract table that lists product rows and their price-bearing product details as flat invoice rows.
_Avoid_: rendering nested product detail blocks outside the main product table

**ستون‌های مقداردهی جدول اصلی محصولات**:
The customer-facing product table separates physical length, physical width, متر طول, متر مربع, and meaningful count into distinct columns. Each measurement cell shows only the bare number because the unit is already named in the column header; تعداد is filled only when a separate count helps explain the row or when the row is count-priced.
The same structural columns are used in original, accounting, and workshop prints, but workshop removes price columns entirely instead of showing empty price cells.
طول and عرض values in print/PDF output are always normalized to meters and shown as numbers only; the unit belongs in the column header, such as طول - متر and عرض - متر. Centimeter-saved values are converted to meters before printing.
_Avoid_: combining طول and عرض into one ابعاد column, repeating unit labels inside متر طول، متر مربع، or تعداد cells, repeating one value across measurement and count columns, putting count in measurement columns when the pricing basis is another measurement, reintroducing price columns in workshop print, or mixing cm and m labels inside length/width cells

**حکمی**:
An explicit percentage-based price increase applied to a contract product when the product is marked as mandatory.
For a longitudinal stone row, entering a positive تعداد automatically changes طول to mean the length of each physical piece, marks the row as حکمی, and activates the configured حکمی percentage without a second confirmation. The UI shows the active percentage in the calculation summary without interrupting the seller's entry flow.
The seller can directly and easily edit the active حکمی percentage or turn حکمی off after its automatic activation, without a warning or confirmation. Turning it off removes only the percentage price increase: positive تعداد still means physical piece count, طول remains the length of each piece, and packing, cutting, consumption, and remaining-stone calculations remain piece-based. The saved row snapshots the final enabled state and percentage actually used so later default changes do not reprice the contract.
When تعداد is cleared, طول returns to aggregate متر طول and the automatically activated حکمی state turns off without confirmation. The last percentage edited in that open product configuration remains dormant; if positive تعداد is entered again, حکمی reactivates with that percentage. A newly configured product starts from the current default percentage.
_Avoid_: leaving a positive-count longitudinal row in aggregate-length mode, requiring a duplicate confirmation after تعداد activates حکمی, coupling piece-based geometry to the final حکمی toggle, preventing the seller from editing or disabling the row's percentage increase, showing a warning when حکمی is disabled or تعداد is cleared, discarding the seller's percentage during the same configuration session, carrying a prior product's percentage into a new product, hiding the active percentage from the summary, repricing a saved row from a later default, or printing or charging حکمی on a row that was neither activated by positive تعداد nor explicitly marked mandatory

**برش حکمی**:
A mandatory product retains the physical calculation for every cut and charges the customer for its actual longitudinal cutting, while cross cutting remains non-billable. Workshop and remaining-stone truth include both cut types; customer, accounting, summary, and invoice totals include only the longitudinal cutting amount.
_Avoid_: zeroing all حکمی cutting charges, hiding either physical cut type, charging حکمی cross cutting, or treating the حکمی percentage as payment for longitudinal cutting

**هزینه فیزیکی برش و مبلغ قابل دریافت برش**:
هزینه فیزیکی برش ارزش محاسبه‌شده عملیات واقعی برای برنامه تولید و کنترل داخلی است؛ مبلغ قابل دریافت برش بخشی از همان عملیات است که طبق قواعد فروش از مشتری دریافت می‌شود. در محصول حکمی، عملیات و هزینه فیزیکی برش طولی و عرضی باقی می‌ماند؛ مبلغ برش طولی از مشتری دریافت می‌شود و مبلغ برش عرضی صفر است. خروجی‌های مالی نرخ و مبلغ ذخیره‌شده قرارداد را نشان می‌دهند، برش فیزیکی رایگان را با نرخ و مبلغ صفر نمایش می‌دهند و هیچ نرخ جاری کاتالوگ را هنگام چاپ جایگزین نمی‌کنند؛ خروجی کارگاه فقط حقیقت فیزیکی را بدون ستون مالی نگه می‌دارد. ردیف‌های خلاصه فقط وقتی ادغام می‌شوند که نوع و نرخ ذخیره‌شده یکسان باشد.
برای محصول طولی عادی، وقتی عرض درخواستی از عرض منبع کمتر است، سیستم برش طولی را خودکار ثبت می‌کند و متراژ و مبلغ قابل دریافت را از چیدمان واقعی و نرخ ذخیره‌شده محاسبه می‌کند. فروشنده نمی‌تواند عملیات را حذف، مبلغ را صفر، یا نرخ محاسبه‌شده را بازنویسی کند؛ هر برش رایگان فقط از یک سیاست رسمی دامنه مانند برش عرضی حکمی ناشی می‌شود.
_Avoid_: استفاده از یک مبلغ مشترک برای حقیقت تولید و مبلغ فاکتور، حذف عملیات فیزیکی به دلیل رایگان‌بودن آن برای مشتری، اجازه لغو یا صفرکردن دستی برش خودکار به فروشنده، صفرکردن مبلغ برش طولی حکمی، دریافت مبلغ برش عرضی حکمی، استفاده از هزینه فیزیکی عرضی در جمع قابل پرداخت، خالی‌گذاشتن مبلغ برش رایگان، میانگین‌گیری نرخ‌های متفاوت، یا قیمت‌گذاری مجدد قرارداد هنگام چاپ

**بازذخیره قیمت‌گذاری حکمی**:
Opening an existing contract for editing and saving it again applies the current حکمی pricing rule to the saved product rows.
_Avoid_: silently changing old saved contract pricing without an edit-save action, or preserving an old paid برش charge after a mandatory row has been edited and saved

**تخفیف قرارداد**:
A percentage reduction applied only to the sum of base stone product subtotals in a sales contract, including کیوبیک و قطعات آماده rows when they are sold as main catalog stone products, before payments are compared to the payable total. It does not reduce ابزار, لایه، پرداخت سنگ, cutting, standalone service rows, or حکمی add-on amounts.
_Avoid_: applying تخفیف to the full contract total including add-ons, or selecting discount limits per individual product row

**خروجی تخفیف قرارداد**:
The saved contract discount snapshot shown in PDF and print output, including the applied percentage and amount. Existing contracts keep their saved discount details even when discount ranges change later.
_Avoid_: recalculating old contract discounts from current بازه تخفیف rules

**Legacy No-Discount Evidence**:
An explicit null discount snapshot from the legacy Sales wizard is affirmative historical evidence that no discount was applied; an older absent discount field has the same meaning only when its frozen payable total exactly reconciles with its frozen gross product total and no positive-discount evidence exists. Qualifying evidence may be normalized during financial approval to auditable explicit zero-discount evidence from the Contract's frozen commercial values without reopening the Contract, while any mismatch remains blocked for human review.
_Avoid_: normalizing unreconciled absence, reopening or resaving the Contract, inventing a positive discount, recalculating from current بازه تخفیف rules, changing the payable total, or weakening fail-closed review for conflicting evidence

**Legacy Discount Eligibility Evidence**:
For a Product snapshot attached to Legacy No-Discount Evidence, explicit `isLayer: true` means the row is a non-discountable layer, while an omitted `isLayer` means the legacy wizard treated it as a non-layer; normalization records every row for which that historical omission is made explicit. A non-boolean value or contradictory layer evidence remains blocked for human review.
_Avoid_: treating omission as non-layer outside the legacy no-discount boundary, discounting an explicit layer, normalizing malformed eligibility, or reopening the Contract to manufacture current evidence

**Current Contract Discount Eligibility Evidence**:
Every Product snapshot in a newly saved Contract explicitly identifies whether it is a layer: `isLayer: true` is non-discountable and `isLayer: false` is an ordinary row whose eligible base stone amount may receive a Contract Discount. An in-progress Contract Creation Draft from the prior wizard shape may upgrade an omitted flag to explicit `false`, while preserving explicit layers and blocking non-boolean or contradictory evidence.
_Avoid_: persisting omission in a new Contract, changing an explicit layer into an ordinary row, losing an in-progress Draft solely because its ordinary rows predate explicit evidence, discounting add-ons or layers, or accepting malformed eligibility evidence

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

**گزارش فروش**:
The comprehensive reporting surface inside the Sales workspace for analyzing sales contracts, pipeline, customers, products, payments, delivery commitments, and seller performance according to the viewer's permissions. Shared sales reporting is available to authorized sales users, while sensitive cross-seller and company-wide analysis is limited to managers and admins.
_Avoid_: treating it as a placeholder dashboard, maintaining separate reporting truths for Sales and BI, or exposing manager-only comparisons to ordinary sales users

**بخش‌های گزارش فروش**:
One comprehensive role-gated reporting page with persistent shared filters across نمای کلی، قراردادها، مشتریان و پروژه‌ها، محصولات و خدمات، پرداخت و وصول، تحویل و بارگیری، عملکرد فروشندگان, and خروجی گزارش. عملکرد فروشندگان is visible only within authorized Sales management scope, while every other section still obeys the viewer's contract-level reporting scope.
_Avoid_: separate pages that silently use different filters, exposing an inaccessible section through exports, or letting a tab change the permitted data scope

**سازنده خروجی گزارش فروش**:
A presentation-only builder for PDF and print output using the shared branded report layout. Users may select and reorder permitted sections, charts, tables, and columns; set title, subtitle or note, orientation, and page size; and save personal presets. Sales admins may publish department presets and global admins may publish company presets, but loading any preset re-applies the viewer's current data permissions at generation time.
_Avoid_: using contract-document templates for analytics, allowing a preset to carry broader data access, editing calculated values in the builder, or storing exported figures as user-entered truth

**لحظه داده گزارش**:
The explicit data time represented by a report. Interactive Sales and BI screens query current authoritative data, show their latest refresh time, and allow manual refresh; starting PDF, Excel, or print output freezes one consistent authorized snapshot so its totals, charts, and detail tables cannot change independently during generation.
_Avoid_: presenting cached data as current without a timestamp, mixing results from different refreshes in one export, or allowing a long-running export to combine records from different moments

**کامل‌بودن داده گزارش**:
The explicit distinction between confirmed zero, an unrecorded unknown value, a source with no usable record, and data hidden by permission. Partially connected cross-workspace metrics show their coverage, such as how many authorized contracts have Accounting receipt data, instead of silently treating missing records as zero.
_Avoid_: inventing zero from missing data, revealing hidden values through summaries, treating unavailable source data as a negative business outcome, or presenting a partial metric without its coverage

**نمودار فارسی گزارش‌ها**:
An RTL-aware chart shared by Sales Reports and BI whose Persian title, legend, tooltip, labels, numbers, currency, and Jalali dates remain readable. Chronological charts place the oldest period on the right and the newest on the left, with comparison series aligned in the same direction. Long Persian customer, project, product, and seller labels must wrap, abbreviate with an accessible full label, or use a horizontal layout instead of clipping or overlapping.
_Avoid_: applying RTL only to the surrounding card, leaving BI charts with LTR internals, reversing time direction inconsistently between charts, Latin-only digits or Gregorian labels without context, color-only status meaning, unreadable rotated Persian text, or legends and tooltips detached from their data

**جزئیات تعاملی نمودار گزارش**:
The permission-preserving drill-down opened from a meaningful chart bar, point, status, customer, product, or seller. It carries the report's active filters plus the visibly selected datum into a detailed table or drawer, explains the resulting scope, and offers links only to source records the viewer may already access.
_Avoid_: a decorative chart with no path to evidence, a hidden filter that users cannot understand or clear, opening unfiltered records, or using chart interaction to bypass contract-level authorization

**مرز گزارش فروش و هوش تجاری**:
Sales Reports is the comprehensive operational and performance report for the Sales workspace. BI remains an authorized cross-workspace analysis surface and reuses the same RTL chart and formatting foundation instead of maintaining a visually inconsistent reporting implementation or becoming a second source of Sales metric truth.
_Avoid_: duplicating Sales calculations independently in BI, redesigning only Sales charts while leaving BI effectively LTR, or turning the Sales report into a company-wide BI bypass

**دامنه داده گزارش فروش**:
An ordinary Sales user sees reporting derived only from contracts they created, while Sales managers and admins may analyze other sellers within their permitted management scope and global admins may analyze the whole company.
_Avoid_: letting an ordinary Sales user see other sellers' contracts, customer/product results derived from those contracts, seller comparisons, or company-wide totals

**دسترسی مدیریتی گزارش فروش**:
Restricted Sales reporting is granted by Sales workspace `admin` permission, with global admins receiving company-wide access. A manager title or access to another workspace does not by itself grant seller comparisons or broader Sales data.
_Avoid_: hard-coding sensitive report access only to a generic manager role, or allowing management authority from an unrelated workspace to expand Sales visibility

**BI فروش**:
A native business-intelligence workspace for analyzing sales-contract performance from sales-owned data such as contracts, payments, customers, products, delivery status, discounts, and seller performance.
_Avoid_: treating it as an embedded external BI tool or as a company-wide analytics workspace

**فروش قطعی در BI فروش**:
The sales value counted as realized sales in BI, limited to sales contracts whose status is `SIGNED` or `PRINTED`.
_Avoid_: counting draft, pending, approved, cancelled, or expired contracts as realized sales

**فروش قطعی در داشبورد اصلی**:
The realized Sales Contract value from the beginning of recorded history through the present, summarized within the viewer's authorized scope from the same authoritative realization events as Sales reporting.
_Avoid_: calling it accounting income or collected payments, silently limiting it to the current month, reading the legacy Contract record set, or defining a second realization calculation for the dashboard

**خلاصه قراردادها در داشبورد اصلی**:
The authorized all-time Sales Contract counts shown as total, pending approval, signed, draft, approved, printed, and one combined cancelled-or-expired bucket.
_Avoid_: counting legacy Contract records, changing the established status grouping without a separate decision, or linking a count to an unfiltered contract list

**وضعیت قرارداد در گزارش فروش**:
The actual lifecycle status of a sales contract, shown with a Persian label and a short explanation of what has happened and what is expected next. Reporting buckets such as pipeline, realized, and lost group contracts for analysis but do not replace or hide their real statuses.
_Avoid_: showing only a vague reporting bucket, or presenting an aggregated category as though it were the contract's exact workflow status

**بازه زمانی گزارش فروش**:
Sales reporting defaults to the current Jalali month and supports today, yesterday, the last seven days, current Jalali quarter and year, the last twelve months, and a custom Jalali range, with comparison to the immediately preceding equal-length period. Realized, pipeline, and lost sales enter a period using their respective signing, creation, and cancellation or expiry business dates.
_Avoid_: mixing lifecycle dates inside one metric, using rolling timestamps where a complete calendar period is intended, or comparing unequal periods without saying so

**حقیقت‌های مرتبط در گزارش فروش**:
Sales Reports may place contract value, payment promises, accounting receipts, logistics delivery, and Security-recorded exit together, but each fact retains its owning workspace and is labeled as planned, confirmed, loaded, delivered, or exited. Sales owns contract value, discount, payment plan, and promised delivery; Accounting owns actual receipts and receivables; Logistics owns actual loading and delivery; Security owns physical exit time.
_Avoid_: treating a payment plan as received money, a promised delivery as physical delivery, or a finalized loading as proof that the vehicle exited

**گزارش عملکرد فروشنده**:
A permission-scoped Sales report for one seller, with ordinary Sales users fixed to themselves, Sales workspace admins able to select sellers in their management scope, and global admins able to select departments and sellers company-wide.
_Avoid_: giving ordinary Sales users a selector for other sellers, or calculating seller performance from contracts outside the viewer's permitted scope

**مسئول فروش قرارداد**:
The seller commercially responsible for a Sales Contract, distinct from the user who entered it. A contract converted from a potential project defaults to that project's responsible seller; otherwise it defaults to its creator, and manager-authorized reassignment requires an audit reason.
_Avoid_: treating technical data entry as sales ownership, silently changing ownership, or losing the CRM project owner during conversion

**ثبت‌کننده قرارداد فروش**:
The system user who originally entered a Sales Contract, preserved as creation provenance even when commercial responsibility later changes. Contract lists identify this user by full name with username as the fallback.
_Avoid_: calling the current responsible seller the contract creator, changing creator provenance after reassignment, or presenting a blank display when a username exists

**اعتبار فروش قطعی فروشنده**:
The seller who receives realized-sales performance credit, snapshotted from the contract's responsible seller when the contract first becomes `SIGNED` or `PRINTED`. Pipeline follows current responsibility, but later reassignment does not rewrite historical realized performance.
_Avoid_: recalculating historical seller credit from current ownership, or crediting the creator when another seller owned the commercial work

**مبلغ قرارداد ثبت‌شده حسابداری**:
The full amount of one Sales Contract's latest currently valid financially approved invoice, attributed to its snapshotted realized seller and dated by that invoice's financial approval. A valid replacement moves the contract and its full amount to the replacement approval period, while an unassigned realized seller remains visible without invented attribution.
_Avoid_: summing receipts or balances, counting one contract more than once, retaining a voided invoice beside its replacement, dating the amount by contract creation or signature, or attributing it from current responsibility

**انتساب قدیمی فروشنده قرارداد**:
The migration state for Sales Contracts created before explicit contract responsibility and realized-credit snapshots existed. A CRM-linked contract uses the seller at conversion only when CRM history can establish it reliably; otherwise its creator becomes the current operational owner and is labeled as a migrated initial value. Unverifiable realized credit remains in فروش قطعی تخصیص‌نیافته قدیمی until a Sales admin assigns it with an audit reason, while company and department totals still include its value.
_Avoid_: treating a mutable current CRM owner as historical proof, silently crediting the creator for legacy realized sales, excluding unassigned legacy sales from aggregate totals, or resolving historical attribution without an audit reason

**شاخص‌های عملکرد فروشنده**:
Seller performance is a transparent set of contract creation, pipeline, realized sales, realization time, lost outcomes, customer mix, product/service mix, and period-comparison metrics rather than one composite score. Seller discount behavior and cross-seller comparison are restricted to manager/admin reporting, while accounting and delivery outcomes remain contextual unless Sales responsibility is defined separately.
_Avoid_: an opaque performance score, penalizing sellers for downstream work they do not own, or exposing sensitive comparisons to ordinary Sales users

**نرخ موفقیت قراردادهای تعیین‌تکلیف‌شده**:
The share of contracts reaching `SIGNED` or `PRINTED` among contracts that reached either a realized outcome or `CANCELLED`/`EXPIRED` during the selected period. Draft and active pipeline contracts are excluded, CRM potential-project conversion remains a separately labeled metric, and a period with no decided outcomes has no percentage.
_Avoid_: calling open pipeline a failure, dividing by every newly created contract, showing zero percent when no outcome exists, or mixing CRM opportunity conversion with Sales contract outcomes

**تعدیل فروش قطعی**:
A dated positive or negative change to an already realized Sales Contract that preserves the original realized amount and date while recording the correction or cancellation delta in the period when it becomes effective. Gross realized sales and dated adjustments are shown separately and combine into net realized sales without silently rewriting closed periods.
_Avoid_: replacing the original amount in historical reports, counting both the current mutable contract total and its adjustment, or inferring adjustments from the current amount without an authoritative change record

**پایپ‌لاین فروش در BI فروش**:
The sales value still in progress in BI, limited to sales contracts whose status is `PENDING_APPROVAL` or `APPROVED`.
_Avoid_: mixing pipeline value with realized sales

**فروش ازدست‌رفته در BI فروش**:
The sales value excluded from realized sales because the sales contract is `CANCELLED` or `EXPIRED`.
_Avoid_: hiding cancelled or expired value from management analysis

**تاریخ فروش قطعی در BI فروش**:
The business date used for realized-sales trends, taken from the contract signing time and falling back to contract creation time only for older signed or printed contracts without a signing time.
_Avoid_: using print, payment, or delivery dates to trend realized sales

**تاریخ پایپ‌لاین در BI فروش**:
The business date used for sales-pipeline trends, taken from the contract creation time.
_Avoid_: using approval time as the only pipeline date

**دامنه داده در BI فروش**:
The set of sales data a BI viewer may analyze: admins see all sales data, managers with BI view access see department-scoped sales data, and managers with BI admin access see all sales data.
_Avoid_: allowing normal users into BI, or treating every manager as automatically company-wide

**فیلتر دیروز در BI فروش**:
A BI sales period preset for the complete previous calendar day in Tehran/Jalali terms, shown as دیروز beside امروز. Its comparison period is the day before yesterday, not a rolling previous 24-hour window.
_Avoid_: calculating دیروز as the last 24 hours or comparing it to an unrelated date range.

**مانده قابل دریافت در BI فروش**:
The outstanding amount for realized sales, calculated as realized sales value minus completed payments and paid installments.
_Avoid_: reducing receivables for pending checks, pending installments, cancelled payments, or unsigned pipeline contracts

**پرداخت معوق در BI فروش**:
A due payment or installment on a realized sales contract that is not completed or paid and whose due date is before today.
_Avoid_: treating check handover date as the due date, or counting cancelled payments as overdue

**فروشنده در BI فروش**:
The sales user credited for a v1 BI sales contract, taken from the contract creator user.
_Avoid_: assuming a separate salesperson assignment exists before the contract model stores one

**ریسک تحویل در BI فروش**:
The management view of delivery exposure, grouped into overdue deliveries, deliveries due today or within seven days, delivered rows without customer confirmation, and completed deliveries.
_Avoid_: treating cancelled deliveries as active delivery risk, or replacing the delivery workspace workflow

**خروجی جاری قرارداد**:
The customer-facing contract output in PDF, print, and confirmation views should reflect the current saved contract details, including edited delivery plans and payment plans.
_Avoid_: generating customer-facing output from an older creation snapshot when the contract has since been edited

**قفل حسابداری قرارداد فروش**:
A sales contract becomes immutable for sales edits only after accounting financially approves an accounting financial record for that contract.
_Avoid_: locking sales edits merely because the contract was sales-approved, digitally signed, or printed

**وضعیت حسابداری در فروش**:
Sales users may view the accounting status of a sales contract as read-only accounting information on the sales contract list and detail pages. The status remains owned by accounting and reflects the current accounting workflow state, including whether the contract is eligible for financial action, already has financial records, or needs accounting correction.
_Avoid_: letting sales users edit accounting status, or showing a stale sales-owned copy of the accounting workflow state

**دارای رکورد مالی**:
A sales contract qualifies as دارای رکورد مالی only while it has at least one currently valid financially approved invoice record in `ISSUED` or `POSTED` state. Draft and voided records do not qualify, and an unapproved replacement qualifies only after financial approval; the corresponding filter follows this factual rule even when a higher-priority primary badge such as نیازمند اصلاح is displayed.
_Avoid_: treating draft creation as financial approval, counting voided records, hiding an urgent correction behind this badge, or excluding a valid approved invoice from the filter because another primary status is displayed

**تاریخ فاکتور سیستمی**:
The Sepidar/system invoice date entered by accounting during financial approval. It may be today, up to ten days in the past, or up to thirty days in the future.
_Avoid_: treating future system invoice dates as invalid when they are within the accounting forward-entry window

**تاریخچه رویدادمحور روند مالی قراردادها**:
The historical financial-trend view in which a late entry is attributed to its authoritative business date, while a later void or correction changes the financial position only from that event's effective date onward. Past Persian-month results are recalculated from the event history rather than frozen when first displayed or rewritten from current record state alone.
_Avoid_: assigning late entries to their data-entry month, erasing previously valid history after a later void, or treating the first displayed monthly total as an immutable snapshot

**ماه مالی شمسی روند قراردادها**:
A Tehran civil-time interval beginning at 00:00 on the first day of a Persian month and ending immediately before 00:00 on the first day of the next Persian month; the current interval ends at the present moment.
_Avoid_: using the server's implicit timezone, Gregorian-month boundaries, an inclusive next-month midnight, or a future end for the current month

**مبلغ خالص فاکتورشدۀ ماه**:
The net invoice movement in a Persian financial month: a financially approved issued or posted invoice adds its amount on its System Invoice Date, a later void subtracts that amount on the void's effective date, and an approved replacement adds its own amount on its own System Invoice Date. Drafts and unapproved replacements have no financial effect.
_Avoid_: counting draft candidates, grouping approval by data-entry time, silently removing a voided invoice from its original month, or treating a replacement as effective before its own approval and invoice date

**مبلغ خالص دریافتی ماه**:
The net realized collection movement in a Persian financial month. Cash, card, bank transfer, and receipt payments add their amount on their authoritative occurrence date; a check adds its amount only when cleared, and a later reversal, bounce, return, or correction subtracts the previously realized amount on that event's effective date. A replacement check has its own independent collection lifecycle.
_Avoid_: counting check possession or deposit as realized collection, retaining a cleared amount after its later reversal, assigning a correction to the original collection month, or carrying realization automatically from an old check to its replacement

**مانده مطالبات پایان ماه قراردادها**:
The non-negative month-end stock calculated per contract as valid net invoiced amount minus realized net collections as of the Persian financial-month cutoff, then summed across contracts. An uninvoiced contract creates no outstanding receivable, an unallocated contract receipt still reduces that contract's balance, and excess advance collection does not become a negative receivable.
_Avoid_: summing current mutable balances into past months, treating the full contract price as receivable before valid invoicing, ignoring an unallocated contract receipt, or presenting customer credit as negative outstanding receivables

**تاریخ مؤثر رویداد مالی**:
The immutable business date on which an invoice, collection, void, reversal, or correction changes financial-trend history; when no separate real-world date is supplied, the system-recorded event time is authoritative. Legacy fallback uses the record's dedicated event time, then its audit-event time, then creation time, and the resulting lower-confidence attribution remains visible to consumers.
_Avoid_: overwriting an earlier event's date during a later status change, silently presenting a fallback date as exact, or assigning every correction to the date of its original transaction

**مهلت حسابداری قرارداد**:
An open receivable with a due date or an unsettled check with a check due date, classified by Tehran calendar date as overdue before today, due from today through seven days ahead, due from eight through thirty days ahead, or due after thirty days. Open receivables include open, partially paid, and overdue items; unsettled checks include pending handover, received, deposited, and bounced checks, while settled, voided, cleared, returned, and replaced items do not create a deadline.
_Avoid_: using record-creation time as the deadline, treating due today as overdue, including terminal records, or calculating rolling device-local 24-hour buckets

**Accounting Metric Drilldown**:
The permission-scoped record collection represented by an Accounting dashboard count, deadline bucket, or financial-trend point. Opening it preserves the metric's exact business scope in a shareable destination, including when the result is empty, without broadening Accounting or Human Resources access.
_Avoid_: linking an operational metric to an unfiltered register, disabling zero-value drilldown, exposing records outside the viewer's authority, or letting a saved destination silently change the represented population

**حذف پیش‌نویس رکورد مالی**:
An accounting financial record may be physically deleted only while it is still a draft and has not been financially approved, while keeping an audit trail of the deletion. Issued, posted, financially approved, or otherwise submitted records are not deleted; they are voided or corrected through accounting workflows.
_Avoid_: deleting financially approved accounting records, or keeping undeletable draft clutter when a new draft should be regenerated

**Legacy Accounting-Originated Correction Request**:
A historical correction request created by Accounting before the Seller-originated Cross-Workspace Duty cutover. Existing active rows may finish through their preserved lifecycle, but no new row may be created through the retired Accounting writer; they are explicitly reported as grandfathered rather than assigned inferred Seller or Accounting actors.
_Avoid_: creating new Accounting-originated requests, migrating an unknown historical actor by inference, accounting silently editing the commercial Contract, or treating a request as permission for Sales to edit before manager approval

**پرچم حسابداری**:
An internal accounting risk or review marker attached to a sales contract. An open blocker flag prevents financial approval but permits preparatory and read-only accounting work; an authorized accounting user closes a flag with a mandatory resolution note, and may cancel an open mistaken flag with a mandatory cancellation reason.
Resolved and cancelled flags remain in auditable history and are not reopened; a recurring concern becomes a new flag.
_Avoid_: treating a flag as a sales correction request, deleting or reopening it after review, or leaving it without a closable lifecycle

**اصلاح حسابداری پس از تایید مالی**:
A correction request after financial approval can reopen a locked sales contract for a controlled sales correction only after manager approval. The existing financially approved record remains immutable and accounting owns any void, reversal, correction, review, and replacement approval needed after the sales correction.
_Avoid_: editing the approved financial record directly, or treating manager-approved sales correction as accounting approval of the replacement financial result

**رکورد مالی جایگزین پس از اصلاح**:
When a corrected sales contract changes the financially approved amount, the old approved financial record remains historical and is voided or reversed, while accounting creates and approves a new financial record from the corrected contract amount.
_Avoid_: editing the old approved record amount in place, or resolving the correction request before accounting confirms the replacement financial result

**شاهد ابطال مالی خارجی**:
When a financially approved Sabalan record has already been registered in Sepidar or another external accounting system, voiding it in Sabalan requires an accountant-entered reason and external cancellation, reversal, or correction reference.
_Avoid_: marking an externally registered financial record as voided in Sabalan without preserving what happened to the external accounting document

**وابستگی‌های ابطال رکورد مالی**:
Voiding a financially approved invoice must account for downstream receivables, receipts, checks, and tax submissions tied to that invoice. Simple replacement is allowed only when downstream records are absent or safely closable; received payments, checks, or submitted tax records require explicit accounting correction evidence before the correction is closed.
_Avoid_: silently deleting or rewriting downstream accounting records when an approved invoice is voided

**بستن اصلاح مبلغ پس از تایید مالی**:
A price-changing correction request after financial approval is closed only after the old approved invoice is voided or reversed with external evidence, a replacement invoice candidate is created from the corrected contract amount, that replacement is financially approved, and downstream accounting dependencies are handled or documented.
_Avoid_: resolving the correction immediately after sales saves the contract edit, or before the replacement financial result is approved

**وضعیت محاسبه‌شده اصلاح مالی**:
After sales saves a post-approval correction, the correction request may remain in `SALES_EDITED` while accounting progress is derived from related financial records: whether the old approved invoice is voided, whether a replacement invoice candidate exists, whether it is financially approved, and whether downstream dependencies are handled.
_Avoid_: adding a new persisted correction-request status for each accounting sub-step when the related records already express that state

**پیوند رکورد مالی جایگزین**:
A replacement invoice candidate created after a post-approval correction is explicitly linked to the correction request and to the old financial record it replaces. Its identity is separate from the original full-contract invoice candidate so accounting can create one replacement for the corrected contract amount without reusing the old invoice candidate.
_Avoid_: using the original contract-level invoice idempotency key for replacement records, or leaving the replacement record disconnected from the correction that required it

**شماره فاکتور سیستمی رکورد مالی جایگزین**:
A replacement invoice candidate may reuse the Sepidar/system invoice number of the old voided invoice only when it is explicitly linked as replacing that old financial record. Unrelated invoices must still have unique system invoice numbers.
_Avoid_: allowing duplicate system invoice numbers across unrelated invoices, or forcing a replacement invoice to receive a different number from the voided invoice it replaces

**اختیار ابطال و جایگزینی رکورد مالی**:
Voiding an approved financial record and financially approving its replacement require manager-level accounting authority, expressed through accounting approve/void permission rather than a hard-coded role name. Normal accounting users may request corrections and prepare allowed drafts, but sales users never void or replace accounting records.
_Avoid_: allowing every accountant to void approved records, or coupling the authority only to one role label instead of the accounting permission model

**راهنمای جایگزینی رکورد مالی**:
For a post-approval correction whose saved sales edit changed the approved amount, the accounting contract detail page guides accounting through voiding the old financial record, creating the replacement draft, financially approving the replacement, and then closing the correction. Each step is enabled only when the previous accounting truth is complete.
_Avoid_: exposing only generic accounting buttons that leave accountants guessing which correction step is currently allowed

**تشخیص اثر مبلغی اصلاح**:
Whether a post-approval sales correction changed the approved financial amount is determined automatically by comparing the old approved financial record amount with the current corrected contract amount in ریال, using the same accounting total calculation used for invoice candidate creation.
_Avoid_: asking accountants to manually classify whether a corrected contract changed the financial amount, or comparing formatted display text

**اصلاح بدون اثر مبلغی پس از تایید مالی**:
When a post-approval correction does not change the approved financial amount, the old approved financial record remains valid and accounting may close the correction after manager-level review and a resolution note. If the non-amount change affects customer identity, tax, Sepidar, or external documents, accounting records the needed evidence or note without recreating the invoice unless the external document itself must be corrected.
_Avoid_: forcing invoice void and replacement for every corrected contract when the approved amount did not change

**تایید مالی با اصلاح باز**:
Accounting financial approval is blocked while a contract has an open or acknowledged pre-approval correction request. Accounting must review and resolve the correction request before financially approving the invoice candidate.
_Avoid_: financially approving and locking a contract while a requested sales correction is still unresolved

**رسیدگی به اصلاح حسابداری**:
After sales edits a contract for a pre-approval correction request, the request remains open until accounting manually reviews the corrected contract and resolves it with an optional resolution note.
_Avoid_: adding a separate handoff status before the workflow needs it, or auto-resolving a correction request merely because the contract was edited

**بررسی اصلاحات حسابداری**:
The manager-level accounting review of whether an accounting correction request may open a controlled sales contract correction window. The authority belongs to accounting workspace admin permission, with global administrators included.
_Avoid_: hard-coding review authority only to a role name, or allowing normal accounting edit permission to approve sales unlocks

**رد اصلاح حسابداری**:
A manager decision that closes a correction request without opening sales editing, while preserving the existing contract and financial record states. The decline reason is part of the accounting audit trail.
_Avoid_: unlocking the contract after a declined review, or changing the financial record just because the request was declined

**عملکرد حسابدار**:
An operational accounting metric for how quickly and consistently an accountant performs auditable accounting workflow actions, measured from accounting records and audit events rather than browser presence.
_Avoid_: treating accountant performance as hidden activity tracking, keystroke monitoring, or time spent with a page open

**ویرایش مرحله‌ای قرارداد فروش**:
Editing a sales contract uses the same step-based contract workflow as creation, with prefilled saved contract details and direct access to any step that may need correction.
_Avoid_: a separate simplified edit form, or forcing linear navigation during edit

**پنجره اصلاح قرارداد فروش**:
A controlled sales-edit opportunity tied to an approved accounting correction request. It allows sales to use the normal full step-based contract edit flow with the correction category and accountant note visible, save one correction edit, and then return the contract to the accounting lock until accounting reviews the corrected contract.
_Avoid_: leaving a previously locked contract generally editable, or trying to field-lock contract editing by correction category

**اعتبارسنجی ویرایش قرارداد فروش**:
During sales contract editing, users may jump directly to any step, but saving changes requires the complete contract to be valid; validation should point the user to the first invalid step.
_Avoid_: blocking step jumps in edit mode, or saving partially invalid edited contracts

**اتمام ایجاد قرارداد فروش**:
After a new Sales Contract commits successfully, creation is complete and opens that Contract's detail so its final number, status, Payment plan, and Delivery plan can be verified. A cleanup or detail-load failure cannot reverse the commit: recovery becomes ineligible immediately, cleanup is idempotent and diagnostic-only, and the detail retry state never permits duplicate submission.
_Avoid_: showing ثبت قرارداد again after the Contract has already been created, waiting for recovery cleanup to declare business success, returning to the editable wizard after a detail-load failure, or creating a duplicate Contract when the user retries viewing

**پیش‌نویس بازیابی قرارداد فروش**:
During Contract creation, meaningful in-progress business data is the canonical creator-private Contract Creation Draft: it has immediate same-location browser recovery plus a durable server checkpoint available across that creator's locations for seven days. Its bounded recovery payload keeps Contract facts and saved in-progress configuration but excludes live CRM navigation collections such as other Contracts, Leads, Communications, counters, and timelines.
_Avoid_: expiring meaningful data after only a few minutes, requiring users to rebuild large Contracts after accidental navigation, limiting durable recovery to one device, copying a full CRM Customer graph into recovery, or retaining recovery after successful creation

**لیست ردیف‌های انتخاب‌شده قرارداد**:
During contract creation, the selected product and service rows are a scalable review surface for the contract being assembled. On desktop, large contracts should be reviewed as compact rows with key pricing and quantity fields first, while rich details such as remaining stones, layers, images, notes, and cutting summaries stay available on demand.
_Avoid_: forcing every selected row to appear as a full detail card when the contract contains many rows

**ویرایش جزئیات محصول قرارداد**:
Editing a saved contract product should preserve previously selected ابزار and پرداخت سنگ details from the contract snapshot, even when the current catalog record is missing or inactive. Saved labels, units, prices, and amounts should remain visible instead of being silently dropped.
_Avoid_: resetting selected contract product details only because catalog lookup fails

**ذخیره اتمیک ردیف محصول قرارداد**:
Saving a created, edited, or duplicated contract-product row is one indivisible business action across the customer request, physical geometry and consumption, remaining-stone relationships, mandatory settings, cutting, tools, finishings, descriptions, images, price components, and row total. The save either commits one mutually consistent row and every affected relationship or changes nothing; success is shown only after every displayed and downstream fact agrees with that same calculation.
An untouched historical row may preserve an all-in saved amount that cannot be reconstructed safely from incomplete legacy facts. Once a seller explicitly creates or saves a row with a complete current calculation, that exact calculation owns the row total and replaces any higher or lower stale amount; unresolved disagreement blocks the row save rather than being deferred to contract submission.
_Avoid_: saving only the fields currently visible, merging old derived facts with new inputs, preserving a stale higher or lower total, showing success for a partially updated row, or requiring final contract submission to discover a row inconsistency that product save could determine

**تکثیر ردیف محصول قرارداد**:
Creating a new editable contract product row from an existing row by copying its product selection, dimensions, quantities, pricing, mandatory settings, cutting details, tools, finishing, notes, images, and remaining-stone usage settings while giving it independent row identity.
Every nested graph identity is also independent: source batches, operation groups, tool selections, finishing selections, and other duplicated relationships are re-keyed without changing commercial values. Existing delivery assignments remain attached to their original stable product rows; the duplicate starts unassigned, shows `محصول تکثیر شد؛ برنامه تحویل آن را مشخص کنید`, and does not move the seller to the delivery step. Existing and newly assigned delivery rows remain editable after contract save and later contract edits.
Recoverable identity collisions that have no ambiguous parent/source relation are re-keyed automatically during draft recovery, product save, final contract preflight, and the server's write boundary without changing dimensions, quantities, prices, operations, or existing valid delivery assignments. An ambiguous relationship blocks save beside the affected row with `وابستگی‌های محصول تکثیرشده قابل تشخیص نیست؛ محصول را باز کرده و دوباره ذخیره کنید`; the server returns a structured 422 validation response rather than a generic 500. Re-saving the corrected row clears the error without discarding the rest of the draft.
Duplicating a remaining-stone child opens `انتخاب منبع برای نسخه جدید` inside the same central modal instead of creating a row immediately. Its editable configuration and saved operation rates become a draft, the prior source is suggested first but never selected or consumed automatically, and the seller must explicitly choose a compatible remaining source. A successful duplicate has zero base material price, independent row and add-on identities, geometry-recalculated operation quantities, and a new allocation appended to the selected source's stable order. Cancellation or lack of a compatible source creates and consumes nothing.
_Avoid_: copying delivery assignments, nested graph identities, stair-system grouping, parent-child indexes, source/allocation identity, or other links that make the duplicate depend on the original row; silently reusing the old remaining source; returning an expected identity conflict as `Server error`; or blocking duplication when an explicit compatible allocation can be created safely

**مالکیت عملیات محصول قرارداد**:
Every tool, finishing, and operation group belongs to one stable contract-product row through an independent identity. Duplicate internal identities, including automatically materialized no-operation groups, are repaired silently during draft recovery, atomic product save, final contract preflight, and the server's transactional write boundary only when every selection has one certain owner group inside one certain product and its coverage, edges, quantity, rate, and amount remain unambiguous. A safe repair rebuilds the affected product's complete operation subtree with fresh coordinated identities, preserves all commercial facts and valid delivery assignments, becomes part of the active recovery checkpoint, and remains stable across retries. The backend also repairs safe submissions from older or cached clients, while finalized contracts are never rewritten outside an explicit authorized edit and save. Technical evidence records only the draft or contract identity, actor, repair stage, affected row identities, collision kinds and counts, and request correlation identity—not customer, price, product-detail, or complete draft payloads. A selection attributable to multiple products, an ownerless group, a reference outside the product's own operation subtree, or contradictory scopes for one group is ambiguous: submission returns structured 422, preserves the draft, returns to Product Selection, scrolls to the affected row, keeps its edit action available, and shows `ساختار عملیات این محصول قابل تشخیص نیست؛ ابزارها و پرداخت‌ها را بازبینی و دوباره ذخیره کنید`.
_Avoid_: sharing one operation-group, tool-selection, finishing-selection, or derived no-operation identity between duplicated products; asking the seller to repair a safely recoverable identity; changing commercial facts merely to repair technical identity; guessing ownership from catalog identity or array position; repeatedly re-keying a repaired draft; logging complete commercial or customer payloads; or silently rewriting finalized contracts

**تکثیر ردیف خدمات قرارداد**:
Creating a new editable standalone service row by copying its catalog source, quantity, unit price, note, and row images while giving it independent scheduling and row identity.
_Avoid_: copying delivery/execution assignments from the original service row

**نام نمایشی سنگ پله**:
Stair contract product rows use the same compact stone identity style as longitudinal product rows, while stair part, layer, dimensions, and other stair-specific details remain separate row details.
_Avoid_: saving or printing the full catalog product name as the stair product row name

**برچسب نوع ردیف سنگ پله**:
Customer-facing contract lists and printed output label stair product rows by their specific part type: کف پله، خیز پله، or پاگرد.
_Avoid_: showing only the generic سنگ پله label when the row's stair part type is known, or using قائمه instead of خیز پله for riser rows

**نام نمایشی سنگ اسلب**:
Slab contract product rows preserve the full catalog stone identity as the row name, including cut type, material, dimensions, mine, finish, color, and quality. Requested slab dimensions, source slab dimensions, cutting details, and finishing details remain separate row details.
_Avoid_: replacing the slab row name with only a short material/category label such as اسلب - مرمریت, or hiding catalog identity differences inside cutting details

**شماره چک ناقص**:
A check payment saved during sales contract creation without a check number. It remains valid for contract creation and output, while preserving the missing value for later accounting follow-up.
_Avoid_: blocking contract creation only because a check number is empty

**پرداخت مازاد قرارداد**:
A sales contract may receive real payments whose combined amount is greater than the payable contract amount. The contract remains invalid when the combined payment and accepted credit amount is lower than the payable contract amount, but extra real payment may be accepted. The extra amount is calculated from the payment/credit total minus the payable contract amount, must carry a selected explanation, and currently prints as به علت بدهی از قبل rather than as مازاد پرداخت مشتری.
_Avoid_: forcing payment rows to equal the payable contract amount exactly, treating a lower-than-payable payment plan as acceptable, manually typing the extra amount when it can be calculated, or labeling the printed reason as مازاد پرداخت مشتری

**استفاده از باقی مانده مشتری**:
A manually entered payment-plan method that applies a claimed pre-existing customer credit or balance to a sales contract until the accounting system can verify customer balances automatically. It is distinct from new money collected through نقدی شبا، نقدی، or چک, defaults its date to today when entered, appears in contract print/PDF payment output, and warns the user that the contract may expire if accounting finds a mismatch.
_Avoid_: using استفاده از باقی مانده مشتری to record new cash collected now, hiding it from printed payment terms, or treating the manually entered balance as automatically accounting-verified

**نام‌های برنامه تحویل**:
The project manager and receiver names on a delivery schedule are free-text person names. They may be prefilled from project/customer defaults, but multi-part names with spaces are valid and should remain exactly as the user enters them while preparing the delivery plan.
_Avoid_: collapsing multi-part names, removing typed spacing, or replacing an edited delivery name with a default while the user is typing

**برنامه تحویل چاپی**:
The delivery schedule shown in customer-facing PDF and print output. It should prioritize readable delivered item names and a separate delivered amount/metrage column over operational fields that make the table wrap.
_Avoid_: combining item name and delivered amount in one cramped cell when several delivery rows are present

**مشخصات مشتری و پروژه چاپی**:
The compact customer and project identity shown in customer-facing and accounting contract output. It includes the saved project name and address as separate two-column fields, while long project addresses wrap within their field; workshop output remains a separate minimal identity view.
_Avoid_: omitting the saved project name, giving the project name or address an otherwise unnecessary full-width row, or expanding workshop output with the full customer/project section

**سربرگ چاپی قرارداد**:
The repeated customer-facing header on every PDF/print page, containing the Sabalan logo, contract number, contract date, print-time status, and page number.
_Avoid_: showing the contract header only on the first page of a multi-page contract output, or letting page content overlap the repeated header

**چاپ حسابداری قرارداد فروش**:
An internal accounting print/PDF version of a sales contract. It removes the branded customer-facing contract header but keeps a compact plain metadata row with contract number, contract date, print-time status, and the sales account/contract creator so accounting can identify the document without relying on the file name. It keeps مشخصات مشتری و پروژه because accounting needs the invoice/receivable party and project context, keeps all price-bearing product/payment columns and totals, and keeps برنامه پرداخت because accounting needs payment method, amount, due or payment date, check details, and notes.
Normal money values in this accounting copy show تومان only, while the final جمع کل فاکتور shows both تومان and the ریال equivalent.
_Avoid_: using the branded customer-facing header in the accounting copy, removing all contract identity metadata from the accounting copy, hiding the sales account/contract creator, hiding the customer/project identity needed for accounting follow-up, removing payment terms from the accounting copy, removing prices from the accounting copy, showing ریال on every dense table row, or hiding ریال from the final invoice total

**چاپ نمره کارگاه**:
A production-facing print/PDF version of a sales contract for workshop execution. It removes the branded/legal customer-facing header and all price-bearing information, but keeps a compact plain metadata row with contract number, contract date, print-time status, customer name only, and project/destination context so workshop sheets can be identified without exposing unnecessary customer or financial details. جدول اصلی محصولات remains the first major section and keeps all non-price production/detail rows, including product rows, سنگ مصرفی, ابزار, خدمات, برش, پرداخت سنگ, and row توضیحات, while removing purely financial total/discount rows. Price columns are removed entirely rather than left blank, and their width is redistributed to شرح، طول، عرض، مقدار/تعداد، and متراژ. It keeps برنامه تحویل with only ردیف، اقلام، متراژ/مقدار، تاریخ تحویل، and توضیحات.
_Avoid_: exposing prices, full customer identity details, payment terms, legal text, signatures, تحویل‌گیرنده, financial total/discount rows, or blank price columns in the workshop copy, or making the workshop copy hard to identify when printed

**انتخاب نسخه چاپ در حسابداری**:
Accounting chooses sales-contract print/PDF variants from a dropdown on the accounting contract detail page. Sales contract detail keeps the customer-facing original version, while accounting can choose نسخه اصلی، چاپ حسابداری، or چاپ نمره کارگاه.
Only چاپ نسخه اصلی marks the commercial contract as printed. چاپ حسابداری and چاپ نمره کارگاه are internal operational outputs and do not change the contract lifecycle status or printedAt. Print and PDF actions from accounting generate from the current saved contract at action time; internal accounting and workshop variants must not be served from a previously generated PDF cache.
_Avoid_: exposing accounting/workshop print variants as ordinary sales-detail actions, scattering print variants across unrelated buttons, changing contract status when an internal operational print is generated, or reusing a stale accounting/workshop PDF after contract details have changed

**چاپ سفارشی حسابداری قرارداد فروش**:
A temporary per-print accounting output configuration for a single sales contract. Accounting can choose visibility, grouping, section, and column options before printing/downloading, including detailed product rows or a summarized add-ons row. The choices are not saved as reusable templates and do not mutate the contract or its lifecycle status.
Custom print may hide or group existing information, but it does not allow manual editing of contract names, quantities, prices, totals, or real saved rows.
_Avoid_: treating custom accounting print as a saved template system, changing contract data through print settings, manually editing financial truth in the output, deleting real contract rows through print settings, or marking the commercial contract as printed from a custom internal output

**ردیف‌های خلاصه افزونه‌های قرارداد**:
A summarized print grouping mode where normal product rows stay visible with their base product price, while attached ابزار، خدمات، برش، پرداخت سنگ، حکمی, and standalone service add-ons are grouped into compact rows by the same catalog identity across the whole contract. The detailed print mode remains available when those add-ons need to be audited line by line.
In summarized mode, each add-on summary row shows the grouped add-on identity, combined amount, rate when it remains truthful, and grouped مبلغ کل. Product rows keep their base product totals, and جمع کل فاکتور reconciles as base products plus grouped add-on rows minus discount.
Catalog codes are part of the summarized add-on identity when available, so the printed summary remains auditable without expanding every product-level detail.
_Avoid_: losing access to the detailed version, changing the saved contract totals while summarizing, rolling add-ons into each product row, collapsing all add-ons into one generic row, hiding available catalog codes, or grouping unrelated catalog items only because their display names look similar

**خلاصه قرارداد فروش سنگ**:
A fixed sales-side customer-facing print/PDF output option beside the full-detail sales contract. It uses the same summarized add-ons meaning as ردیف‌های خلاصه افزونه‌های قرارداد, but sales users cannot customize sections or columns.
_Avoid_: exposing the accounting custom-print controls in sales, replacing the full-detail sales contract, or treating the summary output as a manual edit of contract data

**طول مصرفی سنگ مصرفی**:
The length shown for سنگ مصرفی is the source or standard length consumed from the material, not the finished/customer-requested product length. The product row shows the finished dimensions; سنگ مصرفی explains the material usage that produced it.
_Avoid_: showing the finished product length as the consumed source length when a standard/source length was used, or hiding the standard length consumed by the workshop

**گروه‌بندی سنگ مصرفی**:
Multiple سنگ مصرفی pieces may be grouped in print/PDF output only when they come from the same source material and have the same consumed source dimensions. When consumed pieces come from different source materials, each source is shown separately based on the amount used.
_Avoid_: merging different source materials into one سنگ مصرفی row, or expanding identical source pieces into repetitive rows when a grouped quantity and total area is clearer

**نمایش مقدار سنگ مصرفی**:
A grouped سنگ مصرفی row shows the consumed source width, consumed source/standard length, quantity, and total consumed area in a compact form, such as عرض ۴۰cm × طول ۱.۲m × ۳ عدد، جمع ۱.۴۴ متر مربع. Source dimensions and متر مربع may be shown with up to 4 decimal places when needed so the displayed dimensions and displayed area do not imply different calculations.
_Avoid_: showing only one piece area when multiple source pieces are consumed, adding per-piece area when the compact total area is enough, or rounding source dimensions so aggressively that users infer a different متر مربع than the saved consumed area

**بارگیری**:
A logistics-owned execution document that records what was actually loaded for shipment from one customer project, including the selected contract rows, loaded amounts, driver or vehicle details, and resulting remaining amounts.
_Avoid_: treating بارگیری as the customer-facing برنامه تحویل, or editing the sales delivery promise when logistics is recording actual shipment

**محدوده بارگیری**:
Each بارگیری belongs to exactly one customer project and may include deliverable rows from multiple sales contracts for that same project.
_Avoid_: mixing multiple customer projects in one بارگیری, even when the same driver or vehicle carries them together

**جستجوی پروژه در بارگیری**:
A logistics project lookup matches the project, address, customer identity, company identity, and contact numbers tied to the customer or project.
In the new-loading project picker, only projects with at least one positive مانده بارگیری group are shown. Existing draft or historical loading records for a project with no current remaining stay accessible through the loading list for edit, cancellation, or history.
_Avoid_: forcing logistics users to know the project name when the operational clue they have is a phone number, showing non-loadable projects in the new-loading flow, or offering projects for a new loading when logistics has no remaining physical cargo to select

**شروع پیش‌نویس بارگیری**:
A draft بارگیری starts when logistics selects the customer project, so the in-progress shipment can be resumed before rows, driver, or vehicle details are complete.
Customer search before project selection is only navigation/filtering and does not start a draft.
The new-loading wizard sequence is مشتری، پروژه، قراردادها، راننده، مقدار، بازبینی so گارد can authorize driver entry after cargo identity is known but before final loaded quantities are entered.
_Avoid_: treating بارگیری creation as only the final submit action, or keeping meaningful loading progress as a browser-only form

**ادامه پیش‌نویس بارگیری**:
When logistics selects a project that already has an active draft بارگیری, the normal path resumes that draft; creating another active draft for the same project is an explicit exception for simultaneous operational loading.
_Avoid_: silently creating duplicate active drafts for the same project during ordinary loading creation

**مانده بارگیری**:
The remaining amount for logistics is calculated from eligible contracted amounts minus finalized بارگیری amounts, within compatible contract-row/product groupings.
Accounting financial approval is an eligibility gate for which contract rows may enter logistics, but it is not the quantity source for the remaining calculation.
The eligible contracted amount must be the contract row's true deliverable quantity in its loading unit, such as متر طول for longitudinal rows, متر مربع for area rows, or the sold ton/count quantity for tonnage and count rows.
_Avoid_: using برنامه تحویل, draft accounting financial records, unapproved invoice candidates, sales approval, signature, print state, draft بارگیری, unrelated product rows, or a generic row quantity field that does not represent the row's physical deliverable amount as the source of truth for physical remaining

**گروه مانده بارگیری**:
A logistics display grouping that combines remaining amounts only for contract rows with identical logistics-relevant product specs, while preserving access to the individual source contract rows inside the group.
_Avoid_: losing contract-row traceability when showing a grouped remaining amount, or grouping rows whose physical loading specs differ

**خلاصه گروهی بارگیری**:
The مقدار step may show identical selected rows as one grouped summary for readability, but quantity entry for a group with multiple source contract rows stays per source row. The grouped line shows a live summed total and a جزئیات view for the per-contract quantities.
_Avoid_: accepting one grouped total that the system silently splits across source contracts

**جزئیات محصول در بارگیری**:
The product details shown while preparing a بارگیری are production/logistics identifiers: product name and type, deliverable remaining amount and unit, dimensions, quantity, ابزار, پرداخت سنگ, selected services or cuts, and row notes when they help identify what is being shipped.
_Avoid_: showing price, discount, payment, accounting information, or source/consumed-stone explanation rows in the logistics loading workflow

**انتخاب ردیف برای بارگیری**:
In the new-loading wizard, selecting contract product rows only marks them as candidates for the بارگیری. Quantity entry and validation happen later in the مقدار step.
_Avoid_: mixing product-row selection with loaded-quantity entry in the contract inspection step

**مقداردهی بارگیری**:
Selected rows enter the مقدار step grouped by selected driver. The logistics operator enters the amount each driver carries for each selected row; blank or zero means that driver does not carry that row. A row is valid only when its summed allocation across drivers is positive and within remaining/tolerance rules, and each selected driver must carry at least one positive allocation.
_Avoid_: automatically defaulting a selected row to its full remaining amount, finalizing a selected row with no carried quantity, or selecting a driver who carries nothing

**تخصیص منبع بارگیری**:
When a grouped remaining line contains multiple source contract rows, the logistics user manually chooses how much the بارگیری consumes from each source row before finalization.
_Avoid_: automatically consuming contract rows behind the user's back, even when the grouped remaining amount is compatible

**خط راس بارگیری**:
A logistics calculation input for length-based loading that represents the common or average piece length used with a piece count to calculate loaded متر طول. In multi-driver loading, خط راس, تعداد, اضافه, and کسر belong to each driver-row allocation, and product-row totals are summed from those allocation calculations.
_Avoid_: treating خط راس as a contract dimension, product catalog field, or separate unit of measure

**اضافه و کسر بارگیری طولی**:
Manual length adjustments applied to a length-based بارگیری calculation after خط راس × تعداد: اضافه increases the loaded متر طول and کسر decreases it.
_Avoid_: hiding these adjustments inside the final amount without preserving how the logistics user calculated it

**تلورانس بارگیری طولی**:
A finalized length-based بارگیری may exceed the current remaining متر طول by up to 0.5m with a warning; under-loading is allowed because it leaves remaining for later shipment.
_Avoid_: blocking small length-based overages caused by normal loading variance, or applying the 0.5m tolerance to unrelated units without a separate business decision

**وضعیت بارگیری**:
Only finalized بارگیری records reduce logistics remaining amounts. Draft بارگیری records are editable preparation records, and cancelled بارگیری records stay in history without reducing remaining.
Draft بارگیری records support normal preparation CRUD before finalization, including updating notes, rows, quantities, source allocations, and selected driver/vehicle pair, and cancelling or deleting the draft when it should not proceed.
After project selection starts or resumes a draft, wizard changes are saved on step transitions and by the explicit ذخیره پیش‌نویس action; finalization saves the draft first and then finalizes it.
_Avoid_: reducing remaining from draft loading entries, deleting cancelled logistics history, or using draft CRUD semantics for finalized loading records

**انتخاب راننده بارگیری**:
گارد sends a physically present queued driver into the loading area through ورود برای بارگیری, making that queue turn visible to Logistics as an available loading driver. Logistics may then select one or more available loading drivers for a draft بارگیری; selecting a driver reserves that queue turn for the draft.
At least one available loading driver must be selected before Logistics can continue to مقدار or finalize the loading.
While the loading remains a draft, Logistics may return to the راننده step to add or remove selected drivers. Added drivers become رزرو شده, removed drivers return to وارد محوطه بارگیری, and finalized driver evidence is locked.
Logistics does not see available loading drivers as a queue-ranked list; it chooses based on operational suitability such as driver identity, plate, and vehicle type. Drivers reserved for another draft remain visible but disabled with the reserved loading number.
_Avoid_: showing every registry-active driver to logistics, letting logistics select drivers who are still merely waiting in the گارد queue, requiring a system request from Logistics before گارد can send drivers into loading, or letting logistics manage the registry or queue from بارگیری

**راننده آماده بارگیری**:
A driver queue turn that گارد has moved from در انتظار to وارد محوطه بارگیری. The driver is physically allowed toward loading and is visible to Logistics, but is not attached to a specific بارگیری until Logistics selects it.
_Avoid_: treating وارد محوطه بارگیری as a reservation for a particular loading draft, or treating every waiting queued driver as available to Logistics

**قفل بارگیری نهایی‌شده**:
A finalized بارگیری is immutable because it affects remaining amounts and accounting visibility. Mistakes after finalization are handled through cancellation or correction records rather than silent edits.
_Avoid_: editing finalized loading quantities, driver details, or source rows in place

**اصلاح بارگیری نهایی‌شده**:
Major or document-level mistakes in a finalized بارگیری are handled by cancelling the loading record, while small quantity mistakes are handled by linked correction records that preserve the original finalized document.
_Avoid_: silently changing finalized بارگیری data, or forcing every small quantity adjustment to cancel and recreate the whole loading

**اعتبارسنجی اصلاح بارگیری**:
Correction records follow the same unit, remaining, and tolerance rules as normal بارگیری lines. A correction that increases loaded quantity reduces remaining, and a correction that decreases loaded quantity increases remaining.
_Avoid_: using corrections to bypass loading tolerance or unit compatibility rules

**راننده بارگیری**:
Logistics selects the driver and vehicle for بارگیری only from queue turns that گارد has already moved into وارد محوطه بارگیری, while every بارگیری still saves its own driver and vehicle snapshot for historical accuracy.
One بارگیری may include multiple driver/vehicle queue turns when one delivery needs more than one vehicle. Loading quantities are allocated per selected driver, and the loading's product-row totals are derived from the sum of those driver allocations.
_Avoid_: letting logistics own the reusable driver registry, making old loading documents depend on the current editable driver profile, treating gate approval as approval of loading quantities, or recording multi-driver loading quantities without preserving which driver carried which allocation

**راننده در نهایی‌سازی بارگیری**:
A draft بارگیری may exist without driver information, but finalization requires a complete driver and vehicle snapshot.
If an older draft contains manually entered driver or vehicle data, that data may remain as draft history, but finalization requires reselecting an active گارد-owned driver/vehicle pair so the final snapshot comes from the registry.
_Avoid_: blocking early loading preparation only because the truck is not known yet, finalizing shipment evidence without driver details, or treating legacy manual draft data as an acceptable final driver selection

**ثبت راننده و خودرو**:
A گارد-owned registry of reusable fixed driver/vehicle pairs that may be activated or deactivated for operational use. A complete pair requires the driver's first name, last name, mobile, national code, home address, relative's mobile, vehicle plate and type, plus at least one categorized photo each of the driver's license, vehicle card, and driver; every category may contain additional photos without a count limit.
An active registry pair has valid credentials and may join the driver queue, but registry activation alone does not make it selectable by Logistics.
A never-used pair may be permanently deleted; once referenced by an operational record it may only be deactivated, and its historical snapshots remain unchanged by later registry edits.
_Avoid_: رجیستر راننده و خودرو, treating registry activation as current physical presence, splitting the reusable registry into independent driver and vehicle lifecycles, allowing incomplete pairs into operational use, duplicating reusable driver/vehicle records inside logistics, keeping logistics create/edit/delete controls for the registry, hard-deleting a used pair, or changing historical shipment snapshots when the registry changes

**صف نوبت‌دهی رانندگان**:
A گارد-owned time-ordered queue of registry-active driver/vehicle pairs that are physically present and waiting for loading. Queue presence makes a pair selectable by Logistics, while entry time determines display priority rather than restricting selection because a product may require a specific driver or vehicle.
Queue priority is shown in گارد's waiting queue, not as ordering guidance in Logistics. Drivers returned from وارد محوطه بارگیری back to در انتظار appear first to preserve their turn rights.
_Avoid_: راننده فعال for a merely present driver, treating FIFO as a hard selection rule, manually reordering entry priority, or exposing absent registry drivers to Logistics

**نوبت راننده**:
One historical occurrence of a registry-active driver/vehicle pair joining the queue. Its statuses are در انتظار, وارد محوطه بارگیری, رزرو شده, اعزام شده, and خارج از صف; گارد moves a waiting turn into the loading area through ورود برای بارگیری, Logistics may reserve an available loading turn for a draft بارگیری, releasing a loading reservation returns the same turn to وارد محوطه بارگیری, and an explicit گارد removal ends it as خارج از صف.
The same pair cannot hold two current turns, but may receive a new turn after dispatch or after leaving and physically returning.
گارد may also return a driver from وارد محوطه بارگیری back to در انتظار when the driver should no longer be in the loading area; that turn keeps priority rights and appears first among waiting turns. This rollback requires a short reason, with preset choices for common reasons such as بارگیری آماده نبود, اشتباه در ورود, تغییر برنامه بارگیری, and راننده موقتاً برگشت به صف.
گارد cannot return a رزرو شده turn directly to در انتظار; Logistics must first release it from the draft so it returns to وارد محوطه بارگیری.
_Avoid_: calling reservation release a cancellation, overwriting an earlier turn when a driver returns, allowing one turn to be reserved by multiple loadings, returning a Logistics-released loading driver all the way to در انتظار, or losing original queue priority when a draft releases its reservation

**خودرویی گارد**:
The گارد vehicle area is a workflow hub whose ordered operational tabs are تردد خودرو, تراکنش خروجی, تراکنش ورودی, نوبت‌دهی رانندگان, and ثبت راننده و خودرو, while shared counters may remain on a dashboard.
_Avoid_: combining reusable registry maintenance, gate movement history, inbound loaded-vehicle work, and outbound sales exit recording into one large data-entry page

**تردد خودرو**:
A گارد-owned gate movement record for a vehicle entering or leaving the facility, including its exact gate time and movement purpose.
_Avoid_: treating تردد خودرو as the same document as بارگیری, or using gate movement approval to validate contract rows or loaded quantities

**تردد متفرقه**:
A one-time گارد gate movement for a driver/vehicle that should be recorded for entry or exit history without becoming an active reusable driver/vehicle pair for logistics.
_Avoid_: cluttering the reusable driver/vehicle registry with every one-time supplier, customer, or visitor movement

**خروج با سواری شخصی مشتری**:
A lightweight outbound sales movement where the customer takes goods with a personal vehicle. It must be tied to the customer or linked بارگیری/project and must record the exact exit time, without requiring a reusable driver/vehicle pair.
_Avoid_: forcing customer personal vehicles into the reusable logistics driver/vehicle registry, or requiring freight settlement fields for a customer pickup

**Canonical Driver and Vehicle Master Data (supersedes ثبت راننده و خودرو)**:
Internal-driver eligibility is an HR-owned effective period attached to Personnel. The internal driving profile, licence facts, company vehicles, effective plates, and effective driver–vehicle assignments are independently permissioned Vehicle Operations facts. Guard owns independent external-driver and external-vehicle identities and their lifecycle evidence. A driver and a vehicle are combined only at physical Guard admission, where the queue turn freezes the identities and plate that actually arrived.
The former `SecurityVehiclePair` registry and its queue admissions are historical source evidence only: they remain readable for prior movements, loadings, photos, and audits, but cannot be created, edited, deleted, photographed, admitted, or selected for any new operation. New master records begin in DRAFT, become operational only after explicit readiness-checked activation, and preserve lifecycle and effective-period history. Company vehicles use DRAFT, ACTIVE, OUT_OF_SERVICE, and ARCHIVED; external drivers and vehicles use DRAFT, ACTIVE, RESTRICTED, and ARCHIVED. Permanent deletion is limited to dependency-free unused drafts.
_Avoid_: granting HR authority over licence/profile fields, granting Vehicle Operations authority over Personnel eligibility, granting Guard authority over internal Personnel facts, reusing a legacy combined pair for a new queue turn or loading, treating a mutable plate as vehicle identity, or exposing another workspace's audit evidence through a broad master-data permission

**زمان خروج فروش**:
The official outbound sales exit time is the گارد-recorded gate time when the vehicle physically leaves. It is separate from the logistics بارگیری finalization time.
_Avoid_: treating logistics finalization time as proof of physical gate exit

**وضعیت خروج فروش**:
An outbound sales movement is آماده خروج after logistics finalizes بارگیری, خارج شد after گارد records the physical gate exit time, and لغو خروج when the gate movement is voided because it was created by mistake or the vehicle did not leave.
_Avoid_: adding an approved-for-loading status that makes گارد responsible for logistics loading correctness

**ورود خودروی پر**:
A گارد inbound loaded-vehicle movement whose purpose is one of خرید بیرونی, برگشت از فروش, or امانی.
_Avoid_: recording inbound loaded cargo without a movement purpose, or mixing inbound loaded-vehicle purposes with outbound sales loading

**وضعیت ورود خودروی پر**:
An inbound loaded-vehicle movement is ثبت ورود when the entry time is recorded, تکمیل اطلاعات when required follow-up details such as documents, settlement, or attachments have been completed, and لغو ورود when the entry record is voided as a mistake.
_Avoid_: deleting inbound gate history to correct mistakes, or treating an incomplete paperwork state as if all entry evidence has been captured

**تسویه بارنامه ورود**:
Trip-specific settlement information captured on an inbound loaded-vehicle movement, including the delivery price and bank/card owner details needed for بارنامه settlement.
_Avoid_: storing trip-specific settlement truth only on the reusable driver/vehicle registry, or making settlement history depend on later registry edits

**پیوست تردد**:
A categorized photo or file attached to a گارد gate movement, such as vehicle/plate, driver/document, بارنامه, purchase invoice, cargo, or other evidence.
_Avoid_: storing gate photos as uncategorized blobs that cannot later be filtered or audited by evidence type

**گزارش شیفت گارد**:
An append-only operational log for one planned security shift, made of immutable گزارش لحظه‌ای rows and گشت‌زنی sessions. Ending a shift remains a deliberate closure action, but the main shift content lives in timestamped log entries rather than one free-text summary form.
New entries and patrols are recorded only against the currently active planned shift session for the authenticated security user; manager reconstruction may repair the session boundary but does not backfill log entries or patrols.
_Avoid_: گزارش سرپرست, deleting log rows, forcing duplicate final-summary text when the log already records the shift, or hiding patrol sessions inside unstructured notes

**تصاویر گزارش لحظه‌ای گارد**:
The image evidence attached to one گزارش لحظه‌ای row. Its preview gallery is bounded to that row so the viewer can move among its images without losing which event supplied the evidence; an image opens fit-to-screen and supports zoom in, zoom out, and reset for inspecting fine detail.
_Avoid_: mixing images from unrelated timeline rows into one gallery, showing only an uninspectable thumbnail, preventing inspection of full-resolution detail, or detaching image evidence from its report row

**اصلاح حسابرسی‌شده جلسه شیفت گارد**:
A manager correction of a recorded shift start or finish, or reconstruction of either missing boundary, using asserted actual times and a mandatory reason while preserving every original recorded timestamp or the fact that no click occurred. Operational views and reports use the corrected effective times but mark them visibly as manager-corrected, while audit history permanently retains the original evidence, correcting manager, correction time, and reason.
Corrected times may fall outside the planned slot but cannot be in the future, must form a valid start-before-finish interval, must contain every retained patrol and shift-timeline event, and cannot overlap another shift session for the same guard. Unusual deviation from the planned slot requires an explicit warning and confirmation while the mandatory reason remains the accountable explanation.
It is distinct from اصلاح زمان حضور: physical arrival and operational shift-session boundaries are corrected through separate audited actions and never silently update one another.
Authorization belongs to users with management permission for the Security workspace, including system administrators, rather than every user carrying a generic manager role.
اصلاح‌شده توسط مدیر is audit provenance rather than a replacement lifecycle: reconstructing only the start of a currently ongoing shift leaves it فعال with the correction marker, while a fully reconstructed past shift is پایان‌یافته with that marker.
_Avoid_: silently editing shift timestamps, disguising a missed action as a guard click, losing the original recorded time, hiding correction provenance in reports, creating unaudited historical shift sessions, placing evidence outside the corrected session, accepting contradictory guard-session overlaps, coupling shift correction to physical-arrival correction, granting correction authority to unrelated managers, or treating correction provenance as a mutually exclusive shift status

**بستن اجباری شیفت گارد**:
A Security manager closure of an active shift at the current authoritative server time when the guard cannot complete the ordinary closure. It is displayed as بسته‌شده توسط مدیر and remains distinct from asserting or correcting a historical operational finish time.
_Avoid_: using force-close to manufacture an earlier finish, labeling a historical correction as a current forced closure, or hiding the accountable manager and reason

**پایان واقعی شیفت گارد**:
The authoritative server timestamp captured when the guard submits the final ثبت پایان شیفت confirmation after providing the closure summary. Opening or later cancelling the closure dialog does not end the shift.
_Avoid_: treating the first dialog-opening click as completion, using an untrusted browser clock as the authoritative time, or presenting time spent completing the closure confirmation as server delay

**زمان ثبت عملیات شیفت گارد**:
The single unrounded server timestamp captured immediately when the confirmed shift-start or shift-finish request reaches its handler and then reused for persistence and response. The interface reflects the successful value immediately and prevents duplicate submission; minute-level divergence after server receipt is a defect, while untrusted browser time is never substituted for network transit before receipt.
_Avoid_: capturing a later timestamp after database checks, snapping an actual action to the planned slot, rounding the persisted time, trusting the client clock as authority, or leaving the user waiting for periodic refresh after success

**افراد مرتبط در گزارش لحظه‌ای گارد**:
The reporter of a گزارش لحظه‌ای is always the authenticated security user who owns the active shift session, but the related people attached to the report are active organizational personnel. New report participants should support پرسنل سازمانی, including people without a system login, while old user-based participants remain visible for historical compatibility.
_Avoid_: limiting related people to users with login accounts, changing the report author into a personnel record, or losing old user-based participant history during migration.

**Personnel-linked Guard instant-report history**:
The Guard-manager-only historical view of ordinary Guard instant reports grouped by the organizational personnel recorded as related people. Global ADMIN users and users with Guard-workspace admin permission may access it; Guard view/edit permission alone is insufficient, and the same boundary applies to its APIs and evidence access rather than only its navigation. Although the view belongs to the Guard workspace, its directory covers all organizational personnel eligible to be related to a Guard instant report across every department, including people without system login accounts; it is not a directory of Guard personnel. Inclusion in this history records association with an observation; it does not assert that the person committed a violation or that any allegation was adjudicated. One report may appear in the histories of multiple related personnel, while the authenticated guard remains its reporter. Active and inactive personnel remain discoverable because deactivation does not erase history; the directory initially shows active personnel and offers an employment-status filter and search that can find inactive personnel. Both active and voided reports remain in the history because voiding preserves audit evidence rather than deleting it. The history initially shows active reports and offers active, voided, and all status filters; a voided report is visually distinct and exposes its void time, reason, and actor.
_Avoid_: calling the history a violation record, treating association as guilt or disciplinary judgment, granting access through Guard view/edit permission, enforcing access only in the interface, limiting it to Guard personnel or personnel with system accounts, hiding historical reports after personnel or report deactivation, obscuring void metadata, visually presenting a voided report as active, or changing the reporter into the related person

**نوع گزارش لحظه‌ای گارد**:
A manager-defined active/inactive category for shift log rows, with name, optional description, and display order. It classifies a mandatory timestamped گزارش لحظه‌ای description without adding severity or workflow behavior yet.
Report types are managed in تنظیمات گارد, a workspace-local manager/admin page for گارد-owned settings.
When a report type is selected in the create form, its configured description appears as helper text below the dropdown. Shift log lists, history, and detailed PDFs show the report type name and configured type description separately from the guard-written event description; empty type descriptions are omitted.
_Avoid_: hard-coded report type dropdowns, optional row descriptions, treating type configuration as patrol workflow rules, or merging the configured type description with the actual event description.

**دسته‌بندی گزارش لحظه‌ای گارد**:
A manager-defined parent grouping for instant report types. It helps guards first choose the operational area of the event before selecting the specific نوع گزارش لحظه‌ای.
Categories have manager-controlled name, optional description, display order, and active/inactive state; inactive categories are hidden from new guard report entry while historical reports remain readable.
_Avoid_: using دسته‌بندی as the final report type, making it free text during report entry, deleting categories to hide old history, or mixing it with severity/approval state

**نوع گزارش لحظه‌ای گارد - دسته‌بندی‌شده**:
A manager-defined active/inactive type inside one دسته‌بندی گزارش لحظه‌ای, with name, optional description, and display order. Existing uncategorized types should be migrated into a default عمومی category until managers reorganize them.
If the parent category is inactive, its types are hidden from new گزارش لحظه‌ای creation even when the type itself is active; managers can still see and edit them in settings, and historical reports keep showing both category and type.
Managers may move a type between categories; historical report rows follow the current type/category configuration in this pass rather than snapshotting old category names.
_Avoid_: leaving a type without a category, showing active types from an inactive category in guard entry, hard-coding the category/type choices in the UI, adding category snapshots without a separate audit decision, or merging the configured type description with the actual event description

**انتخاب دسته‌بندی در ثبت گزارش لحظه‌ای**:
During guard report entry, category is selected before type. The type selector is disabled until a category is chosen, shows only active types in that active category, and changing the category clears the previously selected type.
_Avoid_: submitting a stale type from a previous category, showing all types in one long mobile dropdown, or allowing report submission without a selected type

**شماره ردیف گزارش شیفت**:
A server-generated sequence number scoped to one planned security shift. Each shift starts at row 1 and guards never manually enter or edit the row number.
_Avoid_: global report numbering, client-generated row numbers, or reusing a voided row number for a later entry

**ابطال گزارش لحظه‌ای گارد**:
A visible audit state for a mistaken shift log row, requiring a reason, the voiding user, and the exact void timestamp. Any گارد user with edit access may void any row, and voided rows remain in the normal shift log clearly marked باطل شده.
_Avoid_: deleting shift log rows, hiding voided rows by default, or voiding without a reason

**گشت‌زنی گارد**:
A timestamped patrol session inside a security shift. It starts with one click and a server timestamp, ends with a required description and server timestamp, may happen multiple times in one shift, and one user cannot have overlapping active patrol sessions.
Shift closure is blocked while any patrol session in that shift is still active.
_Avoid_: requiring patrol notes before the patrol happens, storing patrols as free-text shift notes, allowing accidental overlapping active patrols for the same user, or auto-ending patrols during shift closure

**رویدادهای خط زمانی گشت‌زنی گارد**:
The two linked chronological events that expose one patrol inside its shift timeline: a start event at the exact patrol start and a finish event at the exact patrol end. The finish event identifies the guard and includes duration and the required completion description so reports recorded during the patrol remain correctly ordered between the two events.
The same combined chronology appears in the guard's active timeline, the manager's live read-only timeline, and completed shift details; active patrol controls remain separate from the recorded evidence. In printable previews and PDF exports, each completed patrol pair becomes one completion-anchored evidence row with duration and description, without repeating the start and finish timestamps. An unfinished patrol may remain a single incomplete row when it is relevant to the export.
_Avoid_: collapsing patrols in interactive timelines, duplicating one patrol as two PDF rows, hiding intervening shift reports, or shrinking the PDF description column to preserve redundant time and status columns

**گزارش‌های گارد**:
A manager-focused reporting workspace with exactly two report products: گزارش شیفت‌ها and گزارش حضور و غیاب گارد. It is separate from the active گزارش شیفت گارد workflow: managers search completed shifts directly, preview the selected evidence, and generate a scoped PDF instead of first choosing an analytical date range or report format.
_Avoid_: mock analytics, decorative KPI collections, performance-report mode as a competing third product, requiring a date range before a manager can find a completed shift, or showing labels that do not match the exported evidence

**شیفت قبل گارد**:
The finished security shift session with the most recent actual `endedAt`, whether normally closed or force-closed by a manager. It is based on actual completion order rather than the previous planned rota slot.
_Avoid_: selecting the prior scheduled slot when another session finished later, or excluding force-closed sessions from the latest completed shift

**دسته‌بندی پوشش شیفت‌های گارد**:
The shift-coverage list has two operational categories: جاری و در انتظار contains the active shift first followed by upcoming waiting shifts nearest-first, including unresolved exceptional states that still require action; it initially exposes 10 shifts and reveals 10 more on each request until exhausted. پایان‌یافته contains normally completed and manager-closed shifts ordered by actual finish time newest-first and is not subject to this incremental disclosure.
Each row links truthfully to its available evidence: a waiting slot opens planned-shift details, an active session opens its live shift report, and a finished session opens its completed shift report.
_Avoid_: mixing completed history into live coverage work, ordering waiting shifts farthest-first, ordering completed shifts by planned slot time, hiding unresolved coverage states in history, or presenting an empty waiting slot as an existing shift report

**شیفت نیازمند بررسی مدیر**:
A planned Security slot whose scheduled end has passed without any shift session. It remains an actionable exception in جاری و در انتظار until a Security manager either reconstructs the forgotten shift with actual start and finish times or confirms that no operational shift occurred; both outcomes require a reason and permanent audit evidence.
_Avoid_: leaving an ended untouched slot as ordinary در انتظار, silently assuming absence, moving the unresolved slot into completed history, or resolving it without an accountable manager decision

**گزارش شیفت‌ها**:
The manager-only completed-shift report product. It lists completed shifts newest-first, supports direct search by shift identity, guard, Jalali date, or operational state, and allows one or several shifts to be selected, previewed with their complete read-only timelines, and exported as one scoped PDF. Date range is an optional advanced filter rather than the required entry point.
_Avoid_: limiting reporting to only شیفت قبل گارد, immediately downloading before preview, requiring a date range for ordinary retrieval, exporting active shifts, or flattening evidence from different shifts into an unscoped feed

**بخش‌های مبتنی بر شواهد در PDF تفصیلی گارد**:
Both the latest-shift PDF and personnel-performance PDF omit empty per-shift patrol, attendance, closure-summary, participant, and image sections, while retaining sections with real recorded activity. The standalone date-range attendance PDF keeps its consistent analytical structure because zero attendance values are meaningful data there.
_Avoid_: printing placeholder operational sections in detailed PDFs, or removing meaningful zero-valued rows from the aggregate attendance report

**عملکرد نیروهای گارد**:
The manager-only reporting view of assigned Security personnel over a selected date range, covering their planned duties, attendance, sessions, coverage exceptions, patrols, and timestamped shift-log activity. It is separate from company-wide attendance reporting.
_Avoid_: treating all employees as Security personnel, or reducing guard performance to only a company attendance percentage

**شواهد عملیاتی نیروی گارد**:
The timestamped shift-log descriptions, patrol completion notes, and shift closure summaries for a Security guard within a selected report date range. Managers may inspect them after narrowing the report; they are not default dashboard content.
_Avoid_: exposing operational narratives without report context, or replacing evidence with counts alone

**فیلتر زمینه‌مند گزارش‌های گارد**:
A report filter set whose controls follow the selected reporting scope: quick or custom Jalali date range and common identity filters, with attendance filters for employee reporting and operational-status/activity filters for Security-personnel performance.
_Avoid_: one static filter form that exposes irrelevant controls, or losing the selected filters when the report scope changes

**دسترسی گزارش عملکرد نیروهای گارد**:
Manager-level Security workspace access to the detailed performance view, its operational narratives, and the latest-completed-shift PDF. This access is distinct from ordinary guard self-service and aggregate report viewing.
_Avoid_: protecting detailed personnel performance only by hidden interface controls, exposing guard narratives to generic workspace viewers, or allowing report-page visibility alone to authorize detailed PDF downloads

**خروجی عملکرد نیروهای گارد**:
The manager-only performance PDF may include detailed operational evidence from finished security shifts in the selected date range: shift date/time and status, planned/replacement/temporary coverage person, attendance and delay, closure summary, instant report rows with report type names and descriptions, and patrol sessions. Active shifts are excluded. Both CLOSED and FORCE_CLOSED sessions count as finished, with force-closed shifts clearly labeled.
_Avoid_: exporting active shifts, hiding force-closed status, or exposing detailed operational narratives outside the manager/admin performance export.

**تصاویر گزارش لحظه‌ای در خروجی گارد**:
Images are printed directly beneath their own instant-report row with preserved aspect ratio, up to two images per row, natural continuation across rows or pages, and a caption containing the report row number and original filename. Voided-report images follow the same layout while retaining the report's voided context.
_Avoid_: separating images from their report, stretching or cropping evidence, mixing images from different rows, or omitting identifying captions

**حضور و غیاب در خروجی شیفت گارد**:
Each completed shift in a latest-shift or personnel-performance PDF has a separate attendance section for the guard who actually worked and any recorded replacement or temporary coverage, including recorded arrival, delay, and corrections. Off-duty A/B/C guards are not shown as absent, while the standalone attendance PDF remains the date-range attendance export.
_Avoid_: treating off-duty primary guards as absent, merging attendance into unrelated shift metadata, or replacing the standalone attendance report with shift-specific attendance

**تاریخچه تفصیلی شیفت نیروی گارد**:
A manager/admin-only dedicated page for chronological review of one Security guard's shifts in the selected range. Each expandable shift keeps scheduled and actual coverage, attendance and session timing, exceptions, patrols, closure data, and the complete instant-report audit trail together.
_Avoid_: flattening evidence from different shifts into one unscoped activity feed, showing detailed history to ordinary guards, or losing the report date context when navigating to the history

**گزارش لحظه‌ای باطل‌شده گارد**:
An instant report that remains visible in the shift audit trail and PDF exports with a clear voided state, void time, void reason, and any attached images. It is historical evidence rather than active shift content and does not count toward active-work summary totals.
_Avoid_: deleting voided reports or their images, counting them as active work, or presenting them as active without their void context

**نمایش تاریخچه تفصیلی شیفت**:
The detailed shift-history page defaults to the selected guard's entire record, including inactive/former Security personnel, and orders shifts newest first. A date range is an optional narrowing filter; each shift begins with a compact status and timing header, while its complete audit evidence is revealed in an expandable section.
_Avoid_: inheriting an arbitrary reporting date as a required history boundary, omitting former personnel, loading every shift's full narrative by default, or making a manager search through an unstructured event stream

**داده واقعی گارد**:
Core گارد surfaces use persisted operational data or an honest empty state when no records exist. Missing core sources should be backed by explicit API contracts, while non-core admin-wide security audit widgets stay empty or hidden until a real audit-log model exists.
_Avoid_: simulated counts, delayed fake loading, hard-coded sample users, or admin security metrics that imply audit coverage the system does not actually record

**پروفایل شخصی کاربر**:
The authenticated user's own identity and department profile, available as a core self-service capability independently of workspace membership. It does not grant access to any workspace-owned operational data.
_Avoid_: making self-profile access depend on Sales access, or treating it as a shortcut to workspace permissions

**امور شخص**:
A personal self-service area opened from the user's profile menu, available to every authenticated user independently of workspace permissions. It contains user-owned actions such as submitting personal leave requests, and is separate from organizational personnel management.
_Avoid_: presenting امور شخص as a workspace, confusing it with پرسنل سازمانی, or requiring workspace access before a user can use their own self-service actions.

**درخواست مرخصی کاربر**:
A personal leave request submitted by an authenticated user from امور شخص, using the same business concept as the existing exception-request workflow so approvals, rejections, attendance effects, and security shift coverage can share one leave truth. V1 requests require leave type, start date, end date, and reason; description is optional. Pending requests may be cancelled by the requester, approved by a global admin or global manager, or rejected with a required reason. Global admins and global managers may also create a leave request for a specific user when needed; manager-created requests are approved immediately by default and keep creator, target user, approval, and reason audit fields visible.
Leave requests are not hard-deleted in normal V1 use. Users may edit or cancel their own pending requests, admins and global managers may edit pending requests, and approved requests may be cancelled by admins or global managers only with a required reason.
_Avoid_: creating a separate leave-request object that competes with existing exception requests, making personal leave submission depend on membership in the گارد workspace, treating workspace managers as approvers by default, requiring manager-created requests to go through a pointless self-approval step, hard-deleting leave history, or rejecting/cancelling a leave request without a visible reason.

**نوع مرخصی کاربر**:
The user-facing leave classification for درخواست مرخصی کاربر: استحقاقی, استعلاجی, استعلاجی سازمانی, or بدون حقوق. مرخصی روزانه is the default request shape, not a separate user-facing leave type.
_Avoid_: exposing technical exception names such as VACATION or SICK_LEAVE to users, or mixing hourly leave and mission categories into the first personal leave-request flow.

**پرسنل سازمانی**:
A real person who belongs to a Sabalan department and may appear in operational workflows such as attendance even when they do not have a system login. A system user may be linked to one organizational personnel record, but login access is not required for someone to be personnel.
_Avoid_: treating every personnel record as a login account, hiding non-user personnel from operational attendance, or using system permissions as proof that a person belongs to the workforce

**مدیریت پرسنل**:
An Admin-owned company workforce registry for creating and maintaining organizational personnel independently of login access. Operational workspaces such as گارد consume this registry but do not own the company-wide personnel list.
_Avoid_: hiding company personnel management inside گارد, duplicating the workforce list per workspace, or mixing personnel registry work with user permission management

**اطلاعات پایه پرسنل سازمانی**:
The first personnel registry records only first name, last name, related department, and active/inactive state. Phone, email, national code, payroll data, and identity documents are outside the first version unless a later workflow explicitly needs them.
_Avoid_: forcing login-style contact fields onto non-user personnel, collecting sensitive identity fields before a workflow requires them, or blocking attendance setup on HR/payroll completeness

**تشخیص تکراری پرسنل سازمانی**:
An Iranian National Code match, when available, identifies a potential same-person record and prevents unattended duplication, but a genuine disagreement in verified name, birth date, or identity evidence requires review before linking or merging. Similar full name, phone, or organizational placement produces a duplicate warning only; User migration, Candidate conversion, and rehire link to confirmed existing Personnel after conflicts are resolved.
_Avoid_: treating National Code as permission to merge conflicting identities, treating names as unique identity, automatically merging on similarity, creating another Personnel for a confirmed returning worker, or exposing National Code outside authorized Human Resources access

**غیرفعال‌سازی پرسنل سازمانی**:
The normal way to remove personnel from active operational selection while preserving their historical attendance, mission, exception, report, and future workflow records. Hard deletion is reserved for accidental records with no operational history.
_Avoid_: deleting personnel with history, showing inactive personnel in normal daily attendance lists, or losing historical names because someone left the company

**سوابق تاریخی پرسنل**:
Operational records that report on personnel should preserve the relevant identity and department as they were at the time of the operation. A later department change updates the current personnel profile but does not rewrite historical attendance or report context.
_Avoid_: recalculating old attendance under a person's current department, or making historical reports depend only on mutable personnel profile fields

**مهاجرت پرسنل سازمانی**:
Introducing organizational personnel should preserve existing user-based attendance and related history through an incremental compatibility migration. Existing users receive linked personnel records, existing attendance links are backfilled to personnel, and new attendance code reads and writes personnel while temporary legacy user links may remain only for compatibility.
_Avoid_: rewriting the visible meaning of historical attendance, dropping old user attendance during migration, or blocking non-user personnel until every legacy relation is removed

**کاربر سیستم**:
A login identity for accessing Sabalan ERP. Every system user should be linked to an organizational personnel record, while many personnel records may have no system user.
_Avoid_: using user accounts as the workforce roster, creating login access just to record operational attendance, or keeping user-only people outside the personnel roster

**اتصال کاربر به پرسنل**:
Creating a system user should default to creating or linking the corresponding organizational personnel from the user's name and department, while also allowing admins to attach the user to an existing personnel record. One personnel record may be linked to at most one system user.
_Avoid_: creating duplicate personnel when a matching same-department person already exists, forcing a login account for existing non-user personnel, or allowing multiple users to represent the same personnel record

**برنامه من گارد**:
The month-selectable personal view of a security user's published shift duties: planned assignment, replacement duty, and temporary coverage. It spans past, current, and future Jalali months, while full rota and coverage visibility remains manager-only.
_Avoid_: using a static date input, showing a guard the entire team's rota, or omitting temporary coverage from the user's own schedule

**بازخورد عملیاتی گارد**:
The workspace feedback pattern: inline validation for field-level corrections, non-blocking in-app notices for routine outcomes, and explicit in-app confirmation or reason dialogs for destructive or audited actions.
_Avoid_: native browser alerts or prompts, generic errors detached from their operation, or confirmations for harmless navigation

**داشبورد گارد**:
A shared operational-awareness surface for users of the گارد workspace. Permitted users receive today's attendance conditions and navigation, while active-shift identity and live reports are visible only to the active guard and security managers/admins; managers/admins remain read-only on the dashboard and complete shift-report view.
_Avoid_: treating the entire dashboard as manager-only, duplicating attendance or shift-report operations on it, exposing another guard's active-shift identity or records to ordinary read-only users, or preventing managers/admins from observing the active shift

**وضعیت امروز گارد**:
The dashboard's calendar-day attendance summary for today's roster, limited to غایب، تأخیر، مأموریت، and مرخصی. These are independent operational conditions rather than parts of one total: غایب and تأخیر use the derived attendance classification, while مأموریت and مرخصی count approved authorizations overlapping today, so one person may contribute to more than one value. The summary is independent of the active security shift, whose live-report timeline may cross midnight.
_Avoid_: including total or present personnel, adding a dashboard date picker, redefining the summary around the active shift session, forcing the four values to be mutually exclusive, or filtering مأموریت and مرخصی only by the primary attendance status

**طراحی عملیاتی موبایل گارد**:
Every گارد route follows one minimal mobile-first RTL interaction language with compact Persian headings, teal primary actions, neutral surfaces, semantic labelled states, structured mobile lists, focused forms, independent data states, and purposeful motion. Desktop may retain compact semantic tables where row comparison matters, while mobile exposes essential row identity and state first and places secondary detail behind expansion without ordinary horizontal scrolling.
_Avoid_: treating manager/config/report pages as a lower-quality responsive afterthought, reviving the older red/rose security theme, table-only mobile views, cramped side-by-side fields that break Persian labels, card-inside-card decoration, or using color without a Persian state label

**خروجی گزارش‌های گارد**:
A PDF rendition of the exact shift and personnel scope that an authorized manager has selected and previewed. Its minimal identity contains the concise Persian report title, selected scope, essential timestamps and states, useful evidence rows or timeline, generation timestamp, and page numbering; decorative charts, helper text, controls, repeated metadata, empty columns, empty sections, and oversized branding are omitted.
_Avoid_: ambiguous PDF buttons, downloading before preview, ignoring the selected scope, exporting sensitive operational data outside authorization, or filling the document with interface copy and decorative summaries

**دو نوع خروجی گزارش گارد**:
Security reporting has two distinct export families. گزارش شیفت‌ها exports complete read-only evidence for one or several selected completed shifts. گزارش حضور و غیاب گارد exports attendance for one or several selected shifts and either all, one, or several selected personnel within that scope.
_Avoid_: a generic performance-report mode, one ambiguous PDF action that changes meaning, or applying a personnel filter to hide unrelated rows from a shift's canonical operational timeline

**صادرکننده گزارش گارد**:
A security manager, admin, or explicitly authorized report viewer who may preview and generate گزارش شیفت‌ها and گزارش حضور و غیاب گارد within their authorized scope. A regular guard may operate their own active گزارش شیفت گارد but cannot gain report export access merely by working a shift.
_Avoid_: granting personnel attendance export to every user who can work a security shift, or relying only on hidden front-end buttons to protect report data

**محتوای خروجی گزارش گارد**:
The attendance export contains the selected shift identities and personnel scope, generation time, a concise useful summary, and the applicable attendance facts for each selected person and shift, including state, expected time, actual movements, and authorized mission or leave context when relevant. The shift export keeps each selected shift's complete timeline and audit context together.
_Avoid_: a report with no scope identity, omitting selected absent personnel, treating mission or leave as fabricated physical presence, mixing different shifts into an unscoped activity feed, or printing fields with no value or decision relevance

**تقویم سالیانه سبلان**:
A company-wide calendar authority for marking days as holidays and recording events. It is informational until a specific workflow explicitly chooses to consume it, so existing attendance, shift, contract, and delivery behavior does not change implicitly.
Each calendar entry has a date, holiday flag, title, description, event type, and active/inactive state; first-version event types are تعطیل رسمی, تعطیل شرکت, رویداد داخلی, یادآوری, and سایر.
One date may have multiple active entries, and the date is considered a holiday if at least one active entry for that date is marked as a holiday.
_Avoid_: hidden side effects on operational workflows, treating admin calendar events as shift reports, recurring rules, half-day schedules, or scattering company holiday definitions across workspaces

**چرخه شیفت گارد**:
A continuous three-person rotation in A→B→C order using fixed 12-hour slots that start at 07:00 and 19:00. Each person works one slot and then rests for two slots before their next planned slot.
_Avoid_: asking managers to manually tune shift duration for the normal annual plan, assigning each person permanently to day or night, scheduling overlapping base slots, or changing a started plan's timing

**برنامه سالانه شیفت گارد**:
A generated schedule with a date range and exactly three ordered primary guards. The normal annual plan uses fixed 07:00/19:00 shift boundaries and 12-hour slots; managers define the A/B/C order and generation dates, not the slot duration. Publishing a plan is an operational activation event: if the published schedule contains the current time, the current slot's assigned guard becomes the active shift worker immediately and their attendance is recorded with the server timestamp. If a plan is published mid-slot, the slot keeps its scheduled 07:00/19:00 boundary while the session start and attendance time remain the real publish timestamp. Mid-year primary changes create a future plan revision, while other eligible security personnel remain substitutes outside the base cycle. Draft plans may be deleted by a manager before publication, but published plans are retained as operational history and should be replaced, superseded, or explicitly cancelled rather than physically deleted.
_Avoid_: exposing normal annual-plan timing as free-form manager inputs, publishing a current schedule that still waits for manual shift start, rewriting started slots, placing one person in multiple primary positions, or silently inserting substitutes into the A→B→C rotation

**جمعیت عملیاتی جاری گارد**:
The three A/B/C primary guards in the current published annual shift plan are the people shown in shift-specific dashboards, performance reports, filters, and PDFs. During a gap with no plan covering the current time, the latest non-superseded published plan remains authoritative; with no published plan history the population is intentionally empty and managers are guided to publish one. Substitutes appear only in the historical shifts they actually covered; workspace access alone never makes an admin, manager, or developer part of this population, and historical records retain their original people.
_Avoid_: using this population for company personnel attendance, deriving reportable guards from workspace access, falling back to all users when no current slot exists, showing substitutes as current primary guards, or rewriting historical shift participants when the current A/B/C plan changes

**نامزد پیکربندی نیروی گارد**:
An otherwise eligible person outside the current A/B/C population may appear only in manager-only shift-plan creation, replacement, or temporary-coverage controls so future assignments remain possible. The candidate does not enter normal operational reports or people lists unless they actually cover a historical shift or become a published A/B/C guard.
_Avoid_: exposing configuration candidates in normal dashboards and reports, or making future A/B/C and replacement assignment impossible by hiding candidates from managers

**جایگزینی شیفت گارد**:
A slot-specific exception that preserves the annual A→B→C baseline while assigning another eligible security user as the actual worker for an absent planned guard. Later planned assignments do not shift, and rest or overlap conflicts require a manager override reason.
_Avoid_: regenerating the rotation after leave, transferring ownership of later slots to the substitute, or hiding rest violations created by coverage

**نیروی مؤثر شیفت فعال گارد**:
The person actually responsible for the current active shift session, whether they are the originally planned guard, a replacement, or temporary coverage. Authorized active-shift awareness identifies this person first and retains the planned-versus-coverage relationship as secondary context.
_Avoid_: presenting the originally planned guard as currently on duty when someone else is operating the session, or flattening replacement and temporary coverage into an unexplained name

**تحویل شیفت گارد**:
The controlled boundary where the outgoing guard submits the shift report and ends the active session before the incoming assigned guard starts the next one. The first active session of a newly published current plan may be opened by publication itself; later boundaries are not auto-started in the first version and still require deliberate closure/start handling. A manager may force-close an unclosable session only with an audited reason.
_Avoid_: starting overlapping active shift sessions, closing a normal shift without its report, or silently correcting a forgotten shift end

**عدم حضور احتمالی شیفت گارد**:
A coverage alert when the assigned or replacement guard has not registered arrival after the plan's lateness threshold. It remains visible for manager review until the slot is covered, corrected, force-closed, or completed.
_Avoid_: treating this as final absence before manager action, hiding the alert because the person later arrived, or using color without a Persian label

**نفرات گارد**:
The گارد people area covers employee attendance, shifts, exceptions, missions, and security personnel workflows. Drivers are not managed here; they belong to خودرویی because their operational role is tied to vehicle movement.
_Avoid_: mixing driver/vehicle registry work into personnel attendance workflows

**کاربر واجد شرایط گارد**:
An active system user linked to organizational personnel who already has a security workspace permission or security role and can therefore be assigned into نفرات گارد. General active personnel are visible in attendance workflows but are not selectable for security shift plans, patrol ownership, shift logs, or replacement coverage unless they have linked user access to گارد.
_Avoid_: offering every active personnel record in security personnel assignment, assigning non-login personnel to authenticated shift work, or using placeholder sample users when no eligible user exists

**فهرست حضور و غیاب گارد**:
A date-effective roster of active company personnel whose ورود و خروج is managed by گارد. Managers may add or remove personnel with immediate effect for today, while each historical date, attendance report, and attendance PDF/Excel uses the roster membership effective on that date.
_Avoid_: deriving company attendance from the A/B/C shift plan or workspace access, automatically including every active person after the initial roster setup, or applying today's roster retroactively to historical attendance

**فهرست خالی حضور و غیاب گارد**:
An empty attendance population means no personnel are members of فهرست حضور و غیاب گارد for the selected date. Attendance pages and metrics show no people and guide managers to configure the roster instead of falling back to A/B/C guards, all active personnel, or access-bearing users.
_Avoid_: calculating attendance from an unconfigured population, silently loading another population, or treating an empty roster as a missing shift plan

**ثبت ورود تکراری در حضور و غیاب گارد**:
When گارد records ورود for a person and that same person already has an entry time for the selected attendance date, the operation should behave as a successful idempotent action and return the existing attendance truth to the operator. The visible daily list should then show the existing حاضر record instead of leaving the person as غایب.
_Avoid_: showing English duplicate errors to operators, treating a successful earlier ورود as a failed action, or displaying غایب for a person whose same-day ورود already exists

**زمان ثبت حضور و غیاب گارد**:
ورود and خروج actions in گارد default to the current time, but the operator may change the time before submitting when the event was forgotten or recorded late. If the submitted time differs from the default current time, a short reason is required and should remain visible as attendance context.
_Avoid_: forcing a separate manual-entry mode, blocking forgotten attendance correction, or allowing silent backdated times without a reason

**حضور باز روز قبل**:
If a person has an older attendance record with ورود and no خروج, گارد must close that previous record with an explicit خروج time and reason before registering a new ورود for a later date. The system should surface this open previous attendance state instead of silently creating a new day entry or auto-filling the old exit.
_Avoid_: overwriting yesterday's record with today's action, creating automatic خروج without operator confirmation, or allowing overlapping open attendance records for the same person

**ساعت کاری پرسنل**:
The optional effective-dated recurring weekly schedule owned by Human Resources as the canonical expected-work baseline for the Personnel identity, containing one complete start-to-end work interval for each selected Persian-calendar weekday. An HR Processor, HR Manager, or Company Manager with the explicit personnel-schedule action permission, and every system ADMIN through its full-system authority, may view and save a new effective-dated version directly; no proposal, submission, second-person review, or approval is required. Every save retains its exact actor and schedule evidence in Personnel audit history. Personnel management and the linked User management form display this same schedule rather than keeping separate schedules. Bulk entry can assign an interval to selected days, after which either boundary remains independently editable for each day; applying bulk time overwrites only the currently selected days, preserves unselected days, and requires confirmation when it would replace differing values. A configured day must have both boundaries, and an absent schedule has neither configured days nor times. When a day's end time is not later than its start time, its interval ends on the following calendar day. Weekday selection follows the project calendar's Saturday-to-Friday order and provides presets for every day and for the standard workweek of Saturday through Thursday. A new schedule version starts on a selected Jalali effective date of today or later, so future changes do not rewrite earlier schedule history. Security, Payroll, the employee, supervisors, and unrelated managers consume the baseline without changing it.
_Avoid_: requiring a proposal or another person's approval, granting direct change access from generic HR edit access without the explicit schedule permission, storing conflicting work schedules on User and Personnel, treating a login account as the workforce source of truth, letting Security or an ordinary supervisor rewrite its own reporting baseline, saving only one boundary of a configured day, keeping selected days without complete times, rejecting an overnight interval merely because its end clock time is earlier than its start clock time, forcing every selected day to keep the same interval after bulk entry, treating Friday as part of the standard-workweek preset, or backdating a schedule change into historical attendance

**روز غیرکاری پرسنل**:
A date on which rostered Personnel has no configured weekday interval and therefore is not expected to attend. The person is excluded from absence and lateness totals for that date, while Security may still record actual entry and exit when exceptional work occurs. Such attendance has no lateness; once exit is recorded, the entire actual entry-to-exit interval is overtime, while an open record shows overtime as pending.
_Avoid_: counting an unplanned workday as absence, removing the person from Security's attendance controls, discarding exceptional presence on a non-working day, or finalizing non-working-day overtime before exit is known

**ساعت کاری تعریف‌نشده**:
The state of Personnel with no weekly schedule version at all, distinct from an unselected weekday in an existing schedule. Existing roster-based present and absent behavior continues for such personnel, but delay and overtime remain unavailable until a schedule is configured.
_Avoid_: treating migration-era personnel as off work every day, silently removing them from absence totals, or inventing delay and overtime without an expected interval

**تأخیر و اضافه‌کار پرسنل**:
On a configured workday, lateness is the positive whole-minute difference between actual entry and the scheduled start, and overtime is the positive whole-minute difference between actual exit and the scheduled end. There is no grace period; early entry does not create overtime, early exit does not create negative overtime, and early-departure classification is outside the current scope. Before scheduled start, missing entry is در انتظار شروع rather than absent; after start passes it becomes غایب, and a later entry changes it to حاضر با تأخیر with the exact delay. A positive delay remains part of the employee's visible attendance state regardless of which list filter exposed the record; its concise presentation uses minutes below one hour and hours plus remaining minutes from one hour onward. Historical attendance retains the schedule and calculated values that applied on its date; later weekly-schedule edits affect future calculations rather than rewriting past reports.
_Avoid_: marking personnel absent before their workday starts, silently applying a grace period, offsetting late arrival with early arrival on another day, counting early arrival as overtime, introducing تعجیل در خروج without a separate business decision, or recalculating historical delay and overtime from a later schedule

**حضور شبانه پرسنل**:
An attendance interval whose configured workday ends after midnight belongs to the calendar date on which work started. Its delay and overtime are calculated against that start-date interval, while the weekly schedule remains a reporting baseline and never prevents Security from recording actual work before, after, or outside scheduled hours.
_Avoid_: splitting one overnight presence into unrelated daily records, assigning it to the exit date, or using the schedule to authorize or block actual attendance

**گزارش روزانه استثناهای حضور پرسنل**:
The default minimal Security PDF for attendance exceptions, containing only person-days that are absent, late, or have overtime. Its summary contains only غایب and تأخیر cards, and its detail columns are پرسنل، وضعیت، ورود، خروج، تأخیر، اضافه‌کار, and یادداشت; department, recorded shift, and signature columns are omitted. A single-day report identifies that one Jalali date rather than presenting it as a same-date range and omits the redundant date column; an explicitly selected multi-day filter remains a range and restores a compact date column so repeated personnel rows remain distinguishable. Ordinary on-time attendance without overtime is omitted, while richer attendance and performance outputs remain separate available reports.
_Avoid_: filling the default operational PDF with ordinary attendance rows, displaying redundant one-day ranges, retaining nonessential detailed columns or metric cards, or removing the existing detailed outputs when introducing the minimal report

**تاریخ عملیاتی گارد**:
The Jalali calendar day explicitly selected for Security attendance, roster, and reporting work. The same selected day must survive frontend, API, persistence, and output boundaries regardless of browser or server timezone.
_Avoid_: allowing UTC conversion to move a selected Security day backward or forward, or applying different date semantics to screen data and exported reports

**خرید بیرونی در ورود خودروی پر**:
An inbound loaded-vehicle purpose for purchased cargo arriving from outside Sabalan. It may have a purchase invoice and may have a بارنامه.
Its completed entry information captures the driver/vehicle details, document presence for purchase invoice and بارنامه, and any trip-specific settlement details needed for بارنامه settlement.
_Avoid_: requiring every outside purchase entry to have both documents when one may be absent in reality, or moving trip-specific settlement evidence to the reusable driver/vehicle registry

**برگشت از فروش در ورود خودروی پر**:
An inbound loaded-vehicle purpose for goods returning from a sold/customer delivery. It has no purchase invoice, must reference the customer, and may have a بارنامه.
_Avoid_: treating returned sales goods as an outside purchase, or entering the customer as free text when the customer exists in CRM

**امانی در ورود خودروی پر**:
A reserved inbound loaded-vehicle purpose for consignment or entrusted goods whose detailed workflow is intentionally not defined yet.
It may be visible as در دست تعریف, but users should not complete امانی entries until its business meaning and lifecycle are resolved.
_Avoid_: implementing امانی rules before the business meaning and lifecycle are resolved

**ردیف قابل بارگیری**:
A contract row is loadable only when it represents physical cargo leaving Sabalan. Services and operations are not loaded separately, but service/tool/finishing details attached to a physical product should remain visible as part of that product's loading identity.
A loading identity includes the product or stone name, product family, loading unit, remaining amount, logistics-relevant dimensions, contract number, and any attached service, tool, or finishing details needed to distinguish the physical cargo.
_Avoid_: creating بارگیری lines for standalone services, hiding product-attached services that help logistics identify the correct cargo, or showing only the origin catalog name when the contract row has more specific loading details

**مشاهده حسابداری بارگیری**:
Accounting sees finalized logistics loading records as read-only shipment evidence, including customer/project, contract links, loaded amounts, driver snapshot, warnings, and correction history.
_Avoid_: letting accounting directly edit physical loading quantities or driver details

**برگه چاپی بارگیری**:
A printable loading slip is an output of a finalized digital بارگیری, not the source record. It summarizes the loading document for warehouse, driver, or accounting use.
_Avoid_: treating the old paper table as the required digital UI layout, or keeping paper as the source of truth after digital entry

**برنامه تحویل در برابر بارگیری**:
برنامه تحویل is the sales/customer promise for planned delivery timing and amounts; بارگیری is the logistics record of actual loading and shipment.
_Avoid_: merging promised delivery schedule data with actual loading transactions when shipped quantities, dates, or drivers differ

## Human Resources and Leave

**HR Migration Baseline**:
The declared cutover reference used to introduce existing Personnel into the new HR model without manufacturing unknown history. Existing active Personnel receive a migrated active Employment Relationship with source identifiers and migration provenance, but creation timestamps are never treated as hire dates and unknown dates remain explicitly unknown for HR verification. Existing User-to-Personnel links are preserved, while unlinked Users remain access identities until deliberately classified. Departments become typed Organizational Units only after hierarchy review, existing schedules retain their known effective dates as legacy records, and only genuine leave Exception Requests become Leave Requests; other exceptions retain their attendance or Security meaning. Migration provides a repeat-safe dry run, reconciliation totals, and duplicate or conflict reporting, and never destructively deletes source records.
_Avoid_: invented employment or schedule history, automatically turning every User into Personnel, coercing every exception into leave, losing source provenance, destructive one-shot migration without reconciliation

**HR Migration Reconciliation State**:
The combination of one primary state describing a record's known lifecycle or migration outcome and zero or more independent attention flags for unresolved mapping, identity, ambiguity, or preserved historical uncertainty. A record may carry several attention flags at once without replacing its truthful primary state.
_Avoid_: one mutually exclusive badge that hides overlapping conditions, using `Unknown` for a known state whose display label is missing, or treating preserved historical uncertainty as a generic migration failure

**HR Migration Identity Reconciliation**:
The evidence-based classification of a legacy person's identity using a confirmed Personnel link, a valid Iranian National Code when available, and human review of possible matches. Sabalan has no Personnel Number identity concept, so an absent `employeeNumber` never creates an identity warning, blocks migration, or participates in matching.
_Avoid_: calling a person unknown merely because National Code is absent, using Personnel Number as identity evidence, merging records from name similarity, or auto-linking an ambiguous User and Personnel pair

**HR User–Personnel Link Reconciliation**:
The explicit classification of each legacy User without a Personnel link as either requiring a reviewed link to a confirmed or controlled-created Personnel identity, or intentionally remaining an access-only User. Until classified, the User carries an attention flag; an approved access-only classification clears it without manufacturing workforce identity.
_Avoid_: automatically creating Personnel for every User, linking by name similarity, treating every unlinked User as invalid, or leaving an unclassified link gap without an owner and action

**HR Organizational Mapping Reconciliation**:
The reviewed mapping of each legacy Department to an existing or approved new Organizational Unit, followed by a valid Primary Employment Assignment for each operational Employment Relationship. Missing mapping does not prevent safe Personnel or Employment Relationship migration, but it carries an attention flag and prevents full reconciliation and final cutover until resolved; a genuinely historical Department may be explicitly classified as having no operational target.
_Avoid_: guessing a unit from its name, blocking safe identity migration, presenting an unassigned relationship as fully reconciled, or allowing final cutover with unresolved operational placement

**HR Possible-Duplicate Reconciliation**:
The durable human review of legacy Personnel records with similar identity evidence, resulting in distinct people, one shared identity requiring controlled consolidation, or unresolved ambiguity. Only the affected automatic link or creation is blocked; the wider migration may continue, and no records are merged automatically.
_Avoid_: treating a similar name as proof, blocking the entire migration for a local ambiguity, repeatedly warning after a distinct-people decision without changed evidence, or silently merging operational history

**HR Legacy-Only Record**:
A reviewed legacy Department, schedule, exception, or other source record retained as historical evidence with no current operational target or dependency. It is a neutral, filterable primary state with explanation and drilldown but no warning, remediation action, or cutover blocker; a record that still affects current operations must instead carry the relevant mapping attention flag.
_Avoid_: treating all legacy data as defective, hiding retained history, forcing a target record without operational meaning, or using legacy-only classification to bypass a current dependency

**Accepted Unknown HR History**:
A field-specific historical fact that Human Resources has reviewed and confirmed cannot be recovered from trustworthy evidence. An unavailable original employment start date uses the canonical Persian classification `تاریخ شروع همکاری قابل بازیابی نیست`; it is neutral and does not block cutover, while a fact still expected to be recoverable remains an actionable completion flag instead.
_Avoid_: using a generic `Unknown` badge, substituting the migration baseline as the real historical date, keeping an accepted unavailable fact as a permanent warning, or accepting uncertainty before review

**HR Employment-State Consistency**:
The agreement between a Personnel record's active or inactive lifecycle state and its current or ended Employment Relationships. Active and inactive are truthful neutral states; an inconsistency flag appears only when the combination is contradictory, and correction proceeds through governed employment history or Offboarding rather than migration rewriting either state.
_Avoid_: flagging every inactive Personnel record, silently ending a relationship during migration, treating suspension as inactivity, or hiding an inactive Personnel record that still has a current relationship

**Unsupported HR Migration State**:
An unexpected non-empty state code returned outside the registered Human Resources migration taxonomy. The interface presents it as a classification error and records technical evidence for investigation; an empty value renders as `—`, and neither condition is translated into a generic business `Unknown` state.
_Avoid_: silently converting a missing label into business uncertainty, persisting an unsupported code as accepted history, showing `Unknown` for an empty optional field, or hiding the technical contract failure

**HR Migration Cutover Blocker**:
An unresolved User–Personnel classification, identity ambiguity, current organizational mapping or Primary Assignment gap, employment-state inconsistency, pending HR review of a recoverable start date, or unsupported migration state that prevents final HR migration cutover. An approved access-only User, HR Legacy-Only Record, Accepted Unknown HR History, consistent inactive Personnel history, or absent National Code by itself is not a blocker.
_Avoid_: blocking safe preliminary migration, allowing unresolved current workforce truth through final cutover, treating accepted historical uncertainty as a permanent defect, or making optional identity evidence mandatory

**Leave Request**:
An employee's request for approved time away from expected work, owned by Human Resources regardless of which workspace later consumes its result.
_Avoid_: Security exception, attendance correction, shift exception

**Employee Leave Self-Service**:
The employee-facing leave entry and tracking surface in Personal Affairs. It is the single place where an employee submits and follows their own Leave Requests.
_Avoid_: a second Security leave form, workspace-specific copies of the same request

**Leave Approval**:
The policy-driven workflow that changes a pending Leave Request into approved or rejected time away from work. Automated checks validate schedule, overlap, balance, and Leave Type rules; the effective Responsible Supervisor is the sole human approver for a routine request. Human Resources owns policy and the ledger but joins the approval only for configured exceptions such as negative balance, unpaid leave, extended duration, medical or legal review, or a retroactive request. The route and responsible actors are snapshotted at submission. An effective-dated delegate may act during an approver's absence; otherwise the request visibly escalates through the reporting hierarchy. Security consumes the approved result and never approves leave.
_Avoid_: making HR manually approve every routine request, using generic application roles instead of accountable effective-dated people, Security approval, silently rerouting a submitted request, stalled requests with no delegation or escalation

**Leave Balance Ledger**:
The auditable source from which an Employment Relationship's balance for each balance-consuming Leave Type is calculated. Entitlement, accrual, carryover or transfer, reservation, usage, expiry, adjustment, and reversal are separate immutable entries; no actor directly edits the resulting balance. A pending request reserves entitlement, approval converts the reservation into usage, and rejection or cancellation releases it. Cancelling confirmed usage creates a reversal rather than deleting history. Adjustments are dated and retain the reason, acting person, and any required approver snapshot. A request cannot exceed available balance unless that Leave Type's explicit negative-balance policy permits it, while Leave Types configured without a balance bypass balance consumption.
_Avoid_: an editable final balance, deleting or rewriting ledger history, independent balances outside an Employment Relationship, consuming the same available entitlement through concurrent pending requests, treating every Leave Type as balance-consuming

**Leave Consumption Duration**:
The amount charged to a Leave Balance Ledger from the employee's Combined Expected Schedule rather than raw calendar days or manually asserted hours. Daily leave covers every expected interval within the selected dates, while hourly leave uses an exact start and end time; rest days and non-working intervals consume nothing. The calculation includes all schedule-contributing assignments and retains the applicable schedule and version references. A pre-approval schedule change recalculates the duration and visibly informs the requester, while a post-approval change creates a review conflict and never silently changes approved consumption or finalized attendance.
_Avoid_: charging calendar days without expected work, ignoring contributing assignments, manually entering the consumed duration as authoritative, silently recalculating approved leave after a schedule change

**Leave Revision and Cancellation**:
The controlled lifecycle for changing a submitted or approved Leave Request without rewriting its decisions. A requester may withdraw a pending request and release its reservation. Changing dates, times, or Leave Type after submission creates a visible revision and reruns validation and approval. Cancelling future approved leave follows the same operational approval route because replacement coverage may already exist. After leave starts, only an authorized Human Resources correction may reverse consumption and trigger attendance reevaluation through new dated records with a reason and required approval. The original request, approval, coverage, ledger, and attendance evidence remain intact, and overlapping active Leave Requests for the same employee are rejected.
_Avoid_: editing an approved request in place, deleting approved leave or its operational consequences, employee self-cancellation after leave starts, retaining a balance reservation after withdrawal, accepting overlapping active leave

**Security Leave Consequence**:
The operational staffing and attendance effect that Security derives automatically from an approved Leave Request. The approved result is shared data, not itself a Cross-Workspace Duty; only a concrete coverage gap creates a structured Security duty to arrange replacement coverage.
_Avoid_: letting Security own the Leave Request or its HR approval policy, creating a duty for every approved leave, or leaving a real coverage gap without an accountable action

**Attendance Exception**:
An operational discrepancy or correction concerning recorded presence, such as a missing entry, late arrival, early departure, or absence correction. It is distinct from a Leave Request even when approved leave explains the discrepancy.
_Avoid_: using Attendance Exception as an umbrella term for leave policy

**Job**:
A reusable description of the nature of work and its expected responsibilities and capabilities, independent of a particular place in Sabalan's organization.
_Avoid_: Position, organizational seat, employee assignment

**Position**:
A defined place in Sabalan's organization that applies a Job within a specific organizational, reporting, workplace, and shift context. Each Position has an approved headcount capacity and may hold multiple active personnel assignments up to that capacity; its vacancy is the unfilled portion of that capacity.
_Avoid_: Job, treating the nature of work and its organizational placement as one field, duplicating an otherwise identical Position for every occupant

**Position Reporting Line**:
The normal supervisory relationship from one Position to its supervising Position, preserved independently of whichever personnel currently occupy either Position. A temporary or exceptional reporting relationship is a separate override rather than a rewrite of the normal structure.
_Avoid_: permanently storing the normal reporting line only between Personnel, editing every subordinate when a manager changes, replacing the normal structure for a temporary arrangement

**Employment Assignment**:
The effective-dated relationship that places Personnel in a Position for a defined period. Personnel may hold concurrent assignments, but exactly one active assignment is primary; every other active assignment is explicitly secondary or acting. Transfers, promotions, and other placement changes close or supersede assignments while preserving the organizational history that applied on each date.
_Avoid_: a mutable Position field on Personnel, multiple primary assignments, unclassified concurrent duties, overwriting earlier placements, reconstructing historical reporting or cost attribution from today's organization

**Capacity-Bearing Assignment**:
A primary or secondary Employment Assignment that occupies one place within a Position's approved headcount capacity. An acting assignment provides temporary operational coverage without consuming permanent capacity, so the covered Position remains vacant for staffing and recruitment purposes.
_Avoid_: counting acting coverage as a permanent occupant, hiding a vacancy because someone is acting in it, ignoring secondary assignments in headcount

**Employment Relationship**:
An effective-dated period during which Personnel is employed by Sabalan. Departure closes the current relationship without removing the Personnel identity, and a later rehire creates a new relationship to which that period's contracts, assignments, employment status, and exit records belong.
_Avoid_: treating Personnel and employment as the same lifecycle, overwriting an earlier employment period on rehire, creating duplicate Personnel for a returning worker

**Employment Status**:
The current lifecycle state of an Employment Relationship: Planned before its start, Active while employment is in force, Suspended while employment continues but work is temporarily stopped, or Ended after the relationship concludes. Ordinary leave is derived from approved Leave Requests, and probation is a dated employment phase rather than an Employment Status.
_Avoid_: using leave, probation, contract state, or attendance state as Employment Status, using a generic inactive state that hides whether employment is planned, suspended, or ended

**Probation Phase**:
An effective-dated phase within an Employment Relationship during which an employee may remain Active while a required probation review is pending. The review explicitly records confirmation, an authorized extension with its reason and new end date, or employment termination; every extension preserves the earlier period and decision history. Reaching the planned end date without a decision creates an overdue escalation and never silently confirms or terminates employment.
_Avoid_: representing probation as Employment Status, overwriting the original probation dates, automatic confirmation or termination at the planned end date, extending probation without an authorized reason

**Employment Termination Decision**:
The explicit Human Resources decision that records the notice date, last working date, effective employment end, reason, and authorized actors and opens a coordinated Offboarding Case. Employment remains Active until the effective end unless separately suspended. At that instant the Employment Relationship and active Assignments close, Position capacity is released, and expected scheduling stops. ERP and physical access each use an exact cutoff time, while early or extended access requires explicit, scoped, time-bounded approval from the relevant owner. Records are disabled or closed rather than deleted.
_Avoid_: deriving termination from contract expiry or incomplete work, releasing capacity before the effective end, deleting Personnel or User, using one vague date for notice, final work, employment end, and access cutoff

**Offboarding Case**:
The coordinated set of separately owned tasks created by an Employment Termination Decision, including equipment return, document handover, payroll settlement, exit interview, ERP access revocation, and physical access revocation. Each task retains its owner, timing, status, and evidence. An unfinished settlement or unreturned asset remains an overdue post-employment obligation and never falsely keeps the Employment Relationship Active; historical attendance, approvals, contracts, assignments, and audit evidence remain intact.
_Avoid_: making employment end depend on every administrative task completing, merging access state with Employment Status, losing evidence after departure, one unowned offboarding checklist

**Suspended Employment Capacity**:
A Suspended Employment Relationship retains its capacity-bearing Position assignments because employment and permanent placement continue. Any temporary operational gap is covered through an acting assignment or other temporary coverage unless Human Resources explicitly changes or ends the permanent assignment.
_Avoid_: creating a permanent vacancy from suspension, triggering ordinary recruitment solely because of suspension, removing the employee's Position without an explicit HR decision

**Committed Position Capacity**:
Capacity reserved by a capacity-bearing assignment on an accepted, future-dated Planned Employment Relationship. It is not active headcount before the start date, but it closes the permanent vacancy so Recruitment does not hire against the same capacity again; an unaccepted offer remains in Recruitment and reserves nothing.
_Avoid_: counting a future hire as currently active, recruiting against capacity already committed to an accepted hire, reserving capacity for an unaccepted offer

**Expired Employment Contract**:
An Employment Contract whose end date has passed without a recorded renewal or replacement. It creates an urgent Human Resources action but does not automatically end the Employment Relationship, release Position capacity, remove attendance expectations, or revoke access.
_Avoid_: treating contract expiry as automatic termination, silently releasing staffing capacity, continuing without an HR alert

**Governing Employment Contract**:
The single Employment Contract whose effective period governs an Employment Relationship on a given date. Renewals are sequential governing contracts, while corrections and changed clauses are amendments to the applicable contract rather than overlapping governing contracts.
_Avoid_: multiple governing contracts active on the same date, representing an amendment as a competing contract, using a second contract to compensate a secondary or acting assignment

**Employment Type**:
The classification of how a person works within an Employment Relationship, such as full-time, part-time, seasonal, or trainee work. It is distinct from the legal form of the governing contract.
_Avoid_: Contract Type, Position, Employment Status

**Contract Type**:
The classification of the legal form used by a Governing Employment Contract, independent of the employee's working arrangement.
_Avoid_: Employment Type, Contract Status, using one combined classification for legal form and working arrangement

**HR Classification Catalog**:
A Human Resources-managed list of stable coded classifications, including Employment Types and Contract Types, whose Persian names and descriptions may evolve. Deactivation prevents future selection while preserving the classification on historical records.
_Avoid_: hardcoded display values that require software migrations, deleting catalog values used by history, allowing a renamed label to change a stable business identity

**Personnel Document**:
A versioned record with a document category, confidentiality level, source, effective and expiry dates, and retention policy. Identity, contract, compensation, disciplinary, and medical categories have separately scoped permissions rather than inheriting one broad HR view. Medical evidence is highly restricted: a Responsible Supervisor sees only the necessary operational result, while Security sees only approved absence and coverage consequences. Viewing, downloading, replacing, and exporting sensitive documents are audited; replacement creates a new version instead of overwriting the prior evidence. Expiry raises an alert but does not itself end employment or invalidate a decision unless an explicit policy requires that consequence.
_Avoid_: general HR access exposing every document, supervisors seeing diagnoses or medical attachments, Security seeing medical details, overwriting evidence, unaudited export, treating document expiry as automatic employment termination

**Assignment Context**:
The Organizational Unit, Workplace, Cost Center, and shift context actually applicable to an Employment Assignment for its effective period. Position values provide the defaults for minimal entry, while explicit assignment values and overrides preserve the context used by historical staffing, attendance, payroll, and reporting.
_Avoid_: deriving history from today's Position defaults, storing mutable placement only on Personnel, requiring repeated entry when Position defaults already apply

**Security Rota**:
The Security-owned operational plan that assigns eligible guards to coverage duties. It consumes HR-owned expected-work schedules and approved leave but does not replace the canonical employee Work Schedule or define company-wide attendance expectations.
_Avoid_: a second employee schedule source of truth, letting operational guard coverage redefine HR work expectations, using the guard rota for general personnel attendance

**Applicable Work Schedule**:
The single expected-work schedule selected for Personnel at a moment by precedence: an effective Personnel Schedule Override, then the Employment Assignment schedule or Shift Pattern, then the Position default. If none exists, the schedule is undefined and requires Human Resources attention.
_Avoid_: combining multiple schedule sources, silently choosing an arbitrary source, treating an undefined schedule as a non-working day

**Personnel Schedule Override**:
An effective-dated exception that temporarily replaces the otherwise Applicable Work Schedule for one Personnel. A person may have at most one active override at any moment, and the system rejects overlapping override periods rather than resolving them through hidden priority.
_Avoid_: overlapping overrides, editing the underlying Position or Assignment for a temporary change, internal priority that is invisible to users

**Rotating Shift Pattern**:
A reusable repeating cycle of work intervals and non-working periods with an Anchor Date that identifies the first day of the cycle. The applicable cycle day for any later date is calculated from that anchor; a temporary deviation is a Schedule Override rather than a change to the Pattern.
_Avoid_: a rotating cycle without an Anchor Date, editing the Pattern for one person's temporary change, generating independently editable daily copies as the source of truth

**Shift Pattern Version**:
An effective-dated version of a Shift Pattern. A permanent cycle or anchor change creates a new version or new schedule assignment from its effective date and never overwrites the Pattern that governed earlier dates.
_Avoid_: retroactively changing historical expected work, editing an old version in place, using a temporary Override for a permanent cycle change

**Schedule-Level Non-Overlap**:
The rule that at most one schedule source of the same precedence level may apply to a Personnel at any moment. Conflicting effective periods at one level are rejected rather than resolved by invisible priority.
_Avoid_: simultaneous same-level schedules, last-write-wins scheduling, undocumented internal precedence within one level

**Finalized Attendance Schedule Evidence**:
The expected-work evidence retained when attendance is finalized, containing either the applicable schedule snapshot or an immutable reference to the exact schedule or Shift Pattern version that governed that attendance.
_Avoid_: recalculating finalized attendance from current schedules, losing the governing version, changing historical lateness or overtime after a future schedule update

**Base Assignment Schedule**:
The expected-work schedule supplied by the primary Employment Assignment. It is the base used for attendance unless a Personnel Schedule Override temporarily replaces it.
_Avoid_: deriving competing base schedules from secondary or acting assignments, using assignment priority that is not visible to Human Resources

**Schedule-Contributing Assignment**:
A secondary or acting Employment Assignment explicitly marked to add recurring expected-work intervals to the base schedule. Non-contributing assignments add no attendance expectation, and contributing intervals must not overlap the base or another contributing interval.
_Avoid_: letting every additional assignment silently change attendance, overlapping expected-work intervals, using a secondary assignment to replace the base schedule

**Combined Expected Schedule**:
The Base Assignment Schedule, or its temporary Personnel Schedule Override, together with every applicable non-overlapping Schedule-Contributing Assignment interval.
_Avoid_: choosing only one responsibility when several explicitly contribute hours, double-counting overlapping intervals, treating titles without schedule contribution as expected work

**Schedule Override Scope**:
The explicit boundary of a Personnel Schedule Override. Base-only scope replaces the Base Assignment Schedule while applicable Schedule-Contributing Assignments remain active; whole-schedule scope temporarily replaces both the base and all additive assignment intervals. Base-only is the default.
_Avoid_: silently suspending secondary duties, making override scope implicit, applying a whole-schedule replacement when only the primary schedule was intended

**Base-Only Override Conflict**:
An invalid schedule state in which a base-only Personnel Schedule Override overlaps an applicable Schedule-Contributing Assignment interval. The system rejects the Override and identifies the conflicting assignment, dates, hours, overlap, and explicit resolution choices rather than accepting a warning.
_Avoid_: warning-only confirmation, silently merging overlapping intervals, saving an ambiguous schedule and deferring the conflict to attendance or payroll

**Expected Assignment Hours**:
The non-overlapping intervals added by an explicitly Schedule-Contributing secondary or acting assignment to the Combined Expected Schedule. They carry ordinary lateness and absence expectations and are not overtime merely because they fall outside the primary assignment's base hours; compensation for the added responsibility is determined separately by assignment and payroll rules.
_Avoid_: classifying one interval as both mandatory attendance and automatic overtime, ignoring absence from additive expected hours, deriving responsibility compensation solely from clock time

**Overtime Candidate**:
System-calculated extra presence outside the Combined Expected Schedule, based on immutable actual entry and exit evidence. Security's attendance evidence is operational data rather than a duty. A candidate creates a structured confirmation duty for the Responsible Supervisor and is not payable overtime until that supervisor explicitly confirms that the work was authorized and performed.
_Avoid_: paying from clock presence alone, creating duties for raw attendance events, letting Security determine compensation entitlement, or deleting raw attendance when the candidate is rejected or corrected

**Approved Overtime**:
An Overtime Candidate confirmed by the Responsible Supervisor and available for Human Resources review and Payroll consumption. Supervisor confirmation closes its duty; a separate Human Resources duty is created only when policy or discrepancy requires human review. Human Resources may correct attendance or classification while preserving the raw entry/exit evidence and the approval audit trail.
_Avoid_: creating routine HR duties when no review is required, sending pending or rejected candidates to Payroll, modifying raw attendance to force a payment result, or losing who approved or corrected the classification

**Responsible Supervisor**:
The one accountable Personnel selected for an Employment Assignment from active occupants of its supervising Position. A sole eligible occupant is suggested or selected automatically; when several are eligible, saving the subordinate assignment requires an explicit selection whose effective period is fully covered by the supervisor's active assignment. Supervisor changes are effective-dated and preserve earlier responsibility.
_Avoid_: arbitrary selection among multiple occupants, a supervisor outside the supervising Position, responsibility extending beyond the supervisor's assignment, deleting previous supervisor history

**Approval Actor Snapshot**:
The immutable identity evidence attached to an approval, including the actual approver's Personnel or User identifier and displayed identity at the time of action. Later supervisor, assignment, account, or name changes do not rewrite who performed the historical approval.
_Avoid_: deriving the historical approver from today's reporting line, replacing the actual actor with a Position label, losing approver identity after organizational change

**Vacant Supervisor Escalation**:
The visible temporary approval route used when a supervising Position has no active occupant. Human Resources is alerted to create an effective-dated acting assignment, while urgent approvals escalate to the nearest occupied supervising Position above it and retain the escalation reason, route, and actual approver in the audit trail.
_Avoid_: silently choosing an unrelated manager, permanently blocking urgent approvals, treating escalation as a substitute for filling the reporting gap, hiding that the normal supervisor was vacant

**Identity-Incomplete Personnel**:
A provisional Personnel identity created before a reliable National Code or equivalent identity document is available. It remains visibly flagged for Human Resources completion and duplicate review without blocking early recruitment, onboarding, or essential operational setup.
_Avoid_: requiring National Code before any provisional record, treating a provisional record as identity-verified, hiding the incomplete identity state

**Candidate**:
A reusable recruitment-bank identity for a person who may pursue different opportunities at Sabalan over time. Identity, contact details, resume, skills, and employment history belong to the Candidate and survive individual application outcomes.
_Avoid_: Personnel before hiring, duplicating the person for every vacancy, storing vacancy-specific decisions on the reusable profile

**Job Application**:
The Candidate's pursuit of one approved vacancy or Recruitment Request. Screening, interviews, assessments, proposed compensation, and the final decision belong to that Application, while hiring links the Candidate to a Personnel identity without deleting recruitment history.
_Avoid_: overwriting an earlier application with a later one, treating Candidate and Application as one record, deleting recruitment evidence after hiring

**Recruitment Request**:
The approved authorization to recruit a defined number of people into a specific Position. Formal Job Applications belong to an approved request; each accepted hire consumes one requested opening and committed Position capacity, and the request closes when its openings are filled or explicitly cancelled.
_Avoid_: informal hiring outside approved structure, accepting more hires than authorized openings, treating an unsolicited resume as a formal Application before it is linked to a request

**Talent-Bank Candidate**:
A Candidate retained by Human Resources without a current formal Job Application. The profile may later be linked to an approved Recruitment Request without duplicating the person or inventing an earlier application history.
_Avoid_: discarding unsolicited resumes, counting talent-bank profiles as active applicants, placing a Candidate in a hiring pipeline without an approved request

**Vacancy-Fill Request**:
A Recruitment Request that uses currently available approved Position capacity.
_Avoid_: recruiting without an actual vacancy, increasing Position capacity implicitly

**Planned-Replacement Request**:
A Recruitment Request linked to the departing Personnel and Employment Assignment with an expected end date. Recruitment may begin before departure, but the accepted hire's capacity commitment starts after the departure unless an explicit handover overlap is approved.
_Avoid_: waiting until departure to begin all replacement recruitment, double-filling capacity without an approved handover, losing which assignment is being replaced

**Capacity-Increase Request**:
A Recruitment Request whose purpose is to add authorized Position capacity. The capacity increase must be explicitly approved before the request enters formal recruitment.
_Avoid_: treating growth as an ordinary vacancy, allowing a hire to increase headcount implicitly, recruiting against unapproved capacity

**Recruitment Request Approval**:
The type-aware authorization of a Recruitment Request. Vacancy-fill and planned-replacement requests require the Responsible Supervisor or Manager followed by Human Resources; a Capacity-Increase Request additionally requires authorized executive or budget approval.
_Avoid_: one undifferentiated approval flow, letting Human Resources silently authorize increased headcount cost, requiring executive approval for every routine replacement

**Handover Overlap**:
An explicitly approved date range during which the departing and incoming assignments may temporarily exceed a Position's ordinary capacity for knowledge transfer. It belongs to a Planned-Replacement Request and does not permanently increase approved capacity.
_Avoid_: hidden double occupancy, permanent capacity growth through a replacement workflow, overlap without start and end dates or accountable approval

**Approver Assignment**:
An effective-dated assignment of a named approval responsibility, such as Human Resources approval or workforce capacity/budget approval, to an eligible accountable person. Business authority is resolved from this assignment rather than a hardcoded user or broad application role, while every completed decision retains its Approval Actor Snapshot.
_Avoid_: treating every MANAGER as authorized, hardcoding a current approver, rewriting old authority after responsibility changes, silently approving when no eligible approver is configured

**Application Stage**:
The minimal visible phase of a Job Application: Received, Screening, Assessment, Offer, or Closed. Detailed interviews, tests, reviews, approvals, and transitions are checklist items and append-only history events rather than additional mandatory stages.
_Avoid_: turning every recruitment activity into a status, forcing every Candidate through irrelevant steps, losing activity history because only the current stage is stored

**Application Outcome**:
The reason a Job Application is Closed: Hired, Rejected, Withdrawn, or Recruitment Request Cancelled. Hired closes recruitment selection permanently and its Guided Hiring Lifecycle continues through Planned Employment preparation and activation. Rejected, Withdrawn, and Recruitment Request Cancelled preserve their immutable closure event but may be formally reopened for the same Position and Recruitment Request after Company Manager authorization and HR Manager execution; reopening restores the last pre-closure lifecycle position, revalidates time-sensitive evidence, and never erases the earlier outcome.
_Avoid_: a generic closed state without reason, treating Hired as completed Employment activation, treating withdrawal as rejection, reopening Hired, moving a reopened Application to another Position, erasing closure history, or restoring expired access credentials

**Company Hiring Management Permissions**:
The action permissions for finalizing a Formal Assessment Plan, reviewing management-safe recruitment evidence, finalizing the Company Evaluation Plan, recording a reasoned final rejection or continuation decision, proposing Candidate-visible collateral requirements, and authorizing reopening of a non-Hired closed Application. Multiple Users may hold any permission, the first valid shared decision records its exact actor, and an eligible Human Resources Broad-Manager Override may act without a separate grant.
_Avoid_: equating company management with a system role or job title, requiring a Company Manager authority assignment, hardcoding one User, hiding the decision actor, or letting management-safe permissions expose protected Finance instrument data or unrestricted medical evidence

**Hiring Action Permission Revocation**:
The immediate, audited deactivation of a User's hiring action permission without rewriting decisions they previously made. Permission history retains grantor, revoker, timestamps, reason, and prerequisite changes; subsequent protected actions fail authorization immediately while prior decisions keep their original actor.
_Avoid_: retaining a parallel Hiring Authority assignment, deleting permission history, revocation without an actor, allowing authorization until a later login, or reattributing completed decisions after revocation

**Reversible Application Disposition**:
An audited pause that preserves the current Application phase and evidence without closing the Application. `رد اولیه` is created by a negative preliminary HR approval and may be reactivated only by an HR Manager; `رد/ذخیره` is assigned after company-management comparison within the same Position or Recruitment Request and may be reactivated only by a Company Manager. Both transitions require reasons and block ordinary progression while paused.
_Avoid_: treating a pause as deleted history, losing the preserved phase, automatically advancing a reactivated case, using `رد اولیه` for a management decision, or using `رد/ذخیره` across unrelated Positions

**Recruitment Checklist Template**:
The Job- or Position-specific definition of required and optional screening, interview, test, reference, certificate, and approval activities inside the fixed Application Stages. A Job Application snapshots the applicable template version when entering the pipeline so later template changes do not rewrite its required work or history.
_Avoid_: one universal assessment sequence for every Job, adding custom pipeline stages per Position, recalculating an active Application from a later template version

**Formal Assessment Plan**:
The versioned, Application-specific snapshot in which a User with the company-evaluation-plan action permission independently selects or does not select DISC, BIG FIVE, and EQ and chooses one shared execution method—Candidate completion through `/apply` or company administration—for every selected assessment. When the Application creator is independently authorized for both creation and plan finalization, creation requires an explicit plan that either selects assessments or selects none, and the Application and initial plan are recorded atomically or not at all; a creator without plan authority creates the Application without a plan for later finalization by an authorized User. A later change creates a reasoned new plan version and preserves every earlier selection and result, and there is no separate waived state.
_Avoid_: mixing Applicant and company execution within one plan version; leaving an Application without its required initial plan after a partial creation failure; making the plan optional for an authorized Application creator; deriving plan authority from Application-creation access, a system role, or a job title; treating absence as a decision not to assess; treating the three assessments as an inseparable selection bundle; silently inheriting later template changes; erasing an earlier selection; or marking an incomplete selected assessment as waived

**Formal Assessment Report**:
The permission-protected recruitment report for DISC, BIG FIVE, and EQ that presents the latest valid formal result by default, including its structured result, explanation, and attachments, while keeping earlier formal versions and read-only legacy assessment evidence available as clearly labelled expandable history through one projection without rewriting either source. Access is authorized by the independent formal-assessment-results viewing permission, which the standard Human Resources Manager and Company Manager permission profiles receive by default without making a title or broad role a runtime authorization check.
_Avoid_: hiding available result evidence, presenting an older or legacy result as current, flattening version history into competing reports, rewriting legacy evidence into the formal model, granting access from a job title alone, exposing the report without the dedicated action permission, omitting the default grant from existing eligible managers during controlled migration, or silently reviving a custom-revoked grant

**Recruitment Evaluation Position Eligibility Configuration**:
The Human Resources recruitment setting that explicitly selects active Positions eligible to supply evaluators for Human Resources manager interviews and Company management interviews; active Personnel assigned to a configured Position become selectable without requiring a User account. Only a User with the independent recruitment-evaluator-settings permission—granted by default to the Human Resources Manager permission profile—may change the configuration, absence of configuration blocks creation of the corresponding interview with an actionable setup message, and a change affects only future selections while historical evaluator snapshots remain unchanged.
_Avoid_: adding evaluator flags to the organizational Position editor, deriving eligibility from title text or a User role, selecting Personnel from an inactive Position, granting User access from evaluator eligibility, excluding eligible Personnel without a User, silently proceeding without configuration, or rewriting historical evaluator identity after configuration changes

**Company Evaluation Plan**:
The internal, Candidate-hidden guided lifecycle phase after Formal Assessments and before Identity verification, containing independently tracked occurrences of management interview, Human Resources manager interview, section-supervisor interview, consultant or therapist referral, or Other. Before work begins, an internally performed occurrence names one accountable active Personnel selected from its eligibility source: the Applicant Position's active supervisor-position assignees for a section-supervisor interview, active Personnel assigned to Positions selected in the Recruitment Evaluation Position Eligibility Configuration for an HR-manager or Company-management interview, and any active Personnel for Other; an external referral instead records the required person-or-center name plus optional provider type, telephone, and note without inventing Personnel identity. No eligible internal Personnel blocks creation with a structural or configuration correction message, multiple eligible Personnel require explicit selection, and the accountable evaluator may be changed without a reason before completion while retaining assignment history; completed responsibility and results are immutable and correction creates a new occurrence. Assignment records responsibility in the Applicant case but creates no personal duty or system notification for the evaluator; Human Resources retains follow-up and may record an optional planned date and optional report-receipt deadline. A supplied planned date is today or later, a supplied deadline is not before its planned date, and passing either date never cancels or completes the occurrence: an overdue report remains recordable and visibly late. Human Resources records the report received from that evaluator under the independent company-evaluation-result permission, granted by default to existing and future Human Resources Processor and Manager permission profiles without reviving custom revocations, and preserves both the evaluator and recording User as distinct evidence. Every occurrence has a stable per-Application and per-type sequence number, positive, neutral, or negative result effect, an immutable-on-save configurable Score 1–5 policy, and one evidence policy—required explanation, required file, optional file, or no file—while Other additionally requires its own subject and follow-up instruction; an unsaved occurrence may be removed, but a saved occurrence is cancelled without a mandatory explanation while retaining actor and time, and the gate releases only after the management decision.
_Avoid_: reusable plan templates, preventing repeated occurrences of one type, assigning an internal occurrence without eligible accountable Personnel, filtering a supervisor or manager by title text instead of effective structure, silently choosing among multiple eligible Personnel, requiring the evaluator to have a User account, creating an evaluator duty or notification from follow-up dates, accepting a past planned date or a deadline before its plan, auto-cancelling overdue work, refusing a late report, attributing an HR-recorded report to the recording User as its evaluator, losing no-reason reassignment history, changing responsibility, score policy, or results after save or completion, representing an external provider as Personnel, saving an external referral without a person-or-center name, renumbering history after cancellation, saving Other without both custom fields, omitting an evidence or score policy, exposing the plan in `/apply`, deriving result effect automatically from score, treating a negative item as automatic rejection, erasing a saved activity, requiring a repetitive cancellation explanation, duplicating DISC/BIG FIVE/EQ inside the plan, reviving a custom-revoked result permission during migration, or bypassing unresolved work

**Company Evaluation Score**:
The Human Resources-recorded integer judgment reported by the accountable evaluator for one Company Evaluation occurrence—1 Very Weak, 2 Weak, 3 Average, 4 Good, or 5 Very Good—kept alongside but never automatically translated into its positive, neutral, or negative result effect. The occurrence creator selects required, optional, or no-score policy, defaulting internal management, Human Resources manager, and section-supervisor interviews to required and external referrals or Other to optional; a missing required evaluator score leaves the result incomplete rather than allowing Human Resources to invent one, and the report preserves the evaluator Personnel and recording User separately.
Legacy completed occurrences without a score remain complete and display `نسخه قدیمی — بدون امتیاز`; no migration fabricates a score or reopens their lifecycle.
_Avoid_: a zero, six, or fractional score, deriving result effect from score, replacing narrative or file evidence with score, fabricating a missing required evaluator score, treating the recording User as the evaluator, retroactively blocking a legacy completed occurrence, or changing a completed score in place

**Candidate Profile**:
The reusable Candidate-owned recruitment information shared across Applications, including identity and contact details, resume, education, skills, languages, and employment history.
_Avoid_: vacancy-specific decisions, internal interviewer notes, duplicating the profile for every Application

**Application Form**:
The Position- or Recruitment Request-specific candidate responses for one Job Application, including availability, desired compensation, declarations, and configured questions.
_Avoid_: copying every historical paper field into every application, storing reusable Candidate facts repeatedly, exposing internal assessment content

**Candidate Questionnaire Scope**:
The candidate-facing questionnaire contains the applicable personal and contact information, address and postal code, education, employment history, skills, languages, work preferences, requested Position, desired compensation, declaration, and configured written questions. Full name, alias response, birth date and place, military-service status, father's name and occupation, marital status, residential address, mobile and home-phone responses, latest education level, field of study, graduation year, social-media response, and Iranian National Code are required for Human Resources record completeness; number of children and spouse's occupation appear and become required only when the Candidate is married, while a Candidate to whom National Code does not apply supplies a classified foreign identity type and number instead, and none of the family or social details may drive automated scoring, filtering, or rejection.
_Avoid_: exposing internal assessments to the Candidate, silently using family or social details as screening criteria, automatic rejection from record-completeness fields, an undocumented reviewer decision based on sensitive details

**Required Candidate Response**:
A questionnaire requirement satisfied by a valid value or, where the information may legitimately be absent or unavailable, a structured reason such as none, unknown, deceased, or cannot provide, with an explanation when the selected reason requires context.
_Avoid_: invented placeholder data, treating absence as an empty string, free-text variants when a controlled reason applies, accepting an unexplained exceptional reason

**Candidate Social-Security History Indicator**:
The Candidate's required yes-or-no response to whether they have prior تأمین اجتماعی insurance history, together with an HR-reviewed state and optional note. The first version collects no insurance number, provider, history detail, attachment, or external verification and does not block hiring or activation.
_Avoid_: treating the response as verified insurance eligibility, requiring future-detail fields prematurely, making a yes or no answer an employment blocker

**Candidate Identity Document Checklist**:
The versioned Human Resources-owned requirements for identity evidence, including every birth-certificate page, a separate conditional explanation-section scan when it contains information, both sides of the National ID card, and applicable foreign identity, military-service, education, photograph, or Job-specific evidence. A سایر item requires a custom document title whose normalized value identifies an independent document series and version history. Each item is missing, received, unreadable, mismatched, verified, or not applicable, and a replacement creates a new version rather than overwriting rejected evidence; Iranian National Code is compared with the National ID evidence before identity verification.
_Avoid_: saving سایر without a title, grouping every custom document into one shared version series, one unchangeable document list, merging multi-side evidence into an ambiguous attachment, deleting an unreadable or mismatched version, or verifying a conditional document without recording applicability

**HR-Captured Candidate Document**:
Private, versioned recruitment evidence recorded only by an HR Processor after identifying whether the original was inspected or a copy was received. An original-seen record keeps the category, inspector, server time, version, and optional note without requiring a file; a copy-received record requires an uploaded, malware-checked file available only through authorized, audited delivery rather than public links. The Candidate portal exposes safe missing or replacement requests but not internal comparison notes.
_Avoid_: Candidate-uploaded identity evidence in the first version, requiring an upload for original-seen evidence, accepting copy-received evidence without its file, missing inspection-source metadata, public file URLs, replacing a rejected version, or exposing internal reviewer notes

**Candidate Identity Verification**:
The field-level Human Resources comparison of an Application Form Submission with received identity evidence: a User with the document-review action permission records documents and marks each check as matching, mismatched, or unverifiable with its note, while a User with the final-identity-clearance permission grants clearance. Document receipt and comparison are one permission-shared HR Work Item; once every required document and check is evidence-complete with no unresolved discrepancy, the system closes that item and creates the separate final-clearance item without requiring a manual completion action. A mismatch or unverifiable required fact blocks clearance until Human Resources returns the identified Candidate fields for resubmission or requests replacement evidence; ordinary Users remain subject to separation of duties, while a Human Resources Broad-Manager Override may deliberately complete both items with automatic self-approval audit.
_Avoid_: one unexplained overall checkbox, requiring an HR Manager responsibility assignment, requiring a redundant completion click after the evidence is complete, allowing an ordinary reviewer to approve their own check, approving unresolved discrepancies, changing Candidate answers on their behalf, or replacing evidence without version history

**Candidate Correction Request**:
A single candidate-facing request issued after Human Resources finishes reviewing an Application Form Submission and identifies one or more fields that the Candidate must correct. The request preserves every prior draft and submitted revision, reopens only the identified fields, and sends one SMS directing the Candidate to the fixed `/apply` page. A still-valid Application-specific OTP remains usable without being repeated in the correction SMS; if access has expired or been revoked, Human Resources issues a replacement OTP for the same Job Application without deleting or resetting any Candidate information, form revision, correction history, or recruitment evidence.
_Avoid_: sending one SMS for every mismatch click, exposing internal field keys, reviewer notes, or sensitive values in SMS, resending an unrecoverable raw OTP, reopening the whole form, creating a new Application for correction, or discarding saved Candidate data when access is replaced

**Deferred Candidate Postal-Code Verification**:
The required 10-digit postal-code response whose basic format is validated while external verification remains explicitly not performed. Its deferred status is visible but blocks no recruitment, conversion, contract, or activation transition; a future verification service may queue historical values without retroactively invalidating completed hires.
_Avoid_: labeling format validation as external verification, blocking today's workflow on an unavailable service, dropping the field, treating a later failed check as automatic retroactive termination

**Candidate Mobile Invitation**:
Application-scoped access issued by Human Resources as a six-digit OTP sent to a normalized snapshot of the Candidate's recorded mobile number. When an authorized creator atomically creates an Application and its required initial Formal Assessment Plan, successful persistence automatically proceeds to invitation issuance and SMS sending and reports the actual send outcome instead of requiring a separate first-send action. A failed or indeterminate SMS outcome preserves the committed Application and plan, distinguishes persistence success from delivery status, and offers authorized resend without pretending delivery or deleting valid recruitment evidence. The Candidate enters that same mobile number and OTP at the fixed public `/apply` entry page, and the pair opens only the associated open Job Application; separate active Applications for the same mobile receive distinct OTPs and are never listed or disclosed by the public page. Editing the Candidate's current mobile does not transfer access: Human Resources must issue a replacement invitation to the new number. The pair remains reusable across devices for seven days. On HR resend, the previous code remains valid until the replacement is successfully used, its original expiry, or a thirty-minute overlap expires; replacement never changes Application data. Five incorrect attempts revoke every active code for the Application and require Candidate contact with HR, while any successful verification resets the failure count. A successful verification creates an Application-only browser session and separately proves Applicant access without rewriting the SMS provider's delivery report. Closing revokes access; formal reopening requires a fresh HR-issued invitation and never restores an old credential. Saved drafts and submitted revisions remain recruitment evidence. Final submission makes the form read-only unless Human Resources returns specified fields for correction, in which case `/apply` shows and edits only those fields with their prior value and field-specific explanation. Public verification gives indistinguishable responses for unknown mobiles and invalid, expired, revoked, or closed-Application invitations, and reveals Candidate or Application details only after success.
_Avoid_: a dynamic or personal SMS link, Candidate self-service OTP issuance, treating the invitation as a User login or two-factor authentication, opening or revealing another Candidate's Application, reusing one OTP across Applications, revoking the still-valid previous code before the safe overlap ends, granting HR workspace access, applicant enumeration through error details, discarding drafts when access is reissued, or displaying unrelated fields during correction

**Candidate Invitation Delivery Evidence**:
The stored SMS.ir message identifier and separately refreshed provider delivery state for an Application invitation. Provider acceptance, provider-reported delivery, failure, unknown status, and successful `/apply` verification are distinct facts; successful access may summarize the invitation as access confirmed but never fabricates a carrier delivery event. SabalanERP polls reports for at most twenty-four hours and offers authorized Human Resources a manual refresh.
_Avoid_: treating API acceptance as handset delivery, discarding the provider message identifier, rewriting unknown delivery as delivered after login, exposing the OTP, or polling indefinitely

**Candidate Recruitment Case**:
The continuous pre-employment record presented under `جذب و پرونده‌های متقاضیان`, linking the Candidate, Job Application, cross-functional clearances, Hire Conversion, onboarding, and activation while preserving each record's ownership and confidentiality boundary.
_Avoid_: استخدام و متقاضیان, a disconnected applicant list, copying confidential recruitment evidence into the general Personnel profile

**Personnel and Employment Relationships**:
The post-conversion workforce view presented under `پرسنل و روابط استخدامی`, containing enduring Personnel identity and effective-dated Employment Relationships and Assignments, with a permanent link to the originating Candidate Recruitment Case when one exists.
_Avoid_: پرسنل و استخدام, treating Personnel and an employment period as one record, losing recruitment provenance

**Exceptional Personnel Registration**:
A reasoned, audited creation of Personnel and initial employment foundation by an assigned Human Resources Manager for data migration, historical correction, or organizational transfer when no ordinary Candidate Recruitment Case applies.
_Avoid_: a routine shortcut around recruitment controls, an unlabeled direct hire, generic HR edit permission, unaudited manual creation

**Application Form Submission**:
An immutable, timestamped version of the Application Form created by the Candidate's final submission. Human Resources may return it with a reason and explicitly identified fields for correction; only the Candidate revises those fields and resubmits as a new preserved version.
_Avoid_: editing a final submission in place, Human Resources silently changing Candidate answers, reopening every field without reason, losing earlier submissions or timestamps

**Candidate Submission Declaration**:
The Candidate's explicit truthfulness attestation made by accepting the declaration, typing their full name, and submitting from an OTP-verified Application session. Its audit evidence retains the submission version, timestamp, masked mobile number, and available IP and device metadata, but it is not the employment contract signature.
_Avoid_: an implicit declaration, treating OTP access alone as acceptance, replacing the later paper contract signature, losing the declaration evidence when the form is corrected

**Internal Candidate Assessment**:
Restricted recruitment evidence created by authorized Sabalan reviewers, including interview notes, psychological or aptitude test results, management assessment, and hiring recommendations.
_Avoid_: candidate-editable assessment, exposing confidential notes in candidate-facing views, treating assessment evidence as reusable Candidate identity data

**Initial HR Interview**:
The versioned Internal Candidate Assessment before management requirements are finalized. Every interview snapshots the current single company-wide set of default HR criteria, may add case-specific criteria, records the Candidate's answers separately from the interviewer's analysis, and ends with an explicit positive or negative decision and reason; a permitted preliminary decision-maker reads the completed report before preliminary approval, and a permitted management decision-maker reads that report plus the preliminary decision before the later management decision. Selecting any numeric score or Not Assessed completes a scored criterion without requiring its optional note; criterion scores and contextual judgments inform but never automatically calculate the interviewer's decision, and a completed interview is corrected only through a reasoned new version.
_Avoid_: exposing the interview in `/apply`, rendering one criterion description twice, requiring a note only for a numeric stability score, hiding the completed report from a permitted decision-maker, asking for the management decision before requested evaluation results are complete, silently changing an active interview when defaults change, mixing the Candidate's self-description with interviewer analysis, calculating the outcome automatically from scores, or editing a completed version in place

**Initial HR Interview Criteria Set**:
The published, company-wide version of criteria snapshotted when a new Initial HR Interview begins and managed outside any Applicant case through explicit view and manage action permissions. If an environment has no published criteria yet, the canonical defaults are atomically materialized as version 1 before the first interview draft begins; version 0 is never a valid persisted criteria version. A new criterion is required and uses Descriptive Answer, Score 1–5, or Yes/No; Yes/No also requires a positive, neutral, or negative decision effect and a negative effect requires a reason, while deactivation and reordering publish a new version without changing active drafts or completed interviews.
_Avoid_: assigning an HR role to manage criteria, changing an in-progress interview after publication, deleting historical criteria, treating version 0 as a persistable fallback, requiring manual publication before the first interview in a fresh environment, allowing a new criterion without its required answer, adding Not Assessed to a new 1–5 criterion, or recording a negative Yes/No effect without a reason

**Initial HR Interview Draft**:
The recoverable current evidence of an unfinished Initial Human Resources Interview, preserving its snapshotted criteria, answers, custom criteria, and independent interview conclusion until completion. A transient automatic-save failure preserves the local evidence and retries with bounded recovery, while completion first persists the latest evidence and then independently validates every snapshotted and case-specific criterion by its frozen answer type before atomically recording the decision; a concurrent-version conflict or malformed snapshot remains fail-closed without losing or silently substituting evidence.
_Avoid_: completing from stale server evidence, validating against a superseded criteria shape, substituting current defaults for a malformed snapshot, losing entered answers after a save failure, replacing unsaved local evidence with an older server version, retrying a version conflict indefinitely, silently merging two interviewers' judgments, retrying without a visible state, requiring a prior automatic save to have succeeded, or recording a completed interview when its final evidence was not saved

**Candidate Assessment Score**:
A required score from zero through one hundred inclusive, with at most two decimal places, entered using Persian, Arabic, or Latin digits and normalized before validation. The Human Resources interface reports an invalid score beside its field and blocks submission, while the server independently rejects the same invalid value; neither layer silently clamps an out-of-range score.
_Avoid_: accepting a score below zero or above one hundred, relying only on browser number controls, accepting excessive decimal precision, silently changing an invalid score to a boundary value, or rejecting otherwise valid Persian or Arabic digits

**Human Resources Numeric Input Normalization**:
Every numeric entry in the Human Resources workspace and Candidate `/apply` experience accepts Persian, Arabic, Latin, or mixed-script digits and immediately presents and retains canonical Latin digits throughout field state, validation, API transfer, and persistence. Numeric amounts and decimals accept Persian or Latin decimal and thousands separators, canonicalizing to a Latin decimal point without grouping before transfer; identifier-shaped values such as National Code, mobile and telephone numbers, Personnel Number, and Postal Code remain digit-only strings so normalization never removes leading zeroes or grants arithmetic meaning.
Existing values are normalized only through a report-first deterministic migration; values that remain invalid or conflict after digit conversion enter review rather than being guessed or silently rewritten.
_Avoid_: delaying visible normalization until submission or blur, accepting localized digits only in assessment scores or Rial amounts, deleting Persian digits with a Latin-only filter, displaying or persisting mixed digit scripts, retaining grouping in canonical values, accepting decimal or grouping separators in identifiers, converting identifiers to numbers, removing leading zeroes, guessing a correction for invalid historical data, applying an unreviewed migration, or relying only on frontend normalization

**Human Resources Interface Language**:
Persian user-facing language throughout the Human Resources workspace and Candidate `/apply` experience, covering system-provided roles, statuses, labels, buttons, headings, validation messages, and audit-event descriptions while internal API and persistence identifiers remain stable and untranslated. Assessment titles are the deliberate exception and appear with the English assessment name first followed by its Persian name in parentheses: `DISC (ارزیابی الگوی رفتاری دیسک)`, `BIG FIVE (ارزیابی پنج عامل بزرگ شخصیت)`, and `EQ (ارزیابی هوش هیجانی)`. User-entered content, uploaded filenames, email addresses, and unavoidable external reference codes remain as supplied.
_Avoid_: leaking internal values such as `HR_MANAGER`, `APPROVED`, or `CANDIDATE` into the interface, translating stored identifiers, showing English role or status labels, removing the approved bilingual assessment names, expanding the bilingual exception to unrelated interface text, or altering user-supplied content

**Human Resources Calendar Presentation**:
Jalali calendar input and display with Persian digits throughout the Human Resources workspace and Candidate `/apply` experience, including recruitment, Personnel, employment, contracts, onboarding, audit history, filters, and reports. Date-times are presented in Tehran time, date-only values such as birth or planned-start dates remain date-only without timezone drift, and authenticated `/dashboard/hr/**` date inputs provide direct year selection without changing calendar behavior in `/apply` or other workspaces. APIs and persistence continue to use Gregorian/ISO representations for interoperability; existing stored values are converted for presentation without rewriting their historical storage solely for display.
_Avoid_: native Gregorian date inputs in Human Resources, mixed Jalali and Gregorian display, Latin digits in presented dates, shifting a date-only value during UTC conversion, storing Jalali display strings as canonical timestamps, rewriting existing data merely to localize its presentation, or enabling HR-specific year selection globally

**Collateral Receipt Date Presentation**:
The Accounting-destination `تاریخ دریافت وثیقه` field alone uses the shared Jalali calendar while APIs and persistence retain a Gregorian/ISO date-only value; it has no guessed default, permits today or a past date, and forbids a future date without changing other Accounting date fields.
_Avoid_: a native Gregorian receipt input, persisting a Jalali display string, guessing today, collecting an unnecessary receipt time, permitting a future physical receipt, or treating this narrow correction as a workspace-wide calendar migration

**Unified Persian Date-Time Selection**:
A single accessible overlay that lets the User select either the Jalali date or one complete time composed of period, hour, and minute; committing one complete part preserves the other saved part and closes the overlay, so changing both requires reopening it.
_Avoid_: nested date and time dialogs, committing a partial hour or minute selection, competing focus or Escape ownership, hiding one selector behind another, or requiring a redundant final confirmation after a complete part is chosen

**Hiring Date Field Guidance**:
Every date input in the Unified Hiring Case View has a persistent semantic label and an explicit required or optional indicator, with a short business hint when its meaning is not self-evident. Empty-state placeholder text may supplement this guidance but never replace it.
_Avoid_: unlabeled calendar controls, relying on positional order to imply start and end, required dates that appear optional, using a disappearing placeholder as the only field description

**Candidate Portal Theme**:
The readable light and dark presentation of the Candidate `/apply` experience, defaulting a first-time visitor to light mode while offering a visible local theme toggle and remembering that device preference independently of Application data. Every surface and state defines compatible foreground, background, border, placeholder, disabled, error, and success colors rather than mixing hard-coded light surfaces with inherited dark text rules; automated visual checks cover both themes.
_Avoid_: white text inherited onto a white card, light text or placeholders disappearing in disabled sections, forcing Candidates into the authenticated workspace theme, storing theme preference in recruitment evidence, omitting a visible toggle, or validating only one theme

**Human Resources Workspace Theme**:
The readable light and dark presentation of every authenticated Human Resources page and its shared HR dialogs, tables, forms, navigation, lifecycle cards, statuses, and notifications. Theme correctness is validated across ordinary, disabled, pending, error, success, selected, and hover states using shared semantic colors; this audit is scoped to the Human Resources workspace and `/apply`, not unrelated ERP workspaces.
_Avoid_: fixing only the reported recruitment page, relying on broad CSS overrides that destroy semantic status colors, leaving hidden text in an untested state, or expanding the requested audit into Sales, Accounting, Inventory, Logistics, CRM, Security, or Administration

**Candidate Assessment Completion**:
The evidence-derived completion of the pre-identity Formal Assessments phase: every assessment selected by the active Formal Assessment Plan has one valid completed result, or the plan explicitly selects no assessments. Candidate-completed results are system-recorded from `/apply`; company-administered results are recorded by an HR Processor and corrected only through a new version. Completion never calculates a hiring outcome, while an HR Manager or Company Manager may independently request a repeat or record a reasoned final rejection.
_Avoid_: treating absence as implicit non-selection, requiring at least one assessment, automatically accepting or rejecting from a score or personality pattern, editing a completed result in place, hiding who recorded a company-administered result, or requiring a separate viewing acknowledgment to complete the evidence gate

**Justified Recruitment Field**:
A field from the source questionnaire that Human Resources explicitly classifies as required, optional, or omitted for a defined recruitment purpose. Sensitive family, social, or personal details are not mandatory merely because they appeared on the paper form.
_Avoid_: one-to-one digitization without purpose review, collecting every available personal detail, hiding why a sensitive field is required

**Recruitment Data Scope**:
The field-group access granted to a participant according to their assigned recruitment responsibility. Candidate self-service, interviewer work, hiring-manager decisions, Human Resources processing, identity documents, assessments, compensation, and confidential notes are distinct scopes rather than one HR-wide view.
_Avoid_: treating HR workspace VIEW as access to every candidate field, showing internal assessments to Candidates, exposing unnecessary identity or family data to interviewers or hiring managers

**Hiring Document Index**:
The categorized list of files linked to a Candidate Recruitment Case, showing each permitted document's title, category, version, uploader, date, and review state while representing restricted evidence only by its safe status and responsible owner. HR Managers may open HR-owned identity and recruitment evidence, Company Managers may open management-safe decision evidence, and protected Finance, medical, or otherwise restricted files remain within their own data scopes; protected access is audited.
_Avoid_: one unrestricted file gallery, hiding the existence of a dependency, opening Finance or medical evidence through managerial status alone, untitled uploads, unaudited protected downloads

**Sensitive Recruitment Access Event**:
The audit evidence produced whenever protected candidate identity, document, psychological assessment, compensation, or confidential-note data is viewed, changed, exported, or downloaded.
_Avoid_: auditing only edits, untracked document downloads, relying on hidden interface controls as privacy enforcement

**Recruitment Data Retention**:
The configurable period and disposition for closed Job Applications and Candidate data. Rejected or withdrawn case evidence—including sensitive documents, DISC/BIG FIVE/EQ results, insurance information, decisions, and audit history—remains stored under its category-specific restricted retention policy; the initial Candidate declaration provides notice and recorded consent for only the ordinary Candidate Profile to remain talent-bank searchable without a second permission request after closure, while sensitive evidence is excluded from talent-bank search and may expire sooner.
_Avoid_: immediate deletion of defensible history, indefinite retention by default, searchable sensitive documents or assessments, a second post-rejection permission flow, forcing every recruitment data group to share one retention duration

**Verified Hire Transfer**:
The explicit mapping that links or creates Personnel from a hired Candidate and transfers only approved, verified identity, contact, education, skill, certificate, and required document data with source provenance. Conflicting existing Personnel values require Human Resources review, while Internal Candidate Assessments remain in restricted Recruitment history.
_Avoid_: copying the entire recruitment file into Personnel, silently overwriting verified personnel data, losing where a transferred value came from, exposing confidential interview or psychological evidence through the general personnel profile

**Candidate–Personnel Identity Conflict**:
The unresolved, auditable condition in which an Application-owned Candidate identity claim and a potentially matching Candidate or Personnel share a strong identifier such as National Code but disagree on verified identity facts; the Application and immutable claim remain attached to their original Candidate, while final identity clearance, Hire Conversion, pre-activation contract approval, and activation stay blocked pending resolution. Discovery after activation creates urgent Human Resources work and blocks later identity-sensitive changes without automatically suspending or otherwise rewriting truthful employment.
_Avoid_: moving the Application to the potential match during submission, overwriting or deleting either identity automatically, accepting the disputed claim as canonical, treating document clearance as link resolution, creating an Employment Relationship against disputed Personnel, automatically suspending active employment from a data conflict, or repairing history without a recorded decision and provenance

**Candidate–Personnel Identity Resolution**:
The independently permissioned Shared Human Resources Decision Work Item that resolves a Candidate–Personnel Identity Conflict within three Tehran working days by choosing a structured link outcome from cited authoritative identity evidence; the first eligible decision closes it for all, while delay warns and escalates without closing or guessing. A Human Resources Broad-Manager Override may decide it, and the chosen identity, reviewer, evidence, time, rejected possibility, and resulting link remain separately audited from document clearance.
_Avoid_: assigning the decision from a title, duplicating it per reviewer, free-text-only resolution, treating identity-document approval as implicit link resolution, deciding without cited evidence, closing on deadline, hiding the rejected identity possibility, or losing prior conflicting values

**Candidate–Personnel Identity Match Policy**:
National Code identifies a potential same-person match but never authorizes automatic merge: harmless Persian-character, whitespace, and zero-width differences are normalized, while a genuine given-name, family-name, birth-date, or verified-identity disagreement creates a hard conflict and a mobile-only difference creates a warning.
_Avoid_: merging from National Code alone, treating `ی/ي` or `ک/ك` as different identities, ignoring a genuine name or verified birth-date disagreement, or treating a changed mobile as proof of a different person

**Candidate–Personnel Link Remediation**:
The report-first, manifest-gated audited repair that freezes activation and contract approval, detaches the Candidate from disputed Personnel, creates or confirms the correct verified Personnel, and reconnects only the affected Planned Employment Relationship in one transaction while preserving Application-owned evidence and immutable prior conversion history. A National Code moves atomically to the resolved Personnel while the conflicting record becomes identity-incomplete with preserved before/after evidence; obsolete Personnel requires a separate fresh impact fingerprint and standard ADMIN-authenticated Permanent Personnel Erasure only after the valid case leaves its deletion graph.
_Avoid_: applying unreviewed drift, retaining one canonical National Code on two Personnel, deleting before detachment, rewriting `HIRE_CONVERTED`, moving Application-owned evidence unnecessarily, retaining identity clearance without recheck, bypassing erasure safeguards, deleting valid recruitment history, or combining repair and irreversible erasure into one opaque action

**Accepted Offer**:
The Candidate's recorded acceptance of the latest fully approved offer, performed directly through the Application portal or captured as an audited Offline Candidate Offer Acceptance by an HR Processor. Direct portal acceptance requires a dedicated confirmation checkbox and a freshly typed full name that matches the latest submitted Application Form after harmless Persian character, whitespace, and zero-width-character normalization; it is distinct from the earlier Candidate Submission Declaration. The Job Application remains in the Offer stage pending successful employment conversion; acceptance does not by itself create Personnel employment, reserve capacity, or mean Hired.
_Avoid_: accepting an internally incomplete or obsolete offer version, reusing hidden or stale declaration state, prefilling away deliberate acceptance, rejecting equivalent Persian `ی/ي` or `ک/ك` spelling and spacing, tolerating a genuinely different or reordered name, obscuring whether the Candidate acted directly or HR recorded offline consent, treating verbal or recorded acceptance as completed hiring, closing the Application before employment records exist, partially creating employment after acceptance

**Declined Offer**:
The Candidate's direct portal decision, or an HR Processor's documented offline record, that the latest fully approved offer is not accepted. It requires a structured Persian reason category and may include an explanatory note, blocks Hire Conversion, and notifies the responsible Company Manager and HR Processor without automatically closing the Job Application. The Company Manager may respond with a new offer version or explicitly close the Application with the appropriate outcome; every earlier offer and decline remains preserved and audited.
_Avoid_: treating silence as decline, declining an obsolete or internally incomplete offer, converting after decline, automatically closing the Application without a Company Manager decision, overwriting the declined offer, losing the Candidate's reason, or omitting offline declines from the audit history

**Offline Candidate Offer Acceptance**:
An HR Processor's final, audited record that the Candidate accepted the latest fully approved Offer Compensation Summary through a documented phone call, in-person meeting, or other approved offline channel when SMS delivery fails or the Candidate cannot use `/apply`. It records the communication method and time, the Candidate's confirmed full name, the reason for using the offline path, and an explanatory note; it remains visibly distinct from direct portal acceptance and cannot be silently edited or replaced.
_Avoid_: describing the HR Processor as the accepting party, using offline acceptance before all internal approvals, accepting an older offer version, recording consent without communication evidence, hiding the recording HR Processor, editing the acceptance in place, or requiring a second HR approver when the authorized processor has captured the required evidence

**Offer Compensation Summary**:
The itemized ریال-denominated snapshot of proposed base salary and each recurring benefit or allowance, prepared before contract signing and explicitly accepted by the Candidate as part of the offer. Each predefined component uses its canonical title; only the سایر component has a required custom title. The signed contract references or includes this approved snapshot, and the post-contract salary-and-benefits table displays the same immutable rows and calculated total; later changes require a new effective-dated Compensation Agreement.
_Avoid_: entering compensation only after signing, a manually typed total without components, renaming predefined compensation components, saving سایر without a title, different offer and contract values, editing the accepted snapshot for a later raise

**Offer Compensation Approval**:
The authorization in which Company Management proposes the package and one eligible User with the explicit payroll-management action permission verifies its component classification and payroll-policy correctness before Candidate presentation. The verification is shared by all eligible permission holders until the first valid decision, is due three Tehran working days after proposal or resubmission, identifies the actual verifier and timestamp after completion, and applies only to the latest offer version. Return closes the prior version's deadline; a corrected version receives a fresh three-working-day deadline. An ordinary proposer cannot verify their own proposal; an eligible Human Resources Broad-Manager Override may do so only through a separate, deliberate verification that records the privileged override and self-verification state. Finance later compares the signed contract with the verified snapshot without editing it.
_Avoid_: Candidate presentation before payroll verification, an end-of-calendar-day deadline, silently carrying a returned version's deadline into its successor, separate preparation, payroll-manager, and Finance offer approvals, implying a pending verification belongs to a named person when it remains permission-shared, hiding the actual verifier or time, mixing decisions from different offer versions, ordinary self-verification, automatic or unmarked privileged verification, an unclassified lump sum, or Finance changing compensation components during contract verification

**Candidate Offer Notification**:
The idempotent SMS notification sent automatically after the latest Offer Compensation Summary passes payroll verification, directing the Candidate to the fixed `/apply` page without another Human Resources release step. A still-valid Application-specific OTP remains usable without being repeated; if access has expired or been revoked, the system issues a replacement OTP for the same Job Application without changing Candidate information or recruitment history. SMS failure does not reverse the completed verification, remains visibly failed in the Human Resources case view, and can be retried explicitly without producing duplicate successful notifications.
_Avoid_: presenting an unverified offer, requiring a manual Human Resources release after verification, repeating a recoverable secret that the system does not store, creating a new Application when access expires, discarding Candidate data during access replacement, rolling back verification because an external SMS provider failed, silently losing notification failure, or sending duplicate SMS messages on page refresh

**Pre-Hire Collateral Clearance**:
The Finance-owned review of required collateral and obligations that begins only after Candidate selection and Accepted Offer. Recording and verification are separate task-scoped Accounting actions performed by distinct Users in the ordinary path; an Accounting Workspace Administrator or global ADMIN holding both explicit collateral permissions may perform the later verification through a separately audited Managerial Self-Verification that records the actual actor, time, and privileged-authority label. Candidates who are rejected, withdrawn, or still under assessment are not asked to provide collateral.
_Avoid_: collecting collateral from every applicant, ordinary recorder self-verification, inferring override authority from a title or one permission, merging the two actions, unmarked managerial self-verification, performing Finance work through general Human Resources access, converting to Personnel before clearance, or treating offer acceptance as collateral approval

**Explicit No Pre-Hire Collateral Requirement**:
A versioned decision by a User with the collateral-requirement action permission that no pre-hire collateral is required for this Application. Missing requirement data never implies this decision. When nothing has been received, the system cancels the still-open Accounting receipt duty with a system reason and records the new decision without deleting prior requirements, duties, documents, or audit history. When collateral evidence or an original has already been received, the decision becomes effective only after the preserved original-return workflow is recorded and confirmed.
_Avoid_: treating a missing requirement as no requirement, deleting prior evidence, silently closing a received custody record, or allowing Hire Conversion while an original remains held

**Pre-Hire Collateral Duty Deadline**:
Each recording, verification, correction, original-return recording, and original-return verification stage receives a fresh deadline of three Tehran working days; Fridays and official holidays do not count. An overdue stage remains open and only raises a warning, and a successor stage never inherits the expired deadline of its predecessor.

**Pre-Hire Collateral Checklist**:
The versioned requirement proposed by Company Management for one Application before offer acceptance, defining required and optional collateral such as promissory notes, cheques, guarantees, undertakings, or an explicitly classified other item. The Candidate sees its type and applicable amount with a system-generated statement that Finance will coordinate receipt after offer acceptance; management supplies neither a separate delivery-time value nor free-text Candidate instruction. Only after acceptance does a Finance recorder add identifier, issuer or guarantor, receipt date, original custody location, and versioned scans, followed by independent Finance verification.
_Avoid_: one hardcoded checklist for every Job, a second ambiguous obligation field, manually authored Candidate delivery timing or instruction, collecting collateral before accepted offer, hiding a requirement from the Candidate, an unclassified attachment, a scan without original-custody evidence, or losing an instrument's return history

**No Pre-Hire Collateral Requirement**:
The explicit, versioned decision by a User with the collateral-requirement action permission that one Application requires no collateral before Hire Conversion. It immediately satisfies the collateral gate without creating an Accounting duty only when nothing has been received; an open receipt duty is cancelled with a recorded system reason, while a received original or copy keeps the decision pending until its preserved return workflow is completed and confirmed. The mere absence of a checklist, item, or duty remains unresolved rather than evidence that collateral is unnecessary.
_Avoid_: inferring no requirement from missing data, silently bypassing the collateral gate, creating an empty Accounting duty, discarding an open duty without its cancellation reason, making the decision effective while received evidence remains unreturned, deleting prior requirements or custody history, deriving authority from a job title, or losing who made the decision and when

**Collateral Follow-Up Reason**:
The Finance-recorded explanation of why a received collateral item is incomplete, mismatched, or otherwise requires correction or coordination. It exists only for an item explicitly returned for follow-up and is the limited coordination explanation Human Resources may see.
_Avoid_: requesting a follow-up reason during normal receipt, treating the reason as custody evidence, exposing protected instrument details, or showing an unexplained free-text field before follow-up is selected

**Collateral Original Return**:
The Finance-recorded handover of a collateral original after a pre-activation cancellation or another authorized release, identifying the recipient and return date and preserving a description plus uploaded proof of handover. Recording and confirmation are separate actions performed by distinct Users ordinarily; an Accounting Workspace Administrator or global ADMIN holding both explicit collateral permissions may confirm their own recorded return only through Managerial Self-Verification.
_Avoid_: showing return fields during ordinary receipt, recording return without a recipient or proof file, confusing original return with rejection for correction, ordinary self-confirmation, unmarked managerial self-verification, merging record and confirmation, or losing the instrument's custody history

**Signed Employment Contract Clearance**:
The versioned evidence that Human Resources recorded and submitted every required signed page and contract metadata, followed by an Accounting-destination shared decision that checks signatures, completeness, dates, and readability without granting the reviewer Human Resources workspace access. Replacements create new versions, and Accounting clearance remains an Employment activation blocker.
_Avoid_: approving inside the Human Resources case, granting Accounting general recruitment access, partial-page evidence, overwriting an earlier scan, treating submission as approval, or activating employment from an unapproved contract

**Collateral Data Scope**:
The access boundary in which Human Resources sees checklist progress, item categories, coordination reasons for missing or rejected items, and the final clearance decision, while instrument identifiers, amounts, guarantor details, custody locations, and scans remain restricted to authorized Finance users. Viewing or downloading protected collateral data produces audit evidence.
_Avoid_: broad HR or Admin access to instrument details, client-side-only hiding, unaudited views or downloads, exposing Finance evidence merely to coordinate checklist progress

**Hire Conversion**:
The HR Manager's atomic operation, with an explicit planned employment start date, that becomes available after HR identity clearance and Finance collateral clearance and links or creates Personnel, creates the Planned Employment Relationship and capacity-bearing primary Employment Assignment, reserves committed capacity, links the source Application and Recruitment Request, and opens onboarding without creating a User account. The Application receives the Hired outcome only after the whole conversion succeeds; insurance scheduling remains a separate HR Processor task, and ordinary work, payroll participation, and employment activation remain blocked until contract approval unless a valid Pre-Activation Activity Permit authorizes limited activity.
_Avoid_: collecting unrelated files or insurance deadlines during conversion, an unlabeled planned-start date, partial hiring records, marking Hired before conversion completes, consuming an opening or capacity without the linked employment foundation, creating login access implicitly, treating planned employment as active work authorization

**Pre-Activation Hiring Cancellation**:
The reasoned closure when a selected Candidate withdraws or is rejected before Employment activation: the Application receives its exact outcome, any Planned Employment Relationship and assignment are cancelled without deleting Personnel, committed capacity is released, and pending User provisioning is cancelled. Administrative completion remains blocked until Finance returns or releases every collateral original with recipient, date, handover proof, and Finance Manager confirmation.
_Avoid_: deleting converted Personnel, leaving Position capacity committed, retaining collateral without an open obligation, generic closure without outcome, enabling a pending User after cancellation

**Employment User Provisioning Request**:
The Responsible Supervisor's request for ERP access when the Personnel's Position requires it, approved by the relevant workspace or data owners and fulfilled by an authorized User administrator by linking one User to the existing Personnel identity. Hire Conversion never creates the User automatically; the account remains disabled until its approved access-start time and receives only explicitly approved permissions.
_Avoid_: deriving login access from Personnel or Position alone, creating a second Personnel identity, enabling access before its approved start, generic default workspace permissions

**Personnel-First User Provisioning**:
The guided administration flow for a person who needs both an employment record and ERP access: create or confirm the Personnel identity first, then optionally create or link one separate User account when login access is actually required. Personnel remains the workforce source of truth; User remains the authentication and access identity, and either may exist without manufacturing the other when the real-world situation requires it.
_Avoid_: merging User and Personnel into one lifecycle, automatically creating login access for every worker, duplicating Personnel when linking an existing User, or storing employment truth only on the User account

**Onboarding Case**:
The new hire's effective onboarding file created by Hire Conversion from snapshots of the current company-wide checklist and the applicable Job or Position checklist. Later template changes do not rewrite an active or completed case.
_Avoid_: one universal checklist for every Job, recalculating active onboarding from current templates, losing which requirements applied when hiring occurred

**Unified Hiring Case View**:
The Human Resources-facing page and chronological progress view that presents the linked Candidate and Job Application before Hire Conversion, the resulting Personnel, Planned Employment Relationship, and Onboarding Case afterward, and cross-functional Finance tasks with their ownership and data restrictions intact. Candidate self-service exposes only Candidate actions and appropriate statuses, never internal assessments or protected Finance details.
_Avoid_: one duplicated master record, losing the Application-to-Personnel link, copying Finance evidence into HR data, exposing internal or financial details through the Candidate portal

**Permission-Scoped Hiring Task Detail**:
The actionable fields, files, and controls for a cross-functional hiring task, visible only to Users with its required action and evidence-view permissions or an eligible Human Resources Broad-Manager Override; other case participants see only the minimum dependency status or blocker needed to coordinate their own work.
_Avoid_: requiring an assigned business-authority role, exposing every task panel as read-only, showing protected evidence through unrelated permissions, hiding the existence of a dependency, or granting task visibility through generic workspace access alone

**Guided Hiring Lifecycle**:
The evidence-derived progress and navigation model inside a Unified Hiring Case View, grouping the case into nine phases: Formation and Applicant Form, Initial Human Resources Review, Optional Formal Assessments, Company Evaluation Plan, Identity Review, Offer and Acceptance, Collateral and Hire Conversion, Start Preparation, and Employment Activation. It reports phase position and completed mandatory items rather than a false global percentage, and guides work across ownership boundaries without allowing manual phase advancement or replacing the underlying domain controls.
_Avoid_: a manually advanced form wizard, treating every recruitment activity as an Application Stage, implying parallel work is strictly sequential, bypassing backend controls with next/previous navigation

**Hiring Lifecycle Phase Status**:
The single visible condition of a Guided Hiring Lifecycle phase: Completed, Action Required by You, Waiting, Blocked, Paused, Upcoming, or Terminated. Waiting is a healthy dependency on another participant, date, or event; Blocked means correction or intervention is required before the case can progress; Paused preserves the phase and evidence while a reversible disposition prevents ordinary progression until explicit reactivation.
_Avoid_: presenting every delay as an error, hiding actionable work inside generic in-progress status, treating a rejected or withdrawn case as successful completion

**Hiring Lifecycle Completion Gate**:
The mandatory evidence that completes one Guided Hiring Lifecycle phase without inventing a new business approval. Formal assessments are optional individually, but every assessment selected in the active Formal Assessment Plan blocks progress until it has a valid result. Non-blocking insurance work and optional onboarding tasks remain visible without becoming gates unless an explicit policy makes them mandatory.
_Avoid_: equating every optional activity with a blocker, treating an incomplete selected assessment as skipped, hiding a rejected mandatory requirement, or changing hiring policy through presentation logic

**Hiring Lifecycle Guidance Scope**:
The sanitized phase status, responsible function, explanation, and permitted next work visible to an authorized hiring participant. It prioritizes one unblocked action the participant can perform, retains other available parallel actions as secondary work, and shares the lifecycle map while Recruitment Data Scope continues to protect underlying details.
_Avoid_: hiding whole phases from non-owners, exposing protected evidence through progress explanations, confusing visibility of a phase with authority to act

**وضعیت آماده‌سازی شروع همکاری**:
خلاصه فقط‌خواندنی و حداقلیِ وضعیت قرارداد استخدامی، مشارکت حقوق‌ودستمزد و ثبت بیمه که مستقیماً از شواهد اصلی چرخه استخدام مشتق می‌شود و اثر هر مورد بر فعال‌سازی را بدون افشای جزئیات محدودشده نشان می‌دهد. این خلاصه در آماده‌سازی و فعال‌سازی باقی می‌ماند تا پیگیری غیرمسدودکننده بیمه پس از شروع همکاری نیز ناپدید نشود.
_Avoid_: فرم ساخت وظیفه موردی، تکمیل دستی وضعیت سیستمی، استفاده از ردیف وظیفه تکراری به‌عنوان منبع حقیقت، پنهان‌کردن پیگیری بیمه پس از فعال‌سازی، یا افشای مدرک و یادداشت محدودشده

**Onboarding Task**:
A company-wide or Job-specific onboarding requirement with mandatory or optional classification, accountable owner, due date, status, and completion evidence. Job-specific tasks cover training, safety, operational readiness, and authorizations without duplicating common administrative tasks.
_Avoid_: tasks without accountable ownership, completion without evidence when evidence is required, mixing common and Position-specific requirements into an unstructured note

**Onboarding Requirement Level**:
The operational effect of an Onboarding Task: Activation Blocker prevents the Employment Relationship from becoming Active; Post-Start Required permits activation but remains tracked and escalated until completion; Optional is situational or recommended and does not block activation.
_Avoid_: treating every task as a start blocker, silently ignoring overdue required work, letting an optional task prevent employment activation

**Independent-Work Blocker**:
A Job-specific Onboarding Task whose incompletion permits active employment and supervised work but forbids independent performance of the affected hazardous or controlled operation until training, clearance, and authorization are complete.
_Avoid_: confusing employment activation with equipment authorization, allowing independent hazardous work before clearance, preventing all supervised work when only independent operation is blocked

**Onboarding-Blocked Start**:
The condition in which a Planned Employment Relationship reaches its intended start date while an Activation Blocker remains incomplete. Employment stays Planned, Position capacity remains committed, Human Resources and the hiring manager are urgently alerted, and resolution requires completing the blocker or formally changing the start date.
_Avoid_: automatic activation to hide incomplete onboarding, releasing committed capacity, silently moving the start date, ignoring an overdue blocker

**Planned Employment Start Revision**:
The reasoned, audited replacement of a scheduled start date with today or a future date by a User holding the independent planned-start-revision permission, granted by default to existing and future Human Resources Processor and Manager permission profiles without reviving custom revocations, while the Employment Relationship remains Planned. The revision atomically updates the Job Application, Planned Employment Relationship including its original planned date, and primary Employment Assignment after revalidating Position capacity. Payroll Participation follows automatically only when its effective date still inherited the previous start date; an explicitly reasoned different Payroll date remains unchanged, blocks activation, and requires renewed Payroll review. Signed employment-contract and insurance evidence never changes automatically: the revision system-withdraws any pending Contract submission and its Accounting duty using the start-change reason, invalidates any prior Contract clearance, creates correction work, and blocks activation until a successor version is approved, while an insurance mismatch becomes visibly review-required but remains non-blocking. Past-date historical correction is explicitly outside this planning capability and requires separately designed attendance, Payroll, insurance, and Contract coordination before it may be introduced.
_Avoid_: accepting a past date through the planning control, changing a start date after Employment activation through the planning control, deriving revision authority from a role name instead of an action permission, reviving a custom-revoked revision permission during migration, updating only one copy of the planned date, retaining the superseded date as the original plan before work actually began, skipping capacity validation, leaving a pending Contract review actionable after the date changes, requiring a redundant manual Contract withdrawal, overwriting an explicitly divergent Payroll date, activating with an unreviewed Payroll mismatch, rewriting signed Contract or insurance evidence, retaining Contract clearance after a material date mismatch, blocking activation only for the non-blocking insurance follow-up, hiding a resulting mismatch, or performing the revision without a reason and audit history

**Employment Activation Authorization**:
The designated HR Manager's explicit authorization to change a Planned Employment Relationship to Active on or after its scheduled start date, available only after approved identity and collateral clearances, accepted and approved compensation, signed-contract clearance, configured Payroll Participation, and completion of every Onboarding Activation Blocker. Reaching the date never activates employment automatically; unresolved requirements produce an urgent Onboarding-Blocked Start alert.
_Avoid_: date-only automatic activation, generic Admin authority, activation without payroll configuration or contract clearance, hiding an unresolved blocker by changing status

**Signed Paper Employment Contract Clearance**:
The versioned evidence that a User with the Human Resources recording permission submitted a signed paper employment contract with explicit start and end dates, then a User with the independent Accounting verification permission approved it or returned it with a reason through a Shared Cross-Workspace Decision Duty. A material replacement invalidates prior approval; an Accounting workspace administrator or global ADMIN holding both permissions may self-verify only through distinctly audited Workspace Administration Duty Override, without receiving recruitment-case access.
_Avoid_: deriving authority from Finance titles, an open-ended Sabalan employment contract, Accounting approval before Human Resources submission, approval inside the source workspace, self-verification without both permissions and the managerial audit marker, an approval-only checkbox without contract evidence, general recruitment access for the reviewer, or silently retaining approval after evidence changes

**Signed Employment Contract Review Duty**:
The Accounting-destination Shared Cross-Workspace Decision Duty for the one latest submitted and unresolved contract version, exposing only the person name and safe case reference, contract number and dates, version and submission evidence, recorder identity, scan, and approve or return actions. Human Resources must withdraw a still-pending submission with a reason before recording its immutable successor; approved and withdrawn versions remain in History, while only the latest valid unresolved version is actionable. Human Resources Users with the independent recording permission retain access to their submitted version, status, and return reason; return closes that review and creates one claimable Human Resources execution duty for a new immutable version whose Accounting review receives a fresh three-Tehran-working-day deadline.
_Avoid_: exposing the Application form, assessments, compensation, collateral, identity documents, or an HR case link; granting contract evidence from general Recruitment Case access; editing a submitted version; submitting a successor before reasoned withdrawal of pending work; showing two actionable versions for one Application; deleting superseded history; reopening a returned review; hiding correction in a notification; inheriting an expired deadline; approving a stale version; or granting source-workspace access through the duty

**Signed Employment Contract Correction Duty**:
The claimable Individual Execution duty in Human Resources created by an Accounting return, available to current contract-recording permission holders and exposing the prior submitted version plus its structured return reason. Claiming makes one User accountable; recording and submitting the immutable successor completes it and creates a fresh Accounting review, while its independent three-Tehran-working-day deadline may warn but never closes the work.
_Avoid_: a notification-only return, permanent assignment to the prior recorder, editing the returned version, parallel successor drafts, inheriting the Accounting deadline, or completing correction without submitting the successor for review

**Signed Employment Contract Submission Withdrawal**:
The reasoned Human Resources withdrawal of the latest unresolved submitted contract version before Accounting commits a result, preserving that version while cancelling its review duty with a system reason and creating a Contract Correction Duty for an immutable successor. A concurrently committed Accounting result wins and makes withdrawal unavailable.
_Avoid_: deleting or editing the submitted version, withdrawal without contract-recording permission and a reason, silently removing Accounting work, reopening the cancelled review, or overwriting a committed Accounting result

**Signed Employment Contract Duty Reconciliation**:
The report-first, manifest-gated, idempotent preservation of exactly one open review duty for each Application's latest valid submitted and unresolved contract version, creating a missing latest duty and cancelling older open duties with explicit supersession evidence while retaining them in History.
_Avoid_: applying without a reviewed manifest, creating duplicate duties, leaving an obsolete version actionable, deleting superseded history, mutating contract evidence, or granting Accounting Human Resources workspace access

**Legacy Hiring Finance Evidence Permission Cutover**:
The report-first retirement of the ambiguous `MANAGE_FINANCE_EVIDENCE` permission from every hiring endpoint and duty, mapping known Finance Recorder and Finance Manager assignments only to their corresponding independent operational permissions while placing direct ambiguous grants into Admin review. Historical grants remain auditable, and only Recruitment Case access proven to have come solely from the retired prerequisite is eligible for removal.
_Avoid_: granting both maker and checker authority from one legacy grant, deleting grant history, retaining a hiring action on the legacy permission, removing independently intended Recruitment Case access, or mutating permissions without a reviewable report

**Employment Insurance Enrollment**:
The HR Processor-owned onboarding record for company insurance setup after Hire Conversion, with a state of not started, in progress, active, or exempt/not applicable, plus effective date, due date, and optional note. The HR Manager receives only its coordination status rather than its fields or notes; the first version has no insurance number, provider details, attachments, or external integration, raises overdue alerts as a required onboarding task, does not block Employment activation, and remains actionable after activation until resolved.
_Avoid_: closing insurance follow-up merely because employment activated, HR Manager editing or viewing the task detail, granting access through generic HR or Admin permission, overwriting the Candidate's prior-insurance response, pretending external enrollment was verified, premature insurance subsystem detail, silently ignoring an overdue setup task

**Insurance Registration Path**:
The separately recorded route for Employment Insurance Enrollment: `ثبت بیمه توسط شرکت` or `درخواست ثبت مستقل توسط شخص`. An HR Processor records an applicant's independent-registration request with its communication method and time, resolves Sabalan's operational follow-up as exempt/not applicable, and requires no later evidence or notification that the applicant activated independent coverage.
_Avoid_: mixing registration route with operational status, inventing approved/rejected/pending route states, reporting independent registration as company-activated insurance, requiring later independent-policy evidence

**Pre-Activation Attendance Evidence**:
Immutable actual presence recorded by Security for Personnel whose Employment Relationship has not yet been authorized to become Active. The record exposes the policy discrepancy and is never deleted or altered to make onboarding appear compliant.
_Avoid_: blocking Security from recording physical reality, treating attendance recording as employment authorization, deleting evidence after Human Resources resolves the onboarding problem

**Pre-Activation Activity Permit**:
A separate, explicit, time-bounded authorization for limited activity while the Employment Relationship remains Planned and Onboarding Blockers remain unresolved. It identifies the permitted activity and location, validity period, approving actor, required supervisor presence, device or system access restrictions, and exception reason; it never activates employment or removes an Activation Blocker.
_Avoid_: deriving permission from attendance, a broad permission to work normally, an undated or unscoped exception, treating the permit as completion or waiver of onboarding

**Pre-Activation Permit Approval**:
The scope-dependent authorization for a Pre-Activation Activity Permit: Human Resources and the Responsible Supervisor approve every permit, with additional safety or equipment authority for hazardous work and system or data owner approval for ERP or sensitive access. Security verifies a valid permit at entry but does not approve it; self-approval is forbidden, approvals retain actor snapshots, and the permit expires automatically.
_Avoid_: one generic approver for every risk, Security authorizing employment, self-approval, access continuing after permit expiry

**Payroll Participation**:
The HR Payroll Manager's effective-dated authorization that includes an Employment Relationship in payroll after reviewing the approved compensation rows and planned employment start. Its required start date defaults to the planned employment start; a different date requires a reason, and authorization remains independent of Personnel activity, system access, Security roster membership, or recorded attendance.
_Avoid_: an unexplained date-only control, participation without reviewing approved compensation, an unexplained mismatch with employment start, a mutable payroll-eligible flag, deriving payroll population from User, Personnel.isActive, roster, or attendance

**Compensation Agreement**:
The effective-dated agreement governing base pay and recurring person-level benefits for one Employment Relationship. Assignment-specific compensation is separate, and at most one Compensation Agreement governs a relationship at a moment.
_Avoid_: salary stored directly on Personnel, overlapping governing agreements, a second base salary for every Assignment

**Assignment Compensation Component**:
An effective-dated earning or allowance attributable to one Employment Assignment, such as responsibility, acting duty, shift, location, or hazardous-work compensation.
_Avoid_: base salary, inferring assignment compensation only from attendance, automatically paying every secondary assignment

**Payroll Policy Version**:
An approved effective-dated set of sourced statutory parameters, calculation rules, rounding behavior, and payroll-calendar policy that governs payroll for a period.
_Avoid_: hardcoded annual values, editing an active version in place, a policy value without source or effective date

**Payroll Policy Owner**:
The explicitly assigned person accountable for maintaining sourced Payroll Policy Versions, whose proposed version requires approval by a separate authorized reviewer before use.
_Avoid_: generic ADMIN authority, self-approved policy changes, software deployment as the ordinary annual policy process

**Payroll Component**:
A classified earning, deduction, employer contribution, or informational amount calculated by a controlled, explainable rule and displayed in ریال.
_Avoid_: an opaque net adjustment, arbitrary executable formula, an amount without classification or calculation trace

**Payroll Period**:
The Jalali calendar month for which a regular Payroll Run calculates compensation and deductions under an explicit cutoff and policy version.
_Avoid_: an unlabeled date range, Gregorian-month substitution, deriving the period from payment date

**Payroll Cutoff**:
The declared boundary through which finalized and approved workforce evidence is eligible to be snapshotted into a Payroll Run.
_Avoid_: querying mutable live data during approval, silently including later corrections, an implicit current-time boundary

**Payroll Run**:
The controlled calculation for one payroll period and run type, containing its snapshotted population, inputs, policy versions, component results, exceptions, approvals, and downstream status.
_Avoid_: a mutable spreadsheet total, recomputing an approved result from current data, one record that hides employee-level calculations

**Payroll Input Snapshot**:
The immutable population, employment, compensation, schedule, attendance, leave, overtime, mission, obligation, and policy evidence used by one Payroll Run.
_Avoid_: a live query presented as historical payroll truth, a value without source and version, replacing evidence after approval

**Payroll Blocking Exception**:
An unresolved condition for a payroll participant, such as missing exit, conflicting schedule, unresolved attendance correction, or pending overtime decision, that prevents the participant from being finalized.
_Avoid_: silently paying from incomplete evidence, omitting the employee, blocking review work for every unaffected employee

**Payroll Deferral**:
The authorized, reasoned decision to exclude one unresolved participant from final payment in the regular run and carry the obligation into a linked Supplemental Payroll Run.
_Avoid_: silent omission, deleting the participant, approving an incomplete run without an accountable decision

**Supplemental Payroll Run**:
A linked payroll calculation that pays or corrects amounts not finalized in the regular run without changing the approved original.
_Avoid_: reopening an approved run, an unlinked manual payment, overwriting the original payslip

**Payroll Reversal Run**:
A linked payroll calculation that formally reverses all or part of an approved payroll result while preserving the original calculation and financial history.
_Avoid_: deleting an approved result, negative free-text adjustment without source, changing posted lines in place

**Approved Payroll Run**:
A Payroll Run whose population, evidence, policies, calculations, approvals, and results are immutable and ready for controlled Accounting consumption.
_Avoid_: editable approved payroll, approval with unresolved or undeferred participants, treating calculation completion as approval

**Payroll Separation of Duties**:
The default rule that preparation, material adjustment, policy activation, and final approval require appropriately distinct accountable actors. An authorized General Manager or ADMIN is the explicit exception and may personally perform multiple stages on the same case; every stage remains a separate intentional action and records the actual actor, privileged override, self-approval state, and time. This exception does not merge Payroll with Accounting ownership or permit Accounting to edit employee calculation lines.
_Avoid_: ordinary self-approval, silent or automatic ADMIN completion, hiding privileged override use, merging distinct audit events, or treating the override as permission for Accounting to rewrite Payroll calculations

**Payroll Accounting Handoff**:
The immutable, idempotent transfer of an Approved Payroll Run summary and proposed accounting attribution from HR Payroll to Accounting for posting and settlement.
_Avoid_: Accounting editing employee calculation lines, duplicate financial posting, sending an unapproved payroll result

**Released Payslip**:
The employee-scoped, immutable statement from an Approved Payroll Run that becomes visible only after explicit authorized publication. A later correction creates a linked payslip rather than replacing it.
_Avoid_: draft calculation shown as a payslip, bulk unrestricted access, overwriting the original after a correction

**Payroll Obligation**:
An approved loan or advance balance whose installments, payroll deductions, pauses, adjustments, and settlement are recorded as an auditable ledger.
_Avoid_: directly editable remaining balance, deduction without an approved source, a full loan-origination workflow inside Payroll

**Job Evaluation Template**:
The versioned standard criteria and expectations shared by people performing the same Job.
_Avoid_: Position-specific operating context, one universal company template, changing active reviews when a template changes

**Position Evaluation Addendum**:
The versioned line-, shift-, location-, or responsibility-specific criteria added by a Position to its Job Evaluation Template.
_Avoid_: duplicating the complete Job template, silently replacing shared criteria, person-specific favoritism

**Review Template Snapshot**:
The immutable combination of the applicable Job Evaluation Template and Position Evaluation Addendum governing one performance review period.
_Avoid_: calculating a historical review from current templates, changing criteria or weights after the review opens

**Operational Evaluation Evidence**:
Traceable read-only facts supplied by the operational system that owns them, with source, definition, period, extraction time, version, and data-quality state retained for review context.
_Avoid_: editable evidence on the evaluation page, unreviewed data used directly as a rating, a number without provenance

**Employee Self-Assessment**:
The employee's criterion-level input and context for a review, distinct from the formal evaluation authored by the Responsible Supervisor.
_Avoid_: formal rating, employee approval of the outcome, substituting self-report for supervisor judgment

**Formal Performance Review**:
The Responsible Supervisor's documented, criterion-level judgment using the Review Template Snapshot, relevant evidence, contextual explanation, and transparent weighting.
_Avoid_: an automatically generated operational score, an opaque overall number, an automatic compensation or employment decision

**Performance Acknowledgement**:
The employee's confirmation that the formal review was received, without implying agreement with its findings.
_Avoid_: acceptance of the score, waiver of response or objection, forced agreement

**Employee Evaluation Response**:
The employee's recorded comment on a formal review that does not by itself open the formal objection process.
_Avoid_: Performance Acknowledgement, Formal Performance Objection, silent replacement of supervisor comments

**Formal Performance Objection**:
The employee's time-bounded request for authorized reconsideration of a formal review while the original review remains intact.
_Avoid_: deleting the original, editing the supervisor review in place, treating every employee comment as an objection

**Revised Performance Review**:
An authorized, reasoned version linked to the original review when a formal objection or exceptional review decision changes the outcome.
_Avoid_: overwriting history, an unlinked replacement, revision without accountable actors and reason

**Controlled Payroll Cutover**:
The transition after two reconciled parallel periods in which the new HR/payroll system becomes the sole ordinary writer and the first live payroll must be approved, posted, paid, and reconciled before the stability window begins.
_Avoid_: dual ordinary writers, cutover before reconciliation, treating parallel calculation alone as production proof

**Controlled Return Window**:
The 30-day critical-discrepancy-free period following complete reconciliation of the first live payroll, after which HR Payroll, Accounting, and the System Owner may authorize permanent removal of legacy editing.
_Avoid_: starting the clock at deployment, retiring fallback before the first live payroll proves stable, an exit without joint sign-off

**Legacy Break-Glass Access**:
Time-limited, least-privilege legacy editing available only to a named technical administrator for a documented critical incident, with full audit, automatic four-hour expiry, independent review, and mandatory reconciliation into the new system.
_Avoid_: normal legacy editing after cutover, standing emergency access, returning to normal operation before reconciliation

**Organizational Unit**:
A typed node in Sabalan's single organizational hierarchy, covering levels such as company, division, department, workshop, production line, and administrative section.
_Avoid_: a separate hierarchy or table for every organizational level, treating workplace or cost center as an organizational parent

**Workplace**:
The physical or operational location where work is performed, independent of the Organizational Unit hierarchy so one location may serve multiple units.
_Avoid_: Organizational Unit, Cost Center

**Cost Center**:
The accounting classification to which workforce cost is attributed, independent of the Organizational Unit and Workplace hierarchies.
_Avoid_: Department, Workplace, deriving accounting ownership only from organizational placement

**Organizational Foundation Record Lifecycle**:
The retained identity of an Organizational Unit, Job, Position, Workplace, or Cost Center across active and inactive use. Ordinary removal deactivates the record and later reactivation restores the same identity and code; permanent deletion is limited to a record with no current or historical reference, and every lifecycle action remains auditable.
_Avoid_: deleting referenced foundation data, re-creating an inactive record under a new identity, cascading removal into history, or treating deactivation as erasure

**Effective-Dated Foundation Status**:
An Organizational Foundation Record's activation or deactivation taking effect today or on a scheduled future date, never retroactively through the ordinary lifecycle action. A scheduled deactivation prevents new dependencies from extending beyond its effective date, a scheduled activation remains unavailable until its date arrives, and changing or cancelling either schedule requires a reason and separate audit evidence.
_Avoid_: backdating ordinary status changes, hiding a scheduled transition, accepting a dependency beyond retirement, or treating a future activation as currently usable

**Organizational Foundation Identity Check**:
Each Organizational Unit, Job, Position, Workplace, and Cost Center has a required immutable code unique within its record type, while normalized similar names or titles produce a reviewable warning rather than a uniqueness failure. Creating a similarly named record requires explicit confirmation after showing the matching records' codes, states, and organizational context.
_Avoid_: allowing a duplicate code, globally forbidding legitimate shared titles, silently creating a near-duplicate, or treating Persian and Arabic character variants as different names

**Organizational Foundation Creation**:
The atomic creation of a complete, validated Organizational Unit, Job, Position, Workplace, or Cost Center as active today by default, active from a scheduled future date, or inactive, with its creator, server time, initial state, and effective date retained. Incomplete drafts are not persisted, and an inactive or not-yet-active record cannot be selected by operational work.
_Avoid_: saving incomplete foundation drafts, silently defaulting an unknown state, allowing premature operational use, or creating a record when the user abandons the form

**Organizational Foundation Correction**:
An audited in-place repair to descriptive foundation data such as a spelling error in a name, title, description, or responsibility, preserving the record's identity while retaining before/after evidence. An immutable code can be corrected only by deleting and re-creating a completely unreferenced record.
_Avoid_: disguising a real reorganization as a correction, changing an immutable code on a referenced record, or losing the prior value

**Organizational Foundation Save Recovery**:
The atomic, retry-safe save behavior that preserves unsaved foundation form input and the Last Successful View after failure, prevents duplicate creation, and rejects an update when another actor changed the record since the form loaded. A conflict presents the user's starting version beside the current version for review and requires reapplying the intended change rather than allowing a blind overwrite.
_Avoid_: partial persistence, clearing input after failure, duplicate records after retry, last-write-wins overwrites, or replacing a usable list with a full-page error

**Effective-Dated Organizational Change**:
A reasoned change to organizational structure whose effective date preserves both the prior and new states, including Organizational Unit parent or type, Position Job or Organizational Unit placement, and Position reporting line. A completely unreferenced record may be changed directly, but an operationally referenced record's structural history is never overwritten.
_Avoid_: rewriting historical organization charts, treating a transfer as a spelling correction, or forcing a new identity for every genuine reorganization

**Organizational Foundation Deactivation Dependency**:
An active Organizational Unit cannot be deactivated while it has active child units, Positions, or current or future direct Employment Assignment references; an active Job cannot be deactivated while an active Position or Recruitment Request depends on it; and an active Workplace or Cost Center cannot be deactivated while an active Position, current or future direct assignment, or open operational or financial workflow requires it. Deactivation never cascades; finalized and historical references remain readable without blocking the action, and the impact preview groups every live blocker with a count and filtered drilldown.
_Avoid_: silently deactivating dependents, checking only Position defaults, leaving an open financial workflow without an active Cost Center, treating historical references as active blockers, or hiding blocker detail

**Organizational Foundation Activation Gate**:
Activation or reactivation requires every applicable upstream foundation record to be active, every hierarchy and reporting line to remain acyclic, and every Position capacity schedule to remain valid. Activation never cascades and never reopens an old assignment, Recruitment Request, or hiring Application; unresolved prerequisites are shown as actionable blockers and the activation is audited.
_Avoid_: activating a Position with an inactive dependency, silently activating dependents, reviving operational work from history, or relying on UI visibility instead of validation

**Inactive Organizational Foundation Record**:
An Organizational Foundation Record retained outside ordinary active lists and operational selectors with its deactivation reason, actor, effective date, history, and historical references visible. It permits only audited descriptive correction, history inspection, validated reactivation preparation, or permanent deletion when completely unreferenced; structural and capacity changes needed for return are validated together with the reactivation effective date.
_Avoid_: treating inactivity as erasure, allowing hidden standalone structural edits, exposing the record in active selectors, or obscuring historical identity

**Organizational Foundation Permanent Deletion Authority**:
The narrowly granted capability to permanently delete a completely unreferenced Organizational Foundation Record after destructive-action safeguards; every active ADMIN possesses it, and specifically approved active Users may receive it directly without receiving the ADMIN role or broader Human Resources authority. The grant belongs to the stable User identity, never transfers through a display name, email, job title, or general Manager role, and becomes unusable while that User is inactive.
_Avoid_: granting permanent deletion to every Manager, deriving it from Human Resources workspace access, transferring it when a person's title changes, or bypassing deletion safeguards for a named User

**Organizational Foundation Change Evidence**:
The permanent audit evidence for every creation, correction, structural change, capacity change, status transition or schedule change, and permanent deletion, including the actor, server time, effective date when applicable, and before/after values. A reason is mandatory for structural changes, capacity decreases, activation or deactivation, changing or cancelling a future schedule, and permanent deletion, while creation, descriptive correction, and capacity increase may omit it.
_Avoid_: auditing only destructive actions, accepting a client-authored event time, requiring meaningless reasons for routine creation, or losing the prior value

**Position Deactivation Blocker**:
A current or future Employment Assignment of any type, an open or paused hiring Application, an active Recruitment Request with committed capacity, or an active subordinate Position that must be resolved before a Position can be deactivated. Ended assignments and closed hiring history remain linked to the inactive Position and do not block deactivation; no dependency is cancelled or transferred automatically.
_Avoid_: deactivating a Position still carrying live work, treating historical references as blockers, or silently cancelling or moving dependent records

**User Creation Provenance**:
The immutable origin of a system user account. Public self-registration is disabled, and managed accounts created after provenance tracking is introduced record their creation source and exact creating user when one exists. Existing accounts without trustworthy historical evidence are shown as `Unknown — Historical Data`; an administrator may record a historical creator only as an explicitly manual, timestamped, audited correction.
_Avoid_: guessing a creator from timestamps, roles, permissions, or the administrator who probably created the account; presenting a manual correction as automatically captured history

**Recognized Login Session**:
A server-tracked authorization created only after successful authentication. It represents one browser profile or client session rather than a guaranteed physical device, and records inferred browser, operating system, device category, IP address, login time, last activity, status, and revocation history. Active sessions may be revoked individually.
_Avoid_: claiming browser metadata proves a hardware identity, creating a recognized device from a failed login, or deleting session history when access is revoked

**Failed Authentication Event**:
A security-log record for an unsuccessful login attempt, kept separately from Recognized Login Sessions. It records the attempted identifier, time, IP address, available client metadata, and a safe failure classification without storing the submitted password.
_Avoid_: showing a failed attempt as an authorized device, recording plaintext credentials, or exposing overly specific failure details to the unauthenticated caller

**Authentication Security Log Access**:
Every authenticated user may view and revoke their own active Recognized Login Sessions through Personal Affairs. Only an ADMIN may inspect another user's active sessions, login history, and Failed Authentication Events or revoke that user's individual or complete set of sessions; managerial role alone does not grant access.
_Avoid_: exposing organization-wide IP and login history to ordinary users or managers, preventing users from securing their own account, or making remote revocation an unaudited action

**Authoritative Server Session**:
The server-side authentication state referenced by a secure HttpOnly cookie and checked on every protected request. Revocation takes effect immediately because an otherwise valid browser cookie cannot authorize access after its server session is revoked. Introducing this model invalidates legacy stateless JWT access and requires every user to sign in again once at deployment.
_Avoid_: treating the session list as informational only, retaining authentication secrets in browser JavaScript storage, or allowing legacy seven-day JWTs to bypass revocation

**Session Lifetime**:
An Authoritative Server Session expires after 12 hours without activity and always expires no later than 7 days after authentication, even with continuous use. Browser closure alone does not revoke it, there is no permanent remember-me mode in the initial version, and last activity is persisted at a controlled interval rather than on every request.
_Avoid_: indefinite sessions, extending a session beyond its absolute expiry, treating a closed browser as proven logout, or writing the database on every authenticated request solely to update activity

**Security-Sensitive Session Revocation**:
Changing one's own password revokes every other session while retaining the verified current session. An administrator resetting another user's password, or deactivating that user, revokes all of the affected user's sessions immediately; reactivation requires a fresh login. Every manual or automatic revocation retains actor, time, reason, and scope.
_Avoid_: leaving suspected sessions active after a password reset, allowing a deactivated account to retain access, or revoking sessions without accountable audit evidence

**Personnel Record Retirement**:
The normal removal path for Personnel is the reversible Personnel Archival Transition, which preserves history and supports controlled restoration. ADMIN may instead choose Permanent Personnel Erasure through its separate high-risk workflow.
_Avoid_: presenting irreversible erasure as ordinary offboarding, treating archive as deletion, or bypassing the permanent-erasure safeguards

**Applicant and Personnel Archive**:
The retained, restorable collection of Applicant and Personnel records intentionally removed from ordinary active lists while all personal, operational, document, and audit history remains intact. Applicant and Personnel archives are separate lists; HR_MANAGER and ADMIN may archive or restore with a mandatory reason and accountable audit, while irreversible erasure remains ADMIN-only.
_Avoid_: treating archive as deletion, hiding archived records without a dedicated archive view, including archived identities in ordinary active work queues, or allowing routine processors and supervisors to archive records

**Archived Job Application**:
A closed or withdrawn Job Application hidden from ordinary hiring queues with its current hiring stage, outcome, evidence, documents, and decisions preserved exactly; it permits no hiring workflow action until HR_MANAGER or ADMIN restores it with a reason. Archival is a retention action after an explicit lifecycle outcome, never the action that rejects, withdraws, cancels, or closes an active case; it requires a reason, uses the server-recorded execution time rather than a user-selected effective date, and restoration resumes the same recorded workflow state.
_Avoid_: archiving an active case instead of recording its lifecycle outcome, asking for a second effective date after closure or withdrawal, changing the hiring outcome during archival, treating an archived application as rejected, continuing workflow actions while archived, or restoring into a newly inferred stage

**Permanent Job Application Deletion**:
An ADMIN-only irreversible deletion of one selected Job Application and its application-specific forms, assessments, invitations, contracts, onboarding tasks, uploads, audits, and live-storage files, leaving only a non-personal deletion receipt. It may be initiated from an active or archived Application without a closure or archival prerequisite, subject to the permanent-deletion impact preview, reason, reauthentication, exact-name challenge, and final confirmation. A surviving Employment Relationship is detached from the deleted Application; Candidate, Personnel, User, payroll, attendance, other Applications, and non-Human-Resources history remain intact.
_Avoid_: requiring a lifecycle transition before Super Admin may initiate deletion, bypassing irreversible-action safeguards, treating an Application deletion as erasure of the person, cascading into a converted Personnel or User, deleting other Applications, or leaving Application-specific files behind

**Personnel Archival Transition**:
The atomic transition that ends the person's active, planned, or suspended Employment Relationship and Payroll Participation on a user-selected archive effective date that is today or in the past, cancels incomplete onboarding and Human Resources tasks with the archive reason, deactivates the linked User and revokes active sessions, then places the Personnel record in the Personnel archive while preserving completed operational history. Failure of any required transition leaves the entire record unchanged, and archiving one person never closes a shared company payroll period.
_Avoid_: future-dating archival instead of using a scheduled offboarding workflow, treating archival as list filtering only, partially applying offboarding, silently deleting completed history, leaving login sessions active, or closing payroll work belonging to other personnel

**Permanent Personnel Erasure**:
An ADMIN-only irreversible operation, available from active or archived Personnel without a prior offboarding or archival condition, that removes the selected Personnel, linked Candidate applications and User, every related Human Resources and non-Human-Resources operational record, credentials, sessions, personal data, and live-storage file; immutable backups age out under normal retention rather than being selectively rewritten. It cannot erase the acting ADMIN or the last active ADMIN, is never bulk-operated, and requires an exact impact preview, mandatory reason, current-password verification, exact-name challenge, final confirmation, atomic execution, and a Permanent Person Erasure Receipt.
_Avoid_: requiring prior archival, treating Personnel erasure as ordinary deletion, preserving undisclosed live copies, partial cascading, deleting oneself or the final administrator, executing without preview and reauthentication, or claiming immediate selective removal from disaster-recovery backups

**Permanent Person Erasure Receipt**:
The immutable non-personal evidence retained after an ADMIN irreversibly erases a person, containing the deleting administrator, time, mandatory reason, erased identity identifiers, and record/file counts by category without the erased person's name, contact details, national code, documents, or other personal information.
_Avoid_: retaining erased personal information in the receipt, allowing deletion without accountable evidence, or making the receipt editable or deletable

**Personnel Bulk Operation**:
An administrator or otherwise authorized operator's reviewed action over selected Personnel records. Initial operations are activate, deactivate, change department, and apply work schedule; every submission first previews selected, eligible, skipped, and conflicting records and requires confirmation tied to that exact preview. Any intervening selected-record change invalidates the whole operation. Confirmed eligible changes execute atomically while skipped and conflicting records remain untouched, with a parent audit event, per-record before/after results, completion counts, and downloadable results. Bulk hard-delete is not supported.
_Avoid_: applying an unpreviewed or stale mass mutation, partially committing eligible changes, silently ignoring conflicts, or treating bulk selection as permission to destroy personnel history

**Administrator Password Reset**:
An ADMIN-only User Management action that replaces another user's password with an administrator-entered temporary password, never displays that password after submission, revokes all of the affected user's sessions, and records the accountable security event.
_Avoid_: placing password reset in Personnel Management, generating or logging a retrievable plaintext password, leaving existing sessions active, or granting the action to managers automatically

**Linked Personnel and User Deactivation**:
Personnel and User remain separate identities. Deactivating Personnel offers an explicit, default-selected choice to also deactivate its linked User and previews the resulting loss of access; the operator may deliberately leave the account active. Reactivating Personnel never automatically reactivates the linked User, and bulk deactivation follows the same previewed rule.
_Avoid_: silently coupling every personnel status change to login access, hiding which accounts a bulk action disables, or restoring system access merely because a personnel record was reactivated

**Temporary Password State**:
After an Administrator Password Reset, the affected User must replace the temporary password immediately after the next successful authentication. Until replacement, that session is restricted to the forced password-change screen and logout; completing the change clears the state and is audited without retaining either plaintext password.
_Avoid_: allowing normal ERP access with an administrator-known temporary password, logging either password, or clearing the forced-change requirement before a successful owner-selected replacement

**User Account Erasure**:
An ADMIN-only irreversible removal initiated from User Management that permanently removes credentials, sessions, personal profile data, and access permissions while unlinking and preserving Personnel and business records; Permanent Personnel Erasure is the explicit exception that cascades through the linked User and business history. Historical attribution normally survives through an inert actor snapshot, and User Account Erasure requires administrator reauthentication, impact preview, reason, audit evidence, and protection for the acting and last active administrators.
_Avoid_: accidentally invoking Permanent Personnel Erasure from User Management, retaining usable credentials after erasure, reactivating an erased identity, deleting oneself, or removing the final active administrator

**Authentication Evidence Retention**:
Active sessions remain while authorized; successful, expired, and revoked session history remains for 180 days after session end; Failed Authentication Events remain for 90 days. Account-erasure and administrator-revocation audit events remain permanently. Scheduled cleanup enforces the finite periods, and administrator views separate active sessions, session history, and failed attempts.
_Avoid_: mixing failed attempts into device history, retaining ordinary IP and client metadata indefinitely, or deleting permanent administrator-accountability evidence during routine cleanup

**Recognized Browser Profile**:
A random identifier stored in a secure cookie after successful authentication and used to recognize later sessions from the same browser profile without fingerprinting the physical device. A missing identifier marks the successful login as new; clearing cookies or using another browser or profile creates a new identity. New-browser login produces an in-app security notification, and `This wasn't me` immediately revokes the reported session while recommending—but not requiring—a password change. Recognition never grants additional access.
_Avoid_: treating browser recognition as proof of hardware identity, silently fingerprinting users, trusting a recognized browser with extra permission, or forcing a password change after every user-reported session

**User and Personnel Administration Boundary**:
User administration is presented inside the Human Resources workspace beside Personnel administration, but relocating that surface does not grant access or capabilities to Human Resources authorities. ADMIN and MANAGER may create and edit non-admin Users, assign or change a non-admin User between USER and MANAGER, and may create, edit, activate, deactivate, and run approved bulk operations for Personnel. HR_MANAGER and ADMIN may archive or restore Applicants and Personnel with a mandatory reason; only ADMIN may assign the ADMIN role, permanently delete a Job Application, perform Permanent Personnel Erasure, reset passwords, erase accounts, inspect organization-wide authentication evidence, revoke another user's sessions, correct historical creator attribution, or apply bulk permissions. Managers may never modify, deactivate, erase, or assign the ADMIN role to an account.
_Avoid_: treating navigation location as authorization, granting sensitive identity or authentication control through the Human Resources workspace or manager role, blocking managers from assigning the MANAGER role to an eligible non-admin User, or allowing a manager to affect or create an administrator account

**Centralized User Access Administration**:
The all-workspace access surface presented inside Human Resources that preserves system-wide User role selection, direct workspace grants, fine-grained feature exceptions, role defaults, expiry, and effective-access provenance under the existing ADMIN and MANAGER administration boundary. ADMIN access remains implicit and complete, while selecting MANAGER is explicit and separate from the reviewed workspace and feature grants saved for that User. Role defaults remain ADMIN-managed and appear as inherited effective access; selecting a system role applies only its already-defined defaults, while User-specific grants remain independently reviewable and editable workspace by workspace. Each workspace presents a general access level and an expandable list of its fine-grained permissions; its select-all and deselect-all controls update both layers for that workspace only. These controls do not change the User's system role, no global all-workspace selection control is provided, and every change remains a draft until one explicit save that targets only the selected User without migrating or rewriting any other User's grants.
_Avoid_: limiting the surface to Human Resources permissions, granting access administration through HR workspace permission, inferring MANAGER from a permission count, treating MANAGER as complete access beyond its configured defaults and direct grants, allowing a MANAGER to edit role defaults, changing a role through select-all controls, providing a global all-workspace selection shortcut, applying only one permission layer during workspace selection, or deleting persisted grants before one explicit save

**Effective Authorization Snapshot**:
The backend-owned, time-specific answer for one User's current access, combining active system role, direct and role-derived workspace grants, direct feature limitations, explicit action permissions, task-scoped access, provenance, expiry, and revocation. ADMIN has complete implicit authority, a workspace ADMIN may manage and perform every action inside that workspace, MANAGER has no unrelated-workspace bypass, and a direct lower feature grant deliberately narrows broader inherited access for that feature.
_Avoid_: computing effective permission independently in the frontend, treating MANAGER as a system-wide administrator, ignoring expiry or revocation, accepting a stale browser session as authority, requiring ADMIN to receive duplicate grants, or letting one permission reader disagree with another

**Action Availability**:
The backend-projected current ability to discover and perform one operation after combining Effective Authorization with record state, workflow stage, ownership, assignment, separation policy, and data-integrity rules; it states whether the action is visible, enabled, and—when disabled—the Persian operational reason. ADMIN bypasses authorization, ownership, assignment, and separation barriers through an audited Admin Override, but never bypasses missing records, immutable evidence, required history, or other data-integrity boundaries.
_Avoid_: inferring actions from role names or record status in the frontend, showing a control that targets a retired command, hiding a temporarily unavailable relevant action without explanation, displaying internal denial codes, treating permission as proof that the current state accepts the action, or using Admin Override to corrupt or erase required evidence

**Authorization Provenance**:
The visible explanation of why an Effective Authorization exists or is limited, identifying system-admin override, workspace level, direct feature grant, role default, explicit action permission, task-scoped duty, expiry, or revocation. Permission administration preserves this source and never presents inherited or temporary access as a direct permanent grant.
_Avoid_: an unexplained effective checkbox, flattening inherited and direct grants, hiding a narrowing override, omitting expiry, or claiming a duty assignment grants general workspace access

**Canonical Permission Migration**:
The versioned, auditable conversion of an active legacy grant into the single Effective Authorization model, preceded by a read-only dry-run and preserving every unambiguous valid access while routing ambiguous cases to ADMIN review. The cutover retires legacy permission writers and readers only after parity verification and never silently removes, widens, or guesses access.
_Avoid_: dual permission ownership, write-on-read migration, deleting legacy grants before verified conversion, guessing ambiguous intent, treating a successful legacy save as canonical access, or keeping contradictory readers after cutover

**Permission Prerequisite Closure**:
The recursive set of prerequisite permissions required by the explicitly selected feature permissions in any workspace. Selecting a feature visibly checks every direct and transitive prerequisite and lists each automatically included item in the added-prerequisites summary; a required prerequisite cannot be unchecked while a selected dependent still needs it. Removing a dependent removes an automatically included prerequisite only when no other selection requires it and the administrator did not also select that prerequisite explicitly.
_Avoid_: showing prerequisite badges without checking the actual permissions, permitting a required prerequisite to be removed independently, discarding an explicitly selected prerequisite when its dependent is removed, implementing the rule only for Human Resources, or calculating a different dependency graph in the interface and authorization service

**Failed Login Monitoring Without Throttling**:
Failed logins never permanently lock an account and do not trigger request rate limits or progressive delays. A successful login resets the applicable failure counter. Unauthenticated callers receive only a generic failure response, while ADMIN-visible security evidence retains a safe internal category and repeated failures generate administrator alerts.
_Avoid_: exposing whether an account exists through login errors, automatically locking legitimate users through hostile attempts, claiming alerts prevent brute force, or silently introducing throttling contrary to the accepted policy

**Suspicious Failed Login Alert**:
An administrator alert produced when one account identifier receives 10 failed attempts within 15 minutes or one IP address produces 25 failed attempts within 15 minutes. Matching alerts are deduplicated for one hour while every underlying Failed Authentication Event remains recorded.
_Avoid_: discarding attempts because an alert was deduplicated, treating the alert as automatic prevention, or revealing threshold details to unauthenticated callers

**User Creator Attribution Display**:
User lists identify the creator by display name and username, while User details also expose creator ID, creation source, account creation time, and whether attribution was automatic or manually asserted. Unknown legacy attribution displays as `Unknown — Historical Data`. ADMIN may add a historical creator with a mandatory reason as a separate audited assertion, but automatically captured provenance is immutable. Erased creators display through their snapshot as `Deleted user — [name]`.
_Avoid_: presenting raw IDs as the primary identity, disguising manual attribution as captured evidence, changing automatic provenance, or losing creator display after account erasure

**Authentication Approximate Location**:
Authentication views show the recorded IP address and may derive only an approximate country and city from a locally maintained IP database, clearly labeled as approximate. They never request browser GPS permission or send login IP addresses to a third-party geolocation service. Private addresses display as `Internal network`, and users viewing their own sessions receive the same IP and approximate-location context available to administrators.
_Avoid_: presenting IP geolocation as precise physical location, transmitting authentication metadata to an external lookup service, or hiding session network context from the account owner

**گزارش لحظه‌ای دسته‌محور گارد**:
An immutable timestamped Security shift-log observation whose category is always recorded directly and whose report type is present only when that category uses report types. Category and type names are preserved as they were at recording time. Description is optional, but every report must contain at least one meaningful detail through description, an image, or related personnel when that field is enabled.
_Avoid_: manufacturing a “without type” type, changing old classifications when settings change, or accepting an empty category-only row

**سیاست فیلدهای گزارش لحظه‌ای**:
Manager-controlled category and type policy for new report entry. A category decides whether report types appear and decides related-personnel visibility for category-only reports; when types are used, the selected type decides related-personnel visibility. Description remains visible and optional and images remain visible and optional in every category.
_Avoid_: showing irrelevant selectors, hiding the description or image controls, or applying new visibility policy retroactively to history

**بازه حضور فیزیکی پرسنل**:
One factual entry-to-exit interval inside a personnel attendance day. A day may have multiple ordered intervals, only one interval may be open for a person at a time, and an interval crossing midnight belongs to the date on which entry occurred. Gaps between intervals represent time outside the premises without assuming a fixed rest schedule.
_Avoid_: limiting a person to one entry and exit per day, hard-coding a lunch break, splitting an overnight interval, or allowing overlapping open intervals

**خلاصه روزانه حضور چندبازه‌ای**:
The personnel-day view derived from all physical intervals: first entry, final exit, total completed physical presence, total time outside between intervals, and whether the latest interval remains open. First entry determines lateness and final exit determines scheduled overtime, while detailed UI and outputs retain every movement.
_Avoid_: reporting only one arbitrary interval, counting a gap as presence, finalizing totals while an interval is open, or letting PDF and Excel disagree with the daily view

**استثنای حضور و غیاب گارد**:
A Security-created operational authority that excuses expected attendance for a full day or a precise hourly window. In the current phase any authorized Security user may create and manage it. New items are pending; only approved items affect attendance. Pending items may be edited or deleted, while decided or attendance-linked history is cancelled or corrected through reasoned audit actions rather than overwritten.
_Avoid_: calling it a personnel request, fabricating physical movements on approval, hard-deleting decided history, or letting pending/rejected/cancelled items change attendance

**ماموریت پرسنل در گارد**:
A Security-created precise time window of authorized work away from the premises. Only an approved mission contributes accounted work; it never pretends that the person was physically present, and actual entry/exit intervals remain visible alongside it. In the current phase any authorized Security user may create and manage missions.
_Avoid_: converting mission time into fake attendance movements, hiding real presence, double-counting overlapping mission and presence, or treating an unapproved mission as worked time

**تعارض زمانی استثنا و ماموریت**:
Pending authorities may overlap with a visible warning, but approval rejects overlapping leaves, overlapping missions, or a leave/mission conflict for the same person. Adjacent missions are valid. Physical presence may overlap any authority because it records fact, and accounted work uses the union of presence and mission windows so time is counted once.
_Avoid_: blocking factual entry/exit, approving contradictory authorities, counting overlapping work twice, or treating leave as worked time

**Complete Recovery Backup**:
An administrator-created portable recovery package containing Sabalan ERP's main business database, business-owned stored files, inquiry-service data, and integrity and compatibility metadata, while excluding deployment secrets and disposable generated data.
_Avoid_: database-only export, server image, secret bundle, ordinary report export

**Staged Recovery Restore**:
An administrator-directed recovery in which a Complete Recovery Backup is uploaded and validated before a separately confirmed replacement of system data, with the current state preserved as a safety recovery point.
_Avoid_: immediate restore on upload, unvalidated replacement, ordinary data import

**Backup Passphrase**:
Administrator-held secret material required to encrypt and open a Complete Recovery Backup; Sabalan ERP never retains or logs it, so losing both the backup and passphrase makes that recovery point unusable.
_Avoid_: account password, stored recovery key, deployment secret

**Sanitized Test Backup**:
An encrypted, production-shaped package restricted to explicitly enabled non-production environments that preserves realistic business relationships and workflow state while consistently replacing personal identifiers and excluding credentials, sessions, authentication evidence, and original sensitive files. Its package and recovered environment remain unmistakably marked as sanitized test data.
_Avoid_: Complete Recovery Backup, raw production clone, seed data

**Consistent Recovery Snapshot**:
The single recoverable state captured across business records and their stored files while Sabalan ERP temporarily permits reads but rejects writes; packaging may continue after normal writes resume.
_Avoid_: live best-effort copy, database-only point in time, prolonged packaging outage

**Recovery Step-Up Verification**:
A one-action confirmation of the acting administrator's current account password required before creating, downloading, or restoring a recovery package, separate from the Backup Passphrase that protects package contents.
_Avoid_: active session alone, reusable verification window, Backup Passphrase as account proof

**Recovery Package Retention**:
The temporary availability of an encrypted recovery package on the application server for at most 24 hours, while its non-sensitive creation, handling, integrity, and outcome evidence remains part of permanent history.
_Avoid_: server-hosted backup archive, indefinite uploaded package, deleting audit history with the package

**Forward-Only Recovery Compatibility**:
A recovery package may return to its originating Sabalan ERP release or advance through a validated, available migration path to a newer release, but may never restore into an older or otherwise incompatible application, backup-format, or database-engine version.
_Avoid_: schema downgrade, best-effort incompatible restore, migration after unvalidated replacement

**Atomic Recovery Promotion**:
The fail-closed replacement of active business records and stored files only after a staged recovery has proven their joint integrity and readiness; any interruption retains or returns to the pre-restore state before writes reopen.
_Avoid_: in-place overwrite, partially promoted restore, reopening an unproven state

**Post-Recovery Global Sign-In**:
The mandatory fresh authentication of every user after a successful recovery, with all active sessions from the recovered state revoked while retained authentication history and the accountable recovery event remain visible.
_Avoid_: reviving backed-up sessions, preserving the restoring administrator's session, deleting historical authentication evidence

**Production Recovery Approval**:
Authorization to promote a validated Complete Recovery Backup in production, normally granted by a second active ADMIN for that exact package and impact preview; a sole active ADMIN may instead use a reasoned, strongly confirmed break-glass path.
_Avoid_: creator self-approval when another admin is available, reusable approval, approval detached from package integrity

**Recovery Backup Freshness**:
The age of the most recent Complete Recovery Backup confirmed as downloaded beyond the application server; after seven days without one, administrators are warned that server-only or absent packages do not provide disaster protection.
_Avoid_: creation time alone, treating temporary server retention as offsite protection, silently stale recovery coverage

**Support Ticket**:
An append-only, access-controlled record through which a Sabalan ERP user reports a problem or improvement from an immutable originating route, with reporter-provided impact, optional media, a sanitized diagnostic snapshot, assignments, responses, resolution, operational targets, and permanent accountability history. A failed contract submission may attach only safe diagnostic metadata such as HTTP status, stable error code and path, affected product-row identity, and tracking code; it does not duplicate the raw contract payload, customer data, or complete pricing data.
_Avoid_: treating support as editable notes, exposing one reporter's ticket through a duplicate link, or granting access merely because a user received an assignment without the required workspace or feature permission

**Support Work Queue**:
The role-aware, newest-first projection of Support Tickets already authorized for the viewer: requests they reported, tickets where they actively handle or collaborate, and—only for authorized managers or administrators—other tickets within their managed scope. Watch-only participation remains visible but is not presented as an actionable queue; search and filters narrow a selected projection without broadening its permission scope.
_Avoid_: mixing personal requests and operational work into one unlabeled list, treating watchers as handlers, or changing access through a client-side filter

**Sensitive Support Evidence**:
Optional raw form values, page text, uploaded-document metadata, customer, Human Resources, financial, image, document, or voice evidence that a reporter explicitly consents to share. It remains protected by originating workspace or feature access, is excluded from Codex diagnostic packages by default, and follows a shorter evidence-retention policy.
_Avoid_: capturing secrets, credentials, cookies, tokens, or passwords; showing sensitive evidence back to the reporter as diagnostic data; or allowing assignment alone to bypass workspace access

**Restricted Security or Privacy Incident**:
A Support Ticket type routed initially only to ADMIN and designated incident handlers, with privacy-safe notifications, protected reporter identity during approved collaboration, ADMIN-approved delegation, minimum-necessary evidence, no automatic closure, and permanent access and delegation accountability.
_Avoid_: placing an incident in ordinary manager queues, lock-screen details, automatic delegation, or the ordinary waiting-for-reporter closure workflow

**Unified Notification Center**:
The durable Persian-first application inbox that is the source of truth for direct assignments, mentions, approvals, security events, support responses, and registered business workflow notifications. Its bell sheet is a compact recent/unread preview, while `/dashboard/personal/notifications` provides the complete history and secondary preferences; realtime socket delivery and opt-in privacy-safe Web Push are delivery channels, not replacement stores.
_Avoid_: treating the bell sheet as the complete inbox, creating separate feature inboxes, placing ticket details on a lock screen, or relying on online socket delivery as durable notification storage

**Notification Inbox State**:
The recipient's durable, newest-first view of notification history, organized through All, Unread, Important, search, and relevant workspace or category filters. Important means only existing HIGH and URGENT priorities; users may change read state but cannot delete or archive notification records.
_Avoid_: introducing a separate archive lifecycle, allowing user deletion of accountability history, or treating filtered-out notifications as removed

**Notification Delivery Preferences**:
The signed-in user's staged choices for optional category muting and low-priority delivery timing, committed together through one explicit save action. Browser-device activation and deactivation remain immediate subscription operations; deactivating every device requires an explicit confirmation dialog, and mandatory in-app accountability events cannot be disabled.
_Avoid_: partially saving a preference form, presenting device subscriptions as unsaved form state, using browser-native confirmation prompts, or allowing preferences to suppress mandatory records

**Self-Service Personal Area**:
The signed-in user's own profile, account security, active sessions, password actions, personal leave requests, notification inbox, and notification preferences. `/dashboard/personal` is a compact read-only identity and destination hub; leave, security, and notifications each have their own focused route, while `/change-password` retains its established behavior. Administrative user creation, access management, and other-user profiles remain outside this area.
_Avoid_: treating administrative user management as profile self-service, or mixing other users' identity administration into personal account tasks

**Last Successful View**:
The most recent complete, authorized dataset successfully loaded for a dashboard surface. Background or manual refresh failure preserves this usable view, its filters, pagination, scroll position, expanded sections, and unsaved form input while showing a small inline error; a full-page error is reserved for the absence of any usable data.
_Avoid_: blanking a previously usable page after refresh failure, resetting user context when realtime data arrives, or replacing a focused form with a global loading state

**Notification Policy Registry**:
The code-owned catalog of registered domain events and their immutable trigger conditions, permission checks, safe recipient resolvers, protected fields, deep links, and deduplication identity. ADMIN may version validated choices among registered safe recipients, approved Persian template variables, priority, channel, and timing, while mandatory accountability policies remain enabled. The administrative interface exposes current-version metadata and a before/after review when publishing the next version; prior versions remain durable for accountability but a full history browser is outside the current notification redesign.
_Avoid_: arbitrary database-trigger policies, administrator-authored permission logic, unversioned policy mutation, or changing notifications already produced by an earlier version

**Support Operational Target**:
A versioned acknowledgment and resolution goal measured using the explicit Asia/Tehran support calendar and fixed to a ticket at triage. Waiting for genuine reporter information pauses only the resolution clock; approaching and missed targets notify and escalate without automatically closing or reassigning the ticket.
_Avoid_: assuming 24/7 elapsed time, treating targets as promises, rewriting existing tickets when policy changes, or hiding the full elapsed timeline

**HR-Hosted Vehicle Operations**:
The first-version arrangement in which operational driver profiles, company vehicles, plates, and assignments are surfaced inside the HR workspace while remaining a separately permissioned Vehicle Operations feature group. Hosting these functions in HR does not merge personnel identity or eligibility with operational vehicle ownership.
_Avoid_: creating a separate Vehicle Operations workspace for the first version, granting vehicle authority to every HR editor, or treating a vehicle assignment as an HR identity fact

**Role-Specific Dispatch Surface**:
The owning workspace's view of one shared dispatch case and handoff timeline, presenting cross-workspace state as readable context while exposing only the decisions and actions that workspace owns. Human Resources, HR-hosted Vehicle Operations, Guard, Logistics, and Accounting each retain their native work queues and detail surfaces.
_Avoid_: a cross-workspace dispatch super-screen, duplicating the case into separate workspace records, or exposing another workspace's commands merely because its state is visible

**Internal Dispatch Pilot Cohort**:
The named rollout group of three to five trained Internal Driver Identities and two to three Company Vehicle Identities used to validate the new dispatch flow before broader use, covering every operating shift and including at least one driver with a known difficult-fingerprint case. Only trained Human Resources, HR-hosted Vehicle Operations, Guard, Logistics, Accounting, and support personnel may operate cohort dispatches; External Driver Identities remain excluded until the cohort passes its acceptance gates.
_Avoid_: opening the pilot to any eligible internal driver, including external drivers before the internal flow is accepted, omitting a shift or known difficult-fingerprint scenario, or allowing untrained operators to handle pilot dispatches

**Internal Dispatch Pilot Acceptance Window**:
The minimum live-evidence period before the Internal Dispatch Pilot Cohort may be accepted: at least twenty operating days and at least fifty successfully completed Guard Physical Exit Records, whichever finishes later, covering every operating shift with at least five completed dispatches per cohort driver and ten per cohort vehicle. Evidence gathered before a Pilot Safety Pause remains part of the record, but acceptance additionally requires ten consecutive operating days and twenty-five exits after the final corrective release.
_Avoid_: accepting on elapsed calendar time alone, accepting on volume without shift and cohort coverage, discarding earlier evidence after a pause, or expanding without a substantial clean run after the last critical correction

**Staged Dispatch Expansion**:
The controlled progression beyond the accepted Internal Dispatch Pilot Cohort. Internal capacity grows by at most five drivers and three company vehicles followed by five clean operating days per addition; after all intended internal drivers are active, internal operation proves another twenty clean operating days and one hundred exits. External confirmation then begins with three to five known recurring external drivers and two to three external vehicles, passes the same twenty-day and fifty-exit acceptance, monitoring, support, training, reconciliation, and non-waivable integrity gates except biometric-specific measures, and expands at the same cohort pace. Pilot Safety Pause freezes progression, no stage may be skipped, and general availability additionally requires notification and report verification plus cross-workspace written approval. Regulated external transport waybill issuance remains outside this progression.
_Avoid_: expanding all users at once, adding another cohort before five clean days, treating internal success as proof of the external confirmation path, applying biometric metrics to OTP confirmation, skipping cross-workspace approval, or silently adding regulated transport-waybill scope

**Internal Driver Identity**:
The Vehicle Operations driving profile of one HR Personnel identity that is eligible to drive for Sabalan; personnel identity remains owned by Human Resources and is not copied into a separate driver person record.
_Avoid_: duplicating Personnel as a driver, treating eligibility as a vehicle assignment, or allowing Vehicle Operations to redefine HR identity

**Internal Driver Eligibility**:
The non-overlapping, effective-dated HR authority for an active Personnel identity to drive for Sabalan; suspension or withdrawal closes the current period with a reason, and reinstatement creates a new period.
_Avoid_: a mutable eligibility flag, overwriting earlier eligibility, granting eligibility through Vehicle Operations, or deleting used periods

**Internal Driver Profile**:
The single stable Vehicle Operations record for an Internal Driver Identity, holding licence and operational driving details without duplicating Personnel identity. Current readiness is derived from active Personnel, current Internal Driver Eligibility, profile completeness, and licence validity; a used profile remains historical rather than being deleted.
_Avoid_: a second personnel record, a manually asserted ready status, storing HR eligibility on the profile, or deleting a profile referenced by operations

**External Driver Identity**:
The reusable Guard-managed identity of a non-personnel driver, independent of any vehicle used on a particular visit.
_Avoid_: embedding the external driver inside a permanent driver-vehicle pair, creating a new identity for every arrival, or treating an external driver as HR Personnel

**Driver Source Continuity**:
The explicit link between an External Driver Identity and a later Personnel-linked Internal Driver Profile for the same real person, without converting either identity or relabelling historical evidence. Active Personnel cannot enter the Guard queue through the linked external source; after employment ends, Guard may reactivate that external identity with a recorded reason.
_Avoid_: merging source records, rewriting external history as internal, creating unlinked duplicates, or bypassing HR eligibility through an external identity

**Company Vehicle Identity**:
The canonical Vehicle Operations record for one Sabalan-managed vehicle, independent of its current or historical driver.
_Avoid_: identifying a company vehicle through its current driver, copying the vehicle for each assignment, or letting a queue turn redefine the vehicle

**Company Vehicle Lifecycle**:
A company vehicle progresses from `DRAFT` to `ACTIVE`, may temporarily become `OUT_OF_SERVICE` without ending its driver assignment, and may be removed from active project use as restorable `ARCHIVED`; only an unused, dependency-free `DRAFT` may be permanently deleted. Active use requires a current plate and driver assignment, unavailable or archived vehicles cannot advance through the queue, and any operationally used vehicle remains historical.
_Avoid_: queueing incomplete or unavailable vehicles, ending an assignment solely for temporary repair, hard-deleting operational history, or showing archived vehicles in ordinary active lists

**External Vehicle Identity**:
The reusable Guard-managed identity of a non-company vehicle, independent of the external driver using it on a particular visit.
_Avoid_: embedding the external vehicle inside a permanent driver-vehicle pair, creating a duplicate for each driver, or treating it as a company vehicle

**External Driver and Vehicle Lifecycle**:
A Guard-managed external driver or vehicle progresses from incomplete `DRAFT` to `ACTIVE`, may be temporarily `RESTRICTED` with accountable effective-dated evidence, and may be removed from ordinary use as restorable `ARCHIVED`; only an unused, dependency-free `DRAFT` may be permanently deleted. Queue readiness additionally requires complete, current identity and documents, so expiry makes readiness false without silently changing lifecycle state.
_Avoid_: using one active flag for different meanings, hiding restrictions, mutating lifecycle on document expiry, queueing an unready record, or deleting operationally used identities

**Vehicle Plate Registration**:
The effective-dated normalized plate assigned to a stable Company Vehicle Identity or External Vehicle Identity; plate periods never overlap across the two registries. Correction or replacement closes the prior period with a reason, later reuse begins only after the earlier period ends, and operational snapshots retain the plate that applied at their recorded time.
_Avoid_: using the plate as vehicle identity, overlapping plate ownership, rewriting historical plates, or changing old queue and dispatch evidence after a plate update

**Driver-Vehicle Association**:
The explicit relationship that joins independent driver and vehicle identities for a defined operational period or visit; internal assignments preserve effective-dated history, while Guard admission records the external combination actually presented.
_Avoid_: a mutable combined driver-vehicle identity, overwriting assignment history, or inferring a historical pairing from current records

**Internal Driver-Vehicle Assignment**:
The effective-dated Vehicle Operations association between one Internal Driver Profile and one Company Vehicle Identity. At any instant each driver and each vehicle has at most one active assignment; periods cannot overlap on either side, reassignment closes the prior assignment with a reason, and future non-overlapping periods may be scheduled.
_Avoid_: concurrent active assignments for either identity, mutating an assignment into a different pairing, overwriting substitution history, or rejecting valid future scheduling

**Guard Driver Queue Turn**:
One immutable, time-ordered admission of the driver and vehicle physically presented to Guard for loading, retaining their source identities, the applicable internal assignment when relevant, and an admission snapshot. Later identity or assignment edits never rewrite the turn; eligibility is revalidated before loading-area entry and Logistics reservation, and an invalid turn is removed with accountable evidence rather than mutated.
_Avoid_: a live projection of the current assignment, overwriting the admitted combination, carrying an invalidated turn forward, or reusing one turn for repeat visits

**Dispatch Case Identity**:
The cross-workspace correlation identity anchored to one Guard Driver Queue Turn and carried through its Logistics allocation lineage, Accounting candidates and waybills, confirmations, authorizations, and physical exit. Successor revisions and replacement waybills remain visible within that same case, while a repeat physical visit always begins a new case through a new queue turn.
_Avoid_: creating a second cross-workspace source-of-truth record, using a replaceable waybill number as the journey identity, merging repeat visits, or losing superseded evidence from the case timeline

**Supported Driver-Vehicle Admission Classes**:
Guard admits either an Internal Driver Identity with the Company Vehicle Identity from its current active assignment, or an External Driver Identity with an External Vehicle Identity combined for that visit. Mixed-source pairings require a separately designed temporary-authorization model and are outside the current dispatch flow.
_Avoid_: internal drivers with external vehicles, external drivers with company vehicles, bypassing an active internal assignment, or inventing an implicit mixed-source exception

**Dispatch Evidence Snapshot Chain**:
The immutable evidence chain in which Guard admission freezes the presented identities and readiness, Logistics finalization freezes each allocation from that admission, Accounting issues each Dispatch Waybill only from the finalized Logistics snapshot, and Guard exit records the confirmed authorization and physical exit. Every boundary retains its upstream identity and integrity hash plus enough embedded display fields to render history without mutable master data; later profile, plate, contact, document, or assignment changes never backfill it.
_Avoid_: rebuilding history from current master records, silently updating old snapshots, issuing from an editable draft, or relying on an upstream record alone to render historical evidence

**Allocation-Scoped Accounting Rejection**:
Accounting rejects only the affected finalized driver-vehicle allocation; accepted sibling allocations remain immutable and may continue toward confirmation and exit, while Logistics creates a successor allocation revision for the rejected allocation. An error in shared loading identity rejects every affected allocation that has not exited, while exited allocations remain immutable and are corrected through separate audited records.
_Avoid_: reopening accepted sibling allocations for a local error, mutating a rejected allocation in place, reissuing from the rejected revision, or rewriting an allocation after physical exit

**Logistics Allocation Revision**:
The mutable `DRAFT` and then immutable `FINALIZED` snapshot of what one Guard-admitted driver-vehicle allocation carries; rejection, withdrawal, cancellation or unloading, and succession are linked disposition records rather than edits. A successor may change lines, quantities, calculations, and operational notes but retains the same driver, vehicle, and queue turn; changing that physical combination requires accountable cancellation or unloading and a new allocation from another eligible turn.
_Avoid_: editing a finalized revision, changing its admitted identity, erasing rejected revisions, or representing driver substitution as an ordinary quantity correction

**Accounting Dispatch Candidate**:
The immutable Accounting review input created atomically from one finalized Logistics driver-vehicle allocation and projected as exactly one Cross-Workspace Duty without a parallel Accounting work-item lifecycle or an Accounting Dispatch Waybill number. Its states are `PENDING`, `ACCEPTED`, `REJECTED`, `RETURNED`, `WITHDRAWN`, `STALE_REQUIRES_SUCCESSOR`, or `EVIDENCE_CONFLICT`; acceptance atomically issues the numbered waybill, while every other disposition preserves the finalized source snapshot and its structured reason.
_Avoid_: calling the candidate a waybill, numbering it before Accounting accepts it, retaining a second work-item truth, combining multiple driver-vehicle allocations into one duty, editing its Logistics snapshot, or bypassing Accounting review

**Accounting Dispatch Return**:
The structured Accounting result for a correctable allocation defect, atomically releasing its reservation and creating a Logistics successor duty that preserves the same driver, vehicle, and Guard queue turn while identifying the required correction. The original finalized allocation and returned candidate remain immutable evidence.
_Avoid_: treating return as terminal rejection, requiring Logistics to rediscover the needed action, changing the admitted driver-vehicle identity, retaining the old reservation, or editing the finalized revision

**Accounting Dispatch Rejection**:
The terminal Accounting refusal of a candidate with a required reason, releasing its reservation without automatically creating a Logistics successor duty. Logistics explicitly chooses cancellation, unloading, or a fresh allocation path, while the rejected candidate and finalized source remain immutable.
_Avoid_: silently creating a successor after rejection, treating rejection as a correctable return, retaining the old reservation, deleting the candidate, or making Logistics' next disposition implicit

**Logistics Dispatch Candidate Withdrawal**:
The pre-issuance command by which Logistics ends its own Accounting Dispatch Candidate with a mandatory reason, atomically closes the Accounting work item, and then creates a successor revision or records cancellation or unloading. Once a waybill is issued, Logistics may only request Accounting to void it.
_Avoid_: withdrawing an issued waybill, leaving a withdrawn work item open, editing the withdrawn candidate, or treating withdrawal as Accounting rejection

**Accounting Dispatch Waybill**:
The permanently numbered, immutable Accounting record issued from one accepted Accounting Dispatch Candidate for one driver-vehicle allocation, with lifecycle `ISSUED` to terminal `VOIDED` or `EXIT_RECORDED`. Confirmation is separate evidence rather than a waybill state; voiding requires a reason and any replacement receives a new linked number that is never reused or erased.
One waybill exits only as the full effective allocation through one atomic Guard Physical Exit Record. A multi-driver loading becomes partially dispatched only as its separate allocations exit independently. A pre-exit quantity change requires an unloading or cancellation disposition and a successor allocation and waybill; a post-exit change uses Returned Dispatch Reconciliation or another Dispatch Correction.
_Avoid_: editing an issued waybill, issuing one for multiple driver-vehicle allocations, partially exiting one waybill, reusing a voided number, or deleting superseded evidence

**Driver Waybill Confirmation**:
The transaction-bound evidence that the snapshotted driver confirmed one exact numbered Accounting Dispatch Waybill, binding driver identity, waybill identity and snapshot hash, verification method, server time, and device or session evidence. It never transfers to a replacement waybill, successor allocation revision, or another dispatch, even when the driver and vehicle are unchanged.
_Avoid_: treating a reusable fingerprint template as transaction confirmation, copying confirmation to a replacement, or accepting evidence that is not bound to the waybill snapshot

**Waybill Confirmation Attempt Evidence**:
The protected record of each successful or failed fingerprint, OTP, or approved fallback attempt against one exact Accounting Dispatch Waybill, including method, server time, result code, and available device, session, and actor context. Failure leaves the waybill `ISSUED` without an exit authorization; throttling or fallback eligibility is derived separately and never silently voids or rejects the waybill.
_Avoid_: overwriting earlier attempts, treating failure as a waybill state, creating authorization from an unsuccessful attempt, or exposing protected verification evidence broadly

**Dispatch Protected Evidence**:
The restricted enrollment, confirmation, fallback, outage, device, actor, and audit detail whose workspace-owned portion is visible to that workspace's administrators and whose complete chain is visible only to global managers, global administrators, or explicitly authorized evidence reviewers. Export is a separately authorized, reason-bound, encrypted and audited act; biometric templates, raw images, OTP secrets, cryptographic keys, and connector secrets are never viewable or exportable.
_Avoid_: equating ordinary dispatch visibility with evidence access, giving a workspace administrator cross-workspace evidence, exporting without purpose and attribution, or exposing reusable authentication material

**Dispatch Audit Chain**:
The append-only, hash-linked record of every dispatch authority change, domain transition, verification or exception outcome, protected-evidence access, privacy action, and denied control, carrying the effective actor authority, workspace, subject, before/after state or hashes, server time, reason, session/device context, and correlation identity. Alerts route exceptional events to the owning workspace administrators and the designated global, security, technical, evidence, or privacy recipients without changing the underlying audit fact.
_Avoid_: logging only successful commands, overwriting audit rows, omitting effective authority or denial evidence, or treating an alert as the authoritative record

**Dispatch Evidence Retention**:
The fail-closed lifecycle that never persists raw fingerprint images, keeps a reusable template only while eligibility and consent are active, disables matching immediately when either ends, and separates template, consent, transaction-evidence, security-log, export, backup, deletion-certificate, and legal-hold schedules. Production biometric enrollment remains unavailable until counsel-approved schedules are configured; a legal hold pauses destruction without restoring matching or expanding access.
_Avoid_: inventing one universal retention period, using held data operationally, deleting only the primary database copy, or enabling production enrollment before required schedules exist

**Biometric Legal Readiness Gate**:
The prerequisite that qualified Iranian counsel answer the dispatch biometric and electronic-evidence checklist and approve purpose-specific employee consent and withdrawal, official privacy and driver-facing wording, electronic-evidence characterization, separate retention schedules, incident and disclosure handling, vendor and cross-system handling, and legal-hold and deletion rules before any real-driver enrollment or live biometric pilot. Every required answer must be configured and tested fail-closed; missing consent, retention, or policy configuration disables enrollment and cannot be waived by managerial authority. Synthetic-identity simulation and non-production technical proof-of-concept work may proceed before the gate passes.
_Avoid_: treating a small pilot as exempt, asking a manager to waive missing legal configuration, enrolling real drivers under draft wording, using one guessed retention period, or blocking synthetic technical validation unnecessarily

**Internal Driver Biometric Enrollment**:
The HR-owned, consent-bound act of creating or replacing the encrypted reusable fingerprint template for an actively eligible Internal Driver Identity; failed or cancelled enrollment leaves the prior valid template unchanged and creates no dispatch fallback authority. Ending eligibility, consent, or permitted retention disables matching without erasing accountable historical evidence.
_Avoid_: enrolling an ineligible person, treating an enrollment attempt as waybill confirmation, using driver OTP to bypass enrollment, replacing a valid template after a failed scan, or deleting transaction history when matching is disabled

**Internal Driver Biometric Fallback**:
The controlled alternate confirmation path made eligible by a reported scanner or connector failure or by three failed live fingerprint attempts in the current waybill-confirmation session. Accounting initiates it without a waiting period, but success requires driver OTP, approval by a different Guard supervisor, a mandatory reason, device or error context, and a manager alert.
_Avoid_: offering fallback before qualifying evidence, letting one user approve both sides, treating OTP alone as sufficient, or hiding fallback use as an ordinary fingerprint success

**Simulated Biometric Device Gate**:
The pre-hardware acceptance gate in which the device-neutral connector simulator proves the complete internal-driver dispatch journey and deterministic success, poor-quality, non-match, wrong-driver, three-failure fallback-eligibility, unavailable-device, disconnect, timeout, recovery, retry-idempotency, void, revocation, and exit-concurrency scenarios. The gate requires all automated tests and one hundred consecutive simulated end-to-end cycles to pass with no critical or high-severity defect, unexplained evidence difference, reconciliation difference, raw fingerprint persistence, or secret exposure, while producing the required transaction-bound evidence, audit events, alerts, and authorization outcomes.
_Avoid_: connecting production-intended hardware before simulator acceptance, testing only the happy path, treating retries as new confirmations or exits, tolerating missing evidence, or allowing simulated biometric material to bypass production privacy boundaries

**Physical Biometric Device Gate**:
The pre-pilot acceptance gate in which the exact purchased BioMini Slim 2, production SDK, Accounting workstation build, and signed connector pass every mandatory proof-of-concept check and their predeclared performance thresholds. Every pilot driver enrolls at least two fingers; at least one hundred representative genuine attempts achieve at least 95 percent first-attempt success overall, no driver below 90 percent, and at least 99 percent success within three attempts; at least one hundred wrong-driver attempts and the approved safe-spoof protocol produce no false acceptance; and p95 verification completes within three seconds after finger placement. A 500-cycle soak and one full operational day must complete without resource leaks, frozen UI, connector restart, or lost evidence, while restart, USB suspend and reconnect, blocked vendor endpoints, licensing failure, replay, revocation, and cross-waybill controls behave safely. Written production SDK, redistribution, server-matching, offline-activation, warranty, spare-unit, and replacement terms are part of the gate. Thresholds may be revised deliberately before evaluation, never after observing a failure; a difficult-fingerprint failure may trigger a RealScan-G1 trial but cannot be hidden through routine fallback.
_Avoid_: accepting a vendor demonstration, changing thresholds after results are known, averaging away one unusable driver, treating fallback as device success, bulk purchasing before acceptance, or using hardware without confirmed production and support rights

**Dispatch Dual Control**:
The transaction-level rule that two distinct authenticated users must complete the two approval sides of a biometric fallback or Manual Outage Exit. Global `ADMIN` and `MANAGER` users may act in either capacity across all five dispatch workspaces, while a workspace administrator may act only for that workspace; broad privileged access never turns a two-person exception into self-approval.
_Avoid_: equating access with self-approval, bypassing actor separation for privileged users, or granting a workspace administrator authority outside that workspace

**Dispatch Workspace Authority**:
The three-level authority model in which workspace `view` exposes ordinary redacted dispatch status, `edit` permits routine commands owned by that workspace, and `admin` additionally permits its supervisory, exception, reversal, and protected-evidence review commands. Narrow feature grants may authorize individual commands but cannot override Dispatch Dual Control or expose biometric templates, OTP secrets, or cryptographic keys.
_Avoid_: treating workspace access as unrestricted evidence access, requiring workspace administration for every routine command, or using a feature grant to bypass transaction invariants

**External Driver Waybill Confirmation**:
The confirmation of one exact Accounting Dispatch Waybill through driver OTP plus a fresh Guard identity approval bound to the same confirmation session. Guard may approve remotely from its workspace, but admission-time identity evidence alone is insufficient and no authorization exists until both factors succeed in the live session.
_Avoid_: reusing Guard admission as confirmation, accepting OTP alone, requiring Guard's physical presence in Accounting, or combining evidence from different sessions

**Dispatch Exit Authorization**:
The single-use authority created by a successful driver confirmation for one Accounting Dispatch Waybill, valid for 12 hours by default, with lifecycle `ACTIVE` to terminal `CONSUMED`, `EXPIRED`, or `REVOKED`; every reconfirmation creates a new authorization. Accounting or Guard may revoke it for a recorded operational or identity concern without changing a correct waybill, while incorrect waybill facts require voiding and replacement.
_Avoid_: treating confirmation as permanent exit permission, extending an authorization in place, allowing exit after expiry or revocation, voiding a correct waybill for a temporary concern, or reissuing solely because authorization expired

**Guard Physical Exit Record**:
The immutable fact created when Guard atomically verifies and consumes an active Dispatch Exit Authorization and closes the corresponding queue turn as `EXIT_RECORDED`; retries of the same exit command are idempotent. Exit requires no checkout or long-lived user lock but competes transactionally with authorization revocation and waybill voiding: the first valid command committed wins, and an already-recorded exit permits only a separate audited correction.
_Avoid_: recording exit from a stale pre-check, consuming one authorization twice, blocking routine work with an editing lock, duplicating exit on retry, voiding an exited waybill, or rewriting the physical-exit fact

**Manual Outage Exit**:
The explicit two-person exception that permits physical exit during a verified ERP-wide outage using a pre-numbered emergency record containing the waybill, driver, vehicle, load, outage window, reason, driver acknowledgment, and distinct Accounting and Guard-supervisor approvals. Registration creates parallel permission-scoped duties whose order does not matter, but one User—including a global administrator or User with both grants—may complete only one side; Guard registers the actual exit and evidence after recovery only after both approvals, without fabricating normal fingerprint, OTP, or digital-authorization success.
_Avoid_: using the manual path for an ordinary device failure, allowing one-person approval, serializing independent approvals unnecessarily, inventing a normal confirmation retrospectively, losing the actual exit time, or leaving the exception unregistered after recovery

**Dispatch Correction**:
An append-only Accounting delta record linked to an exited Accounting Dispatch Waybill that adjusts downstream quantity or accounting projections without changing the original allocation, waybill, confirmation, authorization, or Guard exit. Its lifecycle is `DRAFT` to immutable `POSTED`: drafts affect no projection, while posting atomically makes the delta effective. Each correction states the change from the previously effective quantity; projections equal the original exited quantity plus every posted correction delta in recorded order. A mistaken posted correction is countered by a new opposite posted delta rather than edited, voided, or silently replaced. A physical return is a separate linked Guard inbound movement rather than a reversal of exit, and a return-related negative correction must reference verified Guard inbound evidence. Who may post and whether maker-checker approval is required are separate authorization decisions that do not change projection semantics.
_Avoid_: applying a draft correction, editing or voiding posted evidence, deleting an exit, representing a return as a negative exit, accepting a return correction without inbound evidence, silently replacing an earlier correction, or calculating corrected projections from only the latest row

**Returned Dispatch Reconciliation**:
The two-boundary reconciliation of goods physically returned after exit: Guard's linked inbound movement proves the physical return but does not decide contract attribution or accepted quantity; Accounting reviews that evidence and posts the linked negative Dispatch Correction. Until the correction becomes effective, shipment views preserve the dispatched quantity and show a reconciliation exception. Once effective, Physically Dispatched Quantity decreases and Available-to-Load Quantity increases by the same amount unless a financially approved contract amendment cancels the replacement obligation.
_Avoid_: letting Guard change Accounting shipment truth, reducing dispatch from an unreviewed inbound movement, hiding the pending mismatch, or reopening a cancelled commercial obligation

**Contract Shipment Quantity Reconciliation**:
The per-contract-product-row quantity truth in which the effective Contracted Quantity is reconciled into three mutually exclusive buckets: active finalized allocations not yet physically exited are Finalized/Reserved Quantity, effective Guard-recorded exits are Physically Dispatched Quantity, and the signed remainder is Available-to-Load Quantity, calculated as `Contracted - Finalized/Reserved - Physically Dispatched`. The authoritative grain is one Contract Item identified by its stable productRowId and effective version; contract and customer views roll up these row reconciliations without merging identical-looking rows or summing different units. Presentation may visually group compatible products only while preserving drill-down attribution to every source contract and row. A quantity moves from finalized/reserved to physically dispatched when Guard records exit; rejected, withdrawn, cancelled, unloaded, and superseded allocations contribute to neither bucket. The contracted baseline is the latest financially approved row quantity effective at the projection time; draft or rejected changes do not affect it, and an historical view uses the version then effective. A controlled contract-row reduction becomes effective only when its new quantity is at least the sum of Finalized/Reserved and Physically Dispatched quantities; active reservations must first be disposed, and effective dispatch must first be reduced through return or correction evidence before the contract can fall below it. Cancelling an unfulfilled obligation follows the same guard and never erases dispatch history. A negative available balance remains visible as an over-allocated or over-dispatched reconciliation exception and blocks new finalization; unavoidable later facts such as a positive Dispatch Correction may create that exception even though a controlled commercial reduction may not. Logistics offers zero additional selectable quantity, while unit-specific validation tolerance never changes stored or displayed projection truth. At the same effective time, `Contracted Quantity = Finalized/Reserved Quantity + Physically Dispatched Quantity + Available-to-Load Quantity`.
_Avoid_: counting one allocation as both finalized/reserved and physically dispatched, calling Logistics finalization a dispatch, retaining inactive allocation revisions in the reserved bucket, using an original or unapproved contract version as the current baseline, reducing a contract below reserved plus dispatched truth, rejecting or rewriting unavoidable physical evidence, clamping away a negative balance, applying validation tolerance to projection truth, using a grouped presentation as calculation truth, merging repeated row identities, combining units, or deriving available-to-load from only one downstream lifecycle

**Shipment Projection Time**:
The two explicit time perspectives used to reconstruct Contract Shipment Quantity Reconciliation. `effectiveAt` is when a business event actually occurred; `recordedAt` is when Sabalan ERP learned and recorded it. An operational historical view uses effective time with all knowledge currently available, while an audit-known-at view additionally excludes evidence recorded after its cutoff. A saved export or snapshot records its mode, cutoff, source event identities and versions, and integrity hash.
_Avoid_: using one ambiguous timestamp, losing the actual time of a retrospectively registered event, rewriting what an earlier audit view knew, or saving an historical result without reproducibility metadata

**Shipment Quantity Projection**:
A rebuildable read model derived from immutable contract-version, allocation-disposition, Guard-exit, Dispatch Correction, and return evidence to present Contract Shipment Quantity Reconciliation efficiently. Each row reports `CURRENT`, `STALE`, `LEGACY_UNRECONCILED`, or `EVIDENCE_CONFLICT`; missing links, broken hashes, contradictory dispositions, and incomplete rebuilds never become zero. Views retain the last verified quantities with cutoff, freshness, and unresolved condition. Aggregates distinguish a known subtotal from a complete total and report affected-row counts. A cached or stale projection permits viewing but never authorizes loading. Logistics finalization blocks affected rows, locks every unaffected contract row, and atomically recomputes authoritative current balances from source evidence, then reserves every requested quantity or none; rebuilding a projection from the same evidence must reproduce the same values.
_Avoid_: treating a materialized or grouped view as source truth, authorizing from stale or unhealthy evidence, presenting missing evidence as zero, presenting a partial subtotal as a complete total, partially reserving a multi-row finalization, or maintaining unrebuildable mutable counters

**Shipment Quantity Precision**:
The exact fixed-point quantity policy shared by contract versions, allocations, exits, corrections, returns, cutover decisions, and shipment projections. Values use canonical scale three and never binary floating-point arithmetic; presentation may trim trailing zeros but never rounds a value used for reconciliation. Every event retains the contract row's snapshotted unit, projections neither convert nor combine units, and a financially approved row's unit becomes immutable once reservation or dispatch evidence exists. A commercial unit change creates a new contract row with a new stable identity. Unit-specific operational tolerances validate finalization only and never alter projection values.
_Avoid_: floating-point reconciliation, hidden calculation rounding, cross-unit aggregation or conversion, changing a used row's unit, or folding tolerance into shipment truth

**Legacy Shipment Quantity Cutover**:
The per-contract-row transition from legacy shipment evidence to Contract Shipment Quantity Reconciliation. Delivery and DeliveryProduct remain scheduling or supporting evidence and never directly change shipment quantities. A legacy finalized loading linked to verified Guard outbound movement becomes physically dispatched; a cancelled loading contributes nothing; and a finalized loading without trustworthy exit evidence becomes `LEGACY_UNRECONCILED`, conservatively holding its quantity as reserved until reviewed. Review creates an immutable `DISPATCHED`, `RELEASED`, or `STILL_RESERVED` decision with source links, actor, time, reason, and integrity hash. The reviewed cutover baseline plus post-cutover canonical events reconstructs every later projection.
_Avoid_: treating scheduled or self-reported delivery as physical exit, releasing uncertain legacy quantities for loading, fabricating exit evidence, or relying on an unexplained mutable opening balance

**Legacy Driver-Vehicle Pair Cutover**:
The validation-driven retirement of every combined Security driver-vehicle pair into read-only historical source data with its original identity and snapshot, while owning workspaces review match candidates before activating separate canonical identities. Legacy pairs are disabled for new queue use, historical loading and movement evidence retains its original source, and all new operations use only validated canonical records.
_Avoid_: automatic internal or external classification, promoting a legacy pair directly into active use, breaking historical references, or allowing old and new registries to accept concurrent work

**Driver-Vehicle Cutover Mapping**:
An append-only reviewed decision for each legacy pair that records its linked canonical driver and vehicle targets or its historical-only, duplicate, or invalid disposition, together with reviewer, time, reason, and evidence. Conflicts are quarantined per affected identity without blocking unrelated migration; corrections supersede rather than rewrite prior decisions, and copied legacy documents require explicit validation with provenance.
_Avoid_: automatic merge, silent overwrite, mutable mapping decisions, migration-wide blocking for one conflict, or copying legacy evidence without provenance

**Driver-Vehicle Cutover Boundary**:
The immutable switch from legacy pair and queue writes to canonical driver, vehicle, assignment, and queue records after a verified snapshot, explicit clearing of open legacy turns, and release of non-finalized reservations. Legacy writes may be restored only before the first canonical queue admission; afterward operations pause and fix forward so two competing histories never form.
_Avoid_: deleting cleared turns, rewriting finalized loading history, rolling back after canonical live traffic, or permitting old and new write paths concurrently

**Pilot Safety Pause**:
The fail-safe operating state required when a critical dispatch failure occurs after the first canonical Guard Driver Queue Turn makes legacy rollback unsafe. It blocks new admissions, reservations, finalizations, waybill issuance, and confirmations; preserves all evidence; and permits only explicitly assessed safe completion, revocation, or holding of in-flight cases while a critical incident is fixed forward. Manual Outage Exit remains limited to a verified ERP-wide outage and is not a rollback substitute. Resumption requires documented root cause, correction, reconciliation, repetition of the failed acceptance tests, and approval from the incident lead plus Guard, Logistics, and Accounting owners.
_Avoid_: restoring legacy writes after canonical traffic, deleting or rewriting failed evidence, continuing new work during the pause, using Manual Outage Exit for an ordinary defect, or resuming on technical recovery alone without operational approval

**Pilot Operational Monitoring**:
The live operational view of connector, device, and licence health; dispatch cases by lifecycle and age; confirmation outcomes and latency; fallback and outage use; authorization expiry and revocation; exit idempotency; projection health; reconciliation exceptions; audit-chain integrity; and SMS delivery backlog throughout the Internal Dispatch Pilot Cohort. An unauthorized or duplicate exit, false biometric acceptance, broken evidence or hash chain, unexplained quantity difference, Dispatch Dual Control bypass, raw biometric or secret exposure, or authorization consumed against the wrong snapshot is a critical alert that immediately enters Pilot Safety Pause. Service degradation and stuck work alert support without automatically pausing unless they threaten safety or evidence integrity.
_Avoid_: monitoring only infrastructure, hiding business-state age or reconciliation health, treating every warning as a shutdown, continuing after an integrity-critical alert, or placing biometric material or secrets in telemetry

**Dispatch Pilot Reconciliation and Acceptance**:
The non-waivable evidence gate for expanding beyond the Internal Dispatch Pilot Cohort. Every operating day reconciles queue turns, allocations, candidates, waybills, confirmations, authorizations, exits, corrections, shipment quantities, audit hashes, and SMS enqueue outcomes with exact source-event counts and hashes, exact scale-three shipment equations, and an explained disposition for every exception. Guard, Logistics, and Accounting owners sign daily; HR-hosted Vehicle Operations signs any day with relevant identity, eligibility, enrollment, vehicle, plate, or assignment change. Final acceptance additionally requires every preceding gate and the Internal Dispatch Pilot Acceptance Window, no unresolved critical or high-severity defect, no unauthorized or duplicate exit, false acceptance, wrong-snapshot authorization, dual-control bypass, or privacy failure, complete evidence-chain and quantity reconciliation, sustained physical-device thresholds, reconciled retrospective outage registration, and the correct non-blocking SMS job for every exit. Expansion requires written approval from HR-hosted Vehicle Operations, Guard, Logistics, Accounting, technical support, security and privacy, and the pilot incident lead; no single manager can waive a mandatory failure.
_Avoid_: accepting an unexplained difference, treating missing evidence as zero, skipping daily owner review, averaging away an integrity failure, expanding with an unresolved severe defect, or substituting managerial discretion for required multi-owner approval

**Pilot Support Coverage**:
The named operational and technical readiness required whenever Internal Dispatch Pilot Cohort work is active. A pilot dispatch starts only when trained Guard, Logistics, and Accounting shift owners plus a technical responder are reachable. Active hypercare runs from one hour before the first pilot dispatch through the final pilot exit on each of the first five operating days; every later pilot shift has on-call workspace super-user, application and operations, engineering and security, and scanner-supplier escalation paths. Critical alerts are acknowledged within five minutes, receive containment or Pilot Safety Pause within fifteen minutes, and immediately gain an incident lead; high-severity failures are acknowledged within fifteen minutes and receive a safe workaround or escalation within sixty minutes. Every incident preserves its timeline, evidence, decisions, affected cases, reconciliation result, root cause, and follow-up owner.
_Avoid_: starting without accountable owners, relying on an unnamed shared support channel, measuring response outside the operating shift calendar, continuing while critical containment is overdue, or closing an incident without case and reconciliation evidence

**Dispatch Pilot Competency Certification**:
The role-specific proof that each Internal Dispatch Pilot Cohort participant understands owned actions, handoffs, prohibited actions, privacy, audit reasons, and escalation and can perform the normal path plus every exception their authority permits in a production-like environment. Accounting and Guard supervisors jointly demonstrate biometric fallback, Manual Outage Exit, and Dispatch Dual Control; each workspace demonstrates its recovery and rejection paths; support diagnoses device, licence, projection, audit, and notification failures without exposing secrets; and drivers receive the consent and privacy explanation and practice capture, retry, and fallback expectations. Failed assessment requires retraining, while a material workflow change or relevant incident requires targeted recertification.
_Avoid_: treating attendance as competence, certifying a role without its exceptions, allowing untrained exception approval, omitting drivers or support staff, exposing protected evidence during training, or carrying certification unchanged across a material process change

**Dispatch Cutover Rehearsal Gate**:
The prerequisite of two successful production-like rehearsals before live dispatch cutover: a correctness rehearsal proves mappings, queue clearing, reservation release, finalized-loading preservation, shipment reconciliation, permissions, audit hashes, and rollback restoration; a timed dress rehearsal then uses the exact runbook, named operators, support coverage, and approved downtime window. Both require matching source and target counts and hashes, no unexplained quantity differences, no unresolved identity or plate conflicts affecting the Internal Dispatch Pilot Cohort, and no critical or high-severity defects. A failed rehearsal is corrected and repeated before the gate can pass.
_Avoid_: treating a partially successful rehearsal as cumulative evidence, skipping restoration proof, rehearsing with different operators or steps than live cutover, accepting unexplained reconciliation differences, or carrying a severe defect into production

**Guard Driver Queue Lifecycle**:
The normal visit path is `WAITING_AT_GATE` to `AVAILABLE_FOR_LOADING` to `RESERVED_FOR_LOADING` to `LOADING_FINALIZED` to `EXIT_RECORDED`; only Guard's physical-exit fact produces the final state, so Logistics finalization is not called dispatch. Before finalization Guard may return availability to waiting and Logistics may release a reservation to availability, always with actor, time, and reason; a finalized turn remains occupied, and every repeat visit creates a new turn.
_Avoid_: marking physical dispatch at loading finalization, reserving one turn twice, silently reversing progress, editing a completed visit, or reusing an earlier turn

**Queue Closure Without Loading**:
A real Guard Driver Queue Turn that ends before loading finalization because the driver physically leaves or becomes ineligible; Guard records departure time and reason, and any Logistics reservation is released transactionally first.
_Avoid_: deleting the visit, confusing it with a mistaken entry, leaving a reservation active, or using it to cancel a finalized loading

**Voided Queue Turn**:
A queue turn retained as accountable evidence because the admission record itself was entered by mistake or duplicated, with actor, time, reason, and an optional replacement-turn link.
_Avoid_: hard deletion, using voiding for a real visit that ended without loading, or voiding after finalized downstream evidence exists
