## Parent

#75

## What to build

Establish a safe stair-session lifecycle with a fixed product family, complete fresh-session reset, recoverable dirty close, and reliable repeated creation of any number of independent stair configurations.

## Acceptance criteria

- [ ] Product family is read-only inside the opened modal and can change only through a new product selection.
- [ ] Successful finish and explicit discard reset all stair-specific drafts, staged rows, searches, validation, quantity mode, and active part while preserving global UI preferences.
- [ ] A pristine modal closes immediately.
- [ ] A dirty modal first shows the agreed inline continue/discard choice and closes only after explicit discard.
- [ ] Refresh/crash recovery remains independent from intentional discard.
- [ ] Regression coverage proves back-to-back different stair configurations and a contract containing at least thirty independently identified configurations without merge or overwrite.

## Blocked by

#76
