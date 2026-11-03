# Code continuation snapshot

Source: worktree-000-
Kind: working
Original commit: d9b3caabdca35e98d4eedc868f665df5ffc4cb49

This is a code-only preservation snapshot for moving development to another PC. Its original unpublished ancestry is intentionally not republished because some local histories contain database dumps and large archives. Existing branches, worktrees, indexes and stashes remain unchanged.

It is not an integrated or release-qualified version. Do not merge this snapshot wholesale into main. Compare or cherry-pick reviewed source changes against the current destination branch.

Working snapshots preserve local deletions as observed, including incomplete work. Index and stash snapshots are separately listed in the transfer manifest. Omitted files are operational data, actual environment files, generated outputs, dependency caches and non-source test evidence. Source scripts under reports/tmp are preserved when selected.

Old host paths, image identities, test UUIDs, leases, receipts, job states and permissions do not authorize execution on a new host. Requalify the existing local Compose environment before runtime operations.

reports/qa/ordinary-contract-lifecycle/pdf-smoke.mjs: Local login credential replaced with SABALAN_SMOKE_PASSWORD environment lookup in public snapshot only.
