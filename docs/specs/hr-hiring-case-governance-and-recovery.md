# HR hiring case governance and recovery

Status: Approved for implementation
Approved: 2026-07-26
Scope: `منابع انسانی ← جذب و پرونده‌های متقاضیان` and `/apply`

## Outcome

The hiring workspace must support an auditable, recoverable selection process in which company management controls pre-identity requirements and selection decisions, Human Resources records and coordinates evidence, Finance receives and verifies collateral, and Applicants retain access to the same Application data across OTP replacement.

The guided lifecycle becomes:

1. Formation and Applicant Form
2. Internal pre-identity checklist
3. Identity verification
4. DISC/BIG FIVE/EQ assessment and company-management decision
5. Offer, approvals, and Candidate acceptance
6. Collateral and Personnel conversion
7. Start preparation
8. Employment activation

Detailed checklist work remains evidence inside the fixed Application stages; it is not promoted into additional `HrApplicationStage` enum values.

## Authorities

Use `COMPANY_MANAGER` (`مدیریت شرکت`) as the explicit company-management hiring authority. It is separate from `HR_MANAGER` and generic `ADMIN`; Sabalan has no active Hiring Manager authority or responsibility. Multiple users may hold Company Manager authority, but every action records the exact actor. Generic administration never grants this authority implicitly.

Only explicit HR authority administrators may assign, remove, or expire `COMPANY_MANAGER`. Authority changes are audited and never rewrite earlier decisions.

Responsibilities:

| Authority | Responsibility |
| --- | --- |
| `HR_PROCESSOR` | Coordinate checklist work, record checklist evidence/results, release the completed pre-identity gate, record assessments, issue invitations, and record offline Candidate offer decisions |
| `HR_MANAGER` | Independently record preliminary HR approval, correct HR checklist results through a new version, approve identity, execute authorized formal reopening |
| `COMPANY_MANAGER` | Finalize checklist requirements, add case-specific work, decide how negative items are handled, approve continuation, decide formal assessments, create salary-and-benefits offer versions after selection approval, propose collateral requirements, authorize reopening |
| `FINANCE_RECORDER` | Record actual collateral receipt, protected instrument details, custody, and scans |
| `FINANCE_MANAGER` | Independently verify collateral and approve clearance |

## Pre-identity checklist

The new guided phase `بررسی‌های پیش از احراز هویت` appears between Application Form and Identity. A Job/Position may have a versioned default template. Each Application snapshots its template; later template changes do not silently alter active Applications.

Default/custom items may include trial attendance, interview with company management, interview with HR management, interview with the job supervisor, referral to a consultant or therapist, and other management-defined work. `COMPANY_MANAGER` may add a custom assessment that is not one of the formal DISC/BIG FIVE/EQ choices. Such an item applies only to the current Application unless management explicitly saves it as a reusable template.

DISC, BIG FIVE, and EQ never appear in this checklist; they remain in the formal Assessment phase.

### Ordering

1. `HR_PROCESSOR` records the initial HR interview and its explanation.
2. `HR_MANAGER` independently records preliminary HR approval and its explanation.
3. `COMPANY_MANAGER` assigns zero or more required items and explicitly finalizes the requirements.
4. HR follows up outside `/apply` and records each result.
5. `COMPANY_MANAGER` approves continuation or records another disposition.
6. `HR_PROCESSOR` confirms administrative completion and releases the case to Identity.

Candidates see none of this checklist in `/apply`; HR owns all coordination.

### Item states and evidence

Checklist item states are `PENDING`, `IN_PROGRESS`, `POSITIVE`, `NEGATIVE`, `CANCELLED`, and `WAIVED`.

- `PENDING`: assigned but HR has not started coordination.
- `IN_PROGRESS`: HR has started coordination, scheduled work, or is awaiting a report.
- `POSITIVE` / `NEGATIVE`: HR's recorded interpretation of the received evidence.
- `CANCELLED`: management declares that the item was entered incorrectly or is no longer a valid requirement.
- `WAIVED`: the requirement is valid but management accepts a reasoned exception for this Candidate.

Each item declares whether an HR explanation is required and whether an evidence file is required, optional, or prohibited. A required result cannot complete without its configured evidence.

External reviewers and supervisors provide reports to HR. `HR_PROCESSOR` records the result, source, date, job-relevant explanation, and evidence. `HR_MANAGER` corrects a result only by adding a new audited version. No actor edits or deletes prior evidence in place.

`COMPANY_MANAGER` sees the result, HR explanation, report date/source, and management-safe evidence. Full therapist or medical material remains HR-restricted unless explicitly classified as safe for management.

A negative result never automatically rejects the Candidate. It blocks progress until `COMPANY_MANAGER` chooses: continue with a mandatory reason, require replacement/repeat work, apply `رد/ذخیره`, or apply another valid outcome. A repeated item creates a new attempt and preserves the old one.

Adding a required item after the phase has completed is allowed until `HIRED`. It reopens this phase and blocks later progression. An accepted offer is not silently cancelled, but conversion remains blocked until the new requirement and renewed management approval are complete.

Only HR receives deadline/overdue reminders. HR may manually escalate an exception to management.

## Selection decisions and labels

The Applicant table exposes three canonical, independently audited columns:

1. `مصاحبه اولیه با HR`: recorded by `HR_PROCESSOR`; positive and negative explanations are mandatory.
2. `تأیید اولیه HR`: recorded independently by `HR_MANAGER`; positive and negative explanations are mandatory.
3. `تأیید مدیریت`: recorded by `COMPANY_MANAGER`; a positive explanation is optional, a negative explanation is mandatory.

An authorized actor changes a prior decision only through a new version with a mandatory change reason. The table shows the latest effective decision; clicking its read-only icon opens a dismissible detail panel with the current evidence and full decision history. Only `HR_PROCESSOR`, `HR_MANAGER`, and `COMPANY_MANAGER` may open these explanations.

`تأیید اولیه HR = negative` automatically applies the reversible `رد اولیه` pause label. Only `HR_MANAGER` may reactivate it, with a reason.

Only `COMPANY_MANAGER` may apply `رد/ذخیره`, after comparison within the same Position/Recruitment Request. It pauses rather than closes the Application, requires a reason, and only `COMPANY_MANAGER` may reactivate it.

Paused cases preserve their current lifecycle phase and evidence, display `متوقف‌شده`, and block ordinary progression until reactivated.

During formal Assessment, `HR_PROCESSOR` records/version-controls DISC/BIG FIVE/EQ evidence and explicitly confirms that the evidence set is complete. `COMPANY_MANAGER` then chooses:

- approve and continue;
- request a repeated assessment, with reason and optional deadline;
- `رد/ذخیره`;
- `رد نهایی`, which atomically records formal `REJECTED` and closes the Application.

Management approval immediately completes Assessment and unlocks Offer; no additional HR click is required. A repeated assessment preserves the previous attempt as superseded evidence and blocks Offer until the new attempt is recorded and decided.

Viewers without action authority still see the decision state and responsible role; controls are disabled or absent without hiding why the phase is waiting.

## Closure and reopening

`HIRED` is final and cannot be reopened. `REJECTED`, `WITHDRAWN`, and `REQUEST_CANCELLED` may be formally reopened, without deleting or rewriting the closure event.

Formal reopening requires:

1. `COMPANY_MANAGER` authorization with reason.
2. `HR_MANAGER` execution with reason after verifying that the same Position and Recruitment Request remain valid and have capacity.

The Application can reopen only for its original Position and Recruitment Request. A different role requires a new Application linked to the same Candidate. If the original request is inactive, expired, cancelled, or full, the reopening request remains blocked until it is valid and capacity is available.

Reopening restores the last pre-closure lifecycle position and evidence, then revalidates time-sensitive dependencies. Completed evidence remains unless superseded; obsolete offers require a new version. `WITHDRAWN` additionally requires HR to record the Candidate's renewed consent, communication method, date/time, and note.

Old OTPs never become valid again after reopening. HR sends a fresh invitation; access replacement never changes or deletes Application data.

## Applicant access and SMS delivery

An OTP belongs to an Application and grants access to that same preserved data. Reissue never creates a new Application, resets a draft, erases uploads, or changes submitted answers.

New OTPs remain valid for seven days. On resend, the previous OTP remains usable until the earliest of:

- successful use of the replacement OTP;
- the previous OTP's original expiry;
- 30 minutes after resend.

Successful use of a replacement revokes older active codes. Five incorrect attempts across the Application's active codes revoke all of them. Candidates cannot request replacement from `/apply`; they contact HR by phone or in person, and authorized HR issues it. A successful verification resets the failure counter to zero. IP-level abuse protection remains independent.

After login, `/apply` restores the latest saved state. When HR requests corrections, only the returned fields appear and are editable. Each shows its label, previous value, and field-specific correction explanation; unrelated fields and internal notes remain hidden.

SMS.ir verification sends return a provider message ID. SabalanERP stores it and polls the official send-report endpoint until a terminal state or 24 hours, with manual refresh. The UI distinguishes:

- provider SMS state: queued, delivered, failed, or unknown;
- Applicant access state: successful `/apply` login with timestamp.

Successful login changes overall invitation status to `دسترسی تأیید شد` without rewriting provider delivery evidence. HR is notified about SMS delivery failure, but not failed-login revocation or successful login.

## Offline offer decision

Only `HR_PROCESSOR` may record `ثبت پذیرش آفلاین متقاضی` or an offline decline after every internal approval is complete. This records the Candidate's consent; HR is not the accepting party. Required evidence is communication method, date/time, confirmed full name, offline reason, and conversation note. The exact HR actor and immutable offer version are audited.

An offer decision is final for that offer version. A portal decline cannot be overwritten with offline acceptance; the Company Manager must issue a new offer version.

## Collateral

`COMPANY_MANAGER` proposes and registers the collateral requirement: type, amount/obligation when applicable, due timing, and Candidate-facing explanation. Management may define it before offer acceptance, and `/apply` must show it with the offer.

Finance may record physical receipt only after acceptance of the latest fully approved offer. `FINANCE_RECORDER` records protected instrument data and evidence; `FINANCE_MANAGER` verifies and approves independently. Management sees the requirement and clearance, not instrument identifiers, guarantor details, custody locations, or protected scans.

Changing a Candidate-visible collateral requirement after offer acceptance makes the acceptance stale and requires a new offer version and new Candidate acceptance.

## Applicant table

The hiring queue becomes a server-filtered, server-sorted, paginated table with 50 rows per page. It has one row per Application, not per Candidate.

Default scope is every non-`HIRED` Application, including paused, rejected, reserve, withdrawn, cancelled, and reopened cases. `همه پرونده‌ها` includes hired history. Default ordering is current-user actions, then blocked/overdue cases, then most recently updated.

Default columns:

`متقاضی`, `شماره همراه`, `شغل/جایگاه`, `درخواست جذب`, `مرحله چرخه`, `وضعیت اقدام`, `برچسب پرونده`, `مصاحبه اولیه HR`, `تأیید اولیه HR`, `تأیید مدیریت`, `اقدام بعدی/مسئول`, `آخرین تغییر`.

Full mobile is visible only to `HR_PROCESSOR`, `HR_MANAGER`, and `COMPANY_MANAGER`; every other viewer receives a masked value from the backend.

Filters include name/mobile, Job, Position, Recruitment Request, lifecycle phase/status, label/outcome, each of the three decisions, checklist/overdue state, offer state, collateral state, responsible authority, and created/updated ranges.

## Migration

- Existing Applications already past Identity are grandfathered through the new pre-identity gate with an explicit migration audit; they are not moved backward.
- Existing Applications before Identity receive the applicable checklist and must complete it.
- Existing Assessment cases preserve assessment evidence and wait for the new `COMPANY_MANAGER` decision.
- Migration never fabricates an actor or a positive business decision; grandfathering is a distinct system event.

## Acceptance criteria

1. Lifecycle projection reports eight phases and never strands an authorized viewer behind an unexplained `WAITING` state.
2. Every decision and mutation described above is backend-authorized and audited; UI hiding is not the control boundary.
3. Paused labels and reopened outcomes preserve phase/evidence and never mutate closure history.
4. OTP resend cannot lock a Candidate out solely because the replacement SMS is lost.
5. SMS provider acceptance, provider delivery, and successful Applicant access are separately observable.
6. A replacement OTP restores the exact Application data and correction-only views expose only returned fields.
7. Offline offer acceptance remains visibly attributable to Candidate consent recorded by HR.
8. Management defines collateral; Finance receives and independently approves it.
9. The Applicant table enforces field-level mobile and decision-detail permissions on the backend.
10. Existing production cases migrate without losing evidence or being incorrectly advanced.
