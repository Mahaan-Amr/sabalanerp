---
status: accepted
---

# Scope device personnel movements to Tehran calendar days

On 2026-10-26 the user confirmed that only Guard personnel work overnight and their existing separate manual attendance must remain unchanged. For device-managed personnel, valid movements are scoped to the Tehran calendar day: the first unmatched valid scan of a new day is entry, accounting for valid manual boundaries in that day. A prior-day open interval becomes an explicitly unknown exit when the next valid movement is accepted; no 23:59 exit or morning-entry time is fabricated. This deliberately supersedes ADR-0132's previous-day ambiguity rule for this population. A first scan at 16:00 is still entry unless a manual entry exists; actual forgotten morning entry requires reasoned correction.

Rollover and the new movement are atomic and auditable as system actions under the terminal owner's automation context, with no fabricated human recorder or confirmation. The unknown exit keeps the original day incomplete and reviewable, but alone does not block a new-day movement or Guard shift handover, including through the missing-presence projection. The handover exemption also covers an otherwise unconflicted prior-day open interval before the next scan, without requiring a background job or mutating records during a read. Other conflicts retain their existing review/handover requirements. Pre-activation open history or multiple conflicting open intervals require explicit reconciliation and are not automatically changed. Late/out-of-order evidence, identity, roster, clock validity, replay and activation gates remain in force. Comparison evidence and historical disputed cases are not backfilled or repaired by deployment.

The per-person review dialog defaults to actionable items and separates normal history; correction reasons and timestamps belong to the selected item. This approval covers implementation and tests only on the existing local Docker project, with automatic attendance disabled and all three disputed cases pending. No cloud/device changes, push or deployment are authorized.
