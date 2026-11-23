# Make product QA and periodic recovery drills independent of release

The release owner selects direct deployment, focused tests, or full product QA. Product QA remains available on demand. Missing, failed, or overdue evidence from a periodic isolated restore or deployment and rollback rehearsal does not gate ordinary release admission. This supersedes the earlier admission rules for these exercises and removes the full rehearsal from the mandatory release schedule.

ADR-0039 governs the protected operation. Every deployment requires its own fresh, locally validated checkpoint and full independent remote readback before mutation. Protected migration, health, business-data and rollback gates, reference-aware retention, and independent authorization for separately governed cutovers still apply.

A release can succeed without a recent independent restore exercise. Readback proves the independently held archive matches the locally validated checkpoint. A restore exercise proves recovery with independent custody and supplies its own evidence.

The former drill preflight recursively parsed historical drill sidecars on the independent store. Operators now run that check manually for advisory evidence. An unreadable historical drill sidecar unrelated to the current operation no longer blocks ordinary release admission, and existing retention rules still protect it from cleanup. Independent backup mount identity and capacity checks, validation of the fresh checkpoint, and checks for selected or active checkpoints and retention eligibility still fail closed.
