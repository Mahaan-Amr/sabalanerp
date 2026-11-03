# Purchasing titles, dashboard panels, metric navigation and inquiry actions

## Changes

- Explicit inquiry titles are primary case titles and included in server-side search. Stone names remain secondary list context. Newly created cases record `titleIsCustom` in existing JSON data; default generated titles keep the earlier stone/origin description. Legacy custom titles are read without rewriting documents.
- Dashboard work and authorized Sales contracts are alternative canonical segmented panels; their underlying permissions and contract lookup scoping are unchanged.
- Dashboard and register metrics use one shared composition with the same counted/authorized populations and attention-filter destination links. Browser acceptance clicks between registers directly through the metric cards, rather than only from the dashboard.
- Saved inquiries expose canonical eye and plus icon actions labeled «مشاهده استعلام» and «استعلام جدید برای این اقلام/سنگ». The new action opens an independent editable RFQ draft for the same catalog identities with blank quantity/prices and no inherited offers, allocations or commitments. Legacy/raw sources without a usable catalog identity require explicit catalog selection; opening the form never creates a document.
- Case statuses/counts describe recorded and valid supplier proposals, including partial coverage, instead of «پیگیری اقلام استعلام». Price expiry, firm-order financial readiness and commercial history remain unchanged.

## Validation

- Frontend and backend builds passed.
- Sabalan design-system check, foundation and adoption suites passed; database-client architecture check passed.
- Local Purchasing database integration: **141 checks passed**, transaction rolled back. Added checks cover custom title display/search and actual case proposal counts.
- Real browser quotation suite: all five scenarios passed on the verified current frontend source. A later stricter search capture waited for the matching server response and confirmed a single result; that scenario passed as well. A combined rerun experienced a Chrome worker teardown timeout during mobile history; the unchanged mobile scenario passed in a focused run. Failed traces/logs are retained rather than weakening assertions.
- Focused mobile, full workspace, and both real lifecycle scenarios passed. Workspace coverage includes dashboard panel switching, hidden inactive panel content, and clicks from one register's metric cards to the others. Lifecycle covers RFQ → Request → Order → partial receipt/rejection → actual return → replacement, plus explicit reuse of a general quote for a specific need.
- Browser repeat-inquiry coverage verifies the initial fields, blank quantity, unchanged old offer data and unchanged document count before submission.
- Desktop register/action and dashboard-panel screenshots inspected. `git diff --check` passed.

## Local runtime evidence

Initial browser attempts encountered older running images despite successful builds. They are not acceptance evidence. The existing `sabalanerp-local` project was refreshed using temporary image-name overrides at `/tmp/purchasing-register-local-images.yml`; no second project/service/database was created. Current Purchasing frontend file hashes were compared with the workspace before acceptance. Other services and production were not changed by this task.

Evidence:
- `/tmp/purchasing-register-db.log`
- `/tmp/purchasing-register-atomic-qa.log`, `tmp/qa/purchasing-register-atomic`
- `/tmp/purchasing-register-final-qa.log`, `tmp/qa/purchasing-register-final-inquiries` (strict search success; retained worker-shutdown failure)
- `/tmp/purchasing-register-focused-qa.log`, `tmp/qa/purchasing-register-focused-{mobile,workspace,lifecycle}`

No Git commit, push or production deployment.
