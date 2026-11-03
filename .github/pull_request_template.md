## Summary
- [ ] Describe the feature/fix clearly
- [ ] Reference related issue/task

## Validation
- [ ] `npm run build` (frontend/backend as applicable)
- [ ] `npm run architecture:check` (backend or database changes)
- [ ] `npm run design-system:check` (interactive frontend changes)
- [ ] Relevant behavioral, keyboard, responsive, light/dark, and reduced-motion acceptance completed
- [ ] `npm run text:scan`
- [ ] `npm run text:check` (must pass for finalized text-fix PRs)
- [ ] Security-sensitive paths reviewed (auth, HTML rendering, file upload)
- [ ] Deployment/recovery changes preserve ADR-0039 and `docs/operations/zero-data-loss-deployment.md`

## Encoding Safety Checklist
- [ ] All edited source files are UTF-8 encoded
- [ ] No mojibake markers (`Ø`, `Ù`, `Û`, `Ã`) introduced
- [ ] No accidental placeholder regressions (`???`, `??`) in user-facing strings
- [ ] Persian UI/API strings reviewed in runtime screenshots or staging

## Sabalan Design System
- [ ] Interactive code uses `@/components/erp` and semantic `--sds-*` meanings
- [ ] No new raw palette, legacy glass, native feature controls, clickable non-controls, or duplicated primitives
- [ ] UX simplification preserves permissions, calculations, persisted meaning, recovery, and audit history
- [ ] Any exception is narrow, owned, evidenced, and has a removal or system-addition path
