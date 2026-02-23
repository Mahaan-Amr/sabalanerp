## Summary
- [ ] Describe the feature/fix clearly
- [ ] Reference related issue/task

## Validation
- [ ] `npm run build` (frontend/backend as applicable)
- [ ] `npm run text:scan`
- [ ] `npm run text:check` (must pass for finalized text-fix PRs)
- [ ] Security-sensitive paths reviewed (auth, HTML rendering, file upload)

## Encoding Safety Checklist
- [ ] All edited source files are UTF-8 encoded
- [ ] No mojibake markers (`Ø`, `Ù`, `Û`, `Ã`) introduced
- [ ] No accidental placeholder regressions (`???`, `??`) in user-facing strings
- [ ] Persian UI/API strings reviewed in runtime screenshots or staging
