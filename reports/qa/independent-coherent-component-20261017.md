# Independent coherent diagnostic restoration

The new coherent diagnostic capture was packaged, encrypted with the existing
multi-recipient recovery codec, independently decrypted on the backup host,
and restored into native PostgreSQL 15.18 with its retained attachment and
SQLite bytes. The PostgreSQL workflow completed normally. **Overall ambient
foreign-container acceptance did not pass:** an unrelated QA container changed
identity during the rehearsal. Its failure is retained explicitly; this is
neither a healthy production recovery point nor full application acceptance.

## Frozen bytes and custody

Source: `coherent-capture-ed752ea87865a7c739282c8b8a9bcd57`, already tested in
[coherent capture acceptance](coherent-component-capture-20261017.md).
Packaging reacquired the actual source capture/control locks, checked fresh
cluster-wide namespace/prepared-work absence, reconstructed the successful
ACTIVE claim from its native closure, and read/hash-verified the actual dump,
file history and independent immutable objects. No live source file was used
as an immutable hardlink.

| Artifact | SHA-256 |
| --- | --- |
| Native source closure | `7751452a8e6149d51901dc06aa0183834a97d873ad3b6b632140d64c6ba69d31` |
| Bounded package, 2,498,560 bytes | `71ce0ab10d5a5e62bdbb752553a1c8224e171de94e847e0efb835a8da33d0412` |
| Package index | `286fef79c6a7111a80ccf29db144b8dffe111d11fa006479f280345f82c208c2` |
| Cipher, 2,499,700 bytes | `51b7d746dd91b5ed3e5dca1d65f3f1668c2b65e0c163b4108b2f627acb8b1962` |
| Seal proof | `49d7a9dd6f590379035a555d23b8508ddf68a48cacd5e71b16f482f15510db73` |
| Independently reviewed file-restore helper | `a3175e4afd4df2872cfef011ec9837178a341ff317217ecf72c9d3a59e882ae0` |
| Executed corrected independent controller | `20f89e5747cf73df05565e9bbfc11885a90f02003085b49d544118402ec70a85` |

The independent RSA private key stayed on the backup server. Its public DER
fingerprint remained `455e5a7ba5990866ca6992c0fd177fa0df5b22b5d3e985c41ee306e3a779b8af`.
The second recipient was a newly generated diagnostic rollback key, explicitly
marked test authority. Only ciphertext, public evidence and reviewed code
were transferred. Both local readback and independent RSA authentication
rejected altered ciphertext. Root-imported restore code additionally required
an external reviewed digest, independently of transferred package metadata.

## Native observations

The exact retrievable OCI graph and all selected layer hashes were verified
before using config `sha256:9b4593c6de443299b46098151fc1ec154c882339b77a56334c7ce612c8a7be6a`.
The retained image archive fingerprint remained
`4ac986e0e795da2700e014af9fd094f447204dc863856df94689732e15708ac7`.
The confined native restore used the existing backup drill project, no network
or public port, a read-only root, dropped capabilities, explicit PGDATA bind,
bounded memory/CPU, actual native subreapers and storage reserves.

- Full native `pg_restore` accepted all 427 migration records.
- The lost-acknowledgement row restored exact amount `123456789.12345678`,
  quantity `0.00000001` and storage reference `original.pdf`.
- The retained attachment restored its exact original bytes; SQLite passed
  native integrity and original-value checks before PostgreSQL startup.
- PostgreSQL stopped normally. Inner and host native owners both issued
  successful reaping receipts. The container was exited, PID zero, exit zero,
  without OOM or `postmaster.pid`.
- The container workflow ran from `2026-10-17T17:24:20.698690747Z` to
  `17:26:13.947068679Z` (113.248 seconds, including initdb and shutdown).
  This is a small diagnostic, not production capture/restore timing.

All fifteen persistent foreign identities/images/start times were unchanged.
An unlabelled foreign QA container named `fintech-price-action-study-qa-20261017`
was replaced during the test. The code retained its strict acceptance failure;
the observation does not establish the replacement's initiator. The preserved
[core proof](coherent-core-f996d3f75fe8434eb801464dbb313734.json) sets
`allForeignAcceptancePassed=false` and
`fullIndependentApplicationAcceptanceStillRequired=true`.

## Faults, ownership and closure

The first attempt refused a stale foreign-service count before any native
mutation. Its exact controller exit, absent mutation intents and absent drill
containers were verified in the retained
[pre-mutation refusal](coherent-premutation-refusal-c83b97c60ea14d2cae7f24402de3c38d.json).

The next attempt exposed a real restrictive-umask defect: a new executable
requested as `0555` became root-only `0500`. UID70 could not execute it;
PostgreSQL never started and PGDATA was empty. The reviewed correction uses
explicit `fchmod` only on new confined copies. The
[native UID70 regression](coherent-file-modes-final-20261017.json) reproduces
the original denial, distinguishes unexpected successful execution using
`false`, executes corrected `true`, and reaps both actual children.

Independent review also caught a real FD collision. The
[native ownership regression](host-lock-inheritance-final-20261017.json)
reproduces temporary descriptors `[8,9]` losing the second lock, then proves
the corrected duplication above FD10 retains both distinct exclusive locks
through actual controller SIGKILL until its native worker finishes and is
reaped. Ownership checks inspect actual descriptor identities and FLOCKs.

One-off reviewed closure tools bound exact controller births, frozen source,
native receipts, actual child absence, terminal container state and original
lock inodes before closing only the idle diagnostic holders. The never-started
and completed containers were removed by exact ID without force. Global
ownership records were archived only after durable closure proof. All failure
journals, ciphertext, decoded bytes, PGDATA and image bytes remain retained.
Mount comparisons normalize order only, preserving every field; reversed-order
and changed-permission regression checks passed.

## Capacity and limits

Reference-aware preflight on both hosts removed zero eligible containers or
images. Production had 34,992,046,080 free bytes; the backup host passed a
**scoped 2 GiB** budget with 3,251,572,736 bytes. This budget covered the small
package, retained 115,880,960-byte image archive, bounded new native PGDATA and
1 GiB reserve. It did not turn the earlier failed 3,758,096,384-byte physical
restore requirement into a pass. Native host/container storage guards also
checked reserve during and after work. Existing healthy production recovery
points and foreign resources were preserved.

The canonical local application services were not restarted or rebuilt.
Independent Standards/Spec reviews resolved code-digest, FD-collision and
mount-order findings before the relevant remote mutations. Python syntax,
Node syntax, actual packaging/sealing, native lock inheritance and native
UID70 checks passed. **No production migration, admission or routing change
was performed.** Actual distributed runtime wiring, continuous production
coherence/privacy, semantic migration activation, Inquiry/browser overlap and
full new-chain application restoration still require acceptance under Issue405.
