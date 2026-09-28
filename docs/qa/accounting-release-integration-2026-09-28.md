# Accounting integration evidence — 2026-09-28

## Scope

Integrate the five remaining `codex/issue-387` commits into the accepted accounting workspace, preserve the owner's checkout, and harden the historical import and posting boundaries. This is a code integration, not approval of complete replacement of Sepidar or production authority transfer.

## Evidence from the available backup

The new read-only reconciliation independently compared **12,846 source vouchers and 42,333 source lines** with the actual posted local ledger. Both sides contain exactly the same records and debit/credit totals of **28,378,282,779,868 rials**. No row, account, detail, owner, date, period, version or provenance discrepancy was found. The ledger audit chain verified **30,049 entries**.

The retained report hash is `298370144f6954f4663a2f3f9712b2f57b6f6e0fc85991e5f6b964b53a902fd5`. This proves the imported source ledger only; it does not establish complete inventory costs, missing historical periods, operational subledgers or a valid cutover.

## Changes

- Historical posting and the development-only mutators reject production and other database/book identities. The voucher list presents the same static restriction before the user submits a command.
- Posting compares every actual candidate line with the independent archived source and approved mappings before allocating a statutory number or changing ledger status.
- Source archive import verifies a private copy of the complete export before database mutation. A retry must match the original export and every previously stored immutable row, including its content; counts alone are insufficient.
- Migration records must belong to the hashed package, including on retry. Changed source, tool, scope or predecessor is rejected.
- An unreadable recovery store fails preflight instead of being reported as an empty store.
- Source browsing uses the clicked backup snapshot; accounting fields and known source tables have Persian labels and canonical searchable controls.

## Verification

Focused regression suites cover archive retry corruption, balanced but swapped amounts, missing and extra identities, mapping and period errors, production refusal before database connection, hashed-package binding, and inaccessible recovery storage. A restored PostgreSQL database verifies migration compatibility and transactional migration/archive behavior. Architecture and design-system checks, foundation/adoption suites and frontend accounting behavioral tests pass. Full backend/frontend builds are run against physical dependency copies to avoid the host's shared `node_modules` junction generation issue.

Visual acceptance remains user-owned. No accountant approval or parallel-period result is invented by these tests.

## Reproduce ledger evidence

From `backend`, use the configured approved local database and set the explicit target book, complete snapshot and a new absolute artifact path:

```text
SEPIDAR_TARGET_BOOK_ID
SEPIDAR_SNAPSHOT_ID
SEPIDAR_LEDGER_RECONCILIATION_OUTPUT
npm run accounting:sepidar:reconcile-ledger
```

The command uses a repeatable-read, read-only transaction; it never imports, posts, approves or transfers authority. A discrepancy produces evidence and a nonzero exit code. Existing output files are never overwritten.

## Remaining release boundaries

The user confirmed that only the existing Sepidar backup is available. Missing early-1404 history and inventory movements without authoritative cost remain explicit exceptions. Synthetic QA cannot replace them.

Observed parallel reconciliation, coordinated recovery/cutover and authority-transfer workflows remain unfinished in #387; the corresponding commands fail closed. #388 remains open. Merging this integration must not close either issue or imply that the entire replacement is ready for production.

Production checks and repair of the independent backup connection are authorized separately; deployment itself is not authorized in this request. The repaired connection and observed recovery results must be recorded as operational evidence, not inferred from code tests. The offsite connection currently depends on the user's laptop and must not be described as unattended infrastructure.
