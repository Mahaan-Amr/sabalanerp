# #436 local native owner audit — 12 November 2026

This is a read-only finding for the existing `sabalanerp-local` Compose project. It does not authorize clearing the owner record, starting the backend, or admitting a production release.

## Current owner and runtime

- `docker compose -f docker-compose.local.yml ps` identified the six existing services. PostgreSQL, Redis, ClamAV, frontend and Inquiry were healthy. The original backend container `d9b3fa7533bb54d39f355f479814517d71f5d4cdfecb99a8a54a38c28da7af4a`, image `sha256:80e43f635da51a9290281b12a1b0a3b7d0a9ad2da81d41e8111c8a50c8de642d`, was restarting with exit 75. Its image source labels are `unattested`.
- Root-owned mode-0600 `deployment-runtime-native.json` in the existing recovery-coordination volume is SHA-256 `a22e3874e7af624bc804ef91bb792026f13e49ce4d3247082c164848547b3a42`. It says `ACTIVE`, role `standalone`, namespace `sabalan-rt-280d8c76b5fbdcdabe9fcd65764a8d08efbdc2f5d9ecf373`, PostgreSQL system identifier `7703877635514671138`, database OID `57567`, guardian PID 1, boot ID `f0aa7f6f-1563-4d9f-98b1-322a428f5e0f`, PID namespace `pid:[4026532749]`, and birth ticks `83032`.
- The current Docker VM boot ID, observed from the healthy frontend, is `db891a29-1343-421d-9df8-28b3b495cf08`. The original guardian and all its kernel processes cannot still exist on this boot. The backend image's compiled `dist/index.js` does implement completion-aware shutdown, but a VM reboot cannot create its guardian's reaping receipt. Backend logs first show `RUNTIME_NATIVE_AUTHORITY_UNPROVEN` at `2026-11-12T08:02:14Z`; the application had been healthy on the prior boot.
- The live PostgreSQL system identifier still equals the ACTIVE record. A read-only query found zero sessions for its exact namespace, zero sessions with `sabalan-rt-` application names, and zero prepared transactions. The local recovery `state.json` remains `NORMAL`. The `online/` directory is absent; the earlier audit also found no `deployment-online-worker-native.json`.

## Historical evidence and external effects

- The same volume contains six SHA-named `deployment-runtime-native.preserved-*.json` records, all still `ACTIVE` from six other boot IDs, plus the current seventh ACTIVE generation and `local-forced-recovery-incident-*.json` and `local-reboot-incident-*.json` containing two more raw ACTIVE copies. The current record has `previousSha256:null`; these copies do not constitute a verified closure chain. One earlier archived `QUIESCENT` record does say `nativeReaped:true` and `databaseQuiet:true`, but it belongs to another guardian and database OID.
- The current container is `NODE_ENV=development`, `SMS_IR_ENVIRONMENT=sandbox`; its image configuration has no SMS API key or taxpayer broker endpoint, and its Web Push public/private keys are empty. `/app/.env` is absent. These observations reduce the identified outbound-provider risk but do not prove that every application worker or prior local intervention completed. The image's `applicationWorkers.js` starts fifteen ordinary producers. No original reaping receipt or durable per-worker completion record for this ACTIVE instance was found.
- The local backend publishes only a `127.0.0.1` host port in the reviewed Compose file. This is local QA, not public production admission.

## Qualification consequence

The reviewed online-acceptance overlay adds candidate/retained services to the **same** Compose project and uses the existing PostgreSQL and Redis. It does not repair the original backend. The real qualification owners require all ten services, including the original backend, to be healthy; the current restart loop fails that prerequisite. Starting the overlay alone would provide fixture observations, not #432's complete protected checkpoint and rollback rehearsal.

`backend-runtime-owner.py` accepts only `QUIESCENT` with `nativeReaped:true` and `databaseQuiet:true`. It has no expiry or generic ACTIVE reset. The old boot and quiet SQL prove that the old processes cannot still run and that the database is currently quiet; they do **not** prove graceful work completion. Rewriting the record as ordinary `QUIESCENT` would be false. No local state was changed during this audit.

## Narrow local-only recovery proposal

A separate, reviewed incident owner could stop the exact restarting backend container, retain the current ACTIVE bytes and all prior preserved records, and publish a distinct `ABANDONED_ON_VM_REBOOT` receipt with `nativeReaped:false`, `externalEffectsCompleted:false`, and `productionAdmission:false`. Before publication it would own the existing runtime FD9 lock and a PostgreSQL advisory session; pin the exact container/image, old and current boot IDs, current ACTIVE SHA, PostgreSQL system/database identity; reobserve zero old and all tagged sessions and prepared transactions; verify provider configuration and the local-only `sabalanerp-local` service/volume identity; and make a coordinated local data checkpoint. A narrowly guarded local startup path would accept only this exact linked receipt, while the production `QUIESCENT` rule remains unchanged. This is a proposal, not an implemented or authorized recovery. It must not relabel abandonment as native reaping, erase earlier ACTIVE evidence, or claim production qualification.

Until such a protocol is implemented and reviewed, #436 and #432 remain blocked on this local runtime boundary.
