# Approved personnel badge and profile design — 2026-10-04

The user confirmed the combined design after desktop/mobile prototype review. Prototype primary source: `codex/personnel-badge-prototype` at `27272e34`. Discovery context: #345. This implementation contains only the selected design, with no fictional personnel, variant switcher or prototype route gate.

## Presentation

- HR Personnel and Employment Relationships owns the list and tabbed personnel profile. Use compact neumorphic cards and the B-style identity/current-badge sidebar.
- Seven standalone stones retain their identity and colors above elliptical plates and soft radial ground shadows. Stones are 28px in the header, 40px in rows, and 64px in roadmaps.
- Header has no visible name or numeral. Personnel rows keep the adjacent name and gold Roman numeral. Stacked labels have a 4px plate gap, numeral below the name.
- Roadmaps run left-to-right on desktop and vertically on mobile. A current stone is 6px higher with a matching plate ring and `نشان فعلی`. Later levels keep color at reduced opacity/brightness. This is relative-level emphasis, not a permanent attainment record.

## Data and recovery

Keep existing archive/delete confirmations, relationship/assignment mutations, hiring-origin links, evaluation/consequence permissions, driver eligibility, focus/panel URL state and work-schedule drafts. The schedule editor is inside the profile tab; leaving the tab or closing the profile retains the existing discard-confirmation gate.

Score/history disclosure is separately gated by `VIEW_PERFORMANCE_EVALUATIONS`; the existing endpoint enforces Personnel scope. The overview labels the score as the latest final registered result and uses its actual finalized date. Actual final and legacy history remain accessible, including corrected results. No progress-to-next-grade or promotion projection is introduced.

Generated gemstone artwork is promoted into `performance-floating-stones-v1`. Older assets and five-level records remain historical evidence. ADR-0103 records the approved visual update.

## Verification

Sabalan Design System check, foundation (25), adoption (14), frontend build, badge presentation model and personnel URL-state tests passed. Focused browser tests passed for independent history disclosure, repeated schedule-tab selection preserving dirty state, tab/profile discard confirmation, focus restoration, desktop/mobile roadmap order and fading, and responsive dashboard navigation (3 tests). The existing real-local HR work-schedule/time-picker browser test also passed. A separate read-only browser pass with actual local personnel data exercised the list, profile, all four tabs, schedule and mobile overflow. No domain records were mutated by this QA.
