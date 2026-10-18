# Actual native Next actions across a capture pause

Issue #405, after `29f9a837`. This slice exercises the real compiled Inquiry
Next 16.2.6 application and Prisma 6.19.3 inside the existing project's
`inquiry-candidate` diagnostic service. Canonical services were never recreated.

The private immutable image is
`sha256:0a3fa6cb6312ecc01765308bc95ff7eb6fddac22e44630c945d587836c63d6c1`.
`inquiry-native-next-image-20261018.json` preserves its source/build receipt and
the actual exported archive graph. Image preparation now exports and verifies
the archive itself; startup independently rehashes every OCI blob, graph
descriptor, compatibility manifest and complete archive, compares RootFS, and
checks the observer and pure runtime source identities. Five archive tests
also reject body/header corruption, wrong graph sizes, duplicate entries and
an unrelated root. The retained SDK base differs from the source build's
dependency container; the receipt explicitly declines equivalence and
production-build approval. Actual runtime behavior is tested separately.

The image-owned observer is confined to the diagnostic image and refuses
non-private roots. It records an actual HTTP action arrival and the real task
acquisition call. A test-only callback delay retains an already-admitted root
and pending nested work without depending on SQLite's five-second busy wait.
Ordinary production startup has no observer/fault-control option.

The final positive run is
`inquiry-native-pause-903b768998c1a1682640ae32287d508c-5adfe3f8ed053590.json`:

- Actual hydrated CSV import starts; the native guardian publishes CLOSING.
- A second real product action reaches the server and calls admission.
- The first action's nested authorization/import queries finish during CLOSING.
- Under actual inherited EX10, both imported rows exist and the queued row is
  absent. The managed work journal is QUIESCENT.
- After the guardian's normal reopening, the queued product commits once and
  the actual form navigates successfully. Exact imported prices also match.

Spec review caught a false-positive gap in the earlier test: a shared ACTIVE
epoch alone did not prove the second action waited. The final negative control
uses the **same image** with a deliberately faulty diagnostic observer that
disables the CLOSING join check. Both imports complete, but the subsequent
queued-row assertion fails specifically at
`QUEUED_ACTION_ENTERED_CAPTURE_BOUNDARY`. See
`inquiry-native-pause-b568279fefba796920fa2062022239a3-308e5a4485911f88.json`.
The original failed CLOSING record remains intact; it was never reset or
reopened. Both native application guardians subsequently reaped their actual
descendants and closed SQLite naturally. Only their exact exited containers
were removed, without force or volume deletion; scopes and original records
remain retained.

Actual native HTML login/product creation with JavaScript disabled also passed.
Credential-version revocation passed against the real hydrated form: the old
session could not create its product, reauthentication succeeded and the old
credential version was never restored. That test is
`inquiry-native-revocation-5ef3ee1435d73a10.json`; it does not claim draft handoff.

Two earlier diagnostic failures remain retained: a SQLite busy-timeout fixture
was unsuitable for the expanded observation sequence; the initial observer
also rejected a redirect GET carrying the test header. The latter retained a
Next internal HTTP socket during retirement. Read-only native inspection
identified the exact test GET socket after managed work was QUIESCENT and no
native requests remained. Closing only that diagnostic socket let Next and its
guardian finish; no process exit or native force kill was invoked. Its separate
Docker-exec inspector client received the success response, then exited 137
when the container completed. Fresh native census verified closure. See
`inquiry-observer-retirement-20261018.json`. The corrected observer observes
native action POSTs only; final positive and negative retirement needed no such
repair. Original failures were never relabelled as successful pause tests.

Independent read-only Standards and Spec reviews passed all fourteen source
hashes in `inquiry-native-browser-review-r2-20261018.json`, including the final
negative result. That historical freeze's pending flag predates the result;
`inquiry-native-browser-acceptance-20261018.json` binds the final evidence and
closure receipts. Image preparation, actual server operation, archive checks
and tests are distinct evidence. No UI component or business action body was
changed by this slice.

This is native action/admission acceptance, **not** old/new immutable-image
overlap, the full 24-hour form/draft contract, coherent application recovery,
production image admission or completion of Issue #405. Production entry
points remain closed and production application services were not updated.
