# Capture admission scheduling and native journal identity — 2026-10-17

Private integration only. No host pause publisher, fleet closure proof, public startup, production migration or routing change is enabled.

RuntimeBoundaryJournal accepts the exact full-ID hashed PostgreSQL namespace used by the native guardian; historical v1 namespaces remain readable without rewriting their scope bytes. A native RED test reproduced the missing namespace bridge, then literal independently calculated shared-prefix identities and real journal/kernel task admission passed.

RuntimeTaskAdmission accepts an optional capture-fence reader. A closed fence prevents new work joining an existing shared epoch. Paused arrivals wait outside the serialized completion queue; existing tasks can finish, publish QUIESCENT and release the actual gate. The fence is checked again after asynchronous kernel admission and durable activation. Paused waiters count toward retirement and are cancelled before a new epoch can start. Invalid/failed fence observations poison admission; unknown journal/kernel ownership never passes drain.

Native RED reproduced starvation: another arriving task kept the shared gate alive after capture pause. GREEN verified actual exclusive gate acquisition after the prior task completed, the new arrival remaining unstarted, then a fresh epoch after reopening. Retirement while paused completed without creating an epoch. All 21 real Linux tests passed in the existing sabalanerp-local backend; its ID/image/start time were unchanged. Sources were privately compiled; mounted backend/dist was not overwritten.

Evidence: online-native-journal-red-20261017.log; online-native-journal-green-20261017.tap; online-capture-fairness-red-20261017.log; online-capture-fairness-final-20261017.tap. Full backend TypeScript noEmit passed. Independent Standards and Spec reviews passed versus 5e26bcb3.

The fence predicate is scheduling input, not permission to publish OPEN or claim coherent recovery. A durable owner-bound pause lifecycle and independently proven fleet/capture completion are still required before production admission.
