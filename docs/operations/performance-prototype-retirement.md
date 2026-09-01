# Performance prototype retirement

The production Personnel performance surfaces replace the earlier dashboard prototypes:

- Badge prototype → live personal header Badge and permission-scoped Personnel list Badge.
- Analytics prototype → `/dashboard/hr/personnel/performance/insights`.
- Criteria prototype → `/dashboard/hr/personnel/performance-policies`.

The old dashboard URLs redirect to these canonical surfaces. Badge image assets remain because the live Sabalan Design System component now owns them. Prototype components and the standalone `/prototype` route remain non-production reference material until the expansion/retirement child verifies that no external visual-review workflow still consumes them; they must not be imported by production pages.
