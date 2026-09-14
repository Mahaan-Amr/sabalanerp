# Personnel performance role catalog and coverage discovery

Status: **proposed, business review pending**
Stable tracking key: `PERF-ROLE-CATALOG`
Coordination basis: `PERF-COORD-20260909-v1` in GitHub issue #356
Prepared for: GitHub issue #370
As of: 2026-09-09

## Outcome and truth boundary

No authorized current workforce database, approved production snapshot, or controlled responsibility-document set was available to this task. The repository and its historical local counts are not a current roster or a production baseline. Consequently:

- no real Job, Position, Personnel count, responsibility, Supervisor, assignment, capacity, or source attribution is claimed;
- actual inventory coverage, period eligibility, template readiness, cohort membership, accepted results, and badge availability remain **unknown**, not PASS;
- no named Personnel output is stored in Git or GitHub;
- all example catalog and coverage content in `personnel-performance-role-catalog.synthetic.json` is explicitly **SYNTHETIC** and **AI_PROPOSED**;
- business reviewers, the protected-artifact custodian, source owners, and content approval remain unassigned;
- the 80/20 composition is the approved default. The 20/60/20 content example remains an unapproved draft and is not used here.

Issue #370 permits this truthful unavailable-data result when paired with a reproducible read-only extraction plan. That plan is in `personnel-performance-role-catalog-extraction.md`.

## Delivered artifacts

| Artifact | Purpose | Data classification |
| --- | --- | --- |
| This document | Sanitized catalog proposal, provenance, limitations, evidence rules, coverage contract, and unresolved decisions | Repository-safe; no named workforce data |
| `personnel-performance-role-catalog.synthetic.json` | Machine-readable v1 proposal, agreed producer/consumer contract, and synthetic acceptance examples | Repository-safe, synthetic only |
| `scripts/personnel-performance-role-catalog-contract.mjs` | Validates safety and composition invariants at the proposed import seam | Repository-safe tooling; not runtime import |
| `personnel-performance-role-catalog-extraction.md` | Reproducible Personnel-first read-only extraction and reconciliation plan | Repository-safe plan; output is protected |
| Protected coverage output | Complete named inventory when an authorized source and custodian exist | Must remain outside Git/GitHub in an approved restricted HR location |

The JSON manifest remains a content proposal, but its producer/consumer contract is agreed in the recorded #371 and #372 comments. It is not approved company content, an active policy, or a company-content publication.

## Provenance register

| Register item | Provenance | What is known | What must not be inferred | Review state |
| --- | --- | --- | --- | --- |
| Canonical data shape | Current Prisma schema and performance services in this repository | Personnel, relationships, assignments, Jobs, Positions, organizational units, workplace, allocations, effective dates, responsible Supervisor assignments, and optional User have canonical fields | Schema existence does not prove any company Job, Position, person, responsibility, or current value exists | Engineering reference only |
| Operational policy | `CONTEXT.md`, ADR-0024, ADR-0038 records, ADR-0039, performance operations, #338–#355 final decisions and corrections | Evaluation subject, scoring, authority, disclosure, retention, rollout, and acceptance boundaries | No organization-specific criterion content or approval follows from software policy | Approved product boundaries; catalog content pending |
| Historical local counts | Operations document dated 2026-09-05 | A past local inspection reported 50 Personnel, 42 ACTIVE and 7 ENDED relationships, and position capacity 18 across 13 positions | These are not current, complete, production, or suitable as the #370 denominator | Excluded from coverage counts |
| Synthetic manifest | AI-authored acceptance example dated 2026-09-09 | Demonstrates contract shape and required scenarios | It proves no real organizational role, responsibility, person, or evidence source | `BUSINESS_REVIEW_PENDING` |
| Actual workforce source | None supplied or queried | Nothing current is verified | Unknown values cannot be filled from seed, fixture, today’s structure, or job-title assumptions | Unavailable |
| Named coverage artifact | Not produced | Storage and access constraints are specified | Git/GitHub is not an authorized location; no custodian may be invented | Custodian unassigned |

Every future extraction run must record source class separately as `PRODUCTION`, `LOCAL`, `SANITIZED_RECOVERY`, `SEED`, `FIXTURE`, `HISTORICAL_DOCUMENT`, or `SYNTHETIC`. These classes must never be merged into one unexplained total.

## Proposed catalog content

The synthetic manifest demonstrates only the required content structure:

- a shared accounting-specialist Job with distinct receivables and payables Position addenda;
- an accounting-manager Job with genuinely different management responsibilities;
- sales-specific expectations;
- a workshop worker coverage row without a User account;
- re-employment represented by separate relationships and assignment sections without duplicating the Personnel denominator;
- no Position addendum producing 100% Job composition.

Each proposed Job carries a Persian purpose, documented-responsibility proposal, weighted categories, stable criterion concept/version codes, Persian meaning, five criterion-specific Persian behavioral anchors, controlled applicability, evidence policy, reliable-evidence minimum, window, and outside-control factors. Each criterion is `JUDGMENT`; operational counts and KPIs remain evidence and can never calculate a grade automatically.

Position addenda are additive, not replacements. Their composition must total 100%, Job weight must be at least 70%, and addendum weight must be at most 30%. An absent addendum means 100% Job. No applicability fact can name a person, User, score, protected trait, or current unversioned state.

## Evidence-source dictionary

The proposed dictionary separates source trust from scoring:

| Code | Classification | Intended use | Required lineage | Limitation |
| --- | --- | --- | --- | --- |
| `CONTROLLED_LEDGER_ENTRY` | Trustworthy canonical evidence | Approved accounting or operational record | Record id/version, time, performer Personnel, effective assignment, and separately recorded User | A count or KPI is evidence only, never an automatic grade |
| `APPROVED_WORK_ITEM` | Trustworthy canonical evidence | Approved case or work-item lifecycle | Work item revision, time, recorded performer attribution, effective assignment | Missing attribution blocks use |
| `CONTROLLED_DOCUMENT_REVISION` | Controlled document | Effective procedure/checklist context | Document id, revision, approval state, effective period | A document proves the expectation, not individual performance |
| `STRUCTURED_SUPERVISOR_OBSERVATION` | Structured observation | Criterion-specific human observation | Observer, subject assignment section, effective responsibility, form version, observed time | Requires authority and evidence-quality review |
| `FUTURE_SOURCE_INTEGRATION` | Missing/future | Explicit placeholder for a source not yet verified | Must be defined before reliance | Cannot satisfy minimum evidence |

For every real criterion, the business reviewer must assign the actual process owner, source process, canonical record/version, collection window, lineage, performer attribution, reliable-evidence minimum, and outside-control treatment. The recording User and performing Personnel must remain distinct. Missing, disputed, unreliable, or inapplicable evidence is never zero.

## Applicability contract

The v1 proposal uses typed, frozen assignment facts:

| Fact | Type | Source | Unknown behavior |
| --- | --- | --- | --- |
| `jobId` | ID | Period-effective Position/Job reference | Structural blocker |
| `positionId` | ID | Period-effective assignment context | Structural blocker when required |
| `organizationalUnitId` | ID | Period-effective assignment/unit snapshot | Structural blocker when required |
| `workplaceId` | ID | Canonical assignment workplace | Structural blocker when required |
| `shiftType` | string | Versioned recorded schedule/assignment fact | Structural blocker |
| `assignmentType` | string | Employment assignment | Structural blocker |
| `responsibilityCodes` | string list | Versioned documented responsibility source | Structural blocker when required |
| `effectiveDate` | date | Selected period and effective section | Structural blocker |
| `hasSafetyDuty` | boolean | Versioned documented duty fact | Structural blocker |

`workplaceId` is the canonical name in this proposal; `locationId` is deliberately excluded to prevent the current producer/consumer ambiguity recorded in #356. Every dictionary fact records a stable source and source-version contract. Every rule is typed v1: `EQUALS` accepts exactly one same-type scalar and never a list fact, `IN` means scalar membership or string-list intersection, and `EXISTS` carries no values. Missing, null, malformed, or incompletely versioned facts always block evaluation; they never silently become not applicable. #371 owns validation/consumer semantics and #372 owns the effective snapshot producer; both recorded agreement on 2026-09-09.

## Coverage matrix contract

The extraction denominator starts with every Personnel, including inactive, archived, missing-User, missing-relationship, and missing-assignment records. A row cannot disappear because a right-side relationship is absent.

The protected row model contains:

- non-display Personnel reference and protected identity link;
- Personnel active/archive state and optional User state;
- every Employment Relationship as a separate section, with status and effective dates;
- every period-overlapping assignment section, with type, Position, Job, organizational unit, workplace, capacity context, allocation, and historical snapshot/version;
- every recorded period-effective performance responsibility and responsible Supervisor assignment;
- effective Job template and Position addendum versions or precise missing-version blockers;
- separate classifications for inventory inclusion, period eligibility, structural/template readiness, cohort membership, accepted-result availability, and badge availability;
- precise blocker codes without converting unknowns into absence or failure.

Run-level counts are separate and reconciled independently:

1. distinct Personnel inventory;
2. Employment Relationships;
3. assignment/responsibility sections;
4. period-eligible distinct Personnel;
5. structurally/template-ready distinct Personnel;
6. cohort members;
7. accepted results;
8. badges available.

One Personnel with two re-employment relationships counts once in inventory, twice in relationship totals, and once per actual assignment/responsibility section. A subject without User remains in inventory and may be evaluable. A responsible Supervisor without current User, active employment, recorded responsibility, or permission is an authority blocker; it is not the same condition as a subject without User.

### Current coverage result

| Dimension | Status | Count | Reason |
| --- | --- | ---: | --- |
| Personnel inventory | UNKNOWN | — | No authorized current source |
| Employment Relationships | UNKNOWN | — | No authorized current source |
| Assignment/responsibility sections | UNKNOWN | — | No authorized current source |
| Period eligibility | NOT EVALUATED | — | Selected source unavailable |
| Structural/template readiness | NOT EVALUATED | — | Actual assignments and approved catalog unavailable |
| Cohort membership | NOT EVALUATED | — | Not derived from inventory coverage |
| Accepted results | NOT EVALUATED | — | Not derived from inventory coverage |
| Badge availability | NOT EVALUATED | — | Not derived from inventory coverage |

This is a valid limitation result, not 0% and not PASS.

## Protected artifact handling

The actual row-level coverage output must be generated only after an authorized source, named custodian, approved restricted destination, access list, and retention classification are recorded. It must not be copied to Git, GitHub issues, test logs, chat, or general build artifacts. Repository evidence may contain only sanitized counts, limitation categories, source identity/hash, query version, selected period, and reconciliation status.

The custodian role and responsible reviewer are currently `UNASSIGNED`. No retention period is invented. The existing HR/performance artifact and disclosure controls must be reused after the concrete storage need is reviewed; creating a duplicate personal dataset is not assumed necessary.

## Proposed manifest contract

The JSON proposal includes:

- `schemaVersion`, stable catalog key/version, lifecycle, effective context, import identity, canonical content-hash method and hash;
- source class, references, as-of time, and explicit extracted/synthetic status;
- content origin, business-review state, reviewer role and time;
- typed applicability dictionary and null behavior;
- evidence dictionary with source process, record/version, lineage, attribution and owner;
- canonical or explicitly synthetic Job/Position references;
- Persian purpose, responsibilities, criterion titles/meanings, exactly five anchors, category/criterion weights, applicability, evidence policy and outside-control factors;
- Position addendum composition;
- separated coverage state/counts and protected-artifact constraints;
- synthetic acceptance rows that contain no real identity.

Stable import identity is idempotent only when its canonical content hash is unchanged. Reusing the identity with different bytes must fail. Imports, if later implemented by #371, must create DRAFT versions only, preserve immutable prior versions, preview effective Job/Position composition, and never imply business approval or activation.

The included validator proves document-level contract invariants only. It does not import data, query a workforce source, activate policy, establish runtime compatibility, or approve content.

## Unresolved business questions

| Question | Required reviewer | Current owner |
| --- | --- | --- |
| Which stable read-only source and snapshot time are authorized for the actual inventory? | HR data owner and System Owner | Unassigned |
| Who is the custodian and who may access the protected named coverage artifact? | Human Resources and Security/Privacy | Unassigned |
| What are the real Jobs, Positions, responsibilities, capacities, and effective histories? | Human Resources plus organizational managers | Unassigned |
| Which Persian purposes, responsibilities, anchors, category weights, and criterion weights are approved for each verified Job? | Job owner and Human Resources | Unassigned |
| Which Position differences are genuinely documented and merit an addendum? | Position owner and Human Resources | Unassigned |
| Which canonical processes provide reliable evidence, and how is performer attribution recorded? | Process owner, Human Resources, Security/Privacy | Unassigned |
| What window and reliable-evidence minimum applies to each criterion? | Job owner and Human Resources | Unassigned |
| Which outside-control factors and disputed-evidence routes apply? | Job owner and Human Resources | Unassigned |
Unknown answers must stay blockers. They cannot be supplied from title stereotypes, test fixtures, seed data, historical local state, today’s Supervisor, or AI-authored content.

## Recorded contract decisions

- #371 accepted the DRAFT-only lifecycle, canonical hash, provenance, `workplaceId`, weight boundaries and typed fact set after requiring fail-closed unknowns, fact source versions, typed v1 rules, and strict operator/value shapes. Those corrections are incorporated here.
- #372 accepted the Personnel-root and separated-denominator contract. Its producer emits only period-effective recorded facts, carries `__applicability` version/source/effective metadata, leaves unsupported safety/shift/responsibility facts absent, and never reconstructs historical sections from current Position values.
- Synthetic null Job/Position owner ids remain preview-only and non-importable. Actual import still requires resolved active canonical ids and separate business approval.

## Acceptance status

- Sanitized catalog proposal: **DELIVERED, SYNTHETIC, NOT APPROVED**
- Provenance register: **DELIVERED**
- Evidence dictionary: **DELIVERED, SOURCE OWNERS UNASSIGNED**
- Manifest proposal and validator: **DELIVERED, PRODUCER/CONSUMER CONTRACT AGREED**
- Read-only Personnel-first extraction plan: **DELIVERED, NOT EXECUTED**
- Complete actual Personnel coverage: **UNKNOWN — AUTHORIZED SOURCE UNAVAILABLE**
- Protected named output: **NOT PRODUCED — CUSTODIAN AND DESTINATION UNASSIGNED**
- Company content approval: **NOT EVALUATED**
- Production activation or grading: **NOT AUTHORIZED AND NOT PERFORMED**
