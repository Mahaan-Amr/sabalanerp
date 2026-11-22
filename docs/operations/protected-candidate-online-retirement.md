# Protected candidate: online runtime retirement

Issue #428 removes the unapplied online deployment registry, customer semantic staging barrier, versioned HR file expansion, realtime completion, and serving epoch migrations and their Prisma schema objects. The ordinary backend has one `standalone` role. Its HTTP application, workers, HR invalidation and notification delivery no longer import online release admission or require a candidate/retained slot. Protected release gates use the normal service endpoints and the verified local and remote checkpoint; an online gate context fails closed.

The retired online TypeScript entrypoints, release controllers, runtime composition, migration plan, realtime bridge, and local online acceptance scripts have been removed. Their historical design and QA reports remain available as evidence, without granting production admission.

Four online-named backend modules remain as compatibility and fail-closed recovery guards:

- `onlineRuntimeScope.ts` recognizes an existing native online scope before protected runtime or recovery operations can claim ownership.
- `onlineCheckpointDirectory.ts` classifies older checkpoint directories for reference-aware retention and prevents unverified removal.
- `onlineCaptureAdmission.ts` validates any existing native file capture state; it does not start a capture on its own.
- `continuousOnlineWalState.ts` blocks System Recovery when an old continuous WAL owner has no proven completion.

The backend image retains the Python helpers used by these guards and the protected runtime owner. Removing those helpers before proving old native state absent would turn a recovery preflight into an unverified admission. The online deployment issue history and test evidence are historical only. Future cleanup may rename or remove these guards after inspecting existing coordination state and retaining equivalent fail-closed checks.

The customer source-share workflow remains deferred. Its application command boundary returns `CUSTOMER_SOURCE_SHARES_CLOSED` before mutation without querying the removed online staging table. Existing business migration files for Accounting, Purchasing, Sales/Dispatch, and Attendance remain in the candidate catalog; production applicability still requires the measured ledger, rehearsal, and complete protected release gates.
