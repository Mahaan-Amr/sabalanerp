---
status: accepted
---

# Use the existing seven badges for every Personnel roadmap

The seven current badge names and images are `همراه`, `هم‌ریشه`, `کارساز`, `مانا`, `ستون`, `اثرگذار`, and `الگو`, in that order. Every active Personnel may see this complete roadmap and their own current badge. Seeing another Personnel's current badge still requires the existing permission. This replaces the prospective level names in ADR-0059; the Job-specific criteria and approved calculation remain separate from this display decision.

Following the approved 2026-10-04 prototype, the expanded performance badge uses a horizontal left-to-right route on desktop and a vertical route on mobile in the HR workspace design. Each gemstone floats above a separate elliptical plate with a soft ground shadow; hexagonal surrounds are removed. The current stone is raised slightly and its plate has a ring matching the stone color, with the explicit `نشان فعلی` label. Stages above the current level retain their color with reduced brightness and opacity; the other stages keep their usual appearance. Every stage remains selectable to explain its fixed meaning. Names sit 4px below plates and Roman numerals below the names. The header shows only the stone and plate; personnel rows retain names and gold Roman numerals. The route does not mark earlier stages complete or imply that a level can only increase. `بدون نتیجه رسمی` appears only when no valid official result has determined a current level. An official result may itself assign `همراه`. The former explanatory sentence about the default `همراه` badge is removed.

The five-level badge is no longer a source for the current personal or Personnel-list badge. Former five-level results, their labels, images, scores, and policy versions remain immutable historical evidence, as required by ADR-0059. New official evaluations use only approved seven-level Job criteria; a Job without those criteria retains the default `همراه` display without an official result.

Personnel names and their compact clickable cards open a tabbed personnel profile modal with identity and current badge in the side column on desktop. Tabs cover overview, employment/responsibilities, performance/history, and work schedule. Existing action permissions, backend Personnel scope, schedule draft recovery and discard confirmation remain authoritative. List badge access never grants score/history access. No next-grade progress or promotion state is inferred. Prototype primary source: branch `codex/personnel-badge-prototype` at `27272e34`; related discovery issue: #345.
