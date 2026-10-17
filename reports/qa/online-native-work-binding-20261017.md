# Work journals bind their actual native incarnation

The scoped factory now publishes a v2 work claim containing the exact immutable
grant hash and native ACTIVE claim hash, after actual native ownership validation.
The journal copies/freezes these values and checks an expected binding during
inspection. Read-only inspectors can retrieve the binding; legacy v1 claims
remain readable. Arrays or changed bindings are rejected.

The guardian's QUIESCENT record now retains the hash of its exact original ACTIVE
bytes. Actual acceptance reconstructs those bytes and checks both hashes against
the work claim after HTTP/jobs close. This links identity; it does not turn a
QUIESCENT field into fresh fleet, SQL, image or release admission proof.

Actual scoped HTTP/jobs/capture overlap, queued writes, multipart uploads, exact
lost-ack decimals and both worker/capture-owner death refusals passed in
`online-native-a6c5b1ddfb7c67eaea5009c80e9a68af.json`. The test failed before the v2
claim existed (retained diagnostic attempt
`online-native-86d0927923648c975cd0daf6007e5108`). Linux journal/kernel regression
passed 25 cases in `online-native-work-binding-20261017.tap`; legacy native
normal/descendant/lost-client/guardian-death passed in
`native-owner-9fb49459def60fe7e0336d84ec424cb5.json`. Backend TypeScript no-emit,
architecture checks and independent Standards/Spec source reviews passed.

Canonical local services retained their identities. No production schema,
application or traffic changed. This enables exact work/native census linkage;
whole-fleet closure, main startup, semantic migration, recovery and browser/domain
admission still require integration. The full approved program remains open.
