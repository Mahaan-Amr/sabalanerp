# Seven-level Seller performance evaluation

## Status and scope

This is the accepted and implemented product design for the first manual rollout of the new Personnel performance model. It defines common behavioral evaluation for all active Personnel and a complete official evaluation for the Seller Job. Automated extraction from Sales, Accounting, and Guard remains a later phase; the first rollout records referenced source values manually.

The model evaluates performance against versioned Job expectations. It does not change a Personnel's Job or Position. A Position may add narrowly specific criteria, and each result remains bound to the exact employment assignment and period that produced it.

## Badge levels

| Score | Level | Stone |
| ---: | --- | --- |
| 0–49.99 | همراه | عقیق |
| 50–59.99 | کوشا | کهربا |
| 60–69.99 | شایسته | فیروزه |
| 70–79.99 | توانمند | زمرد |
| 80–89.99 | برتر | یاقوت کبود |
| 90–96.99 | سرآمد | یاقوت سرخ |
| 97–100 | الگو | الماس |

All seven icons retain the current badge frame, lighting, size, and elongated stone cut. The Persian level name always accompanies the visual meaning.

On activation, every active Personnel sees only the label `همراه`. Until the first valid seven-level result exists, its internal state is `no official result`: it has no score and is excluded from analytics, competition, compensation, promotion, improvement, and discipline. Managers may filter this state as `بدون نتیجه رسمی`, but `آغازین` is never part of the visible badge label.

Existing five-level results keep their historical score, label, icon, and policy version. They are not mapped to seven levels or used as the current badge after cutover.

## Period and eligibility

- Period 1: 1 Farvardin through the end of Shahrivar.
- Period 2: 1 Mehr through the end of Esfand.
- A formal result requires at least 90 effective days in the evaluated assignment.
- Count and amount targets are prorated by effective days.
- Rates require their defined minimum sample.
- A Job or Position change creates a separate segment.
- Concurrent or sequential segments are weighted by effective days multiplied by recorded allocation percentage.
- Missing allocation is a blocker and is never guessed.
- Progress and missing-data warnings may update monthly; the official badge changes only after period close and appeal.

## Total score composition

| Source | Weight |
| --- | ---: |
| Quantitative system performance data | 63% |
| Contextual Seller performance judgment by Supervisor | 7% |
| Behavioral judgment by Supervisor | 12% |
| Behavioral peer surveys | 9% |
| Valid system behavioral data | 9% |
| **Total** | **100%** |

This yields 30% behavioral and 70% performance evaluation. Seventy percent of the behavioral category is qualitative, ninety percent of the performance category is quantitative, and validated system data supplies 72% of the total result.

## Common behavioral factors

| Factor | Weight of total result |
| --- | ---: |
| Respectful and professional conduct | 4% |
| Collaboration and teamwork | 4% |
| Accountability and follow-through | 5% |
| Clear and effective communication | 3% |
| Learning and accepting feedback | 3% |
| Grooming and approved workplace standards | 2% |
| Scheduled attendance compliance | 5% |
| Punctuality and unjustified delay | 4% |
| **Total** | **30%** |

Approved leave, mission, recorded illness, and non-working days have no negative effect. Overtime has no positive effect. Grooming criteria judge only an approved workplace standard and relevant workspace orderliness, never personal taste, body, health, family, ethnicity, religion, or another protected characteristic.

### Initial behavioral survey statements

1. این همکار با مشتریان و همکاران محترمانه و آرام رفتار می‌کند.
2. این همکار هنگام اختلاف‌نظر از پرخاشگری، تحقیر و رفتار نامناسب خودداری می‌کند.
3. این همکار اطلاعات لازم را در زمان مناسب با اعضای مرتبط تیم به اشتراک می‌گذارد.
4. این همکار در انجام تعهدهای مشترک با تیم همکاری می‌کند.
5. این همکار کاری را که پذیرفته است تا رسیدن به نتیجه پیگیری می‌کند.
6. این همکار تأخیر، اشتباه یا مانع را به‌موقع اعلام می‌کند و آن را پنهان نمی‌کند.
7. این همکار منظور، درخواست و اطلاعات لازم را روشن و قابل‌فهم بیان می‌کند.
8. این همکار به صحبت دیگران گوش می‌دهد و از درک درست موضوع مطمئن می‌شود.
9. این همکار بازخورد حرفه‌ای را می‌پذیرد و برای اصلاح عملکرد استفاده می‌کند.
10. این همکار برای یادگیری روش‌ها و جلوگیری از تکرار اشتباه تلاش می‌کند.
11. این همکار استاندارد مصوب پوشش و آراستگی محیط کار را رعایت می‌کند.
12. این همکار نظافت شخصی و نظم فضای کاری مرتبط با مسئولیتش را رعایت می‌کند.

The fixed response scale is `کاملاً مخالفم`, `مخالفم`, `نه موافقم نه مخالف`, `موافقم`, and `کاملاً موافقم`. `اطلاعات کافی برای ارزیابی ندارم` is a separate unscored response.

## Peer surveys

- HR Manager and Company Manager may create, edit, reorder, delete, and activate survey drafts.
- HR Processor sees completion and aggregated results but does not manage questions.
- The six behavioral sections are fixed; questions within each section are dynamic and equally weighted.
- Activation freezes the form version. Later changes create a new version.
- Managers select questions, active target Personnel, active respondents, and start/end dates.
- A respondent cannot evaluate themselves or submit twice to the same form.
- There is no limit on the number of surveys, targets, or executions.
- All valid surveys in the six-month period may contribute.
- Answers are first averaged for each respondent–target–factor combination, then averaged equally across distinct respondents. Repetition never increases one person's influence.
- At least three distinct scored respondents are required.
- Free comments never affect the score.
- Respondents may save a draft and revise their final response until survey close. Only the latest final version scores; previous versions remain confidential audit evidence.
- After close, a correction requires the respondent's request and creates a linked version. HR never rewrites an answer on the respondent's behalf.

Only HR Manager may inspect raw comments and respondent identities for investigation, and every inspection is audited. The target Personnel, Supervisor, and Company Manager see only a reviewed anonymous summary; HR Processor sees only aggregates and completion. No one may use managerial access to inspect raw responses about themselves. The alternate resolver for an HR Manager or Company Manager who is the target is deferred to a future design.

## Seller performance factors

| Family and subfactor | Weight |
| --- | ---: |
| **Sales contribution** | **22%** |
| Net value of finalized contracts against target | 14% |
| Actual received cash attributed to the Seller against target | 8% |
| **Collection and financial follow-up** | **15%** |
| Collection rate for obligations due in the period | 5% |
| On-time collection follow-up | 6% |
| Receivables without valid follow-up | 4% |
| **Contract cycle speed** | **8%** |
| Seller-controlled time to first valid submission | 3% |
| Active Seller-controlled correction time | 2% |
| Seller-controlled time from complete signature to valid Accounting submission | 3% |
| **Contract quality and accuracy** | **7%** |
| First-submission acceptance | 3% |
| Corrections attributable to the Seller | 2% |
| Contextual Supervisor judgment | 2% |
| **Cancellation, return, and reversal** | **5%** |
| Seller-attributable cancellation rate | 3% |
| Seller-attributable return/reversal rate | 2% |
| **Customer and opportunity management** | **8%** |
| Valid new customers | 2% |
| Decided-opportunity conversion rate | 2% |
| Stale opportunities without action | 1% |
| Contextual Supervisor judgment | 3% |
| **Delivery commitment quality** | **5%** |
| Accuracy of Seller delivery promises | 2% |
| Delivery problems attributable to the Seller | 1% |
| Contextual Supervisor judgment | 2% |
| **Total** | **70%** |

The three contextual Supervisor statements cover professional handling of complex contract cases, responsible customer/opportunity management, and realistic delivery commitments. They never repeat or override system numbers.

## Attribution and metric rules

- Each finalized contract has exactly one realized Seller. The entire net contract value belongs to that Seller; joint contribution is recognized separately and value is not split.
- Contract value scores in the period of valid finalization and financial approval.
- Cash scores in the period it is actually received, including receipts for older contracts, and remains attributed to the realized Seller.
- Collection follow-up belongs to the Personnel responsible at the obligation's due date.
- Transfers are future-effective and never rewrite past sales credit or collection responsibility.
- A payment is counted once by its valid Financial Record identity.
- Collection rate includes obligations due in the period and does not double-count early payment.
- Seller-controlled duration counts scheduled working time only, begins at valid assignment, and stops at valid submission.
- Holidays, approved leave/mission, customer waiting, and time owned by Management, Accounting, Inventory, Production, Logistics, or Guard are excluded.
- Customer signature waiting is not a speed penalty; compliance with the signature follow-up plan is measured instead.
- A new Customer counts only after their first valid finalized contract; creating or duplicating a CRM record earns nothing.
- Conversion includes genuinely won or lost opportunities. Open opportunities are excluded from conversion but become stale when left without required action.
- External inventory or management causes do not count against the Seller.

Cancellation before final delivery, returned delivered goods, an order returned to an earlier step for correction, and a financial correction are separate event classes. The source workspace records the initial reason and responsibility as Seller, Customer, Inventory/Production, Accounting, Logistics/Guard, Management, Shared, or Under Review. A disputed event does not score until HR Manager resolves it.

## Sample sufficiency

- Peer score: at least 3 distinct respondents.
- Contract quality rates: at least 3 finalized contracts.
- Collection rates: at least 3 due obligations.
- Conversion rate: at least 5 decided opportunities.
- Formal period result: at least 90 effective assignment days.

An insufficient subfactor is never zero. Its weight is redistributed only within the same family by a predefined rule. If an entire primary family lacks valid evidence, no new official result is issued; the prior valid badge remains, or the Personnel continues to display `همراه` with no official result.

## Scoring

- Higher-is-better: zero actual maps to 0, target maps to 75, and 120% of target maps to 100.
- Lower-is-better: zero adverse events maps to 100, the maximum acceptable target maps to 75, and twice that maximum maps to 0.
- Capped rates: target maps to 75 and 100% maps to 100.
- Values outside the defined range stop at 0 or 100.
- A custom curve requires an explicit versioned business justification.

The following gates apply in addition to total score:

- `برتر` or above requires behavioral score of at least 70.
- `سرآمد` or above requires collection and contract-quality scores of at least 75.
- `الگو` requires total score of at least 97, behavioral score of at least 90, sufficient evidence, no confirmed serious violation in the period, and no primary performance family below 60.
- An allegation has no effect until the formal investigation and appeal are complete.

## Targets

Company Manager sets the Job or Position targets in one action before the period begins. HR may view them without a separate approval. Started-period targets are immutable and a new target is future-effective. The form shows the prior 12 months as decision support; the system never chooses the target automatically. Position differences require a reason, and Company Manager may set an initial target directly when history is insufficient.

## Manual and automated operation

Initially, Supervisor records their judgments, HR Processor enters sourced quantitative values, peer respondents submit confidential answers, the system calculates the score and badge, and HR Manager finalizes it. Company Manager may view but never directly choose or overwrite a score or badge. HR Processor cannot prepare or change their own evidence; another authorized actor handles a declared conflict and the substitution is audited.

Before finalization, HR Processor may correct a manual value while preserving old value, new value, source, and reason. After finalization, correction creates a linked result version.

Later automation replaces only quantitative data entry. Extracted values cannot be overwritten in HR: the owning Sales, Accounting, or Guard record must be corrected, after which the result recalculates. An unresolved source conflict is excluded from scoring rather than overridden.

## Finalization, disclosure, and consequences

1. The period closes and evidence is frozen and validated.
2. Supervisor judgments and survey evidence are complete.
3. The system produces a reproducible proposed result.
4. HR Processor checks evidence completeness without overriding the score.
5. Personnel sees their permitted result and evidence.
6. Personnel has seven calendar days to appeal.
7. HR Manager reviews the appeal.
8. The result is locked and the badge becomes current.

Personnel sees their badge, total score, behavioral/performance split, factor scores, system values and sources, eligible aggregate survey result, standardized strengths/improvement explanation, period, next review, and appeal path. They never see respondent identity, individual answers, raw comments, other Personnel data, or confidential investigation notes.

Personnel with no linked User receives an identity-verified HR delivery and a traceable appeal receipt. No public or separate OTP access is introduced.

A final result is documented input into a separate human compensation, reward, promotion, improvement, or disciplinary decision. It never executes a consequence automatically, and a single weak result is insufficient by itself. Every dependent decision has its own authority, reason, and appeal path; a corrected result flags that decision for review.

## Visibility and recognition

- Personnel sees only their own badge and details.
- Supervisor sees only direct reports' badge, factors, and history.
- HR Processor, HR Manager, and Company Manager permission profiles may see all badge labels; sensitive details remain separately permissioned.
- Ordinary Personnel never see coworkers' badges or a leaderboard.
- Company Manager may announce positive period achievements such as strongest growth, follow-up discipline, contract quality, or overall performance without exposing others' scores or lower performers. Named recognition occurs with the winner's knowledge.

## Employment lifecycle

- Active Personnel has a current badge.
- Suspended Personnel retains the last valid badge and receives no new evaluation.
- Ended employment has history but no current badge.
- Rehire starts with the visible label `همراه` and no official result; the former badge never transfers.

## Retention

Company Manager publishes a versioned internal retention policy for drafts, numeric answers, raw comments, final results, appeals, dependent decisions, and audit events. Raw comments expire or become anonymous earlier than aggregates. Active appeals, investigations, and legal holds block related deletion, and completed deletion produces a non-personal audit receipt. Automatic deletion remains disabled until the policy is published, but indefinite retention is not the intended steady state.

## Deliberately deferred

The alternate confidential reviewer and finalizer when HR Manager or Company Manager is themselves the target is not designed in this phase. The general self-access and self-action prohibition remains; the special workflow will be decided separately in a future phase.
