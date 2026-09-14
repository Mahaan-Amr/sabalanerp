---
status: accepted
---

# Use simple KPI-based personnel performance evaluation

Personnel performance evaluation uses the active, versioned workbook profile that matches the Personnel's current organizational unit. Evaluators never choose or assign a profile during daily work. Missing or ambiguous profile matches block evaluation with the short message `فرم ارزیابی آماده نیست`.

Every authorized evaluator uses the same direct `ثبت ارزیابی` action beside the Personnel badge. Human Resources users require `EVALUATE_ALL_PERSONNEL`; Supervisors require `EVALUATE_DIRECT_REPORTS` and are derived from the uniquely occupied supervising Position. Empty or multiply occupied supervisor positions grant no automatic authority. Nobody may evaluate themselves. Suspended Personnel retain their prior badge but cannot receive a new evaluation; ended employment has history but no current badge.

Opening an empty form creates nothing. The evaluator enters actual values and may save a creator-owned draft or finalize directly. Values calculate the weighted score and five-level badge; missing values never count as zero. Multiple evaluations may be finalized on any day in the current month. The newest final result supplies the current badge, while every result remains in history. Corrections are reasoned linked versions: a Supervisor may correct only their own result, while a user with all-Personnel authority may correct any result in scope.

The list shows the level and latest evaluation date, while exact scores remain in authorized history. Badge refresh failure preserves the last valid display. Profile versions affect only evaluations opened after activation. Evaluator identity, authority, profile version, inputs, calculations, corrections, and finalization remain auditable. No result automatically changes compensation, promotion, discipline, or employment.

The independent permissions are `VIEW_PERFORMANCE_EVALUATIONS`, `EVALUATE_DIRECT_REPORTS`, `EVALUATE_ALL_PERSONNEL`, `MANAGE_PERFORMANCE_PROFILES`, and `VIEW_PERFORMANCE_BADGE_LIST`. Job title alone grants nothing. This decision supersedes the operational workflow of ADR-0024 for new simple evaluations; existing final results remain read-only and existing drafts retain their stored profile version.
