# Selected local QA memory-pressure policy

This successor changes laptop admission, not production deployment or container
budgets. Issues #408/#419 require real health, immutable resources, closed original
children and safe recovery; they do not specify 2 GiB of Windows Available RAM.
The former number was a conservative implementation/runbook policy, not a measured
upper bound for this workload. The explicit policy-change assignment supersedes
that number for this selected successor only.

## Selection and historical evidence

The native launcher emits entry v2 and supervisor-plan v3 with the exact
`memoryPolicy: local-qa-pressure-v1` selection. A new source freeze, operations
source map and constructor pins are required. Old v2 supervisor plans retain their
1536 MiB gate and old receipts retain all their original 1280/1536/2048 meanings.
New candidate receipts explicitly select `localQaMemoryPolicy`; historical receipts
without that selection reject pressure frames even in before/after fields.
Pressure frames have a different `sabalan-local-qa-pressure/v1` schema. A historical
2 GiB sample, saved token, low-RAM fixture or new report never becomes a live
pressure observation or native completion.

Candidate/retained cgroup limits, memory-plus-swap, CPU/PID/OOM policies and the
existing actual 384 MiB actor headroom stay unchanged. The separate retained-browser
1.5 GiB Linux MemAvailable reserve also remains; it is not summed with Windows
Available. Selected retained-browser Windows checks use the same pressure owner,
while legacy rounds keep their original Windows floors. No WSL setting, cache,
swap, image, credential, production gate, backup, SQLite or retention policy is
changed. The pressure collector does not start WSL, Docker or a container.

## What the selected gate measures

The fixed Windows Python collector reads `GetPerformanceInfo` system commit and
physical Available, and queries `LowMemoryResourceNotification`. It then obtains
the actual existing `sabalanerp-local` PostgreSQL container ID through Compose ps
and uses read-only `docker exec ... /bin/cat` for the VM boot ID, memory PSI and
global `oom_kill` counter. Every Docker exec is preceded by its actual Compose ps.
No shell-selected command, guest creation, SQL or application startup is involved.
The Root retains one actual sampler Worker. That sampler retains the existing
asynchronous Python observer, which retains both actual Docker children and their
readers until closure. Output is bounded by
discarding excess bytes and recording failure, without timeout/buffer kills.
Both original collector children must exit zero with both EOFs. A nonzero outer
observer cannot prove its grandchildren closed and marks custody unknown. Unknown/late,
malformed, regressed, changed-incarnation or incomplete observations refuse work.

Available physical RAM is telemetry, not a fixed 2 GiB admission floor. Admission
requires no OS low-memory notification, system commit at most 90% of its actual
limit, VM `full avg10` at most 5% and `some avg10` at most 20%, and no new VM OOM
event. Connection-only preparation retains its separate 512 MiB read-only reserve. These percentages are explicit conservative operating limits, not claims
of empirically proven safe workload size. Commit headroom is virtual backing
capacity, not free physical RAM. PSI measures stalls, not bytes. Cache, swap,
Windows private bytes and guest Available are never added or credited as RAM.
The unchanged cgroup/actor health and OOM gates remain independently mandatory.

Pressure inspection preserves a fixed allowlisted semantic `fault` such as
`QA_MEMORY_PRESSURE_REFUSED`; an assertion's JavaScript code is retained separately
as `faultCode: ERR_ASSERTION`. Worker replies and the final drain receipt preserve
that distinction. Unknown reasons keep their original diagnostic fallback. A
later healthy sample never clears the first fault or promotes the failed attempt.
An OS low-memory notification can refuse work while commit and VM PSI remain
within their limits; do not relabel that event as an OOM or a sampling gap.

The policy JSON and both sampler modules are part of the frozen source. Samples must be at most 5 seconds
old and probe duration at most 2500 ms. During owned heavy work, observations run
every 2 seconds in the retained sampler, independently of synchronous runner
inspection/hash work, with one serialized Python observer and no new heavy lane.
Each observation is persisted before validation. Root validates sequence, gap,
incarnation and OOM on the original live Worker channel; buffered historical
frames grant no admission. A shared atomic fault latch blocks a synchronous actor
request even while Root's message loop is stalled. The existing final pre-UP
port requests a fresh completed sample from this same sampler and checks its
sticky fault. The bounded 16384-attempt journal is never truncated; reservation
occurs before observer creation, and exhaustion stops scheduled probes while
the actual work remains owned. Each record is at most 64KiB, with at most two
records per attempt plus one separate durable closure. The
supervisor requires three good observations before sending a selected command.

## Scheduling and failure

One same-owner heavy lane covers candidate replacement, retained browser rounds,
LOCAL and COMPLETE. Existing required candidate/retained coexistence inside a
qualification is preserved; this is not permission for another coordinator,
parallel catalog, speculative image build or alternate Compose stack.

The Root first captures its complete read-only baseline using the existing
resource, native/SQL quietness, image, SQLite, configuration and disk checks. Host
pressure does not prevent this bounded observation from establishing a valid
restoration path. No heavy replacement is admitted before baseline completion
and fresh pressure validation. A pressure refusal with that baseline stays
negative, verifies the unchanged resources and can close before UP. A failure to
capture a trustworthy baseline, unknown child or lost telemetry remains HELD;
no baseline is synthesized.

A pressure/telemetry/OOM alarm latches, stops admission of another heavy phase or actor request,
and never races a promise to report completion while originals still live.
LOCAL authenticates an honest host-pressure PHASE_REFUSED before forwarding a
new actor request. COMPLETE has signed zero-input WORK_ADMISSION observations on
its existing reader/issuer channels for new Inquiry/frontend and broker
baseline/initialize/HTTP starts. A signed refusal is negative data, not a grant;
CURRENT, fence, shutdown and reader drain remain available. The
same original work, readers and callbacks must settle through their existing
closure owners. END drains the sampler's pending probe. Before recovery or lease
release, DRAIN proves actual observer/reader closure and durable bounded evidence,
then Root awaits the same Worker's natural zero exit. Recovery observations use
the existing local read-only observer after this closure and grant no admission.
The sampler owner, promises and handlers exist before Worker allocation. A proved
preallocation failure alone may release setup custody; a constructor refusal
returns the same no-worker closure port. Post-allocation setup faults retain that
same worker; unexpected loss or uncertain children remains HELD. No replacement
sampler, timeout-kill or Worker.terminate path exists.
No process is killed by this policy. After a known closed failed
UP, the boundary enters a private recovery lane, revalidates identities/quietness
and the exact baseline, then runs the existing non-destructive serial rollback.
Recovery still records pressure, but it does not demand the admission pressure
thresholds that might prevent restoring the old release. This lane cannot admit
new QA work, skip a data/health/lease check, or turn the failed parent into PASS.

If LOCAL/COMPLETE has no genuine typed known-negative closure, pressure failure
retains the lease and original obligations in HELD. It does not infer cleanup
from a child PID, missing process or arbitrary exit code. A signalled or otherwise
ambiguous original, failed restoration, unhealthy/OOM service, changed SQLite,
lost source pin or uncertain evidence likewise stays fail-closed. Successful
milestone reporting retains the same live master for later authorized stages.

## Activation and the current HELD operation

The predecessor at `1d8c8e10`, operation `d475adcf...` / Root `a5c37b99...`, failed
before UP and had no HELD resume or close API. It was subsequently retired by the
separately authorized one-shot r2, with real `ABNORMAL_RETIREMENT_FINISHED` evidence
in `reports/qa/issue-419-c3-bindings-20261026/AUTHORIZED-NATIVE-R2-RETIREMENT-20261031.json`.
Its original shell/supervisor channel 49187 ended. That retirement does not turn
the failed native attempt into acceptance. Neither r2 nor the older a11-only r5
may be replayed or have IDs substituted. More RAM, new code and this report are
never live owner authority.

Before activation: qualify/review a recovery plan bound to the actual current
native owner, obtain its required scoped control-operation decision, prove real
closure and preserved data/resources, integrate the reviewed successor into the
approved execution root, freeze it and regenerate only changed operational pins.
Then take a new lease, fresh production/two-host/storage/namespace/health and local
pressure preflight. No UP/master, production mutation, push or #420 is authorized
by a pressure test or this document. Actual activation and every subsequent
attempt require the original current lease and freshly observed prerequisites.

The first activated pressure-policy connection attempt (`fe82a81e...`, Root
`746512ab...`) passed post-stop pressure admission but failed the exact production
backend incarnation check before inspection/UP/master. Its same owner restored
the frontend and naturally closed, with no remaining frontend obligation. Keep
that negative result. A data-only exact restart projection requires a hash-bound
closed diagnostic, the unchanged full canonical configuration/health checks and
a new preflight; it never repairs production or establishes a restart cause.

## Sources

[Windows memory notifications](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-creatememoryresourcenotification)
describe the system low-memory signal; the neutral range does not imply unlimited
capacity. [GetPerformanceInfo](https://learn.microsoft.com/en-us/windows/win32/api/psapi/nf-psapi-getperformanceinfo)
and [PERFORMANCE_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/api/psapi/ns-psapi-performance_information)
define system-wide commit in pages. These APIs do not prove application acceptance.

## Measured canonical frontend lifecycle

Four event-driven observations run in the existing SAME-owner lifecycle:
`before-stop`, `after-stop`, `before-restore`, `after-restore`. They reuse the
retained pressure observer and fixed read-only Docker ports; there is no polling
collector or second owner. Windows system Available/commit/low-memory queries
bracket each guest read. The guest reports VM meminfo, PSI/OOM and its actual
cgroup/proc anonymous/file/swap facts. The probe itself is included and labelled;
process RSS is not summed, Windows/guest numbers are not added, and no memory
saving is inferred from a missing cgroup. While frontend is stopped the guest
probe runs in existing backend-candidate: frontendCgroup is null, not zero.

A valid pre-stop observation is required before stopping. A metric-validation failure after an authenticated successful outer observer
closure is persisted negatively and cannot prevent safe restoration; an outer
Python failure (including ProbeClosureFailure) still means unknown custody and
HELD, even if its internal finally normally drains children; unknown child custody, evidence-persistence failure, source/lease
loss or resource mismatch still fails closed. Telemetry grants no admission.
Only the actual same-process read-only inspection boundary can permit restoration
in PREPARED_READ_ONLY; no UP/master/COMPLETE/Inquiry transition or open child is
allowed, and baseline/SQLite are revalidated. Public returned data cannot mutate
the private proof. MASTER_RETAINED remains outside this restoration path.

A connection-only cycle restores the same frontend CID/config and releases its
lease; it grants no native admission. The selected successor carries the same
post-UP qualified suspension through only the paired retained-browser peak. The
one original master may enter that pre-input segment while the main development
frontend remains enrolled as stopped. Both retained versions still execute their
required concurrent/native/browser work. LOCAL and COMPLETE do not start there.

Only the same producer's genuine completion, all four original session EOFs,
closed command readers, audited returned browser models/holds, quiet native/SQL
scopes and unchanged original SQLite permit Root's canonical return before the
master input loop/first LOCAL. Root reuses the existing START of the same CID,
image and configuration, validates actual health, RestartCount and a new StartedAt,
and checks the endpoint against the original network/IPAM. Publication, unlink
or readback uncertainty remains fail-closed and cannot issue the current epoch.

The immutable retained report continues to describe its original stopped scope.
A private same-Root acknowledgement transitions that SAME completion to the
verified returned epoch; JSON or removing its old scope cannot do this. The
actual LOCAL factory privately associates its completion with that retained token.
Root joins exact owned report bytes to that token when binding COMPLETE; it never
uses the report's historical stopped selection as current authority.

An epoch receipt is not a fresh health observation. Root's owned census/inspect
ports check the actual frontend identity, PID, StartedAt, RestartCount, full
configuration/mounts/network, health and endpoint before the first LOCAL and at
heavy-lane entry/end and LOCAL completion. Existing COMPLETE actor admission
continues through the fresh full-owner resource/snapshot checks. Drift/unknown
observation denies work; no cache/swap is credited and no pressure fault is reset.

A negative retained parent before return takes the existing canonical rollback,
then restores frontend through the same terminal obligation before lease-last.
A completed return followed by pressure failure stays negative and rolls back
with the new running frontend baseline, without a second START. An uncertain
return or unknown closure remains HELD. Dev heap/config changes are outside this
sequence. Never rebuild unchanged #413 artifacts for this purpose.

Passive post-stop stabilization records raw samples and waits for two consecutive
valid pressure observations before admission. It then rechecks the SAME private
owner latch; an earlier OOM/incarnation/closure fault cannot be cleared by later
healthy readings. This waiting lane starts no heavy QA work.

## Same-Root no-delete storage and post-FULL image stage

File-only COMPLETE readiness uses the existing immutable reader's bounded
`verify()` for material files, tools and source references whose bytes are not
consumed. Revalidation also hashes every byte through a fixed 1 MiB buffer and
rechecks the same descriptor/path identity, size, metadata, nlink and SHA pins.
This is neither a cached verification nor a metadata-only substitute. Files
whose bytes are parsed, packaged or executed still use the exact checked
`read()` buffer. One finite owned-process qualification compares resident peaks
for a real 128 MiB file against the byte-consuming control and covers tamper,
replacement, short reads, I/O failure and descriptor closure. Its result does
not prove that a subsequent native operation will pass memory admission.

Production Docker health and `/api/ready` do not prove that System Recovery is
inactive. The existing same-FD9 Source preflight therefore performs a fixed
read-only recovery observation at its current boundary, immediately before
handing control to backup, and after the actual backup ACK. It requires valid
NORMAL coordination, no pending restore/maintenance/restart/Inquiry-stop marker,
and zero CREATING/VALIDATING/RESTORING operations. The query runs in one actual
read-only transaction; its standalone Prisma client closes in `finally`. The
serial Node probe has a 128 MiB heap cap and returns only metadata, statuses and
timestamps. It imports no application lifecycle or initialization code.

The checked probe and classifier are explicit immutable dependencies in the Root
context, factory, Python owner and rendered Source program. A successful result
must carry all three actual observations. Missing authority, malformed metadata
or active recovery refuses preflight; lost child custody retains the original
owner. These are fresh snapshots, not continuous exclusion of application
recovery by FD9. The same preflight repeats at relevant FULL/image boundaries.
Diagnostic restart reports remain historical evidence; healthy/exit0/OOMfalse
never establishes a normal cause, and a new count is not automatically admitted.

The canonical CLI remains `scripts/run-original-online-qualification-master.mjs`.
Its master implementation and private completion registries live in the single
CLI-free `scripts/lib/original-online-qualification-master.mjs` module. Both the
CLI re-exports and the Root import use that same module instance. The Root must
not await importing the currently evaluating CLI: its native top-level await is
already waiting for that Root. This cycle can leave `masterStarted=true` after
`root-ready` without entering the master body or opening its command reader.
That flag records intent, not genuine LOCAL/COMPLETE readiness or completion.

An actual Node/ESM CLI regression substitutes only the operational native-entry
boundary, creates no runtime/lease, and checks module resolution, retained input,
negative natural closure and shared export identity. It qualifies the source
connection, not native acceptance. A source fix cannot resume an owner already
blocked in the old import cycle. Such an owner requires its own separately
qualified current-identity recovery and actual closure before successor activation;
do not hot-patch it, send commands before readiness, reconstruct completion tokens
or relaunch another owner while its original obligations remain live.

The #419 native entry obtains its first pressure observation from its **own**
sampler through `prepareReadOnlyStorageAdmission`, before starting the finite
two-host storage owner. Supervisor samples cannot seed the Root's private
sampler. This path preserves the C/D/E backing-file and reserve checks. It
repeats the same admission immediately around private credential delivery.

`original-readonly-storage-preflight.mjs` uses the captured unchanged C3
`storage-preflight.mjs` and `deployment-storage.mjs` with fixed `--mode plan`.
It never invokes the installed apply wrappers. The canonical capacity audit is
still appended; this is no deletion, not zero filesystem writes. Source FD9
remains held through the independent backup observation; backup FD9/10 remain
held through its canonical plan. Both actual SSH originals and both EOFs must
close. Private credentials use an operation/sequence/challenge frame on the
same supervised anonymous stdin, never command files or environment variables.
The existing bounded collector redacts even split password echoes and records
that event negatively. No saved receipt grants lease or completion authority.

On backup, `C=1242945672` is the immutable FULL cipher content size, not current
capture authority. The selected R9 `backup_material.py:18` and `prepare.py:98`
require `2C + 64 MiB + 512 MiB`; the canonical backup reserve `B` must additionally
remain available, so preflight requires `B + 2C + 64 MiB + 512 MiB`. R9's separate
`3C` requirement in `prepare.py:151` belongs to Windows material storage and
remains enforced there. Never add independent-host RAM or disk capacity to the
laptop's measurement.

Only genuine SAME Root/LOCAL/FULL completion can select image staging. Both
Windows input absences and the two exact backup transfer paths for that FULL
must still be absent. Staging then requires `B + cipherUpperBound + three block
roundings + 2 MiB bounded metadata + 512 MiB`; it cannot credit future retirement.
Actual image storage separately checks exact allocation, durable readback, full
client retrieval/ACK and backend RSA/GCM/archive identity. Accepted frontend and
Inquiry cipher artifacts are reused; only the changed backend component needs
new crypto. No Docker image import or #420 install starts at this milestone.

A known negative capacity/health result remains negative after proved original
closure. The same master can authorize its existing non-database rollback only
from private failure lineage: drain the pressure worker first, revalidate the
current resources and FULL retirement, restore Inquiry configuration and backend
slots, then verify baseline. LOCAL's verified returned browser slots are not
restarted again. Source/resource mismatch or unknown child custody retains HELD
and its lease. Main SQLite is never copied, migrated, seeded or adopted here.
Finite/model tests qualify these source connections; real connection-only and
LOCAL/COMPLETE/FULL/retrieval receipts remain separately mandatory.

### Continuous denied observations and primary failures

A closed, fresh, structurally valid pressure observation remains a continuity
observation when it denies admission. Record it and advance the observation
cursor before applying pressure admission. Keep the first fault latched; later
healthy frames cannot admit work or replace that fault with a secondary gap.
A genuinely missing/late probe, changed VM/container or OOM still fails closed;
the 4500 ms gap and all probe, pressure and container limits remain unchanged.
The measured f282 retained-browser failure first observed Windows low-memory;
its later gap was reproduced as skipped-denied-frame accounting, not proven
loss of telemetry. That historical native parent remains negative. See
`reports/qa/issue-419-c3-bindings-20261026/DBCD-PRESSURE-SECONDARY-GAP-DIAGNOSIS-20261101.json`.

### Retained-browser negative before the master input loop

The retained-browser producer may issue a private same-Root closed-negative
only after all four original sessions and command readers close cleanly, its
original controller confirms closure, its ERP browser slots have returned, and
fresh protected-resource inspection succeeds. Saved JSON never issues this proof.
The master preserves that producer error across a secondary pressure END error,
checks that no signal-held state arose and returns a private negative terminal
before constructing its input loop. Root must drain the actual sampler, recheck
quietness and original SQLite, validate the full original browser models and
measured reincarnations, then perform its canonical Inquiry/backend rollback
without copying a database. Only a final baseline verification permits normal
terminal closure and lease release. Unknown sampler/session/model/rollback facts
remain HELD. This successor path does not provide a port to an already-held
process running older frozen source; that chain requires separately qualified
bounded recovery under the standing authorization.

## Inquiry observation before authority

The Root captures the initial Inquiry baseline and the pre-authority observation
only from a complete current project inspection whose Inquiry `ExecIDs` is exactly
null. A busy list is recorded as metadata and may receive at most twelve naturally
closed reads within a fifteen-second acceptance budget. The original lease/source
guard runs around each read and after persistence; incarnation, configuration and
all non-transient health fields must remain unchanged while waiting. A late,
malformed, interrupted or still-busy observation refuses; it never kills an exec.
Disappearance proves current quiescence only. The final same-incarnation verifier
still compares the full raw quiet baseline/current inspection, including ExecIDs;
SQLite conservation, native quietness and reader checks remain mandatory. The
negative 38ee attempt is historical evidence, never a reusable acceptance receipt.

## Redundant buffers and browser contexts

The original command collector may release raw chunk copies only after the same
child actually closes and both original streams reach EOF. The complete returned
strings and original identity, bounds, errors and closure records remain intact.
The isolated GC-enabled test measures duplicate buffers, never runtime admission.

The retained Inquiry browser keeps both old unsaved forms across publication.
After current HTML opens and both HTML submissions obtain their durable receipts,
only those two owned HTML contexts retire. Their observers, same live publication,
proxy activity, journal and exclusive non-keepalive Agent sockets must be quiet
before and after closure. The old hydrated form remains alive; current hydrated
opens afterward. All four submissions, assets and RSC checks remain required;
maximum simultaneous owned contexts is three. This partial retirement neither
stops proxy admission nor replaces final proxy drain, original Chrome/readers,
shared actor drain or SQLite closure. Unknown context-close is not retried.

These changes reduce specific duplication/concurrency. They do not quantify the
historical Windows memory cause or promise enough physical memory. The negative
046c retained round and its nine OS low-memory notifications stay negative.


## LOCAL preparation before allocation

A failed `RUN_LOCAL` does not become a recoverable negative from its error text,
report or an absent directory. The same Root binds one fixed qualification call
and request sequence in a private preparation epoch. Attempting registration
revokes early-failure eligibility before any registration assertion can throw.
The fresh current-parent lane excludes legacy helper branches that spawn
unowned historical readers; other selected routes do not inherit this closure.

Initial project inspection and Git reads use the Root's original serial children.
The previously verified Root source snapshot retains its Git-byte proof; current
compiled/material and operations bytes, HEAD, index and working tree are checked
again. Historical capsule provenance remains data-only and is revalidated by its
original pinned-file reader. No compiler, image or original token is recreated.

Raw preparation errors remain pending. After the pressure work's real END, the
Root binds the observed outer error to the original producer error, drains the
same sampler, and proves all allocated observation children, actual EOFs and
receipts. The ledger is registered before spawn. New bookkeeping faults after
retainer setup await that same original child and remain unknown; receipt or
setup faults cannot mint a closed negative. This does not claim that a rejected
retainer initialization alone proves drain.

Source, current protected incarnations, restored frontend/browser epochs,
SQLite bytes/metadata/readers, capsule holds and native/SQL quietness are checked
before a private preparation-negative token can exist. Master queue/control
eligibility is checked again after finalization awaits. A changed source,
incarnation, queued request, cancellation, failed observation or unknown child
retains HELD. Registration or later allocation never uses this early path.

Only that same master/Root may consume the token, return canonical Inquiry and
both backends, verify the complete current baseline and close its existing
lease/input normally. Already-returned frontend and browser slots are preserved.
A return or conservation failure remains HELD. This is a negative closure, not
LOCAL/COMPLETE/FULL acceptance. It cannot repair or adopt an older live owner;
the historical dad2 retirement remains abnormal and negative.
