# Immutable browser overlap and producer identity — 2026-10-17

This is local acceptance for Issue #405 / ADR-0131. It does not admit production switching, database changes, an Inquiry release, or a healthy coherent recovery point.

## Frozen runtimes and actual traffic

The native overlap run used `e01ba36fad14d0c046611e078ab5239a0b059e02`, with every exercised JS source hashed in [the intent](retained-ui-overlap-67d8b4abc2154ccaea5e88b55f7a0cb1-intent.json) and [the completed report](retained-ui-overlap-67d8b4abc2154ccaea5e88b55f7a0cb1.json). Diagnostic services were added only to the existing `sabalanerp-local` project. There was no second database/stack and no production operation.

Two completed actual Next 15.5.25 artifacts were frozen with their public/configuration files into read-only images. Runtime startup verifies their complete file manifests. Both image layer prefixes matched the already verified local base; neither frontend had a bind mount or a declared writable image volume. Loopback ports were used throughout.

| Build | Exact diagnostic image | Runtime files / bytes | Static assets |
| --- | --- | --- | --- |
| `erp_20261015t062600z_2b8094d1_release` | `sha256:7962c5edcf434c7f0399844e952d410acbf6f21c43dad5a303f219821de873c6` | 1,382 / 41,198,788 | 273 |
| `erp_draft_handoff_20261017` | `sha256:263d04b2537b6402ad7663db62fed3f35add5705d7d6435b06e6b08fd1b9f2dc` | 1,377 / 41,870,405 | 272 |

The complete real-browser run passed in **86.623 seconds**, with no skipped case: [native TAP](retained-ui-overlap-native-20261017.tap).

- An old login form retained its exact typed identifier/password and did not reload when generation 2 began serving new documents.
- A fresh browser loaded the new build's actual versioned JS/CSS assets.
- An old tab clicked an initially offscreen, unprefetched real Next link after publication. The actual RSC response had private/no-store policy and a durable generation-2 operation intent selecting the old image. There was no injected identity header, patched router or replacement document navigation.
- The proxy drained with no pending work, stopped naturally, restarted, and read generation 2 from immutable history. The exact old asset bytes remained retrievable and matched their manifest hash.
- The new frontend stopped naturally. Its next explicit request failed without retry on the old slot. The uncertain transport intent stayed unresolved.
- Generation 3 switched new documents back to the old code while the original form stayed intact. No database or business-file restoration was used.
- The old and new retirement promises remained in history. This bounded run did **not** wait an actual 24 hours; native routing-history tests independently exercise the exact 24-hour boundary and preserve selection after expiry until handoff is possible.

## Completion and diagnostic retirement

`readStoppedTransport()` observes actual request/outbound-client closure; it does not settle an action or prove application/SQL completion. Durable UNKNOWN still prevents `assertDrained()`, including in a replacement instance. Actual HTTP disconnect/action regressions pass.

The new private diagnostic worker fsyncs a HELD record before stopping with exit 75 when only uncertain outcomes remain. Both normal and obsolete HELD markers are checked **under the native publication lock**, and pending journal entries independently prevent listeners. Two actual Linux marker/acquisition-race regressions passed: [native startup TAP](private-ui-held-startup-native-20261017.tap).

For the accepted run, actual restart of that stopped proxy refused the held root with exit 1. Its unchanged HELD hash and sole unknown GET were preserved; the target frontend had already exited normally before the request. The other frontend stopped normally, and the three exact terminal diagnostic containers were removed without force. Image dependencies and all journal/history/evidence files remain. Canonical backend/frontend/Inquiry/PostgreSQL IDs, images and start times remained unchanged: [retirement receipt](retained-ui-natural-retirement-67d8b4abc2154ccaea5e88b55f7a0cb1.json).

Earlier failed attempts are retained. They exposed absent-vs-null Docker volume metadata, the Windows command-line length limit, an ignored health-check Host override, a half-close management acknowledgement race, prefetch-distorted navigation evidence, an overly strict viewport assumption, and an invalid final login-page link. One **obsolete local diagnostic** controller from an earlier failed run could not exit after retaining UNKNOWN. Its exact identity, closed HTTP ingress, absent native TCP/descendant work, retained native lock and already stopped read-only upstream were verified before terminating only that obsolete controller. UNKNOWN was retained, not converted into completion: [one-off receipt](obsolete-held-ui-retirement-8f417154f543d7ca2ff58268f457a7c7.json). Future workers use the natural HELD shutdown above; this is not a production termination/recovery escape path.

Independent Standards and Spec reviews passed `e01ba36f` for the runtime/hold behavior and `6560e901` for identity-bound diagnostic retirement. The latter records the first accepted run's intentional same-container proxy restart transparently; future runs record that incarnation directly.

## Compiled API producer and cache behavior

`fb4cdbde` binds the compiled browser build ID to ERP Axios, session probes, public confirmation, applicant and scoped native-fetch requests. Callers cannot substitute another build ID. Legacy builds retain absent identity; the header grants no authentication, permissions or release admission.

Real compiled acceptance discovered anonymous public documents being replaced with login after session bootstrap returned 401. The interceptor correction in `8455271ab191215c90ea42f5d30dcb764313d05e` exempts only the public `/`, `/about`, `/contact` paths in addition to the existing public verification paths. Private-route login enforcement and same-owner session retention remain intact. [RED](public-bootstrap-red-20261017.tap) and [GREEN](public-bootstrap-green-20261017.tap) evidence preserve the regression.

The corrected Next build `erp_api_public_bootstrap_20261017` completed compilation, lint/type validation and page generation. Its isolated candidate serves the reviewed public directory read-only as well as the compiled output; it cannot silently inherit an older base-image service worker. The actual served worker hash is checked against source.

Four compiled-browser cases passed in **10.081 seconds** at `bfedb661c249ec198dfd0d75b6867e5ed0f26cb9`: [browser TAP](api-producer-browser-20261017.tap), [candidate/canonical identities](api-public-bootstrap-compiled-slot-20261017.json).

1. Installed Next rejects both runtime identity overrides.
2. Anonymous public navigation remains public, with actual versioned assets and native RSC identity.
3. Session bootstrap and rejected login carry the compiled producer ID and retain form values. Actual worker activation removes the three known legacy private caches, preserves an unrelated cache, returns a fresh 401 instead of a private cache canary, and preserves the open form without reload.
4. An anonymous private dashboard still goes to login; no business write is sent.

Native/ Axios binding tests cover identified and unidentified builds. Session interceptor regressions also cover applicant/public/private transports, rejected identity substitution, fresh session/account ownership, late outcomes and no mutation replay. These tests do not certify every browser transport or old/new API/domain compatibility.

Both frontend builds completed their normal lint/type gates; existing unrelated hook warnings were retained. Notification catch-up's eight cases and the complete contract-creation script passed after these API changes. Commit hooks passed architecture ownership, changed-source design-system adoption and all 25 design-system foundation cases. There were no visual/component changes in this slice.

After the builds ended, only their two explicitly identified `cache/webpack` directories were removed following identity, containment and reparse-point checks. Required runtime manifests and build IDs remained unchanged. This reclaimed 1,677,860,864 filesystem bytes on the local C drive; no business/backup/image data was removed: [owned build-cache receipt](owned-frontend-build-cache-retirement-20261017.json).

## Remaining program gates

Production serving/control/worker fencing, continuous coherent base/WAL/file/deletion/SQLite/privacy recovery, semantic migration activation and old-runtime/domain compatibility, persistent production slot/proxy ownership, Inquiry native action overlap and full release fault/budget acceptance remain required. Existing independent full application restores and the newer base/WAL replay are separate evidence; this browser run does not replace either. Issue #405 remains open and production online mutations/switching remain blocked.
