---
status: accepted
---

# Preserve device attendance evidence separately from Guard decisions

The attendance terminal does not provide a verified reliable entry/exit direction, and delayed punches may conflict with Guard's manual records. Preserve source punch evidence and identity attribution at occurrence time separately from inferred movements, human corrections and confirmations, rather than inserting every punch as an unquestioned alternating entry/exit or silently rewriting manual history. Ambiguous dependent movements require Guard review; a genuinely unknown exit time remains explicitly unknown while a later real entry may be recorded, avoiding fabricated durations. Personnel names accompany stable identity evidence without becoming matching keys.

The user confirmed the consolidated design on 2026-10-15 and authorized local implementation and tests only. Guards continue to record their own attendance manually through the existing workflow; this integration does not clock them automatically or automate duty-session start/end. This record authorizes no deployment, device write or production change.
